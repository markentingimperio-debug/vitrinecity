import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {setupPrayerSupportPix,publicSupportPix} from './prayer-support-pix.js';

export const PRAYER_SUPPORT_AMOUNT_CENTS=500;
export const PRAYER_SUPPORT_AMOUNTS_CENTS=Object.freeze([50,100,200,300,500]);
const DAY=86400000;
const MP='https://api.mercadopago.com';
const allowedStatuses=new Set(['pending','authorized','in_process','in_mediation','approved','rejected','cancelled','refunded','charged_back']);
const protectedStatuses=new Set(['approved','in_mediation','partially_refunded','refunded','charged_back','review_required']);
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
const receiptToken=(order,secret)=>createHmac('sha256',secret).update(`prayer-support-status:${order.reference}:${order.request_key}`).digest('base64url');
const safeEqual=(left,right)=>{const a=Buffer.from(String(left)),b=Buffer.from(String(right));return a.length===b.length&&timingSafeEqual(a,b);};

export function prayerSupportEnvironment(env=process.env){
  return {enabled:env.PRAYER_SUPPORT_ENABLED==='true',beneficiary:String(env.PRAYER_SUPPORT_BENEFICIARY||'').trim().slice(0,120),collectorId:String(env.PRAYER_SUPPORT_COLLECTOR_ID||'').trim(),accessToken:String(env.MERCADOPAGO_ACCESS_TOKEN||'').trim(),webhookSecret:String(env.MERCADOPAGO_WEBHOOK_SECRET||'').trim()};
}

export function prayerSupportCheckoutUrl(value){
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&['mercadopago.com.br','www.mercadopago.com.br','mercadopago.com','www.mercadopago.com'].includes(url.hostname)&&!url.port&&url.pathname.startsWith('/checkout/')?url.href:'';}catch{return '';}
}

// Dedicated support records deliberately have no wallet, product, enrollment,
// affiliate or fulfillment references. An approval grants no platform benefit.
export function setupPrayerSupport({app,db,siteUrl,sameOriginOnly,allowAttempt=()=>true,verifySignature,readConfig=()=>prayerSupportEnvironment(),fetchImpl=globalThis.fetch,now=Date.now}){
  const site=new URL(siteUrl).origin;
  db.exec(`CREATE TABLE IF NOT EXISTS prayer_support_orders (
    reference TEXT PRIMARY KEY,request_key TEXT NOT NULL UNIQUE,amount_cents INTEGER NOT NULL CHECK(amount_cents IN (50,100,200,300,500)),
    currency TEXT NOT NULL DEFAULT 'BRL' CHECK(currency='BRL'),beneficiary TEXT NOT NULL,collector_id TEXT NOT NULL,
    status TEXT NOT NULL,preference_id TEXT UNIQUE,checkout_url TEXT,payment_id TEXT UNIQUE,status_token_hash TEXT NOT NULL,provider_updated_ms INTEGER,
    created_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL,expires_ms INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS prayer_support_events (
    event_key TEXT PRIMARY KEY,reference TEXT NOT NULL REFERENCES prayer_support_orders(reference),payment_id TEXT NOT NULL,
    status TEXT NOT NULL,amount_cents INTEGER NOT NULL,refunded_cents INTEGER NOT NULL DEFAULT 0,created_ms INTEGER NOT NULL);`);
  if(!db.prepare('PRAGMA table_info(prayer_support_orders)').all().some(column=>column.name==='provider_updated_ms'))
    db.exec('ALTER TABLE prayer_support_orders ADD COLUMN provider_updated_ms INTEGER');
  if(!db.prepare('PRAGMA table_info(prayer_support_orders)').all().some(column=>column.name==='status_token_aliases'))
    db.exec("ALTER TABLE prayer_support_orders ADD COLUMN status_token_aliases TEXT NOT NULL DEFAULT '[]'");
  const tokenHashes=order=>{try{return [order.status_token_hash,...JSON.parse(order.status_token_aliases||'[]')].filter(value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value));}catch{return [order.status_token_hash];}};
  const tokenFor=(order,config)=>{
    const token=receiptToken(order,config.webhookSecret),digest=hash(token);
    // A replay is authorized by its unguessable request key. When the provider
    // signing secret rotates, retain the previous receipt hashes and accept the
    // current one too; never invalidate a receipt already saved by the visitor.
    if(order.status_token_hash&&!tokenHashes(order).includes(digest)){
      const current=db.prepare('SELECT * FROM prayer_support_orders WHERE reference=?').get(order.reference);
      const aliases=[...new Set([...tokenHashes(current),digest])].filter(value=>value!==current.status_token_hash);
      db.prepare('UPDATE prayer_support_orders SET status_token_aliases=? WHERE reference=?').run(JSON.stringify(aliases),order.reference);
    }
    return token;
  };
  let verification=null;
  const headers=config=>({Authorization:`Bearer ${config.accessToken}`,'Content-Type':'application/json'});
  async function recipientReady(config){
    if(!config.enabled)return {enabled:false,reason:'disabled'};
    if(config.beneficiary.length<2||!/^\d{1,20}$/.test(config.collectorId))return {enabled:false,reason:'beneficiary_pending'};
    if(!config.accessToken||!config.webhookSecret)return {enabled:false,reason:'payment_unavailable'};
    const key=hash(config.accessToken+':'+config.collectorId);
    if(verification?.key===key&&verification.expires>now())return verification.promise;
    const entry={key,expires:now()+30000,promise:null};verification=entry;
    entry.promise=(async()=>{
      try{
        // Mercado Pago's credential documentation uses this authenticated,
        // read-only account endpoint. Never expose its personal fields.
        const response=await fetchImpl('https://api.mercadolibre.com/users/me',{headers:headers(config),signal:AbortSignal.timeout(8000)}),account=await response.json();
        if(!response.ok||String(account.id)!==config.collectorId)return {enabled:false,reason:'beneficiary_unverified'};
        entry.expires=now()+5*60000;return {enabled:true,reason:'ready'};
      }catch{return {enabled:false,reason:'verification_unavailable'};}
    })();
    return entry.promise;
  }
  let pixService;
  const publicOrder=order=>({reference:order.reference,status:order.status,amountCents:order.amount_cents,currency:'BRL',beneficiary:order.beneficiary,...publicSupportPix(order,now())});
  app.get('/api/prayer-support/config',async(_req,res)=>{
    const config=readConfig(),ready=await recipientReady(config);
    return res.set('Cache-Control','no-store').json({amountCents:500,defaultAmountCents:500,amountsCents:PRAYER_SUPPORT_AMOUNTS_CENTS,currency:'BRL',beneficiary:config.beneficiary,oneTime:true,pixEnabled:ready.enabled,...ready});
  });
  app.post('/api/prayer-support/checkout',sameOriginOnly,async(req,res)=>{
    res.set('Cache-Control','no-store');
    const body=req.body||{},key=String(body.requestKey||'');
    if(body.accepted!==true||!/^[a-zA-Z0-9_-]{20,100}$/.test(key))return res.status(400).json({error:'Confirme o apoio voluntário único e o valor escolhido.'});
    if(!PRAYER_SUPPORT_AMOUNTS_CENTS.includes(body.amountCents)||('quantity'in body&&body.quantity!==1)||body.recurring===true)return res.status(400).json({error:'Escolha um dos valores de apoio disponíveis. Não há cobrança recorrente.'});
    const config=readConfig(),ready=await recipientReady(config);
    if(!ready.enabled)return res.status(503).json({error:'O apoio ainda não está disponível. A oração continua gratuita.',reason:ready.reason});
    let order=db.prepare('SELECT * FROM prayer_support_orders WHERE request_key=?').get(key);
    if(order){
      if(order.collector_id!==config.collectorId||order.beneficiary!==config.beneficiary)return res.status(409).json({error:'Os dados do recebedor mudaram. Confira novamente antes de apoiar.'});
      if(order.amount_cents!==body.amountCents)return res.status(409).json({...publicOrder(order),statusToken:tokenFor(order,config),error:'Já existe um apoio em acompanhamento com outro valor. Confira o status desse apoio antes de continuar.'});
      if(order.status==='pending'&&order.checkout_url&&order.expires_ms>now())return res.json({...publicOrder(order),checkoutUrl:order.checkout_url,statusToken:tokenFor(order,config)});
      return res.status(409).json({...publicOrder(order),statusToken:tokenFor(order,config),error:'Este apoio já está sendo acompanhado. Confira o status antes de tentar novamente.'});
    }
    if(!allowAttempt(req.ip))return res.status(429).json({error:'Aguarde alguns minutos antes de tentar novamente.'});
    const time=now(),reference='support_'+randomUUID();
    order={reference,request_key:key,amount_cents:body.amountCents,beneficiary:config.beneficiary,collector_id:config.collectorId,status:'creating',created_ms:time,expires_ms:time+DAY};
    const statusToken=receiptToken(order,config.webhookSecret);
    db.prepare(`INSERT INTO prayer_support_orders(reference,request_key,amount_cents,beneficiary,collector_id,status,status_token_hash,created_ms,updated_ms,expires_ms)
      VALUES (?,?,?,?,?,'creating',?,?,?,?)`).run(reference,key,order.amount_cents,order.beneficiary,order.collector_id,hash(statusToken),time,time,order.expires_ms);
    const returnUrl=`${site}/oracao-do-dia.html?apoio=retorno&ref=${encodeURIComponent(reference)}`;
    try{
      const response=await fetchImpl(`${MP}/checkout/preferences`,{
        method:'POST',headers:{...headers(config),'X-Idempotency-Key':reference},
        body:JSON.stringify({items:[{id:'prayer-voluntary-support',title:'Apoio voluntário único · Oração do Dia',description:`Apoio de ${(order.amount_cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} para ${order.beneficiary}. Não concede créditos, produtos ou benefícios.`,quantity:1,currency_id:'BRL',unit_price:order.amount_cents/100}],
          external_reference:reference,notification_url:`${site}/api/prayer-support/webhook`,back_urls:{success:returnUrl,pending:returnUrl,failure:returnUrl},
          auto_return:'approved',statement_descriptor:'VITRINECITY',metadata:{purpose:'prayer_voluntary_support',one_time:true},expires:true,expiration_date_from:new Date(time).toISOString(),expiration_date_to:new Date(order.expires_ms).toISOString()}),
        signal:AbortSignal.timeout(12000)});
      const preference=await response.json(),checkoutUrl=prayerSupportCheckoutUrl(preference.init_point);
      if(!response.ok&&response.status>=400&&response.status<500){
        db.prepare("UPDATE prayer_support_orders SET status='creation_rejected',updated_ms=? WHERE reference=? AND status='creating'").run(now(),reference);
        return res.status(422).json({...publicOrder({...order,status:'creation_rejected'}),statusToken,error:'O Mercado Pago não disponibilizou o pagamento com esse valor. Nenhum outro valor foi enviado. A oração continua gratuita.'});
      }
      if(!response.ok||!preference.id||!checkoutUrl||String(preference.collector_id)!==order.collector_id)throw Error('Invalid support preference.');
      db.prepare("UPDATE prayer_support_orders SET preference_id=?,checkout_url=?,status=CASE WHEN status='creating' THEN 'pending' ELSE status END,updated_ms=? WHERE reference=?")
        .run(String(preference.id),checkoutUrl,now(),reference);
      const saved=db.prepare('SELECT * FROM prayer_support_orders WHERE reference=?').get(reference);
      return res.status(201).json({...publicOrder(saved),checkoutUrl,statusToken});
    }catch{
      // A timeout does not prove that Mercado Pago failed to create a preference.
      // Preserve this reference and prevent a repeated click from creating another.
      return res.status(502).json({...publicOrder(order),statusToken,error:'A confirmação da abertura do pagamento não chegou. Este apoio permanece em verificação; não foi confirmado como pago.'});
    }
  });
  app.get('/api/prayer-support/orders/:reference',async(req,res)=>{
    res.set('Cache-Control','private,no-store');
    let order=db.prepare('SELECT * FROM prayer_support_orders WHERE reference=?').get(String(req.params.reference));
    if(!order||!tokenHashes(order).some(digest=>safeEqual(hash(req.get('X-Support-Token')||''),digest)))return res.status(404).json({error:'Apoio não encontrado.'});
    if(order.payment_method==='pix')order=await pixService.reconcile(order);
    return res.set('Cache-Control','private,no-store').json(publicOrder(order));
  });
  const settle=db.transaction(payment=>{
    const reference=String(payment?.external_reference||''),order=db.prepare('SELECT * FROM prayer_support_orders WHERE reference=?').get(reference);
    if(!order)return null;
    // This ledger reports real voluntary support only. A simulated payment, or
    // a response without an explicit production marker, cannot confirm money.
    if(payment.live_mode!==true)throw Error('Support payment is not verified as live.');
    const id=String(payment.id||''),amount=Number(payment.transaction_amount),refunded=Number(payment.transaction_amount_refunded||0);
    if(order.payment_method==='pix'&&(payment.payment_method_id!=='pix'||(order.payment_id&&order.payment_id!==id)))throw Error('Pix payment identity mismatch.');
    if(!/^\d{1,30}$/.test(id)||!allowedStatuses.has(payment.status)||payment.currency_id!=='BRL'||amount!==order.amount_cents/100||String(payment.collector_id)!==order.collector_id||!Number.isFinite(refunded)||refunded<0||refunded>amount)throw Error('Support payment mismatch.');
    let status=String(payment.status);if(status==='approved'&&refunded>0)status=refunded===amount?'refunded':'partially_refunded';
    const parsedUpdate=typeof payment.date_last_updated==='string'?Date.parse(payment.date_last_updated):NaN;
    const providerUpdatedMs=Number.isFinite(parsedUpdate)?parsedUpdate:null;
    // Provider GETs can complete out of order. A newer dispute must revoke the
    // confirmed view, and an older/undated approval must not undo that dispute.
    if(order.payment_id===id&&order.provider_updated_ms!==null&&
      (providerUpdatedMs===null||providerUpdatedMs<=order.provider_updated_ms))return order;
    if(status==='in_mediation'&&providerUpdatedMs===null)return order;
    const eventKey=`${id}:${status}:${Math.round(refunded*100)}:${providerUpdatedMs??'undated'}`;
    if(db.prepare('SELECT 1 FROM prayer_support_events WHERE event_key=?').get(eventKey))return order;
    if(order.payment_id&&order.payment_id!==id&&protectedStatuses.has(order.status)){
      db.prepare('INSERT INTO prayer_support_events(event_key,reference,payment_id,status,amount_cents,refunded_cents,created_ms) VALUES (?,?,?,?,?,?,?)').run(eventKey,reference,id,status,order.amount_cents,Math.round(refunded*100),now());
      if(status==='approved')db.prepare("UPDATE prayer_support_orders SET status='review_required',updated_ms=? WHERE reference=?").run(now(),reference);
      return db.prepare('SELECT * FROM prayer_support_orders WHERE reference=?').get(reference);
    }
    if(order.payment_id===id){
      if(['refunded','charged_back','review_required'].includes(order.status)&&status!==order.status)return order;
      if(['approved','partially_refunded'].includes(order.status)&&['pending','authorized','in_process','rejected','cancelled'].includes(status))return order;
      if(order.status==='partially_refunded'&&status==='approved')return order;
    }
    db.prepare('INSERT INTO prayer_support_events(event_key,reference,payment_id,status,amount_cents,refunded_cents,created_ms) VALUES (?,?,?,?,?,?,?)').run(eventKey,reference,id,status,order.amount_cents,Math.round(refunded*100),now());
    db.prepare('UPDATE prayer_support_orders SET status=?,payment_id=?,provider_updated_ms=?,updated_ms=? WHERE reference=?').run(status,id,providerUpdatedMs,now(),reference);
    return db.prepare('SELECT * FROM prayer_support_orders WHERE reference=?').get(reference);
  });
  pixService=setupPrayerSupportPix({app,db,site,sameOriginOnly,allowAttempt,readConfig,recipientReady,headers,publicOrder,
    tokenFor,hash,settle,fetchImpl,now,allowedAmounts:PRAYER_SUPPORT_AMOUNTS_CENTS});
  app.post('/api/prayer-support/webhook',async(req,res)=>{
    const signatureId=String(req.query['data.id']||req.query.data_id||''),bodyId=String(req.body?.data?.id||''),id=signatureId;
    if(!verifySignature?.(req,signatureId))return res.sendStatus(401);
    const type=String(req.body?.type||req.query.type||'');if(type!=='payment')return res.sendStatus(200);
    if(!/^\d{1,30}$/.test(id)||(signatureId&&bodyId&&signatureId!==bodyId))return res.sendStatus(400);
    const config=readConfig();if(!config.accessToken)return res.sendStatus(503);
    try{
      const response=await fetchImpl(`${MP}/v1/payments/${id}`,{headers:headers(config),signal:AbortSignal.timeout(10000)});
      if(!response.ok)return res.sendStatus(502);const payment=await response.json();
      if(String(payment.id)!==id)return res.sendStatus(400);
      if(!String(payment.external_reference||'').startsWith('support_'))return res.sendStatus(200);
      settle(payment);return res.sendStatus(200);
    }catch{return res.sendStatus(502);}
  });
  return {settle};
}
