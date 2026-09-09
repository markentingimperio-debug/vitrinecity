import {createHash,randomUUID} from 'node:crypto';
import {safeResultImageUrl} from './public/search-result-image.js';
import {publicCopyHasLinks,removePublicLinks} from './public/social-public-copy.js';

const API='/api/admin/social-comment-campaigns', DAY=86400000;
const SURFACES=new Set(['facebook_page','facebook_group','instagram']);
const KEYWORDS=new Set(['EU QUERO','QUERO RECEITA','QUERO GUIA']);
const TRIGGERS=new Set(['keyword','any_comment']);
const clean=value=>typeof value==='string'?value.trim():'';
const normalize=value=>clean(value).normalize('NFKC').toUpperCase().replace(/\s+/g,' ');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(message,status=400)=>Object.assign(new Error(message),{status,socialCampaignSafe:true});
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,150}$/.test(value);
const requested=(text,keyword)=>normalize(text).replace(/[.!?]+$/,'').trim()===keyword;
const plainText=value=>clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const OPT_OUT='A pessoa recusou receber mensagens.';
const interactionReason=text=>{
  const value=plainText(text);
  if(!value||value.length>5000)return 'Comentário vazio ou muito longo.';
  if(/\b(nao\s+(?:me\s+)?(?:quero|mande|mandem|envie|enviem|contate|contatem|chame|chamem)|pare|parem|parar|stop|cancelar|cancele|descadastrar|descadastre|remova\s+meu\s+contato)\b/.test(value))return OPT_OUT;
  if(/https?:\/\/|www\.|\b(porn\w*|nudes?|sexo explicito|supremacia|ataque racial|exterminar|tortura|estupro|pedofil\w*|vai se foder|filh[oa] da puta|vtnc)\b/.test(value))return 'Comentário retido pela moderação automática.';
  return '';
};
const authorName=value=>{const name=clean(value).replace(/\s+/g,' ');return /^[\p{L}\p{N}][\p{L}\p{N} ._'’\-]{0,79}$/u.test(name)&&!publicCopyHasLinks(name)&&!interactionReason(name)?name.split(' ')[0]:'';};
const publicThanks=(source,name='')=>{const safeName=name==='{nome}'?name:authorName(name);return `${safeName?safeName+', obrigado':'Obrigado'} pelo comentário! ${source.commercial?'Enviei o link da oferta no privado.':'Enviei um presente no privado: o conteúdo desta publicação.'}`;};
const eventTime=value=>{
  if(value===undefined||value===null||value==='')return NaN;
  if(typeof value==='number'||/^\d+(?:\.\d+)?$/.test(String(value))){const n=Number(value);return n<1e12?n*1000:n;}
  return typeof value==='string'?Date.parse(value):NaN;
};
const localParts=time=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(time).map(p=>[p.type,p.value]));
const dayKey=time=>{const p=localParts(time);return `${p.year}-${p.month}-${p.day}`;};
const openHours=time=>{const hour=Number(localParts(time).hour);return hour>=9&&hour<20;};

/** Routes prepare copy only. An authenticated, signature-verified Meta webhook is
 * the sole queue input. This module never publishes a post or messages a liker. */
export function registerSocialCommentCampaigns({app,db,requireAdmin,sameOriginOnly,siteUrl,sourceCatalog,metaAdapter,commentModerationReason=()=>'',canRun=()=>true,now=Date.now,sendTimeoutMs=20000,inspectTimeoutMs=35000}) {
  const origin=new URL(siteUrl).origin, inflight=new Map(),connectionChecks=new Map();let processing=false,inspectionCount=0;
  db.exec(`CREATE TABLE IF NOT EXISTS social_content_campaigns (
    id TEXT PRIMARY KEY,idempotency_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('draft','active','paused')),
    source_key TEXT NOT NULL,source_json TEXT NOT NULL,source_hash TEXT NOT NULL,
    account_id INTEGER NOT NULL,account_json TEXT NOT NULL,object_id TEXT NOT NULL,
    surface TEXT NOT NULL,post_id TEXT NOT NULL,group_id TEXT NOT NULL DEFAULT '',
    keyword TEXT NOT NULL,caption TEXT NOT NULL,invite TEXT NOT NULL,private_reply TEXT NOT NULL,
    readiness_json TEXT NOT NULL,created_at INTEGER NOT NULL,activated_at INTEGER,updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_social_content_active_post ON social_content_campaigns(surface,object_id,post_id,group_id) WHERE status='active';
  CREATE TABLE IF NOT EXISTS social_content_comment_events (
    id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES social_content_campaigns(id),
    surface TEXT NOT NULL,object_id TEXT NOT NULL,page_id TEXT NOT NULL,instagram_id TEXT NOT NULL,
    post_id TEXT NOT NULL,group_id TEXT NOT NULL,comment_id TEXT NOT NULL,author_id TEXT NOT NULL,
    original_time INTEGER NOT NULL,received_at INTEGER NOT NULL,intent_text TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('ignored','pending','processing','sent','failed','unknown','cancelled')),
    reason TEXT,attempt_day TEXT,claimed_at INTEGER,provider_message_id TEXT,sent_at INTEGER,
    UNIQUE(surface,object_id,comment_id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_social_content_author_post ON social_content_comment_events(surface,object_id,post_id,group_id,author_id) WHERE status!='ignored';
  CREATE INDEX IF NOT EXISTS idx_social_content_pending ON social_content_comment_events(status,received_at);
  CREATE INDEX IF NOT EXISTS idx_social_content_daily ON social_content_comment_events(attempt_day);`);
  if(!db.prepare('PRAGMA table_info(social_content_comment_events)').all().some(column=>column.name==='invalidated_at'))db.exec('ALTER TABLE social_content_comment_events ADD COLUMN invalidated_at INTEGER');
  for(const [table,columns] of Object.entries({social_content_campaigns:{trigger_mode:"TEXT NOT NULL DEFAULT 'keyword'",public_reply_enabled:'INTEGER NOT NULL DEFAULT 0',react_enabled:'INTEGER NOT NULL DEFAULT 0'},social_content_comment_events:{author_name:"TEXT NOT NULL DEFAULT ''",...Object.fromEntries(['public','reaction'].flatMap(prefix=>[[prefix+'_status',"TEXT NOT NULL DEFAULT 'not_requested'"],[prefix+'_text','TEXT'],[prefix+'_claimed_at','INTEGER'],[prefix+'_attempt_day','TEXT'],[prefix+'_provider_id','TEXT'],[prefix+'_sent_at','INTEGER'],[prefix+'_reason','TEXT']]))}})){
    const existing=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column=>column.name));for(const [column,type] of Object.entries(columns))if(!existing.has(column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }

  const rowById=id=>db.prepare('SELECT * FROM social_content_campaigns WHERE id=?').get(id);
  const accountById=id=>db.prepare(`SELECT id,page_id,page_name,instagram_id,instagram_username FROM social_accounts WHERE id=? AND status='connected'`).get(id);
  const publicAccount=row=>({id:row.id,pageId:clean(row.page_id),pageName:clean(row.page_name),instagramId:clean(row.instagram_id),instagramUsername:clean(row.instagram_username)});
  function ownUrl(value){
    if(typeof value!=='string'||value.length>2000||/[\\\x00-\x20\x7f]/.test(value)||value.startsWith('//'))return '';
    try{const url=new URL(value,origin),decoded=decodeURIComponent(url.pathname);return url.origin===origin&&!url.username&&!url.password&&!/[\\\x00-\x20\x7f%]/.test(decoded)&&!/%(?:2f|5c)/i.test(url.pathname)&&!/^\/(?:api|admin|auth|login|logout|entrar)(?:[/.\-]|$)/i.test(decoded)?url.href:'';}catch{return '';}
  }
  function sourceSnapshot(key){
    const source=sourceCatalog.get(key),url=ownUrl(source?.sourcePath);
    if(!source||!clean(source.title)||!url)throw fail('O conteúdo não está mais disponível para divulgação.',409);
    const snapshot={key:source.key,title:clean(source.title).slice(0,300),summary:clean(source.summary).slice(0,1400),image:safeResultImageUrl(source.image_url,origin),url,commercial:Boolean(source.commercial)};
    return {snapshot,fingerprint:hash([snapshot,source.facts,source.updated_at,source.body])};
  }
  function reply(source,invite,id,surface,triggerMode){
    const url=new URL(source.url);url.searchParams.set('utm_source',surface==='instagram'?'instagram':'facebook');url.searchParams.set('utm_medium','comment_reply');url.searchParams.set('utm_campaign',id);
    const disclosure=source.commercial?'\nPublicidade: a página pode incluir produtos, serviços ou links de afiliados.':'';
    const invitation=invite==='vip'?`\n\nQue bom ter você por aqui! Se quiser receber mais receitas, dicas de plantas, notícias e ofertas, conheça o Grupo VIP da VitrineCity: ${origin}/grupos-whatsapp.html`:invite==='city'?`\n\nSe quiser, conheça também a cidade da VitrineCity: ${origin}/`:'';
    const lead=triggerMode==='any_comment'?(source.commercial?'Obrigado pelo comentário! Aqui está o link da oferta relacionada à publicação:':'Obrigado pelo comentário! Separei este conteúdo da publicação para você:'):'Aqui está o conteúdo que você pediu:';
    return `${lead} ${source.title}\n${url.href}${disclosure}${invitation}`;
  }
  function readinessResult(result){
    const missing=Array.isArray(result?.missing)?result.missing.map(value=>clean(value).slice(0,250)).filter(Boolean).slice(0,15):[];
    let postUrl='';try{const url=new URL(result?.postUrl);if(url.protocol==='https:'&&!url.username&&!url.password&&['www.facebook.com','facebook.com','www.instagram.com','instagram.com'].includes(url.hostname))postUrl=url.href;}catch{}
    const ready=result?.ready===true&&!missing.length;
    const details={publicAccessVerified:false};
    for(const key of ['permissionCheck','subscriptionCheck','ownershipCheck'])details[key]=result?.details?.[key]===true;
    return {ready,missing:ready?[]:missing.length?missing:['A conexão precisa ser conferida antes de ativar.'],postUrl,details,note:ready?'Configuração verificada; alcance público depende da aprovação Meta.':''};
  }
  async function inspect(data,source){
    if(!data.postId)return {ready:false,missing:['Informe o ID de uma publicação existente.'],postUrl:''};
    if(!source.image)return {ready:false,missing:['Escolha um conteúdo com foto de capa válida.'],postUrl:''};
    return performInspection(data);
  }
  async function performInspection(data){
    if(inspectionCount>=3)return {ready:false,missing:['Há verificações de conexão em andamento. Aguarde um instante.'],postUrl:''};
    inspectionCount++;let timer;
    try{return readinessResult(await Promise.race([metaAdapter.inspect({accountId:data.accountId,surface:data.surface,postId:data.postId||'',groupId:data.groupId||'',publicReplyEnabled:data.publicReplyEnabled===true,reactEnabled:data.reactEnabled===true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('inspection_timeout')),Math.max(1,Math.min(inspectTimeoutMs,50000)));})]));}
    catch{return {ready:false,missing:['Não foi possível verificar a conexão com a Meta. Tente novamente.'],postUrl:''};}
    finally{inspectionCount--;clearTimeout(timer);}
  }
  function inspectionInput(row){return {accountId:row.account_id,surface:row.surface,postId:row.post_id,groupId:row.group_id,publicReplyEnabled:Boolean(row.public_reply_enabled),reactEnabled:Boolean(row.react_enabled)};}
  function cancelExtras(column,id,reason){for(const prefix of ['public','reaction'])db.prepare(`UPDATE social_content_comment_events SET ${prefix}_status='cancelled',${prefix}_reason=? WHERE ${column}=? AND ${prefix}_status='pending'`).run(reason,id);}
  function dto(row){
    const counts={pending:0,processing:0,sent:0,failed:0,unknown:0,cancelled:0};
    for(const item of db.prepare('SELECT status,COUNT(*) AS count FROM social_content_comment_events WHERE campaign_id=? GROUP BY status').all(row.id))if(Object.hasOwn(counts,item.status))counts[item.status]=item.count;
    const extras={};for(const [prefix,key] of [['public','publicReplyCounts'],['reaction','reactionCounts']]){extras[key]={pending:0,processing:0,sent:0,failed:0,unknown:0,cancelled:0};for(const item of db.prepare(`SELECT ${prefix}_status AS status,COUNT(*) AS count FROM social_content_comment_events WHERE campaign_id=? GROUP BY ${prefix}_status`).all(row.id))if(Object.hasOwn(extras[key],item.status))extras[key][item.status]=item.count;}
    return {id:row.id,status:row.status,source:JSON.parse(row.source_json),account:JSON.parse(row.account_json),surface:row.surface,postId:row.post_id,groupId:row.group_id,keyword:row.keyword,triggerMode:row.trigger_mode,publicReplyEnabled:Boolean(row.public_reply_enabled),reactEnabled:Boolean(row.react_enabled),publicReplyPreview:row.public_reply_enabled?publicThanks(JSON.parse(row.source_json),'{nome}'):'',caption:row.caption,invite:row.invite,privateReply:row.private_reply,readiness:JSON.parse(row.readiness_json),counts,...extras,createdAt:new Date(row.created_at).toISOString(),activatedAt:row.activated_at?new Date(row.activated_at).toISOString():null};
  }
  function validateInput(input){
    const sourceKey=clean(input?.sourceKey),accountId=Number(input?.accountId),surface=clean(input?.surface),postId=clean(input?.postId),groupId=clean(input?.groupId),keyword=normalize(input?.keyword),caption=clean(input?.caption),invite=clean(input?.invite)||'none',idempotencyKey=clean(input?.idempotencyKey);
    const triggerMode=input?.triggerMode===undefined?'keyword':input.triggerMode,publicReplyEnabled=input?.publicReplyEnabled??false,reactEnabled=input?.reactEnabled??false;
    if(!TRIGGERS.has(triggerMode)||typeof publicReplyEnabled!=='boolean'||typeof reactEnabled!=='boolean')throw fail('Confira o gatilho e as opções de agradecimento e curtida.');
    if(reactEnabled&&surface==='instagram')throw fail('A curtida automática de comentários está disponível somente no Facebook.');
    if(!sourceKey||sourceKey.length>300||!Number.isSafeInteger(accountId)||accountId<1||!SURFACES.has(surface)||!KEYWORDS.has(keyword)||!['none','city','vip'].includes(invite)||!/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey))throw fail('Revise o conteúdo, a conta, a palavra escolhida e os dados da prévia.');
    if((postId&&!identifier(postId))||(surface==='facebook_group'&&((postId&&!identifier(groupId))||(groupId&&!identifier(groupId))))||(surface!=='facebook_group'&&groupId))throw fail('Use os IDs da publicação e do grupo, sem inserir links nesses campos.');
    if(caption.length>1800||publicCopyHasLinks(caption)||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(caption))throw fail('A descrição deve ter até 1.800 caracteres e não deve conter links.');
    const account=accountById(accountId);if(!account)throw fail('Escolha uma conta conectada.',409);
    const objectId=surface==='instagram'?clean(account.instagram_id):clean(account.page_id);if(!identifier(objectId))throw fail('Esta conta não tem a Página ou o Instagram necessário.',409);
    return {sourceKey,accountId,surface,postId,groupId,keyword,triggerMode,publicReplyEnabled,reactEnabled,caption,invite,idempotencyKey,account:publicAccount(account),objectId};
  }
  const route=handler=>async(req,res)=>{try{await handler(req,res);}catch(error){res.status(error.socialCampaignSafe?error.status:500).json({error:error.socialCampaignSafe?error.message:'Não foi possível concluir esta operação. Tente novamente.'});}};
  app.get(API+'/catalog',requireAdmin,route(async(req,res)=>{
    const seenPages=new Set(),seenInstagram=new Set(),accounts=[];
    for(const raw of db.prepare(`SELECT id,page_id,page_name,instagram_id,instagram_username FROM social_accounts WHERE status='connected' ORDER BY updated_at DESC,id DESC`).all()){
      const account=publicAccount(raw);if(seenPages.has(account.pageId))continue;seenPages.add(account.pageId);
      if(account.instagramId&&seenInstagram.has(account.instagramId)){account.instagramId='';account.instagramUsername='';}else if(account.instagramId)seenInstagram.add(account.instagramId);
      accounts.push(account);
    }
    const items=sourceCatalog.list({q:clean(req.query.q).slice(0,200),limit:200}).flatMap(source=>{try{return [sourceSnapshot(source.key).snapshot];}catch(error){if(error.socialCampaignSafe)return [];throw error;}});
    res.json({items,accounts});
  }));
  app.get(API,requireAdmin,route(async(_req,res)=>res.json({campaigns:db.prepare('SELECT * FROM social_content_campaigns ORDER BY created_at DESC LIMIT 100').all().map(dto)})));
  app.get(API+'/connection',requireAdmin,route(async(req,res)=>{
    const accountId=Number(req.query.accountId),surface=clean(req.query.surface),account=Number.isSafeInteger(accountId)&&accountId>0?accountById(accountId):null;
    if(!account||!SURFACES.has(surface))throw fail('Escolha uma conta conectada e um destino válido.');
    for(const [key,value] of connectionChecks)if(value.expiresAt<now())connectionChecks.delete(key);
    if(['publicReplyEnabled','reactEnabled'].some(key=>req.query[key]!==undefined&&!['true','false'].includes(req.query[key])))throw fail('Confira as opções da verificação.');
    const publicReplyEnabled=req.query.publicReplyEnabled==='true',reactEnabled=req.query.reactEnabled==='true';if(reactEnabled&&surface==='instagram')throw fail('A curtida automática de comentários está disponível somente no Facebook.');
    const key=hash([accountId,surface,account,publicReplyEnabled,reactEnabled]);let pending=connectionChecks.get(key);
    if(!pending){if(connectionChecks.size>=50)throw fail('Aguarde um instante antes de verificar outra conexão.',429);pending={expiresAt:now()+5000,promise:performInspection({accountId,surface,publicReplyEnabled,reactEnabled})};connectionChecks.set(key,pending);}
    res.json({account:publicAccount(account),surface,readiness:await pending.promise});
  }));
  app.get(API+'/:id',requireAdmin,route(async(req,res)=>{const row=rowById(req.params.id);if(!row)throw fail('Campanha não encontrada.',404);res.json(dto(row));}));
  app.post(API+'/preview',requireAdmin,sameOriginOnly,route(async(req,res)=>{
    const data=validateInput(req.body),requestParts=[data.sourceKey,data.accountId,data.surface,data.postId,data.groupId,data.keyword,data.caption,data.invite];
    if(data.triggerMode!=='keyword'||data.publicReplyEnabled||data.reactEnabled)requestParts.push(data.triggerMode,data.publicReplyEnabled,data.reactEnabled);const requestHash=hash(requestParts);
    const existing=db.prepare('SELECT * FROM social_content_campaigns WHERE idempotency_key=?').get(data.idempotencyKey);
    if(existing){if(existing.request_hash!==requestHash)throw fail('Use uma nova prévia para os dados alterados.',409);res.json(dto(existing));return;}
    if(inflight.has(data.idempotencyKey)){const pending=inflight.get(data.idempotencyKey);if(pending.hash!==requestHash)throw fail('A prévia ainda está sendo preparada com outros dados.',409);res.json(dto(await pending.promise));return;}
    if(inflight.size>=3)throw fail('Há prévias em preparação. Aguarde um instante.',429);
    const promise=(async()=>{
      const {snapshot,fingerprint}=sourceSnapshot(data.sourceKey),readiness=await inspect(data,snapshot),id=randomUUID(),created=now();
      const caption=data.caption||`${removePublicLinks(snapshot.title)}\n\n${removePublicLinks(snapshot.summary.slice(0,650))}\n\n${data.triggerMode==='any_comment'?'Deixe seu comentário e enviaremos o link relacionado a esta publicação por mensagem privada.':`Quer acessar o conteúdo completo? Comente ${data.keyword} para receber o link por mensagem.`}`,privateReply=reply(snapshot,data.invite,id,data.surface,data.triggerMode);
      if(privateReply.length>1900)throw fail('O endereço e o título deste conteúdo excedem o tamanho permitido na mensagem.',409);
      db.prepare(`INSERT INTO social_content_campaigns (id,idempotency_key,request_hash,status,source_key,source_json,source_hash,account_id,account_json,object_id,surface,post_id,group_id,keyword,caption,invite,private_reply,readiness_json,created_at,activated_at,updated_at,trigger_mode,public_reply_enabled,react_enabled) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,data.idempotencyKey,requestHash,'draft',data.sourceKey,JSON.stringify(snapshot),fingerprint,data.accountId,JSON.stringify(data.account),data.objectId,data.surface,data.postId,data.groupId,data.keyword,caption,data.invite,privateReply,JSON.stringify(readiness),created,null,created,data.triggerMode,data.publicReplyEnabled?1:0,data.reactEnabled?1:0);
      return rowById(id);
    })();inflight.set(data.idempotencyKey,{hash:requestHash,promise});
    try{res.json(dto(await promise));}finally{inflight.delete(data.idempotencyKey);}
  }));
  app.post(API+'/:id/activate',requireAdmin,sameOriginOnly,route(async(req,res)=>{
    const row=rowById(req.params.id);if(!row)throw fail('Campanha não encontrada.',404);if(row.status==='active'){res.json(dto(row));return;}
    const current=sourceSnapshot(row.source_key);if(current.fingerprint!==row.source_hash)throw fail('O conteúdo mudou. Prepare e revise uma nova prévia.',409);
    const account=accountById(row.account_id);if(!account||hash(publicAccount(account))!==hash(JSON.parse(row.account_json)))throw fail('A conta mudou. Prepare uma nova prévia.',409);
    const readiness=await inspect(inspectionInput(row),current.snapshot);
    db.prepare('UPDATE social_content_campaigns SET readiness_json=? WHERE id=?').run(JSON.stringify(readiness),row.id);
    if(!readiness.ready)throw fail(readiness.missing.join(' '),409);
    try{db.transaction(()=>{
      const fresh=rowById(row.id);if(fresh.status!==row.status||fresh.updated_at!==row.updated_at||sourceSnapshot(fresh.source_key).fingerprint!==fresh.source_hash||hash(publicAccount(accountById(row.account_id)||{}))!==hash(JSON.parse(row.account_json)))throw fail('Os dados mudaram durante a verificação. Atualize a prévia.',409);
      const time=now();db.prepare("UPDATE social_content_campaigns SET status='active',activated_at=?,updated_at=? WHERE id=?").run(time,Math.max(time,fresh.updated_at+1),row.id);
    })();}catch(error){if(error.code==='SQLITE_CONSTRAINT_UNIQUE')throw fail('Esta publicação já tem uma campanha ativa.',409);throw error;}
    res.json(dto(rowById(row.id)));
  }));
  app.post(API+'/:id/pause',requireAdmin,sameOriginOnly,route(async(req,res)=>{
    if(!rowById(req.params.id))throw fail('Campanha não encontrada.',404);
    db.transaction(()=>{const current=rowById(req.params.id);db.prepare("UPDATE social_content_campaigns SET status='paused',updated_at=? WHERE id=?").run(Math.max(now(),current.updated_at+1),req.params.id);db.prepare("UPDATE social_content_comment_events SET status='cancelled',reason='Campanha pausada antes do envio.' WHERE campaign_id=? AND status='pending'").run(req.params.id);cancelExtras('campaign_id',req.params.id,'Campanha pausada antes desta interação.');})();res.json(dto(rowById(req.params.id)));
  }));

  function parseEvents(payload){
    const events=[];if(!payload||!['page','instagram'].includes(payload.object)||!Array.isArray(payload.entry))return events;
    for(const entry of payload.entry.slice(0,100)){
      if(!identifier(entry?.id))continue;
      for(const change of (Array.isArray(entry.changes)?entry.changes:[]).slice(0,200)){
        const value=change?.value;if(!value||typeof value!=='object')continue;
        const unsupported=Boolean(value.live_video_id||value.media?.media_product_type==='LIVE'||value.self_ig_scoped_id||value.is_self||(value.verb&&value.verb!=='add'));
        if(payload.object==='page'&&change.field==='feed'&&value.item==='comment')events.push({surface:'facebook_page',objectId:entry.id,postId:value.post_id,commentId:value.comment_id,authorId:value.from?.id,authorName:authorName(value.from?.name),time:eventTime(value.created_time),text:value.message,groupId:'',parentId:value.parent_id,unsupported:unsupported||value.verb!=='add'});
        if(payload.object==='instagram'&&['comments','live_comments'].includes(change.field))events.push({surface:'instagram',objectId:entry.id,postId:value.media?.id,commentId:value.id,authorId:value.from?.id,authorName:authorName(value.from?.username||value.from?.name),time:eventTime(value.created_time??value.timestamp??entry.time),text:value.text,groupId:'',parentId:value.parent_id,unsupported:unsupported||change.field!=='comments'});
      }
      if(payload.object==='page')for(const value of (Array.isArray(entry.messaging)?entry.messaging:[]).slice(0,200))if(value?.field==='group_feed'&&value.item==='comment'&&value.recipient?.id===entry.id)events.push({surface:'facebook_group',objectId:entry.id,postId:value.post_id,commentId:value.comment_id,authorId:value.from?.id,authorName:authorName(value.from?.name),time:eventTime(value.created_time),text:value.message,groupId:value.group_id,parentId:value.parent_id,unsupported:value.verb!=='add'});
    }
    return events;
  }
  function ingestWebhook(payload){
    const claimed=new Set();
    db.transaction(()=>{for(const event of parseEvents(payload)){
      if(!identifier(event.commentId)||(event.groupId&&!identifier(event.groupId)))continue;
      if(!identifier(event.postId)){
        const known=db.prepare('SELECT post_id,group_id FROM social_content_comment_events WHERE surface=? AND object_id=? AND comment_id=?').get(event.surface,event.objectId,event.commentId);
        if(!known)continue;event.postId=known.post_id;event.groupId=known.group_id;
      }
      const campaign=db.prepare(`SELECT * FROM social_content_campaigns WHERE surface=? AND object_id=? AND post_id=? AND group_id=? ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,created_at DESC LIMIT 1`).get(event.surface,event.objectId,event.postId,event.groupId);
      if(!campaign)continue;claimed.add(event.commentId);
      if(event.unsupported){db.prepare("UPDATE social_content_comment_events SET status=CASE WHEN status='pending' THEN 'cancelled' ELSE status END,invalidated_at=?,reason='O comentário foi alterado ou removido antes da conclusão.' WHERE surface=? AND object_id=? AND comment_id=? AND status IN ('pending','processing','sent')").run(now(),event.surface,event.objectId,event.commentId);const invalid=db.prepare('SELECT id FROM social_content_comment_events WHERE surface=? AND object_id=? AND comment_id=?').get(event.surface,event.objectId,event.commentId);if(invalid)cancelExtras('id',invalid.id,'Comentário alterado ou removido.');}
      const account=JSON.parse(campaign.account_json),time=now(),validTime=Number.isFinite(event.time),author=identifier(event.authorId)?event.authorId:'';
      if(!event.unsupported&&author&&![account.pageId,account.instagramId].includes(author)&&validTime&&event.time<=time+300000&&time-event.time<7*DAY&&interactionReason(event.text)===OPT_OUT){
        const prior=db.prepare("SELECT id FROM social_content_comment_events WHERE surface=? AND object_id=? AND post_id=? AND group_id=? AND author_id=? AND status IN ('pending','processing','sent')").all(event.surface,event.objectId,event.postId,event.groupId,author);
        for(const row of prior){db.prepare("UPDATE social_content_comment_events SET status=CASE WHEN status='pending' THEN 'cancelled' ELSE status END,invalidated_at=?,reason=? WHERE id=?").run(time,OPT_OUT,row.id);cancelExtras('id',row.id,OPT_OUT);}
      }
      let reason='';
      if(event.unsupported)reason='Evento editado, removido ou ao vivo não participa da campanha.';
      else if(campaign.status!=='active')reason='Campanha não está ativa.';
      else if(!author||[account.pageId,account.instagramId].includes(author))reason='Autor ausente ou conta própria.';
      else if(!validTime||event.time<=campaign.activated_at||event.time>time+300000||time-event.time>=7*DAY)reason='Horário ausente, antigo ou fora da janela permitida.';
      else if(event.parentId&&event.parentId!==event.postId)reason='Resposta a outro comentário não é um pedido na publicação.';
      else if(interactionReason(event.text))reason=interactionReason(event.text);
      else if(db.prepare('SELECT 1 FROM social_content_comment_events WHERE surface=? AND object_id=? AND post_id=? AND group_id=? AND author_id=? AND reason=?').get(event.surface,event.objectId,event.postId,event.groupId,author,OPT_OUT))reason=OPT_OUT;
      else if(campaign.trigger_mode!=='any_comment'&&!requested(event.text,campaign.keyword))reason='Comentário sem a frase explícita escolhida.';
      else if(!accountById(campaign.account_id))reason='Conta desconectada.';
      else {try{if(commentModerationReason(event.text))reason='Comentário retido pela moderação automática.';else if(sourceSnapshot(campaign.source_key).fingerprint!==campaign.source_hash)reason='O conteúdo foi alterado.';}catch{reason='Conteúdo ou moderação indisponível.';}}
      if(!reason&&db.prepare("SELECT 1 FROM social_content_comment_events WHERE surface=? AND object_id=? AND post_id=? AND group_id=? AND author_id=? AND status!='ignored'").get(event.surface,event.objectId,event.postId,event.groupId,author))reason='Este autor já teve um pedido registrado nesta publicação.';
      db.prepare(`INSERT OR IGNORE INTO social_content_comment_events (id,campaign_id,surface,object_id,page_id,instagram_id,post_id,group_id,comment_id,author_id,original_time,received_at,intent_text,status,reason,author_name,public_status,reaction_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),campaign.id,event.surface,event.objectId,account.pageId,account.instagramId,event.postId,event.groupId,event.commentId,author,validTime?event.time:0,time,reason?'':normalize(event.text).slice(0,100),reason?'ignored':'pending',reason||null,event.authorName||'',!reason&&campaign.public_reply_enabled?'pending':'not_requested',!reason&&campaign.react_enabled?'pending':'not_requested');
    }})();return claimed;
  }
  function claim(id){
    return db.transaction(()=>{
      const time=now();if(!canRun()||!openHours(time)||db.prepare('SELECT COUNT(*) AS total FROM social_content_comment_events WHERE attempt_day=?').get(dayKey(time)).total>=30)return null;
      const row=db.prepare("SELECT * FROM social_content_comment_events WHERE id=? AND status='pending'").get(id);if(!row)return null;
      if(!db.prepare("UPDATE social_content_comment_events SET status='processing',attempt_day=?,claimed_at=? WHERE id=? AND status='pending'").run(dayKey(time),time,id).changes)return null;return row;
    })();
  }
  function freshCampaign(event,expectedStatus='processing'){
    const campaign=rowById(event.campaign_id),account=campaign&&accountById(campaign.account_id);
    const currentEvent=db.prepare('SELECT status,invalidated_at FROM social_content_comment_events WHERE id=?').get(event.id);
    if(!currentEvent||currentEvent.status!==expectedStatus||currentEvent.invalidated_at!==null)throw fail('Este pedido foi invalidado antes do envio.',409);
    if(!campaign||campaign.status!=='active'||!account||hash(publicAccount(account))!==hash(JSON.parse(campaign.account_json))||event.original_time<=campaign.activated_at||now()-event.original_time>=7*DAY)throw fail('Campanha pausada, conta alterada ou pedido expirado.',409);
    if(sourceSnapshot(campaign.source_key).fingerprint!==campaign.source_hash)throw fail('O conteúdo mudou desde a prévia.',409);
    return campaign;
  }
  const validProviderId=id=>typeof id==='string'&&id.trim()&&id.length<=500&&!/[\x00-\x1f\x7f]/.test(id);
  const restorePrivate=id=>db.prepare("UPDATE social_content_comment_events SET status='pending',attempt_day=NULL,claimed_at=NULL WHERE id=? AND status='processing'").run(id);
  const restoreExtra=(id,prefix)=>db.prepare(`UPDATE social_content_comment_events SET ${prefix}_status='pending',${prefix}_attempt_day=NULL,${prefix}_claimed_at=NULL WHERE id=? AND ${prefix}_status='processing'`).run(id);
  async function timedSend(action){let timer;try{return await Promise.race([Promise.resolve().then(()=>{if(!canRun())throw Object.assign(Error('global_paused'),{ecosystemPaused:true});return action();}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('send_timeout')),Math.max(1,Math.min(sendTimeoutMs,30000)));})]);}finally{clearTimeout(timer);}}
  async function processExtra(event,prefix){
    const claimed=db.transaction(()=>{
      if(!canRun()||!openHours(now())||db.prepare(`SELECT COUNT(*) AS total FROM social_content_comment_events WHERE ${prefix}_attempt_day=?`).get(dayKey(now())).total>=30)return false;
      return db.prepare(`UPDATE social_content_comment_events SET ${prefix}_status='processing',${prefix}_claimed_at=?,${prefix}_attempt_day=? WHERE id=? AND status='sent' AND provider_message_id IS NOT NULL AND ${prefix}_status='pending'`).run(now(),dayKey(now()),event.id).changes>0;
    })();if(!claimed)return false;
    let campaign;
    try{campaign=freshCampaign(event,'sent');const readiness=await inspect(inspectionInput(campaign),JSON.parse(campaign.source_json));if(!readiness.ready)throw fail('Conexão indisponível.');campaign=freshCampaign(event,'sent');if(!openHours(now()))throw fail('Fora do horário de envio.');}
    catch{if(!canRun()){restoreExtra(event.id,prefix);return true;}db.prepare(`UPDATE social_content_comment_events SET ${prefix}_status='cancelled',${prefix}_reason='Interação cancelada na verificação anterior ao envio.' WHERE id=? AND ${prefix}_status='processing'`).run(event.id);return true;}
    try{
      const input={accountId:campaign.account_id,surface:campaign.surface,commentId:event.comment_id};
      let result;
      if(prefix==='public'){input.text=publicThanks(JSON.parse(campaign.source_json),event.author_name);db.prepare('UPDATE social_content_comment_events SET public_text=? WHERE id=?').run(input.text,event.id);result=await timedSend(()=>metaAdapter.replyPublic(input));if(!validProviderId(result?.commentId))throw Error('missing_public_confirmation');}
      else {result=await timedSend(()=>metaAdapter.likeComment(input));if(result?.success!==true)throw Error('missing_like_confirmation');}
      db.prepare(`UPDATE social_content_comment_events SET ${prefix}_status='sent',${prefix}_provider_id=?,${prefix}_sent_at=?,${prefix}_reason=NULL WHERE id=? AND ${prefix}_status='processing'`).run(prefix==='public'?result.commentId:null,now(),event.id);
    }catch(error){if(error?.ecosystemPaused){restoreExtra(event.id,prefix);return true;}db.prepare(`UPDATE social_content_comment_events SET ${prefix}_status=?,${prefix}_reason=? WHERE id=? AND ${prefix}_status='processing'`).run(error?.definitive===true?'failed':'unknown',error?.definitive===true?'A Meta recusou esta interação. Não haverá repetição automática.':'Resultado desta interação desconhecido. Não haverá repetição automática.',event.id);}
    return true;
  }
  async function processPending(){
    if(processing||!canRun())return {processed:0};
    // Claims cannot be replayed after a crash: an absent acknowledgment may still
    // represent an accepted private reply. Preserve them for manual review.
    db.prepare("UPDATE social_content_comment_events SET status='unknown',reason='Envio interrompido sem confirmação. Confira a conversa antes de qualquer novo envio.' WHERE status='processing' AND claimed_at<?").run(now()-120000);
    for(const prefix of ['public','reaction']){
      db.prepare(`UPDATE social_content_comment_events SET ${prefix}_status='unknown',${prefix}_reason='Interação interrompida sem confirmação. Não haverá repetição automática.' WHERE ${prefix}_status='processing' AND ${prefix}_claimed_at<?`).run(now()-120000);
      db.prepare(`UPDATE social_content_comment_events SET ${prefix}_status='cancelled',${prefix}_reason='A mensagem privada não foi confirmada.' WHERE ${prefix}_status='pending' AND status IN ('failed','unknown','cancelled','ignored')`).run();
    }
    if(!openHours(now()))return {processed:0};processing=true;let processed=0,actions=0;
    async function extras(event){for(const prefix of ['public','reaction'])if(actions<3&&await processExtra(event,prefix))actions++;}
    try{
      for(const event of db.prepare("SELECT * FROM social_content_comment_events WHERE status='sent' AND (public_status='pending' OR reaction_status='pending') ORDER BY sent_at,id LIMIT 3").all()){if(actions>=3)break;await extras(event);}
      for(const next of db.prepare("SELECT id FROM social_content_comment_events WHERE status='pending' ORDER BY received_at,id LIMIT 3").all()){
      if(actions>=3)break;
      const event=claim(next.id);if(!event)continue;processed++;
      actions++;
      let campaign;
      try{
        campaign=freshCampaign(event);const readiness=await inspect(inspectionInput(campaign),JSON.parse(campaign.source_json));
        if(!readiness.ready)throw fail('A conexão ou a publicação deixou de estar pronta.',409);
        campaign=freshCampaign(event);if(!openHours(now()))throw fail('O período de envio encerrou durante a verificação.',409);
      }catch{if(!canRun()){restorePrivate(event.id);break;}db.prepare("UPDATE social_content_comment_events SET status='cancelled',reason='Pedido cancelado na verificação anterior ao envio.' WHERE id=? AND status='processing'").run(event.id);cancelExtras('id',event.id,'Mensagem privada cancelada.');continue;}
      try{
        const result=await timedSend(()=>metaAdapter.send({accountId:campaign.account_id,surface:campaign.surface,commentId:event.comment_id,text:campaign.private_reply}));
        if(!validProviderId(result?.messageId))throw Error('missing_provider_confirmation');
        db.prepare("UPDATE social_content_comment_events SET status='sent',provider_message_id=?,sent_at=?,reason=NULL WHERE id=? AND status='processing'").run(result.messageId,now(),event.id);
      }catch(error){if(error?.ecosystemPaused){restorePrivate(event.id);break;}db.prepare("UPDATE social_content_comment_events SET status=?,reason=? WHERE id=? AND status='processing'").run(error?.definitive===true?'failed':'unknown',error?.definitive===true?'O serviço recusou o envio. Nenhuma repetição automática será feita.':'Confirmação de envio desconhecida. Confira a conversa antes de qualquer novo envio.',event.id);cancelExtras('id',event.id,'A mensagem privada não foi confirmada.');}
      await extras(db.prepare('SELECT * FROM social_content_comment_events WHERE id=?').get(event.id));
    }}finally{processing=false;}return {processed,actions};
  }
  return {ingestWebhook,processPending};
}
