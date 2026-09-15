import {createHash,randomUUID} from 'node:crypto';
import {assertAiPurchaseStatus,assertAiPurchaseOrder} from '../public/neural-chat-contract.js';
import {VITRINE_COINS_POLICY,quoteCoinTopup} from '../public/vitrine-coins-contract.js';
export {assertAiPurchaseStatus,assertAiPurchaseOrder} from '../public/neural-chat-contract.js';

const DAY=86400000;
export const AI_PURCHASE_TERMS=Object.freeze({
  version:'2026-09-14-ai-prepaid-15-v1',validityDays:60,
  summary:'Saldo pré-pago exclusivo para serviços de IA na VitrineCity, expira 60 dias após a confirmação. Cada uso custa o valor da API convertido para reais mais 15%, informado antes de executar. A recarga não desconta outra taxa de 15%.',
  refunds:'Sem saque ou transferência para fora da plataforma. Direitos legais de arrependimento, cancelamento e restituição são preservados; solicitações pelo atendimento.'
});
export const AI_PURCHASE_PRESETS_CENTS=Object.freeze([1000,2500,5000,10000]);
export const COIN_PURCHASE_TERMS=Object.freeze({
  version:VITRINE_COINS_POLICY.version,validityDays:60,feeStage:'topup',topupFeeBps:1500,usageMarkupBps:0,coinsPerBRL:'9.6',
  summary:'Vitrine Coins são saldo interno único para os serviços habilitados da plataforma. Na recarga, 15% do valor pago é a taxa e 85% vira saldo: R$ 10 pagos resultam em 81,6 Coins, equivalentes a R$ 8,50. 9,6 Coins equivalem a R$ 1 de saldo. API cobrada pelo custo confirmado convertido para reais, sem nova taxa de uso. O saldo desta compra vale por 60 dias. Cursos: desconto de até 30%, conforme elegibilidade.',
  refunds:AI_PURCHASE_TERMS.refunds
});
const STATUSES=new Set(['pending','authorized','in_process','in_mediation','approved','rejected','cancelled','refunded','charged_back']);
const TERMINAL=new Set(['refunded','charged_back']);
const HOLD=new Set(['refunded','charged_back','in_mediation']);
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
const scopeOf=value=>{if(typeof value!=='string'||!/^(?:admin|store|user):[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))fail('ai_purchase_scope_denied',403);return value;};
const referenceOf=value=>typeof value==='string'&&/^ai_[0-9a-f-]{36}$/.test(value)?value:'';
const numericId=value=>(typeof value==='string'||Number.isSafeInteger(value))&&/^\d{1,30}$/.test(String(value))?String(value):'';
const stamp=value=>typeof value==='string'&&Number.isSafeInteger(Date.parse(value))?Date.parse(value):null;
function cents(value){
  if(!['number','string'].includes(typeof value)||!/^\d+(?:\.\d{1,2})?$/.test(String(value)))return null;
  const result=Number(value)*100;return Number.isSafeInteger(Math.round(result))&&Math.abs(result-Math.round(result))<0.000001?Math.round(result):null;
}
function body(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key)))fail('ai_purchase_input_invalid');return value;}
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function checkoutLink(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&/^(?:[a-z0-9-]+\.)*mercadopago\.com(?:\.br)?$/.test(u.hostname)?u.href:null;}catch{return null;}}
const view=row=>assertAiPurchaseOrder({reference:row.reference,status:row.status,amountCents:row.amount_cents,checkoutUrl:row.status==='pending'?row.checkout_url:null,createdAt:row.created_ms,expiresAt:row.expires_ms,...(row.terms_version===VITRINE_COINS_POLICY.version?quoteCoinTopup(row.amount_cents):{})});

/** Only this isolated ledger handles new AI-money purchases. All network methods
 * are injected. Reconciliation accepts only authenticated provider GET results;
 * never call it with webhook bodies or browser return parameters. No refund,
 * automatic renewal, migration or paid AI call is implemented here. */
export function createAiCreditPurchases({db,wallet,enabled=false,expectedCollectorId,createPreference,fetchPayment,searchPayments,paymentReady=()=>false,now=Date.now}={}){
  if(!db?.transaction||!wallet?.grant||!wallet?.freeze)throw TypeError('AI purchases require the dedicated wallet');
  const active=enabled===true;
  const terms=wallet.unified===true?COIN_PURCHASE_TERMS:AI_PURCHASE_TERMS;
  const authorize=scope=>{scopeOf(scope);if(wallet.unified?wallet.allowsScope?.(scope)!==true:scope.startsWith('user:'))fail('ai_purchase_scope_denied',403);};
  const account=()=>numericId(typeof expectedCollectorId==='function'?expectedCollectorId():expectedCollectorId);
  const ready=()=>active&&wallet.enabled===true&&Boolean(account())&&paymentReady()===true&&typeof createPreference==='function';
  const atomic=fn=>{const tx=db.transaction(fn);return (...args)=>tx.immediate(...args);};
  db.exec(`CREATE TABLE IF NOT EXISTS neural_ai_purchase_orders(
    reference TEXT PRIMARY KEY,scope TEXT NOT NULL,idempotency_key TEXT NOT NULL,request_hash TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK(amount_cents IN(1000,2500,5000,10000)),collector_id TEXT NOT NULL,
    terms_version TEXT NOT NULL,terms_accepted_ms INTEGER NOT NULL,status TEXT NOT NULL,
    preference_id TEXT,checkout_url TEXT,payment_id TEXT,credited_payment_id TEXT,
    created_ms INTEGER NOT NULL,expires_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL,
    UNIQUE(scope,idempotency_key));
    CREATE INDEX IF NOT EXISTS idx_neural_ai_purchase_scope ON neural_ai_purchase_orders(scope,created_ms);
    CREATE TABLE IF NOT EXISTS neural_ai_purchase_receipts(
      payment_id TEXT PRIMARY KEY,order_reference TEXT NOT NULL,collector_id TEXT NOT NULL,amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL,provider_updated_ms INTEGER NOT NULL,refunded_cents INTEGER NOT NULL,
      created_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS neural_ai_purchase_refresh(
      reference TEXT PRIMARY KEY,next_ms INTEGER NOT NULL,lease_until_ms INTEGER NOT NULL DEFAULT 0,lease_token TEXT NOT NULL DEFAULT '');`);
  function lookup(scope,reference){
    authorize(scope);if(!referenceOf(reference))fail('ai_purchase_not_found',404);
    const row=db.prepare('SELECT * FROM neural_ai_purchase_orders WHERE scope=? AND reference=?').get(scope,reference);
    if(!row)fail('ai_purchase_not_found',404);return row;
  }
  function status(scope){
    authorize(scope);const s=wallet.status(scope);
    return assertAiPurchaseStatus({currency:'BRL',availableMicro:s.availableMicroBrl,reservedMicro:s.reservedMicroBrl,chargedMicro:s.chargedMicroBrl,
      expiredMicro:s.expiredMicroBrl,frozenMicro:s.frozenMicroBrl||0,frozen:s.frozen===true,canPurchase:ready()&&s.frozen!==true,
      presetsCents:[...AI_PURCHASE_PRESETS_CENTS],terms,...(wallet.unified?{coinWallet:wallet.coinStatus(scope)}:{}),
      orders:db.prepare('SELECT * FROM neural_ai_purchase_orders WHERE scope=? ORDER BY created_ms DESC,reference LIMIT 30').all(scope).map(view)});
  }
  const prepare=atomic((scope,input)=>{
    authorize(scope);body(input,['amountCents','key','termsAccepted','termsVersion']);
    if(!AI_PURCHASE_PRESETS_CENTS.includes(input.amountCents)||typeof input.key!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/.test(input.key))fail('ai_purchase_input_invalid');
    if(input.termsAccepted!==true||input.termsVersion!==terms.version)fail('ai_purchase_terms_required',409);
    const hash=fingerprint({amountCents:input.amountCents,terms:input.termsVersion});
    const prior=db.prepare('SELECT * FROM neural_ai_purchase_orders WHERE scope=? AND idempotency_key=?').get(scope,input.key);
    if(prior){if(prior.request_hash!==hash)fail('ai_purchase_conflict',409);return {row:prior,duplicate:true};}
    if(!ready())fail('ai_purchase_unavailable',503);
    if(wallet.status(scope).frozen)fail('ai_purchase_frozen',423);
    const time=now();
    if(db.prepare('SELECT COUNT(*) n FROM neural_ai_purchase_orders WHERE scope=? AND created_ms>?').get(scope,time-10*60000).n>=5)fail('ai_purchase_rate_limit',429);
    const reference=`ai_${randomUUID()}`;
    db.prepare(`INSERT INTO neural_ai_purchase_orders(reference,scope,idempotency_key,request_hash,amount_cents,collector_id,terms_version,terms_accepted_ms,status,created_ms,expires_ms,updated_ms)
      VALUES(?,?,?,?,?,?,?,?,'creating',?,?,?)`).run(reference,scope,input.key,hash,input.amountCents,account(),input.termsVersion,time,time,time+DAY,time);
    return {row:lookup(scope,reference),duplicate:false};
  });
  async function checkout(scope,input){
    const prepared=prepare(scope,input);if(prepared.duplicate)return {duplicate:true,order:view(prepared.row)};
    const order=prepared.row;
    try{
      const result=await createPreference({reference:order.reference,amountCents:order.amount_cents,collectorId:order.collector_id,
        title:wallet.unified?'Vitrine Coins — saldo interno':'Saldo pré-pago de IA VitrineCity',expiresAt:order.expires_ms,termsVersion:order.terms_version,
        returnPath:'/neural-workspace.html?'+new URLSearchParams({...scope.startsWith('store:')?{store:scope.slice(6)}:scope.startsWith('user:')?{personal:'1'}:{},purchase:order.reference})});
      const url=checkoutLink(result?.init_point),id=String(result?.id||'');
      if(!url||!id||id.length>160||/[\x00-\x1f]/.test(id))throw Error('Invalid preference');
      if(result.collector_id!==undefined&&numericId(result.collector_id)!==order.collector_id)throw Error('Wrong collector');
      db.prepare("UPDATE neural_ai_purchase_orders SET preference_id=?,checkout_url=?,status=CASE WHEN status='creating' THEN 'pending' ELSE status END,updated_ms=? WHERE reference=?")
        .run(id,url,now(),order.reference);
    }catch{
      // A timed-out POST may have created a payable preference. NEVER repeat it
      // automatically or claim that no charge is possible. Refresh reads only.
      db.prepare("UPDATE neural_ai_purchase_orders SET status='payment_unknown',updated_ms=? WHERE reference=? AND status='creating'").run(now(),order.reference);
    }
    return {duplicate:false,order:view(lookup(scope,order.reference))};
  }
  const reconcileVerifiedPayment=atomic(payment=>{
    if(!active)fail('ai_purchase_unavailable',503);
    const reference=referenceOf(payment?.external_reference),id=numericId(payment?.id),collector=numericId(payment?.collector_id),amount=cents(payment?.transaction_amount),updated=stamp(payment?.date_last_updated),state=payment?.status;
    const order=reference&&db.prepare('SELECT * FROM neural_ai_purchase_orders WHERE reference=?').get(reference);
    if(!order)return {ok:false,reason:'order_not_found'};
    // Receipt processing is not a new purchase. A later account restriction
    // must not discard an already approved payment or refund evidence.
    const receiptView=()=>view(db.prepare('SELECT * FROM neural_ai_purchase_orders WHERE reference=?').get(reference));
    const refunded=payment.transaction_amount_refunded===undefined?0:cents(payment.transaction_amount_refunded);
    if(!id||!collector||collector!==order.collector_id||collector!==account()||payment.currency_id!=='BRL'||payment.live_mode!==true||amount!==order.amount_cents||
      !STATUSES.has(state)||updated===null||updated<order.created_ms-300000||updated>now()+300000||refunded===null||refunded>amount)fail('ai_purchase_payment_mismatch',400);
    const prior=db.prepare('SELECT * FROM neural_ai_purchase_receipts WHERE payment_id=?').get(id);
    if(prior&&(prior.order_reference!==reference||prior.collector_id!==collector||prior.amount_cents!==amount))fail('ai_purchase_payment_mismatch',400);
    if(prior&&(updated<prior.provider_updated_ms||(updated===prior.provider_updated_ms&&(state!==prior.status||refunded!==prior.refunded_cents))))return {ok:true,reason:'older_payment',order:view(order)};
    if(prior&&TERMINAL.has(prior.status)&&!TERMINAL.has(state))return {ok:true,reason:'terminal_payment',order:view(order)};
    if(prior&&['approved','in_mediation'].includes(prior.status)&&['pending','authorized','in_process','rejected','cancelled'].includes(state))return {ok:true,reason:'protected_payment',order:view(order)};
    db.prepare(`INSERT INTO neural_ai_purchase_receipts VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(payment_id) DO UPDATE SET
      status=excluded.status,provider_updated_ms=excluded.provider_updated_ms,refunded_cents=MAX(neural_ai_purchase_receipts.refunded_cents,excluded.refunded_cents),updated_ms=excluded.updated_ms`)
      .run(id,reference,collector,amount,state,updated,refunded,now(),now());
    const paymentReference=`mercadopago:${id}`;
    if(order.credited_payment_id&&order.credited_payment_id!==id){
      if(state==='approved'){
        wallet.freeze(order.scope,{paymentReference,reason:'duplicate_payment'});
        db.prepare("UPDATE neural_ai_purchase_orders SET status='review_required',updated_ms=? WHERE reference=?").run(now(),reference);
      }
      return {ok:true,reason:'other_payment',order:receiptView()};
    }
    const hasRefund=refunded>0||Array.isArray(payment.refunds)&&payment.refunds.length>0;
    if(HOLD.has(state)||hasRefund){
      wallet.freeze(order.scope,{paymentReference,reason:hasRefund?'partial_refund':state});
      db.prepare("UPDATE neural_ai_purchase_orders SET payment_id=?,status='review_required',updated_ms=? WHERE reference=?").run(id,now(),reference);
      return {ok:true,reason:'review_required',order:receiptView()};
    }
    if(state==='approved'){
      // Both receipt insertion and exactly-once grant share the outer immediate
      // transaction. A failure cannot leave the order funded without its lot.
      const netCents=order.terms_version===VITRINE_COINS_POLICY.version?quoteCoinTopup(amount).netCents:amount;
      wallet.grant(order.scope,{paymentReference,amountMicroBrl:netCents*10000,termsVersion:order.terms_version});
      db.prepare("UPDATE neural_ai_purchase_orders SET payment_id=?,credited_payment_id=?,status=?,updated_ms=? WHERE reference=?")
        .run(id,id,(wallet.settlementStatus?wallet.settlementStatus(order.scope):wallet.status(order.scope)).frozen?'review_required':'approved',now(),reference);
    }else if(!order.credited_payment_id){
      db.prepare('UPDATE neural_ai_purchase_orders SET payment_id=?,status=?,updated_ms=? WHERE reference=?').run(id,state,now(),reference);
    }
    return {ok:true,reason:'reconciled',order:receiptView()};
  });
  async function refresh(scope,reference){
    const order=lookup(scope,reference);if(!active||!account()||typeof fetchPayment!=='function'||typeof searchPayments!=='function')fail('ai_purchase_unavailable',503);
    const token=randomUUID(),time=now();
    const claimed=atomic(()=>{
      db.prepare('INSERT OR IGNORE INTO neural_ai_purchase_refresh(reference,next_ms) VALUES(?,0)').run(reference);
      return db.prepare('UPDATE neural_ai_purchase_refresh SET lease_until_ms=?,lease_token=?,next_ms=? WHERE reference=? AND next_ms<=? AND lease_until_ms<=?')
        .run(time+60000,token,time+30000,reference,time,time).changes===1;
    })();
    if(!claimed)return {order:view(order),checking:false};
    const owns=()=>!!db.prepare('SELECT 1 FROM neural_ai_purchase_refresh WHERE reference=? AND lease_token=? AND lease_until_ms>?').get(reference,token,now());
    try{
      let ids=order.payment_id?[order.payment_id]:[];
      if(!order.credited_payment_id){
        const result=await searchPayments({reference});
        if(!Array.isArray(result?.results))throw Error('Invalid payment search');
        ids=[...result.results.filter(p=>p.external_reference===reference&&numericId(p.id)).sort((a,b)=>Number(b.status==='approved')-Number(a.status==='approved')).map(p=>numericId(p.id)),...ids];
      }
      for(const id of [...new Set(ids)].slice(0,5)){
        if(!owns())break;const payment=await fetchPayment(id);if(!owns())break;
        if(numericId(payment?.id)!==id||payment.external_reference!==reference)fail('ai_purchase_payment_mismatch');
        reconcileVerifiedPayment(payment);
      }
    }catch(error){if(error?.code==='ai_purchase_payment_mismatch')throw error;}
    finally{db.prepare("UPDATE neural_ai_purchase_refresh SET lease_until_ms=0,lease_token='' WHERE reference=? AND lease_token=?").run(reference,token);}
    return {order:view(lookup(scope,reference)),checking:false};
  }
  return {enabled:active,status,checkout,order:(scope,reference)=>view(lookup(scope,reference)),refresh,reconcileVerifiedPayment};
}

const MESSAGES={ai_purchase_scope_denied:'Acesso não autorizado.',ai_purchase_not_found:'Compra não encontrada para este acesso.',ai_purchase_input_invalid:'Revise os dados da recarga.',
  ai_purchase_terms_required:'Leia e aceite os termos atualizados antes de continuar.',ai_purchase_conflict:'Esta tentativa já identifica outra compra.',
  ai_purchase_unavailable:'A recarga de IA está temporariamente indisponível.',ai_purchase_frozen:'O saldo de IA está em revisão. Fale com o atendimento.',
  ai_purchase_rate_limit:'Muitas tentativas de recarga. Aguarde alguns minutos.',ai_purchase_payment_mismatch:'O pagamento precisa de conferência pelo atendimento.'};
export function mountAiCreditPurchases({app,purchases,requireAdmin,requireUser,sameOriginOnly,getAuthorizedStore}={}){
  if(!app||!purchases||typeof requireAdmin!=='function'||typeof sameOriginOnly!=='function'||typeof getAuthorizedStore!=='function')throw TypeError('AI purchases require authenticated routes');
  const error=(res,e)=>res.status(Object.hasOwn(MESSAGES,e?.code)?e.status||400:503).json({ok:false,code:Object.hasOwn(MESSAGES,e?.code)?e.code:'ai_purchase_unavailable',error:MESSAGES[e?.code]||MESSAGES.ai_purchase_unavailable});
  const privateHeaders=(_req,res,next)=>{res.set('Cache-Control','no-store');next();};
  const adminScope=(req,res,next)=>{try{res.locals.aiPurchaseScope=scopeOf(`admin:${req.user?.id??''}`);next();}catch(e){error(res,e);}};
  const userScope=(req,res,next)=>{try{const id=String(req.user?.id??'');if(!/^[1-9]\d{0,14}$/.test(id))fail('ai_purchase_scope_denied',403);res.locals.aiPurchaseScope=`user:${id}`;next();}catch(e){error(res,e);}};
  const storeScope=(req,res,next)=>{try{const authorized=getAuthorizedStore(req,res);if(!authorized){if(!res.headersSent)error(res,{code:'ai_purchase_scope_denied',status:403});return;}res.locals.aiPurchaseScope=scopeOf(`store:${authorized.storeReference}`);next();}catch(e){error(res,e);}};
  const mutation=(req,res,next)=>{if(req.get('x-neural-request')!=='1'||!req.is('application/json')||Object.keys(req.query||{}).length)return error(res,{code:'ai_purchase_scope_denied',status:403});return sameOriginOnly(req,res,next);};
  const route=fn=>async(req,res)=>{try{const data=await fn(req,res.locals.aiPurchaseScope);res.json({ok:true,...data});}catch(e){if(!res.headersSent)error(res,e);}};
  const mount=(base,auth)=>{
    const read=[privateHeaders,...auth],write=[...read,mutation];
    app.get(base+'/status',...read,route((_req,scope)=>purchases.status(scope)));
    app.post(base+'/checkout',...write,route((req,scope)=>purchases.checkout(scope,req.body)));
    app.get(base+'/orders/:orderReference',...read,route((req,scope)=>({order:purchases.order(scope,req.params.orderReference)})));
    app.post(base+'/orders/:orderReference/refresh',...write,route((req,scope)=>{body(req.body,[]);return purchases.refresh(scope,req.params.orderReference);}));
  };
  mount('/api/admin/vitriny-neural/chat/credits',[requireAdmin,adminScope]);
  if(typeof requireUser==='function')mount('/api/neural/chat/credits',[requireUser,userScope]);
  mount('/api/store-portal/:reference/neural/chat/credits',[storeScope]);
}
