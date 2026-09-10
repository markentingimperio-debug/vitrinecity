import {randomUUID} from 'node:crypto';
const DAY=86400000;
export const REWARD_TERMS='city-rewards-2026-09-10';
export function rewardDiscount(priceCents,points,coinsPerReal){
  if(!Number.isSafeInteger(priceCents)||priceCents<1||!Number.isSafeInteger(points)||points<0||!Number.isSafeInteger(coinsPerReal)||coinsPerReal<1)return {discountCents:0,points:0,payCents:priceCents};
  const discountCents=Math.min(Math.floor(priceCents*.3),Math.floor(points*100/coinsPerReal));
  return {discountCents,points:Math.ceil(discountCents*coinsPerReal/100),payCents:priceCents-discountCents};
}
export function setupCityRewards({app,db,requireUser,requireAdmin,sameOriginOnly,publicDir,getCourse,createPreference,paymentReady,searchPayments=null,onSettlement=()=>{},affiliateFor=()=>null,now=Date.now}){
  db.exec(`CREATE TABLE IF NOT EXISTS city_reward_settings(id INTEGER PRIMARY KEY CHECK(id=1),coins_per_real INTEGER NOT NULL DEFAULT 100,daily_limit INTEGER NOT NULL DEFAULT 100,enabled INTEGER NOT NULL DEFAULT 1);
    INSERT OR IGNORE INTO city_reward_settings(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS city_reward_batches(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,source_key TEXT NOT NULL UNIQUE,points INTEGER NOT NULL,remaining INTEGER NOT NULL,created_ms INTEGER NOT NULL,expires_ms INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_city_reward_balance ON city_reward_batches(user_id,expires_ms);
    CREATE TABLE IF NOT EXISTS city_reward_orders(reference TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,kind TEXT NOT NULL,slug TEXT NOT NULL DEFAULT '',title TEXT NOT NULL,price_cents INTEGER NOT NULL,discount_cents INTEGER NOT NULL,pay_cents INTEGER NOT NULL,points INTEGER NOT NULL,allocations TEXT NOT NULL DEFAULT '[]',debited INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'created',checkout_url TEXT,preference_id TEXT,payment_id TEXT,created_ms INTEGER NOT NULL,starts_ms INTEGER,ends_ms INTEGER,terms_version TEXT NOT NULL,UNIQUE(user_id,request_key));
    CREATE TABLE IF NOT EXISTS city_reward_audit(id INTEGER PRIMARY KEY,admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,coins_per_real INTEGER NOT NULL,daily_limit INTEGER NOT NULL,enabled INTEGER NOT NULL,created_ms INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS city_reward_checks(reference TEXT PRIMARY KEY REFERENCES city_reward_orders(reference) ON DELETE CASCADE,checked_ms INTEGER NOT NULL);`);
  const settings=()=>db.prepare('SELECT coins_per_real coinsPerReal,daily_limit dailyLimit,enabled FROM city_reward_settings WHERE id=1').get();
  const available=id=>db.prepare('SELECT COALESCE(SUM(remaining),0) points,MIN(expires_ms) nextExpiry FROM city_reward_batches WHERE user_id=? AND remaining>0 AND expires_ms>?').get(id,now());
  const entitlement=id=>{const time=now(),periods=db.prepare("SELECT starts_ms,ends_ms FROM city_reward_orders WHERE user_id=? AND kind='avatar' AND status='approved' AND ends_ms>? ORDER BY starts_ms").all(id,time);let until=time;for(const period of periods){if(period.starts_ms>until)break;until=Math.max(until,period.ends_ms);}return {active:until>time,expiresAt:until>time?until:null};};
  function product(kind,slug){if(kind==='avatar')return {kind,title:'Avatar Premium · 30 dias',priceCents:1000,slug:''};if(kind==='course'){const c=getCourse(String(slug||''));if(c)return {kind,slug:c.slug,title:c.title,priceCents:c.priceCents};}return null;}
  function quote(id,p,usePoints){const config=settings(),balance=available(id),discount=rewardDiscount(p.priceCents,usePoints&&config.enabled?balance.points:0,config.coinsPerReal);return {...p,...discount,availablePoints:balance.points,coinsPerReal:config.coinsPerReal,maxDiscountPercent:30,termsVersion:REWARD_TERMS};}
  function debit(id,points){let remaining=points;const allocations=[];for(const batch of db.prepare('SELECT id,remaining FROM city_reward_batches WHERE user_id=? AND remaining>0 AND expires_ms>? ORDER BY expires_ms,id').all(id,now())){if(!remaining)break;const used=Math.min(remaining,batch.remaining);db.prepare('UPDATE city_reward_batches SET remaining=remaining-? WHERE id=?').run(used,batch.id);allocations.push({id:batch.id,points:used});remaining-=used;}if(remaining)throw Error('As moedas disponíveis mudaram. Confira novamente o valor.');return allocations;}
  function restore(order){if(!order.debited)return;for(const item of JSON.parse(order.allocations))db.prepare('UPDATE city_reward_batches SET remaining=MIN(points,remaining+?) WHERE id=? AND user_id=?').run(item.points,item.id,order.user_id);db.prepare('UPDATE city_reward_orders SET debited=0 WHERE reference=?').run(order.reference);}
  const settle=db.transaction((reference,payment)=>{
    const order=db.prepare('SELECT * FROM city_reward_orders WHERE reference=?').get(reference);if(!order)return null;
    if(!payment.id||payment.external_reference!==reference||!['pending','authorized','in_process','in_mediation','approved','rejected','cancelled','refunded','charged_back'].includes(payment.status))throw Error('Pagamento não corresponde ao pedido.');
    if(payment.currency_id!=='BRL'||Math.round(Number(payment.transaction_amount)*100)!==order.pay_cents)throw Error('Valor de pagamento diferente do pedido.');
    const status=String(payment.status||''),reversed=['refunded','charged_back','cancelled','rejected'].includes(status);
    if(order.payment_id&&order.payment_id!==String(payment.id)&&['approved','refunded','charged_back','review_required'].includes(order.status))throw Error('Pedido já associado a outro pagamento.');
    // Do not re-open a settled/reversed payment because an older notification arrives.
    if(['refunded','charged_back'].includes(order.status)&&!['refunded','charged_back'].includes(status))return order;
    if(order.status==='approved'&&!reversed&&status!=='approved')return order;
    if(status==='approved'){
      if(!order.debited&&order.points){
        // A late approval after released points requires review; never grant unbacked discounts.
        if(available(order.user_id).points<order.points){db.prepare("UPDATE city_reward_orders SET status='review_required',payment_id=? WHERE reference=?").run(String(payment.id),reference);return {...order,status:'review_required'};}
        const allocations=debit(order.user_id,order.points);db.prepare('UPDATE city_reward_orders SET allocations=?,debited=1 WHERE reference=?').run(JSON.stringify(allocations),reference);
      }
      if(order.kind==='avatar'&&!order.ends_ms){const end=db.prepare("SELECT MAX(ends_ms) value FROM city_reward_orders WHERE user_id=? AND kind='avatar' AND status='approved'").get(order.user_id).value||0,start=Math.max(now(),end);db.prepare('UPDATE city_reward_orders SET starts_ms=?,ends_ms=? WHERE reference=?').run(start,start+30*DAY,reference);}
      if(order.kind==='course')db.prepare(`INSERT INTO course_enrollments(user_id,course_slug,order_reference,status) VALUES(?,?,?,'active') ON CONFLICT(order_reference) DO UPDATE SET status='active',updated_at=CURRENT_TIMESTAMP`).run(order.user_id,order.slug,reference);
    }else if(reversed){restore(order);if(order.kind==='course')db.prepare("UPDATE course_enrollments SET status='revoked',updated_at=CURRENT_TIMESTAMP WHERE order_reference=?").run(reference);}
    db.prepare('UPDATE city_reward_orders SET status=?,payment_id=? WHERE reference=?').run(status,String(payment.id),reference);
    if(order.kind==='course')db.prepare('UPDATE course_orders SET status=?,mp_payment_id=?,updated_at=CURRENT_TIMESTAMP WHERE reference=?').run(status,String(payment.id),reference);
    return db.prepare('SELECT * FROM city_reward_orders WHERE reference=?').get(reference);
  });
  function grantGame(id,points,sourceKey){const config=settings();if(!config.enabled||!Number.isSafeInteger(points)||points<1)return 0;const dayStart=Math.floor(now()/DAY)*DAY,today=db.prepare('SELECT COALESCE(SUM(points),0) n FROM city_reward_batches WHERE user_id=? AND created_ms>=?').get(id,dayStart).n,grant=Math.min(points,Math.max(0,config.dailyLimit-today));if(!grant)return 0;const result=db.prepare('INSERT OR IGNORE INTO city_reward_batches(user_id,source_key,points,remaining,created_ms,expires_ms) VALUES(?,?,?,?,?,?)').run(id,sourceKey,grant,grant,now(),now()+60*DAY);return result.changes?grant:0;}
  app.get('/api/rewards/me',requireUser,(req,res)=>res.set('Cache-Control','private,no-store').json({balance:available(req.user.id),settings:settings(),avatar:entitlement(req.user.id),avatarPriceCents:1000,maxDiscountPercent:30,validityDays:60,orders:db.prepare('SELECT reference,kind,title,price_cents,discount_cents,pay_cents,points,status,starts_ms,ends_ms,created_ms FROM city_reward_orders WHERE user_id=? ORDER BY created_ms DESC LIMIT 30').all(req.user.id),batches:db.prepare('SELECT points,remaining,created_ms,expires_ms FROM city_reward_batches WHERE user_id=? ORDER BY id DESC LIMIT 30').all(req.user.id)}));
  app.get('/api/rewards/quote',requireUser,(req,res)=>{const p=product(req.query.kind,req.query.slug);if(!p)return res.sendStatus(404);return res.set('Cache-Control','private,no-store').json(quote(req.user.id,p,req.query.usePoints==='true'));});
  app.post('/api/rewards/checkout',requireUser,sameOriginOnly,async(req,res)=>{
    const b=req.body||{},p=product(b.kind,b.slug),key=String(b.key||'');if(!p)return res.status(404).json({error:'Este produto ainda não está disponível.'});
    if(!b.termsAccepted||b.termsVersion!==REWARD_TERMS||!/^[a-zA-Z0-9-]{12,80}$/.test(key))return res.status(400).json({error:'Revise o valor e aceite os termos atuais.'});
    if(!paymentReady())return res.status(503).json({error:'Pagamento temporariamente indisponível.'});
    let order;
    try{order=db.transaction(()=>{
      const prior=db.prepare('SELECT * FROM city_reward_orders WHERE user_id=? AND request_key=?').get(req.user.id,key);if(prior){if(prior.kind!==p.kind||prior.slug!==p.slug||prior.pay_cents!==b.payCents||prior.points!==b.points)throw Error('Pedido já utilizado.');return prior;}
      if(p.kind==='course'&&db.prepare("SELECT 1 FROM course_enrollments WHERE user_id=? AND course_slug=? AND status='active'").get(req.user.id,p.slug))throw Error('Você já tem acesso a este curso.');
      const outstanding=db.prepare("SELECT COUNT(*) n FROM city_reward_orders WHERE user_id=? AND status IN ('created','creating','pending','review_required')").get(req.user.id).n;if(outstanding>=3)throw Error('Você já tem três pedidos pendentes. Confira seu histórico antes de continuar.');
      const recent=db.prepare('SELECT COUNT(*) n FROM city_reward_orders WHERE user_id=? AND created_ms>?').get(req.user.id,now()-600000).n;if(recent>=5)throw Error('Aguarde alguns minutos antes de tentar novamente.');
      const q=quote(req.user.id,p,b.usePoints===true);if(q.payCents!==b.payCents||q.points!==b.points)throw Error('O saldo ou a cotação mudou. Atualize o resumo antes de pagar.');
      const reference='cityperk_'+randomUUID(),allocations=debit(req.user.id,q.points);
      db.prepare('INSERT INTO city_reward_orders(reference,user_id,request_key,kind,slug,title,price_cents,discount_cents,pay_cents,points,allocations,created_ms,terms_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(reference,req.user.id,key,p.kind,p.slug,p.title,p.priceCents,q.discountCents,q.payCents,q.points,JSON.stringify(allocations),now(),REWARD_TERMS);
      if(p.kind==='course')db.prepare("INSERT INTO course_orders(reference,user_id,course_slug,course_title,amount_cents,affiliate_id,status) VALUES(?,?,?,?,?,?,'created')").run(reference,req.user.id,p.slug,p.title,q.payCents,affiliateFor(req));
      return db.prepare('SELECT * FROM city_reward_orders WHERE reference=?').get(reference);
    })();}catch(e){return res.status(409).json({error:e.message});}
    if(order.checkout_url&&order.status==='pending'&&now()<order.created_ms+DAY)return res.json({checkoutUrl:order.checkout_url,reference:order.reference});
    if(order.status!=='created')return res.status(409).json({error:'Este pedido já foi processado. Consulte seu histórico.'});
    // One claim prevents concurrent replays from issuing another preference.
    if(!db.prepare("UPDATE city_reward_orders SET status='creating' WHERE reference=? AND status='created'").run(order.reference).changes)return res.status(409).json({error:'Seu pagamento está sendo preparado.'});
    try{const preference=await createPreference(order,req.user);const link=new URL(preference.init_point);if(!preference.id||link.protocol!=='https:'||!/(^|\.)mercadopago\.com(?:\.br)?$/.test(link.hostname))throw Error('Resposta de pagamento inválida.');
      db.prepare("UPDATE city_reward_orders SET status=CASE WHEN status='creating' THEN 'pending' ELSE status END,checkout_url=?,preference_id=? WHERE reference=?").run(link.href,String(preference.id),order.reference);
      return res.status(201).json({checkoutUrl:link.href,reference:order.reference});
    }catch{return res.status(502).json({error:'A confirmação da abertura do pagamento não chegou. Confira este pedido no histórico antes de tentar novamente.',reference:order.reference});}
  });
  async function refreshOrder(req,res,admin=false){
    const order=db.prepare('SELECT * FROM city_reward_orders WHERE reference=?').get(String(req.params.reference||''));
    if(!order||(!admin&&order.user_id!==req.user.id))return res.sendStatus(404);
    if(!searchPayments||!paymentReady())return res.status(503).json({error:'Consulta de pagamento temporariamente indisponível.'});
    const last=db.prepare('SELECT checked_ms FROM city_reward_checks WHERE reference=?').get(order.reference);
    if(last&&now()-last.checked_ms<30000)return res.status(429).json({error:'Aguarde 30 segundos antes de consultar este pedido novamente.'});
    db.prepare('INSERT INTO city_reward_checks(reference,checked_ms) VALUES(?,?) ON CONFLICT(reference) DO UPDATE SET checked_ms=excluded.checked_ms').run(order.reference,now());
    try{
      const result=await searchPayments(order);
      if(!Array.isArray(result?.payments)||result.payments.some(p=>p.external_reference!==order.reference))throw Error('Resposta de pagamento inválida.');
      const paid=result.payments.filter(p=>p.status==='approved');
      if(new Set(paid.map(p=>String(p.id))).size>1)throw Error('Há mais de um pagamento aprovado. O atendimento precisa conferir os pagamentos.');
      const bound=order.payment_id&&['approved','refunded','charged_back','review_required'].includes(order.status);
      const payment=bound?result.payments.find(p=>String(p.id)===order.payment_id):paid[0]||result.payments[0];
      let updated=order;
      if(payment){updated=settle(order.reference,payment);onSettlement(updated,payment);}
      else if(result.complete&&result.payments.length===0&&now()>order.created_ms+3*DAY&&['created','creating','pending','failed'].includes(order.status)){
        updated=db.transaction(()=>{const current=db.prepare('SELECT * FROM city_reward_orders WHERE reference=?').get(order.reference);if(['created','creating','pending','failed'].includes(current.status)){restore(current);db.prepare("UPDATE city_reward_orders SET status='expired' WHERE reference=?").run(order.reference);if(current.kind==='course')db.prepare("UPDATE course_orders SET status='expired' WHERE reference=?").run(order.reference);}return db.prepare('SELECT * FROM city_reward_orders WHERE reference=?').get(order.reference);})();
      }
      return res.json({reference:updated.reference,status:updated.status});
    }catch(error){return res.status(502).json({error:error.message==='Há mais de um pagamento aprovado. O atendimento precisa conferir os pagamentos.'?error.message:'Não foi possível confirmar o pagamento. O pedido e suas moedas continuam preservados.'});}
  }
  app.post('/api/rewards/orders/:reference/refresh',requireUser,sameOriginOnly,(req,res)=>refreshOrder(req,res));
  app.post('/api/admin/rewards/orders/:reference/refresh',requireAdmin,sameOriginOnly,(req,res)=>refreshOrder(req,res,true));
  app.get('/admin-recompensas.html',requireAdmin,(_req,res)=>res.sendFile(publicDir+'/admin-recompensas.html'));
  app.get('/api/admin/rewards',requireAdmin,(_req,res)=>res.set('Cache-Control','private,no-store').json({settings:settings(),pending:db.prepare("SELECT reference,user_id,title,pay_cents,points,status,created_ms FROM city_reward_orders WHERE status IN ('created','creating','pending','review_required') ORDER BY created_ms LIMIT 100").all(),audit:db.prepare('SELECT * FROM city_reward_audit ORDER BY id DESC LIMIT 30').all()}));
  app.put('/api/admin/rewards',requireAdmin,sameOriginOnly,(req,res)=>{const rate=Number(req.body?.coinsPerReal),limit=Number(req.body?.dailyLimit);if(!Number.isSafeInteger(rate)||rate<1||rate>10000||!Number.isSafeInteger(limit)||limit<1||limit>1000)return res.status(400).json({error:'Informe 1 a 10.000 moedas por real e limite diário de 1 a 1.000.'});db.transaction(()=>{db.prepare('UPDATE city_reward_settings SET coins_per_real=?,daily_limit=?,enabled=? WHERE id=1').run(rate,limit,req.body?.enabled===false?0:1);db.prepare('INSERT INTO city_reward_audit(admin_id,coins_per_real,daily_limit,enabled,created_ms) VALUES(?,?,?,?,?)').run(req.user.id,rate,limit,req.body?.enabled===false?0:1,now());})();return res.json({ok:true});});
  return {grantGame,settle,entitlement,settings,available,exportUser:id=>({batches:db.prepare('SELECT points,remaining,created_ms,expires_ms FROM city_reward_batches WHERE user_id=?').all(id),orders:db.prepare('SELECT reference,kind,title,price_cents,discount_cents,pay_cents,points,status,created_ms FROM city_reward_orders WHERE user_id=?').all(id)})};
}
