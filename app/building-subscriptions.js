import {randomUUID} from 'node:crypto';

export const BUILDING_TRIAL=Object.freeze({days:30,monthlyCents:1000,version:'building-trial-30d-v1'});
const DAY=86400000,HOLD=45*60000;
const error=(message,status=409,code='subscription_conflict')=>Object.assign(new Error(message),{status,code});
const cancelled=status=>['cancelled','canceled'].includes(status);
const stamp=value=>Date.parse(String(value||'').replace(' ','T')+(/(?:Z|[+-]\d\d:\d\d)$/.test(String(value||''))?'':'Z'));

/** A recurring authorization grants access, but only verified payment receipts
 * count as revenue. Network-ambiguous creations stay reserved for reconciliation. */
export function setupBuildingSubscriptions({db,request,siteUrl,now=Date.now,onActivation=()=>{},onPayment=()=>{},trialEnabled=()=>true,schedule=false}){
  const columns={trial_version:"TEXT NOT NULL DEFAULT ''",trial_until:'TEXT',subscription_status:"TEXT NOT NULL DEFAULT ''",mp_checkout_url:'TEXT',subscription_error:'TEXT',subscription_paid_cents:'INTEGER NOT NULL DEFAULT 0'};
  const existing=new Set(db.prepare('PRAGMA table_info(lot_orders)').all().map(row=>row.name));
  for(const [name,type] of Object.entries(columns))if(!existing.has(name))db.exec(`ALTER TABLE lot_orders ADD COLUMN ${name} ${type}`);
  db.exec(`CREATE TABLE IF NOT EXISTS building_trial_claims(email TEXT PRIMARY KEY,order_reference TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,consumed_at TEXT);
    CREATE TABLE IF NOT EXISTS building_subscription_suspensions(order_reference TEXT PRIMARY KEY,previous_review_status TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS building_subscription_receipts(payment_id TEXT PRIMARY KEY,order_reference TEXT NOT NULL,status TEXT NOT NULL,amount_cents INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,approved_at TEXT);
    CREATE INDEX IF NOT EXISTS building_subscription_receipts_order ON building_subscription_receipts(order_reference);`);
  if(!db.prepare('PRAGMA table_info(building_subscription_receipts)').all().some(row=>row.name==='approved_at'))db.exec('ALTER TABLE building_subscription_receipts ADD COLUMN approved_at TEXT');
  const get=reference=>db.prepare('SELECT * FROM lot_orders WHERE reference=?').get(reference);
  const iso=()=>new Date(now()).toISOString();
  const config=()=>({enabled:trialEnabled(),...BUILDING_TRIAL});
  function details(order){
    return {trialUntil:order.trial_until||null,billingAmountCents:Number(order.amount_cents||0),
      trialVersion:order.trial_version||null,subscriptionStatus:order.subscription_status||null,
      paymentReceived:order.billing_type==='recurring'?Boolean(order.subscription_paid_cents):order.status==='approved',
      trialActive:Boolean(order.trial_version&&order.status==='approved'&&stamp(order.trial_until)>now()&&!order.subscription_paid_cents)};
  }
  function occupation(lotCode,excluding=''){
    return db.prepare(`SELECT * FROM lot_orders WHERE lot_code=? AND reference<>? AND (status='approved' OR
      (billing_type='recurring' AND subscription_status IN ('creating','creation_uncertain','verification_pending','cancellation_pending','authorized','awaiting_payment','conflict')) OR
      (status IN ('created','pending') AND datetime(created_at)>=datetime(?))) ORDER BY CASE WHEN status='approved' THEN 0 ELSE 1 END LIMIT 1`)
      .get(lotCode,excluding,new Date(now()-HOLD).toISOString());
  }
  function suspend(reference,status){
    db.prepare(`INSERT OR IGNORE INTO building_subscription_suspensions(order_reference,previous_review_status,created_at) SELECT order_reference,review_status,? FROM store_profiles WHERE order_reference=? AND review_status='published'`).run(iso(),reference);
    db.prepare(`UPDATE store_profiles SET review_status=CASE WHEN review_status='published' THEN 'subscription_suspended' ELSE review_status END,updated_at=? WHERE order_reference=?`).run(iso(),reference);
    db.prepare('UPDATE lot_orders SET status=?,subscription_status=?,fulfillment_status=?,updated_at=? WHERE reference=?')
      .run(cancelled(status)?'cancelled':status==='paused'?'paused':'pending',status,`subscription_${status}`,iso(),reference);
  }
  const providerValid=(subscription,order)=>{
    const recurring=subscription?.auto_recurring;
    return String(subscription?.id||'')===String(order.mp_subscription_id||'')&&String(subscription?.external_reference||'')===order.reference&&
      recurring?.currency_id==='BRL'&&Number(recurring.transaction_amount)*100===order.amount_cents&&Number(recurring.frequency)===1&&recurring.frequency_type==='months'&&
      (!order.trial_version||(Number.isFinite(stamp(recurring.start_date))&&stamp(recurring.start_date)>=stamp(order.trial_until)-1000&&
        (subscription.next_payment_date==null||(Number.isFinite(stamp(subscription.next_payment_date))&&stamp(subscription.next_payment_date)>=stamp(order.trial_until)-1000))));
  };
  async function stopProvider(order,reason='cancelled'){
    db.prepare('UPDATE lot_orders SET subscription_status=?,subscription_error=?,updated_at=? WHERE reference=?').run('cancellation_pending',reason,iso(),order.reference);
    try{
      const remote=await request(`/preapproval/${encodeURIComponent(order.mp_subscription_id)}`,{method:'PUT',body:{status:'cancelled'}});
      if(!cancelled(remote.status))throw error('O cancelamento ainda não foi confirmado.',502);
      suspend(order.reference,'cancelled');return get(order.reference);
    }catch(e){throw error('O cancelamento ainda está em verificação. A reserva foi preservada; tente novamente ou fale com o suporte.',502,'cancellation_pending');}
  }
  function accept(subscription,reference){
    let activated=false;
    const result=db.transaction(()=>{
      const order=get(reference);if(!order||order.billing_type!=='recurring')throw error('Assinatura não encontrada.',404);
      if(String(subscription.id)!==String(order.mp_subscription_id)||String(subscription.external_reference||'')!==reference)throw error('Assinatura divergente.',409,'provider_mismatch');
      if(cancelled(subscription.status)||subscription.status==='paused'){suspend(reference,cancelled(subscription.status)?'cancelled':'paused');return get(reference);}
      if(!providerValid(subscription,order))throw error('As condições de cobrança não foram confirmadas.',502,'provider_mismatch');
      if(cancelled(order.status)||['cancellation_pending','conflict'].includes(order.subscription_status))return order;
      if(subscription.status==='authorized'){
        if(occupation(order.lot_code,reference)){db.prepare("UPDATE lot_orders SET status='pending',subscription_status='conflict',subscription_error='lot_occupied',updated_at=? WHERE reference=?").run(iso(),reference);throw error('O prédio não está mais disponível. A assinatura precisa ser cancelada.',409,'lot_occupied');}
        const expiredTrial=order.trial_version&&stamp(order.trial_until)<=now()&&!order.subscription_paid_cents;
        if(expiredTrial){suspend(reference,'awaiting_payment');return get(reference);}
        activated=order.status!=='approved';
        db.prepare(`UPDATE lot_orders SET status='approved',subscription_status='authorized',subscription_error=NULL,
          fulfillment_status=CASE WHEN fulfillment_status IN ('awaiting_payment','subscription_awaiting_payment','subscription_paused') THEN 'awaiting_assets' ELSE fulfillment_status END,
          reserved_at=COALESCE(reserved_at,?),updated_at=? WHERE reference=?`).run(iso(),iso(),reference);
        db.prepare(`UPDATE store_profiles SET review_status='published',updated_at=? WHERE order_reference=? AND review_status='subscription_suspended' AND EXISTS(SELECT 1 FROM building_subscription_suspensions WHERE order_reference=? AND previous_review_status='published')`).run(iso(),reference,reference);
        db.prepare('DELETE FROM building_subscription_suspensions WHERE order_reference=?').run(reference);
        if(order.trial_version)db.prepare('UPDATE building_trial_claims SET consumed_at=COALESCE(consumed_at,?) WHERE order_reference=?').run(iso(),reference);
      }else if(order.status==='approved')suspend(reference,'pending');
      else db.prepare("UPDATE lot_orders SET subscription_status='pending',updated_at=? WHERE reference=?").run(iso(),reference);
      return get(reference);
    })();
    if(activated)onActivation(result);return result;
  }
  async function reconcile(reference,subscription){
    const order=get(reference);if(!order?.mp_subscription_id)return order;
    const remote=subscription||await request(`/preapproval/${encodeURIComponent(order.mp_subscription_id)}`);
    if(cancelled(remote.status)||remote.status==='paused')return accept(remote,reference);
    if(order.subscription_status==='cancellation_pending'||cancelled(order.status))return stopProvider(order,order.subscription_error||'cancelled');
    if(!providerValid(remote,order)||occupation(order.lot_code,reference)&&remote.status==='authorized'){
      await stopProvider(order,!providerValid(remote,order)?'provider_mismatch':'lot_occupied');
      throw error('As condições desta assinatura não puderam ser confirmadas. Ela foi cancelada sem liberar a loja.',409,'subscription_cancelled');
    }
    if(remote.status==='pending'&&now()-stamp(order.created_at)>=HOLD)return stopProvider(order,'reservation_expired');
    if(remote.status==='pending'&&!order.mp_checkout_url){
      let checkout;try{checkout=new URL(remote.init_point);}catch{}
      if(!checkout||checkout.protocol!=='https:'||!/(^|\.)mercadopago\.com(?:\.br)?$/.test(checkout.hostname))throw error('O endereço de autorização ainda não foi confirmado.',502,'verification_pending');
      db.prepare('UPDATE lot_orders SET mp_checkout_url=?,trial_until=CASE WHEN trial_version<>\'\' THEN ? ELSE trial_until END,updated_at=? WHERE reference=?').run(checkout.toString(),remote.auto_recurring.start_date||null,iso(),reference);
    }
    return accept(remote,reference);
  }
  async function create({name,email,whatsapp,businessName,segment,lotCode,affiliateId=null,planCode='basic_monthly',trialConsent,trialConsentVersion,onReserved=()=>{},canResume=()=>false}){
    const trial=planCode==='basic_monthly_trial';
    if(!['basic_monthly','basic_monthly_trial'].includes(planCode))throw error('Plano mensal inválido.',400);
    if(trial&&(!trialEnabled()||trialConsent!==true||trialConsentVersion!==BUILDING_TRIAL.version))throw error('Confirme as condições do período gratuito para continuar.',400,'trial_consent_required');
    const normalizedEmail=email.trim().toLowerCase();
    const reserved=db.transaction(()=>{
      if(trial){
        const claim=db.prepare('SELECT * FROM building_trial_claims WHERE email=?').get(normalizedEmail);
        if(claim){const previous=get(claim.order_reference);if(previous&&!claim.consumed_at&&previous.status==='pending'&&previous.lot_code===lotCode&&canResume(previous))return {order:previous,replayed:true};
          throw error('O período gratuito está disponível uma única vez por e-mail. Você pode escolher o plano mensal.',409,'trial_already_used');}
      }
      if(occupation(lotCode))throw error('Este prédio já foi reservado.',409,'lot_reserved');
      const reference=`sub_${randomUUID()}`,createdAt=iso(),until=trial?new Date(Math.floor((now()+BUILDING_TRIAL.days*DAY)/1000)*1000).toISOString():null;
      db.prepare(`INSERT INTO lot_orders(reference,name,email,whatsapp,lot_code,business_name,segment,amount_cents,affiliate_id,status,plan_code,billing_type,trial_version,trial_until,subscription_status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,'pending',?,'recurring',?,?,'creating',?,?)`).run(reference,name,normalizedEmail,whatsapp,lotCode,businessName,segment,1000,affiliateId,planCode,trial?BUILDING_TRIAL.version:'',until,createdAt,createdAt);
      if(trial)db.prepare('INSERT INTO building_trial_claims(email,order_reference,created_at) VALUES(?,?,?)').run(normalizedEmail,reference,createdAt);
      return {order:get(reference),replayed:false};
    })();
    let order=reserved.order;
    if(reserved.replayed){
      if(!order.mp_subscription_id)throw error('Sua solicitação anterior está em verificação. Aguarde antes de tentar novamente.',409,'creation_pending');
      order=await reconcile(order.reference);
      if(order.status!=='pending'||order.subscription_status!=='pending')throw error('Esta solicitação não está mais disponível para conclusão.',409);
      return {order,replayed:true};
    }
    onReserved(order);
    let remote;
    try{
      remote=await request('/preapproval',{method:'POST',idempotencyKey:order.reference,body:{reason:`Prédio Essencial Mensal${trial?' — 30 dias grátis':''} — ${businessName}`,external_reference:order.reference,payer_email:normalizedEmail,
        back_url:`${siteUrl}/pagamento.html?resultado=pendente&ref=${encodeURIComponent(order.reference)}`,
        auto_recurring:{frequency:1,frequency_type:'months',transaction_amount:10,currency_id:'BRL',...(trial?{start_date:order.trial_until}:{})},status:'pending'}});
    }catch(e){
      const rejected=Number(e.providerStatus)>=400&&Number(e.providerStatus)<500;
      db.prepare('UPDATE lot_orders SET status=?,subscription_status=?,subscription_error=?,updated_at=? WHERE reference=?').run(rejected?'failed':'pending',rejected?'failed':'creation_uncertain',rejected?'provider_rejected':'creation_uncertain',iso(),order.reference);
      if(rejected&&trial)db.prepare('DELETE FROM building_trial_claims WHERE order_reference=? AND consumed_at IS NULL').run(order.reference);
      throw error(rejected?'Não foi possível iniciar a assinatura. Confira seus dados.':'O serviço de assinatura está verificando sua solicitação. Sua reserva foi preservada; não é necessário enviar novamente.',502,rejected?'provider_rejected':'creation_uncertain');
    }
    if(!remote?.id){db.prepare("UPDATE lot_orders SET subscription_status='creation_uncertain',subscription_error='missing_provider_id' WHERE reference=?").run(order.reference);throw error('A assinatura está em verificação.',502,'creation_uncertain');}
    db.prepare("UPDATE lot_orders SET mp_subscription_id=?,subscription_status='verification_pending',updated_at=? WHERE reference=?").run(String(remote.id),iso(),order.reference);
    order=get(order.reference);
    let verified;
    try{verified=await request(`/preapproval/${encodeURIComponent(remote.id)}`);}catch{throw error('A assinatura está em verificação. A cobrança gratuita ainda não foi confirmada.',502,'verification_pending');}
    let validUrl=false;try{const url=new URL(verified.init_point||remote.init_point);validUrl=url.protocol==='https:'&&/(^|\.)mercadopago\.com(?:\.br)?$/.test(url.hostname);}catch{}
    if(!providerValid(verified,order)||!validUrl||verified.status!=='pending'){
      await stopProvider(order,'provider_mismatch');throw error('O período de cobrança não foi confirmado. Esta solicitação foi cancelada.',502,'provider_mismatch');
    }
    db.prepare("UPDATE lot_orders SET mp_checkout_url=?,subscription_status='pending',trial_until=CASE WHEN trial_version<>'' THEN ? ELSE trial_until END,updated_at=? WHERE reference=?").run(verified.init_point||remote.init_point,verified.auto_recurring.start_date||null,iso(),order.reference);
    return {order:get(order.reference),replayed:false};
  }
  function recordPayment(payment){
    const reference=String(payment.external_reference||''),order=get(reference);if(!order||order.billing_type!=='recurring')return null;
    if(!payment.id||payment.currency_id!=='BRL'||Math.round(Number(payment.transaction_amount)*100)!==order.amount_cents)throw error('Pagamento divergente.',400,'payment_mismatch');
    const result=db.transaction(()=>{
      const previous=db.prepare('SELECT * FROM building_subscription_receipts WHERE payment_id=?').get(String(payment.id));
      if(previous&&previous.order_reference!==reference)throw error('Pagamento divergente.',400);
      const status=String(payment.status||'pending'),firstApproval=status==='approved'&&previous?.status!=='approved',changed=previous?.status!==status;
      const approvedAt=status==='approved'?(Number.isFinite(stamp(payment.date_approved))?new Date(stamp(payment.date_approved)).toISOString():iso()):null;
      db.prepare(`INSERT INTO building_subscription_receipts(payment_id,order_reference,status,amount_cents,created_at,updated_at,approved_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(payment_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,approved_at=COALESCE(building_subscription_receipts.approved_at,excluded.approved_at)`).run(String(payment.id),reference,status,order.amount_cents,iso(),iso(),approvedAt);
      const total=db.prepare("SELECT COALESCE(SUM(amount_cents),0) total FROM building_subscription_receipts WHERE order_reference=? AND status='approved'").get(reference).total;
      db.prepare('UPDATE lot_orders SET subscription_paid_cents=?,mp_payment_id=?,updated_at=? WHERE reference=?').run(total,String(payment.id),iso(),reference);
      return {firstApproval,changed,order:get(reference),status};
    })();
    if(result.changed)onPayment(result.order,payment);return result;
  }
  async function reconcileInvoice(invoiceId){
    const invoice=await request(`/authorized_payments/${encodeURIComponent(invoiceId)}`);
    const order=db.prepare("SELECT * FROM lot_orders WHERE mp_subscription_id=? AND billing_type='recurring'").get(String(invoice.preapproval_id||''));
    if(!order)return null;
    if(String(invoice.external_reference||'')!==order.reference||invoice.currency_id!=='BRL'||Math.round(Number(invoice.transaction_amount)*100)!==order.amount_cents)throw error('Fatura divergente.',400,'invoice_mismatch');
    if(invoice.payment?.id){
      const payment=await request(`/v1/payments/${encodeURIComponent(invoice.payment.id)}`);
      if(String(payment.id)!==String(invoice.payment.id)||(payment.external_reference&&String(payment.external_reference)!==order.reference))throw error('Pagamento da fatura divergente.',400,'invoice_mismatch');
      recordPayment({...payment,external_reference:order.reference});
    }
    return reconcile(order.reference);
  }
  async function cancel(reference){const order=get(reference);if(!order?.mp_subscription_id)throw error('Este pedido não possui assinatura recorrente.',409);return stopProvider(order);}
  let busy=false;
  async function sweep(){
    if(busy)return;busy=true;
    try{for(const order of db.prepare("SELECT * FROM lot_orders WHERE billing_type='recurring' AND subscription_status<>'' AND subscription_status NOT IN ('cancelled','failed') ORDER BY updated_at LIMIT 30").all()){
      try{
        if(!order.mp_subscription_id&&['creating','creation_uncertain'].includes(order.subscription_status)&&now()-stamp(order.created_at)>60000){
          const found=await request(`/preapproval/search?external_reference=${encodeURIComponent(order.reference)}`);
          const matches=(found.results||[]).filter(item=>String(item.external_reference||'')===order.reference);
          if(matches.length===1){db.prepare("UPDATE lot_orders SET mp_subscription_id=?,subscription_status='verification_pending',updated_at=? WHERE reference=?").run(String(matches[0].id),iso(),order.reference);}
        }
        const latest=get(order.reference);if(latest.mp_subscription_id)await reconcile(order.reference);
      }catch{/* Keep uncertainty reserved and try reconciliation next interval. */}
    }}finally{busy=false;}
  }
  const timer=schedule?setInterval(()=>{sweep().catch(()=>{});},5*60000):null;timer?.unref?.();
  return {config,details,occupation,create,reconcile,reconcileInvoice,recordPayment,cancel,get,sweep,close:()=>clearInterval(timer)};
}
