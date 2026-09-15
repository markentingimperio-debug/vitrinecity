import {randomUUID} from 'node:crypto';

const MP='https://api.mercadopago.com';
const openStates=new Set(['creating','pending','authorized','in_process','approved','in_mediation','partially_refunded']);
const EMAIL=/^[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[^\s@\x00-\x1f]+$/;
function validQr(code,image){
  return typeof code==='string'&&code.length>=60&&code.length<=2048&&code.startsWith('000201')&&!/[\x00-\x1f]/.test(code)&&
    typeof image==='string'&&image.length>=60&&image.length<=300000&&image.startsWith('iVBORw0KGgo')&&/^[A-Za-z0-9+/]+={0,2}$/.test(image);
}
export function publicSupportPix(order,time){
  if(order.payment_method!=='pix')return {};
  const value={method:'pix',expiresAt:new Date(order.expires_ms).toISOString()};
  if(order.status==='pending'&&order.expires_ms>time&&validQr(order.pix_code,order.pix_image))
    value.pix={qrCode:order.pix_code,qrCodeBase64:order.pix_image,expiresAt:value.expiresAt};
  return value;
}

// This integration only creates an unpaid Pix request. Settlement always uses
// the provider's verified production record and the existing separate ledger.
export function setupPrayerSupportPix({app,db,site,sameOriginOnly,allowAttempt,readConfig,recipientReady,headers,publicOrder,tokenFor,hash,settle,fetchImpl,now,allowedAmounts}){
  const columns=new Set(db.prepare('PRAGMA table_info(prayer_support_orders)').all().map(c=>c.name));
  for(const [name,type] of Object.entries({payment_method:"TEXT NOT NULL DEFAULT 'checkout'",pix_code:'TEXT',pix_image:'TEXT',payer_email_hash:'TEXT',provider_checked_ms:'INTEGER'}))
    if(!columns.has(name))db.exec(`ALTER TABLE prayer_support_orders ADD COLUMN ${name} ${type}`);
  const get=reference=>db.prepare('SELECT * FROM prayer_support_orders WHERE reference=?').get(reference);
  function matches(payment,order){
    return payment?.live_mode===true&&/^\d{1,30}$/.test(String(payment.id||''))&&payment.payment_method_id==='pix'&&
      String(payment.external_reference)===order.reference&&String(payment.collector_id)===order.collector_id&&
      payment.currency_id==='BRL'&&Number(payment.transaction_amount)===order.amount_cents/100&&(!order.payment_id||String(payment.id)===order.payment_id);
  }
  function save(payment,order){
    if(!matches(payment,order))throw Error('Pix provider mismatch');
    // Reuse monotonic settlement before saving QR data; an approval/chargeback
    // arriving while the create request is in flight must never be downgraded.
    settle(payment);
    const tx=payment.point_of_interaction?.transaction_data||{};
    const expiry=Date.parse(payment.date_of_expiration);
    if(Number.isFinite(expiry)&&validQr(tx.qr_code,tx.qr_code_base64))
      db.prepare('UPDATE prayer_support_orders SET pix_code=?,pix_image=?,expires_ms=? WHERE reference=?')
        .run(tx.qr_code,tx.qr_code_base64,expiry,order.reference);
    return get(order.reference);
  }
  async function reconcile(order){
    if(order.payment_method!=='pix'||!openStates.has(order.status))return order;
    const time=now();
    // Persist the throttle before I/O: concurrent polling and restarts cannot
    // multiply provider requests for the same receipt.
    if(!db.prepare('UPDATE prayer_support_orders SET provider_checked_ms=? WHERE reference=? AND (provider_checked_ms IS NULL OR provider_checked_ms<=?)')
      .run(time,order.reference,time-15000).changes)return get(order.reference);
    const config=readConfig();if(!config.accessToken)return get(order.reference);
    try{
      const url=order.payment_id?`${MP}/v1/payments/${order.payment_id}`:`${MP}/v1/payments/search?external_reference=${encodeURIComponent(order.reference)}`;
      const response=await fetchImpl(url,{headers:headers(config),signal:AbortSignal.timeout(8000)});
      if(!response.ok)return get(order.reference);
      const data=await response.json();
      if(order.payment_id){if(String(data.id)!==order.payment_id)return get(order.reference);return save(data,get(order.reference));}
      const payments=Array.isArray(data.results)?data.results.filter(p=>matches(p,order)):[];
      if(payments.length>1){db.prepare("UPDATE prayer_support_orders SET status='review_required',updated_ms=? WHERE reference=? AND status='creating'").run(time,order.reference);return get(order.reference);}
      if(payments.length===1)return save(payments[0],get(order.reference));
    }catch{/* A missing response is never evidence that money was received. */}
    return get(order.reference);
  }
  app.post('/api/prayer-support/pix',sameOriginOnly,async(req,res)=>{
    res.set('Cache-Control','private,no-store');
    const body=req.body||{},key=String(body.requestKey||'');
    if(body.accepted!==true||!/^[a-zA-Z0-9_-]{20,100}$/.test(key)||!allowedAmounts.includes(body.amountCents)||('quantity'in body&&body.quantity!==1)||body.recurring===true)
      return res.status(400).json({error:'Escolha um valor disponível para a contribuição única e voluntária.'});
    const config=readConfig(),ready=await recipientReady(config);
    if(!ready.enabled)return res.status(503).json({error:'O Pix está indisponível agora. A oração continua gratuita.',reason:ready.reason});
    let order=db.prepare('SELECT * FROM prayer_support_orders WHERE request_key=?').get(key);
    if(order){
      if(order.collector_id!==config.collectorId||order.beneficiary!==config.beneficiary)return res.status(409).json({error:'O recebedor mudou. Confira os dados antes de continuar.'});
      if(order.amount_cents!==body.amountCents||order.payment_method!=='pix')return res.status(409).json({...publicOrder(order),statusToken:tokenFor(order,config),error:'Já existe uma contribuição em acompanhamento. Verifique seu status antes de continuar.'});
      order=await reconcile(order);
      const result={...publicOrder(order),statusToken:tokenFor(order,config)};
      return res.status(result.pix?200:409).json({...result,...(result.pix?{}:{error:'Esta contribuição já está em acompanhamento. Verifique a confirmação antes de continuar.'})});
    }
    const email=String(body.payerEmail||'').trim().toLowerCase();
    if(email.length>254||!EMAIL.test(email))return res.status(400).json({error:'Informe um e-mail válido para identificar sua contribuição no Mercado Pago.'});
    if(!allowAttempt(req.ip))return res.status(429).json({error:'Aguarde alguns minutos antes de tentar novamente.'});
    // recipientReady may await network I/O, so reserve with a UNIQUE key before
    // submitting. A raced request must read the same receipt, never POST again.
    const time=now(),reference='support_'+randomUUID();
    order={reference,request_key:key,amount_cents:body.amountCents,beneficiary:config.beneficiary,collector_id:config.collectorId,status:'creating',payment_method:'pix',created_ms:time,expires_ms:time+30*60000};
    const statusToken=tokenFor(order,config);
    const reserved=db.prepare(`INSERT OR IGNORE INTO prayer_support_orders(reference,request_key,amount_cents,beneficiary,collector_id,status,status_token_hash,created_ms,updated_ms,expires_ms,payment_method,payer_email_hash)
      VALUES (?,?,?,?,?,'creating',?,?,?,?, 'pix',?)`).run(reference,key,order.amount_cents,order.beneficiary,order.collector_id,hash(statusToken),time,time,order.expires_ms,hash(email));
    if(!reserved.changes){const existing=db.prepare('SELECT * FROM prayer_support_orders WHERE request_key=?').get(key);return res.status(409).json({...publicOrder(existing),statusToken:tokenFor(existing,config),error:'Esta contribuição já está sendo preparada.'});}
    try{
      const response=await fetchImpl(`${MP}/v1/payments`,{method:'POST',headers:{...headers(config),'X-Idempotency-Key':reference},
        body:JSON.stringify({transaction_amount:order.amount_cents/100,payment_method_id:'pix',payer:{email},description:'Contribuição voluntária única · Oração do Dia · VitrineCity',
          external_reference:reference,notification_url:`${site}/api/prayer-support/webhook`,date_of_expiration:new Date(order.expires_ms).toISOString(),metadata:{purpose:'prayer_voluntary_support',one_time:true}}),signal:AbortSignal.timeout(12000)});
      const payment=await response.json();
      if(!response.ok&&[400,401,403,404,422].includes(response.status)){
        db.prepare("UPDATE prayer_support_orders SET status='creation_rejected',updated_ms=? WHERE reference=? AND status='creating'").run(now(),reference);
        return res.status(422).json({...publicOrder(get(reference)),statusToken,error:'Não foi possível gerar este Pix no Mercado Pago. Nenhum valor foi alterado. Você pode tentar a opção Mercado Pago.'});
      }
      if(!response.ok)throw Error('Pix response unavailable');
      const saved=save(payment,get(reference)),result=publicOrder(saved);
      if(!result.pix&&saved.status!=='approved')throw Error('Pix data unavailable');
      return res.status(201).json({...result,statusToken});
    }catch{
      return res.status(502).json({...publicOrder(get(reference)),statusToken,error:'A geração do Pix ainda precisa de confirmação. Verifique o status; não gere outra contribuição enquanto esta estiver pendente.'});
    }
  });
  return {reconcile};
}
