import {createHash,randomBytes} from 'node:crypto';

const DAY=86400000,COOKIE='vc_site_sales',INTEREST_COOKIE='vc_site_sales_interest',MAX_EVENTS=160;
const TYPES=new Set(['context','invitation','open','dismiss','message','offer_click']);
const CLIENT_TYPES=new Set(['invitation','open','dismiss','offer_click']);
const ASSETS=new Set(['product','service','course','affiliate','group','prayer','navigation']);
const APPROACHES=['helpful_question','simple_choices','direct_product','checkout_help'];
const ORDERS={marketplace:{table:'marketplace_orders',status:'payment_status',amount:'total_cents'},digital_service:{table:'service_orders',status:'status',amount:'amount_cents'},video_package:{table:'service_orders',status:'status',amount:'amount_cents'},course:{table:'course_orders',status:'status',amount:'amount_cents'}};
const hash=value=>createHash('sha256').update(value).digest('hex');
const iso=value=>value==null?null:new Date(value).toISOString();
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const cleanId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value)?value:'';

/** Anonymous, first-party conversation measurement. Client events are funnel
 * hints, never payment/signup proof. No message bodies, auth tokens, IPs, email
 * addresses or external affiliate-sale guesses are persisted here. */
export function setupSiteSalesExperience({app,db,requireAdmin,siteUrl='https://vitrinecity.com',canRun=()=>true,schedule=true,now=Date.now}){
  const origin=new URL(siteUrl).origin,secure=new URL(siteUrl).protocol==='https:';
  const requestSessions=new WeakMap();
  db.exec(`CREATE TABLE IF NOT EXISTS site_sales_versions(
    id INTEGER PRIMARY KEY,number INTEGER NOT NULL UNIQUE,parent_version_id INTEGER,
    approach TEXT NOT NULL,status TEXT NOT NULL,reason_code TEXT NOT NULL,confidence TEXT NOT NULL,
    created_at INTEGER NOT NULL,activated_at INTEGER NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_site_sales_active ON site_sales_versions(status) WHERE status='active';
    CREATE TABLE IF NOT EXISTS site_sales_policy(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,
    active_version_id INTEGER NOT NULL,last_review_at INTEGER NOT NULL,last_change_at INTEGER NOT NULL,last_status TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS site_sales_sessions(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,
    version_id INTEGER NOT NULL REFERENCES site_sales_versions(id),created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_site_sales_expiry ON site_sales_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS site_sales_interests(token_hash TEXT PRIMARY KEY,session_id TEXT NOT NULL UNIQUE REFERENCES site_sales_sessions(id),expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS site_sales_offers(session_id TEXT NOT NULL REFERENCES site_sales_sessions(id),
    asset_type TEXT NOT NULL,asset_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(session_id,asset_type,asset_id));
    CREATE TABLE IF NOT EXISTS site_sales_events(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES site_sales_sessions(id),
    version_id INTEGER NOT NULL REFERENCES site_sales_versions(id),event_type TEXT NOT NULL,asset_type TEXT NOT NULL DEFAULT '',
    asset_id TEXT NOT NULL DEFAULT '',outcome TEXT NOT NULL DEFAULT '',duration_ms INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_site_sales_events_window ON site_sales_events(version_id,created_at,event_type);
    CREATE INDEX IF NOT EXISTS idx_site_sales_events_session ON site_sales_events(session_id,event_type,created_at);
    CREATE TABLE IF NOT EXISTS site_sales_order_attribution(order_type TEXT NOT NULL,order_reference TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES site_sales_sessions(id),version_id INTEGER NOT NULL REFERENCES site_sales_versions(id),
    created_at INTEGER NOT NULL,payment_status TEXT NOT NULL DEFAULT 'pending',amount_cents INTEGER NOT NULL DEFAULT 0,
    payment_id_hash TEXT NOT NULL DEFAULT '',approved_at INTEGER,updated_at INTEGER NOT NULL,PRIMARY KEY(order_type,order_reference));
    CREATE UNIQUE INDEX IF NOT EXISTS idx_site_sales_order_once ON site_sales_order_attribution(order_reference);
    CREATE TABLE IF NOT EXISTS site_sales_signups(user_id INTEGER PRIMARY KEY,session_id TEXT NOT NULL REFERENCES site_sales_sessions(id),
    version_id INTEGER NOT NULL REFERENCES site_sales_versions(id),created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS site_sales_reviews(id INTEGER PRIMARY KEY,version_id INTEGER NOT NULL,
    window_start INTEGER NOT NULL UNIQUE,window_end INTEGER NOT NULL,status TEXT NOT NULL,
    metrics_json TEXT NOT NULL,new_version_id INTEGER,created_at INTEGER NOT NULL);`);
  db.transaction(()=>{
    if(db.prepare('SELECT 1 FROM site_sales_policy WHERE id=1').get())return;
    const stamp=now(),version=db.prepare("INSERT INTO site_sales_versions(number,approach,status,reason_code,confidence,created_at,activated_at) VALUES(1,'helpful_question','active','initial','unmeasured',?,?)").run(stamp,stamp).lastInsertRowid;
    db.prepare("INSERT INTO site_sales_policy VALUES(1,1,?,?,?,'collecting')").run(version,stamp,stamp);
  }).immediate();
  const policy=()=>db.prepare('SELECT * FROM site_sales_policy WHERE id=1').get();
  const version=id=>db.prepare('SELECT * FROM site_sales_versions WHERE id=?').get(id);
  const dto=row=>row?{id:row.id,versionId:row.version_id,versionNumber:version(row.version_id)?.number,approach:version(row.version_id)?.approach}:null;
  function cookieToken(req,name=COOKIE){
    const parts=String(req.headers?.cookie||'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(name+'='));
    if(parts.length!==1)return '';
    const token=parts[0].slice(name.length+1);return /^[A-Za-z0-9_-]{32}$/.test(token)?token:'';
  }
  function existingSession(req){
    const remembered=requestSessions.get(req);if(remembered)return dto(db.prepare('SELECT * FROM site_sales_sessions WHERE id=? AND expires_at>?').get(remembered,now()));
    const token=cookieToken(req);if(!token)return null;
    return dto(db.prepare('SELECT * FROM site_sales_sessions WHERE token_hash=? AND expires_at>?').get(hash(token),now()));
  }
  function session(req,res){
    const existing=existingSession(req);if(existing)return existing;
    const stamp=now(),id=randomBytes(18).toString('base64url'),token=randomBytes(24).toString('base64url'),active=policy().active_version_id;
    db.prepare('INSERT INTO site_sales_sessions VALUES(?,?,?,?,?)').run(id,hash(token),active,stamp,stamp+DAY);
    res.cookie(COOKIE,token,{httpOnly:true,sameSite:'lax',secure,maxAge:DAY,path:'/'});
    requestSessions.set(req,id);
    return dto({id,version_id:active});
  }
  const live=id=>typeof id==='string'?db.prepare('SELECT * FROM site_sales_sessions WHERE id=? AND expires_at>?').get(id,now()):null;
  function registerOffers(sessionId,offers){
    if(!live(sessionId))return false;
    const rows=(Array.isArray(offers)?offers:[]).slice(0,12).filter(item=>ASSETS.has(item?.assetType)&&cleanId(item?.assetId));
    const save=db.prepare('INSERT OR IGNORE INTO site_sales_offers VALUES(?,?,?,?)');
    db.transaction(()=>{for(const item of rows)save.run(sessionId,item.assetType,item.assetId,now());})();return true;
  }
  function recordEvent(sessionId,type,detail={}){
    const current=live(sessionId);if(!current||!TYPES.has(type))return false;
    let assetType='',assetId='';
    if(type==='offer_click'){
      assetType=detail.assetType;assetId=cleanId(detail.assetId);
      if(!ASSETS.has(assetType)||!assetId||!db.prepare('SELECT 1 FROM site_sales_offers WHERE session_id=? AND asset_type=? AND asset_id=?').get(sessionId,assetType,assetId))return false;
    }
    if(db.prepare('SELECT COUNT(*) n FROM site_sales_events WHERE session_id=?').get(sessionId).n>=MAX_EVENTS)return false;
    // One exposure/open/dismiss/click per session/asset. Messages count actual
    // validated requests, and can only be recorded by server code.
    const id=type==='message'?randomBytes(18).toString('hex'):hash([sessionId,type,assetType,assetId].join('|'));
    return !!db.prepare('INSERT OR IGNORE INTO site_sales_events(id,session_id,version_id,event_type,asset_type,asset_id,created_at) VALUES(?,?,?,?,?,?,?)').run(id,sessionId,current.version_id,type,assetType,assetId,now()).changes;
  }
  function recordOutcome(sessionId,{outcome,durationMs=0}={}){
    const current=live(sessionId);if(!current||!['answered','fallback','failed'].includes(outcome))return false;
    if(db.prepare('SELECT COUNT(*) n FROM site_sales_events WHERE session_id=?').get(sessionId).n>=MAX_EVENTS)return false;
    const duration=Number.isFinite(durationMs)?Math.max(0,Math.min(120000,Math.round(durationMs))):0;
    db.prepare('INSERT INTO site_sales_events(id,session_id,version_id,event_type,outcome,duration_ms,created_at) VALUES(?,?,?,\'response\',?,?,?)').run(randomBytes(18).toString('hex'),sessionId,current.version_id,outcome,duration,now());return true;
  }
  function markInterest(req,res,type,detail={}){
    if(!['message','offer_click'].includes(type))return false;
    const current=existingSession(req);if(!current)return false;
    const recorded=recordEvent(current.id,type,detail);
    const repeatedClick=type==='offer_click'&&ASSETS.has(detail.assetType)&&cleanId(detail.assetId)&&db.prepare("SELECT 1 FROM site_sales_events WHERE session_id=? AND event_type='offer_click' AND asset_type=? AND asset_id=?").get(current.id,detail.assetType,detail.assetId);
    if(!recorded&&!repeatedClick)return false;
    const token=randomBytes(24).toString('base64url');
    db.prepare('INSERT INTO site_sales_interests(token_hash,session_id,expires_at) VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at').run(hash(token),current.id,now()+DAY);
    res.cookie(INTEREST_COOKIE,token,{httpOnly:true,sameSite:'lax',secure,maxAge:DAY,path:'/'});return true;
  }
  function interested(req){
    const token=cookieToken(req,INTEREST_COOKIE);
    if(token){const row=db.prepare('SELECT s.* FROM site_sales_interests i JOIN site_sales_sessions s ON s.id=i.session_id WHERE i.token_hash=? AND i.expires_at>?').get(hash(token),now());if(row)return dto(row);}
    const current=existingSession(req);if(!current)return null;
    return db.prepare("SELECT 1 FROM site_sales_events WHERE session_id=? AND event_type IN ('message','offer_click') AND created_at>=? LIMIT 1").get(current.id,now()-DAY)?current:null;
  }
  function orderRow(orderType,reference){
    const spec=ORDERS[orderType];if(!spec||!cleanId(reference))return null;
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(spec.table))return null;
    const owner=orderType==='marketplace'?',buyer_user_id':orderType==='course'?',user_id':'';
    return db.prepare(`SELECT reference,${spec.status},${spec.amount},mp_payment_id${owner} FROM ${spec.table} WHERE reference=?`).get(reference);
  }
  const canApplyLiaDiscount=req=>Boolean(interested(req));
  function captureOrder(req,{orderType,orderReference}={}){
    const current=interested(req),order=orderRow(orderType,orderReference);if(!current||!order)return false;
    if(orderType==='marketplace'&&(!Number.isSafeInteger(req.user?.id)||order.buyer_user_id!==req.user.id))return false;
    if(orderType==='course'&&order.user_id!=null&&order.user_id!==req.user?.id)return false;
    const stamp=now();return !!db.prepare('INSERT OR IGNORE INTO site_sales_order_attribution(order_type,order_reference,session_id,version_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(orderType,orderReference,current.id,current.versionId,stamp,stamp).changes;
  }
  function recordSignup(req,userId){
    const current=interested(req);if(!current||!Number.isSafeInteger(userId)||userId<=0)return false;
    if(!db.prepare('SELECT 1 FROM users WHERE id=?').get(userId))return false;
    return !!db.prepare('INSERT OR IGNORE INTO site_sales_signups VALUES(?,?,?,?)').run(userId,current.id,current.versionId,now()).changes;
  }
  function recordPayment({orderType,orderReference,status,amountCents,paymentId}={}){
    if(!['approved','refunded','charged_back','cancelled','rejected','pending','in_process','authorized','in_mediation'].includes(status))return false;
    const order=orderRow(orderType,orderReference),spec=ORDERS[orderType];if(!order||order[spec.status]!==status)return false;
    if(typeof paymentId!=='string'||!paymentId||paymentId.length>160||String(order.mp_payment_id||'')!==paymentId)return false;
    if(!Number.isSafeInteger(amountCents)||amountCents<0||amountCents!==order[spec.amount])return false;
    if(orderType==='marketplace'&&!db.prepare('SELECT 1 FROM marketplace_payment_events WHERE order_reference=? AND payment_id=? AND payment_status=?').get(orderReference,paymentId,status))return false;
    let approvedAt=null;
    if(orderType==='course'&&status==='approved'&&db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='course_payment_receipts'").get()){
      const receipt=db.prepare("SELECT approved_ms FROM course_payment_receipts WHERE order_reference=? AND payment_id=? AND status='approved' AND amount_cents=?").get(orderReference,paymentId,amountCents);
      if(Number.isSafeInteger(receipt?.approved_ms)&&receipt.approved_ms>0&&receipt.approved_ms<=now())approvedAt=receipt.approved_ms;
    }
    // Amount/status/id were first settled by the payment integration. A later
    // approved callback cannot overwrite a currently refunded order.
    return !!db.prepare(`UPDATE site_sales_order_attribution SET payment_status=?,amount_cents=?,payment_id_hash=?,
      approved_at=CASE WHEN ?='approved' THEN COALESCE(?,approved_at,?) ELSE approved_at END,updated_at=? WHERE order_type=? AND order_reference=?`)
      .run(status,amountCents,hash(paymentId),status,approvedAt,now(),now(),orderType,orderReference).changes;
  }
  function metrics(versionId,start,end){
    const rows=db.prepare(`SELECT event_type,COUNT(*) events,COUNT(DISTINCT session_id) sessions FROM site_sales_events
      WHERE version_id=? AND created_at>=? AND created_at<? GROUP BY event_type`).all(versionId,start,end),by=Object.fromEntries(rows.map(row=>[row.event_type,row]));
    const paid=db.prepare(`SELECT COUNT(*) count,COALESCE(SUM(amount_cents),0) revenue FROM site_sales_order_attribution
      WHERE version_id=? AND payment_status='approved' AND approved_at>=? AND approved_at<?`).get(versionId,start,end);
    const pending=db.prepare(`SELECT COUNT(*) count FROM site_sales_order_attribution WHERE version_id=? AND payment_status IN ('pending','in_process') AND created_at>=? AND created_at<?`).get(versionId,start,end);
    const signups=db.prepare('SELECT COUNT(*) count FROM site_sales_signups WHERE version_id=? AND created_at>=? AND created_at<?').get(versionId,start,end).count;
    const failures=db.prepare("SELECT outcome,COUNT(*) count FROM site_sales_events WHERE version_id=? AND event_type='response' AND created_at>=? AND created_at<? GROUP BY outcome").all(versionId,start,end);
    const sessions=db.prepare("SELECT COUNT(DISTINCT session_id) n FROM site_sales_events WHERE version_id=? AND event_type IN ('context','message') AND created_at>=? AND created_at<?").get(versionId,start,end).n;
    return {windowStart:iso(start),windowEnd:iso(end),sessions,invitations:by.invitation?.sessions||0,opens:by.open?.sessions||0,dismissals:by.dismiss?.sessions||0,messages:by.message?.events||0,messagingSessions:by.message?.sessions||0,offerClicks:by.offer_click?.events||0,offerClickSessions:by.offer_click?.sessions||0,signups,paidOrders:paid.count,revenueCents:paid.revenue,pendingOrders:pending.count,responseOutcomes:Object.fromEntries(failures.map(x=>[x.outcome,x.count])),externalSales:'unknown'};
  }
  const versionDto=item=>({id:item.id,number:item.number,parentVersionId:item.parent_version_id,approach:item.approach,status:item.status,reasonCode:item.reason_code,confidence:item.confidence,createdAt:iso(item.created_at),activatedAt:iso(item.activated_at)});
  function recentOrders(){
    const columns=new Map(),has=(table,column)=>{
      if(!columns.has(table))columns.set(table,new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(item=>item.name)));
      return columns.get(table).has(column);
    };
    const titleText=value=>String(value||'').replace(/<[^>]*>/g,'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,160);
    return db.prepare(`SELECT a.order_type,a.order_reference,a.payment_status,a.amount_cents,a.created_at,a.approved_at,v.number
      FROM site_sales_order_attribution a JOIN site_sales_versions v ON v.id=a.version_id
      WHERE a.order_type IN ('marketplace','course','digital_service','video_package')
      ORDER BY a.created_at DESC,a.order_reference DESC LIMIT 20`).all().map(item=>{
      const spec=ORDERS[item.order_type],hasTitle=item.order_type==='course'&&has(spec.table,'course_title');
      const source=has(spec.table,spec.amount)?db.prepare(`SELECT ${spec.amount} amount${hasTitle?',course_title title':''} FROM ${spec.table} WHERE reference=?`).get(item.order_reference):null;
      let title=titleText(source?.title)||({course:'Curso digital',marketplace:'Pedido de produtos',digital_service:'Serviço digital',video_package:'Pacote de vídeos'}[item.order_type]);
      if(item.order_type==='marketplace'&&has('marketplace_order_items','product_name')&&has('marketplace_order_items','id')){
        const products=db.prepare('SELECT product_name FROM marketplace_order_items WHERE order_reference=? ORDER BY id LIMIT 2').all(item.order_reference);
        const first=titleText(products[0]?.product_name);if(first)title=first+(products.length>1?' e outros itens':'');
      }
      // Expected source value is useful while the attribution is pending (0).
      // Reading an order does not settle its payment or change paid metrics.
      const amount=source?.amount??item.amount_cents;
      return {orderType:item.order_type,orderReference:item.order_reference,title,paymentStatus:item.payment_status,
        amountCents:Number.isSafeInteger(amount)&&amount>=0?amount:0,createdAt:iso(item.created_at),approvedAt:iso(item.approved_at),versionNumber:item.number};
    });
  }
  function snapshot(){
    const state=policy(),stamp=now(),current=version(state.active_version_id);
    const versions=db.prepare(`SELECT v.*,(SELECT COUNT(*) FROM site_sales_order_attribution a WHERE a.version_id=v.id AND a.payment_status='approved') paid_orders,
      (SELECT COALESCE(SUM(amount_cents),0) FROM site_sales_order_attribution a WHERE a.version_id=v.id AND a.payment_status='approved') revenue_cents,
      (SELECT COUNT(*) FROM site_sales_signups s WHERE s.version_id=v.id) signups FROM site_sales_versions v ORDER BY number DESC LIMIT 50`).all();
    return {revision:state.revision,recentOrders:recentOrders(),current:versionDto(current),metrics:metrics(current.id,Math.max(current.activated_at,stamp-DAY),stamp+1),review:{lastAt:iso(state.last_review_at),nextAt:iso(Math.max(state.last_review_at,state.last_change_at)+DAY),status:state.last_status},versions:versions.map(item=>({...versionDto(item),paidOrders:item.paid_orders,revenueCents:item.revenue_cents,signups:item.signups})),history:db.prepare('SELECT version_id,window_start,window_end,status,metrics_json,new_version_id FROM site_sales_reviews ORDER BY id DESC LIMIT 30').all().map(item=>({versionId:item.version_id,windowStart:iso(item.window_start),windowEnd:iso(item.window_end),status:item.status,metrics:JSON.parse(item.metrics_json),newVersionId:item.new_version_id}))};
  }
  function addVersion(previous,approach,reason,confidence,stamp){
    db.prepare("UPDATE site_sales_versions SET status='superseded' WHERE id=? AND status='active'").run(previous.id);
    const number=db.prepare('SELECT MAX(number)+1 n FROM site_sales_versions').get().n;
    const id=db.prepare("INSERT INTO site_sales_versions(number,parent_version_id,approach,status,reason_code,confidence,created_at,activated_at) VALUES(?,?,?,'active',?,?,?,?)").run(number,previous.id,approach,reason,confidence,stamp,stamp).lastInsertRowid;
    db.prepare('UPDATE site_sales_policy SET active_version_id=?,last_change_at=? WHERE id=1').run(id,stamp);return Number(id);
  }
  function review(){
    if(!canRun())return {status:'paused',changed:false};
    return db.transaction(()=>{
      const state=policy(),stamp=now();if(stamp<Math.max(state.last_review_at,state.last_change_at)+DAY)return {status:'collecting',changed:false};
      const current=version(state.active_version_id),data=metrics(current.id,state.last_review_at,stamp),confidence=data.sessions<20?'low':'limited';
      let status='no_traffic',newId=null;
      if(data.paidOrders)status='conversion_observed';
      else if(data.sessions>0){
        if(data.pendingOrders)status='awaiting_payment';
        else{
          const reason=data.signups?'signups_without_paid_orders':!data.opens?'few_opens':!data.messages?'few_messages':!data.offerClicks?'few_offer_clicks':'no_attributed_payment';
          let approach=!data.opens?'helpful_question':!data.messages?'simple_choices':!data.offerClicks?'direct_product':'checkout_help';
          if(approach===current.approach)approach=APPROACHES[(APPROACHES.indexOf(approach)+1)%APPROACHES.length];
          newId=addVersion(current,approach,reason,confidence,stamp);status=confidence==='low'?'trial_low_traffic':'trial_started';
        }
      }
      db.prepare('INSERT INTO site_sales_reviews(version_id,window_start,window_end,status,metrics_json,new_version_id,created_at) VALUES(?,?,?,?,?,?,?)').run(current.id,state.last_review_at,stamp,status,JSON.stringify(data),newId,stamp);
      db.prepare('UPDATE site_sales_policy SET revision=revision+1,last_review_at=?,last_status=? WHERE id=1').run(stamp,status);
      return {status,changed:newId!==null,versionId:newId,metrics:data};
    }).immediate();
  }
  function rollback({versionId,revision}={}){
    if(!Number.isSafeInteger(versionId)||versionId<1)throw fail('Escolha uma versão anterior válida.');
    db.transaction(()=>{
      const state=policy();if(revision!==undefined&&revision!==state.revision)throw fail('O painel mudou. Atualize antes de restaurar.',409);
      const target=version(versionId),current=version(state.active_version_id);if(!target||target.id===current.id)throw fail('Escolha uma versão anterior disponível.',409);
      if(current.reason_code==='rollback_version_'+target.number&&current.approach===target.approach)return;
      const stamp=now();addVersion(current,target.approach,'rollback_version_'+target.number,'manual',stamp);
      db.prepare("UPDATE site_sales_versions SET status='rolled_back' WHERE id=?").run(current.id);
      db.prepare("UPDATE site_sales_policy SET revision=revision+1,last_review_at=?,last_status='manual_rollback' WHERE id=1").run(stamp);
    }).immediate();return snapshot();
  }
  function cleanup(){
    const stamp=now(),cutoff=stamp-30*DAY;
    // Functional handles expire at 24h. Keep aggregate review history and the
    // original version of verified sales/signups; never move private chat text.
    return db.transaction(()=>{
      db.prepare('DELETE FROM site_sales_interests WHERE token_hash IN (SELECT token_hash FROM site_sales_interests WHERE expires_at<=? LIMIT 5000)').run(stamp);
      db.prepare('DELETE FROM site_sales_offers WHERE session_id IN (SELECT DISTINCT o.session_id FROM site_sales_offers o JOIN site_sales_sessions s ON s.id=o.session_id WHERE s.expires_at<=? LIMIT 5000)').run(stamp);
      db.prepare("UPDATE site_sales_sessions SET token_hash='expired:'||id WHERE id IN (SELECT id FROM site_sales_sessions WHERE expires_at<=? AND token_hash NOT LIKE 'expired:%' LIMIT 5000)").run(stamp);
      db.prepare('DELETE FROM site_sales_events WHERE id IN (SELECT id FROM site_sales_events WHERE created_at<? LIMIT 10000)').run(cutoff);
      db.prepare(`DELETE FROM site_sales_sessions WHERE id IN (SELECT s.id FROM site_sales_sessions s WHERE s.expires_at<?
        AND NOT EXISTS(SELECT 1 FROM site_sales_order_attribution a WHERE a.session_id=s.id)
        AND NOT EXISTS(SELECT 1 FROM site_sales_signups a WHERE a.session_id=s.id)
        AND NOT EXISTS(SELECT 1 FROM site_sales_interests a WHERE a.session_id=s.id)
        AND NOT EXISTS(SELECT 1 FROM site_sales_events a WHERE a.session_id=s.id)
        AND NOT EXISTS(SELECT 1 FROM site_sales_offers a WHERE a.session_id=s.id) LIMIT 5000)`).run(cutoff);
    }).immediate();
  }
  const sameOrigin=(req,res,next)=>req.get('origin')===origin?next():res.status(403).json({error:'Origem não autorizada.'});
  const route=fn=>(req,res)=>{res.set('Cache-Control','no-store');try{return fn(req,res);}catch(error){return res.status(error.status||503).json({error:error.status?error.message:'Não foi possível consultar a experiência agora.'});}};
  app.post('/api/site-assistant/event',sameOrigin,route((req,res)=>{
    const current=existingSession(req);if(!current)return res.status(409).json({error:'Abra o assistente antes de registrar a interação.'});
    const body=req.body;if(!body||typeof body!=='object'||Array.isArray(body)||!CLIENT_TYPES.has(body.type)||Object.keys(body).some(key=>!['type','assetType','assetId'].includes(key)))return res.status(400).json({error:'Interação inválida.'});
    if(body.type!=='offer_click'&&(body.assetType!==undefined||body.assetId!==undefined))return res.status(400).json({error:'Interação inválida.'});
    if(body.type==='offer_click'&&(!ASSETS.has(body.assetType)||!cleanId(body.assetId)||!db.prepare('SELECT 1 FROM site_sales_offers WHERE session_id=? AND asset_type=? AND asset_id=?').get(current.id,body.assetType,body.assetId)))return res.status(400).json({error:'Oferta não disponível nesta conversa.'});
    if(body.type==='offer_click')markInterest(req,res,body.type,body);else recordEvent(current.id,body.type,body);return res.status(204).end();
  }));
  app.get('/api/admin/site-assistant/experiments',requireAdmin,route((_req,res)=>res.json(snapshot())));
  app.post('/api/admin/site-assistant/experiments/rollback',requireAdmin,sameOrigin,route((req,res)=>res.json(rollback(req.body))));
  let timer=null;if(schedule){timer=setInterval(()=>{try{cleanup();review();}catch{/* A reporting failure must not affect checkout or conversation. */}},5*60*1000);timer.unref?.();}
  return {session,existingSession,recordEvent,recordOutcome,markInterest,registerOffers,canApplyLiaDiscount,captureOrder,recordSignup,recordPayment,snapshot,review,rollback,cleanup,close(){clearInterval(timer);}};
}
