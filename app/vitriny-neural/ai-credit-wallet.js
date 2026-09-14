import {createHash,randomUUID} from 'node:crypto';

const DAY=86400000, MAX_GRANT=100_000_000_000, MAX_TOTAL=1_000_000_000_000;
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
function scopeOf(value){if(typeof value!=='string'||! /^(?:store|admin|user):[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))fail('ai_wallet_scope_denied',403);return value;}
function number(value,min=0,max=MAX_GRANT){if(!Number.isSafeInteger(value)||value<min||value>max)fail('ai_wallet_input_invalid');return value;}
function identifier(value){if(typeof value!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,159}$/.test(value))fail('ai_wallet_input_invalid');return value;}
function object(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail('ai_wallet_input_invalid');return value;}
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Internal, opt-in monetary ledger, NOT a payment endpoint or a deployed offer.
 * Amounts use integer microBRL, independent of the existing AI plans, Ads and coins.
 * The caller must derive the owner from authentication, verify payment/usage receipts,
 * and enforce approved quotes/paid-use consent BEFORE invoking these methods.
 * Payment/refund integrations and public terms are intentionally not implemented here.
 * No new expiration is imposed on any existing wallet or historical purchase.
 */
export function createAiCreditWallet({db,enabled=false,now=Date.now}={}){
  if(!db?.transaction)throw new TypeError('AI wallet requires SQLite');
  const active=enabled===true;
  const clock=()=>number(now(),0,8_640_000_000_000_000-60*DAY);
  const requireEnabled=()=>{if(!active)fail('ai_wallet_disabled',503);};
  const atomic=fn=>{const tx=db.transaction(fn);return (...args)=>tx.immediate(...args);};
  db.exec(`
    CREATE TABLE IF NOT EXISTS neural_ai_credit_lots(
      id TEXT PRIMARY KEY,scope TEXT NOT NULL,payment_reference TEXT NOT NULL UNIQUE,
      amount_micro INTEGER NOT NULL CHECK(amount_micro>0),charged_micro INTEGER NOT NULL DEFAULT 0 CHECK(charged_micro>=0),
      reserved_micro INTEGER NOT NULL DEFAULT 0 CHECK(reserved_micro>=0),terms_version TEXT NOT NULL,
      request_hash TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,
      CHECK(charged_micro+reserved_micro<=amount_micro));
    CREATE INDEX IF NOT EXISTS idx_neural_ai_lots_scope ON neural_ai_credit_lots(scope,expires_at);
    CREATE TABLE IF NOT EXISTS neural_ai_credit_reservations(
      scope TEXT NOT NULL,request_id TEXT NOT NULL,maximum_micro INTEGER NOT NULL CHECK(maximum_micro>0),
      quote_id TEXT NOT NULL,request_hash TEXT NOT NULL,identity_hash TEXT NOT NULL,
      state TEXT NOT NULL,charged_micro INTEGER NOT NULL DEFAULT 0 CHECK(charged_micro>=0),receipt_id TEXT UNIQUE,
      settlement_hash TEXT,release_hash TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
      PRIMARY KEY(scope,request_id),CHECK(charged_micro<=maximum_micro));
    CREATE TABLE IF NOT EXISTS neural_ai_credit_allocations(
      scope TEXT NOT NULL,request_id TEXT NOT NULL,lot_id TEXT NOT NULL,amount_micro INTEGER NOT NULL CHECK(amount_micro>0),
      PRIMARY KEY(scope,request_id,lot_id));
    CREATE TABLE IF NOT EXISTS neural_ai_credit_events(
      id TEXT PRIMARY KEY,scope TEXT NOT NULL,request_id TEXT,type TEXT NOT NULL,amount_micro INTEGER NOT NULL,
      created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_neural_ai_events_scope ON neural_ai_credit_events(scope,created_at);
    CREATE TABLE IF NOT EXISTS neural_ai_credit_receipt_evidence(
      scope TEXT NOT NULL,request_id TEXT NOT NULL,receipt_id TEXT NOT NULL UNIQUE,
      observed_micro INTEGER CHECK(observed_micro>=0),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
      PRIMARY KEY(scope,request_id));
    CREATE TABLE IF NOT EXISTS neural_ai_credit_scope_holds(
      scope TEXT NOT NULL,payment_reference TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL,
      PRIMARY KEY(scope,payment_reference));
  `);
  function event(scope,requestId,type,amount){db.prepare('INSERT INTO neural_ai_credit_events VALUES(?,?,?,?,?,?)').run(randomUUID(),scope,requestId,type,amount,clock());}
  function view(row){return {requestId:row.request_id,state:row.state,maximumMicroBrl:row.maximum_micro,chargedMicroBrl:row.charged_micro,quoteId:row.quote_id,createdAt:row.created_at,updatedAt:row.updated_at};}
  function row(scope,requestId){
    scopeOf(scope);identifier(requestId);
    const value=db.prepare('SELECT * FROM neural_ai_credit_reservations WHERE scope=? AND request_id=?').get(scope,requestId);
    if(!value)fail('ai_wallet_not_found',404);return value;
  }
  function status(scope){
    scopeOf(scope);const time=clock();
    const lots=db.prepare('SELECT amount_micro,charged_micro,reserved_micro,expires_at FROM neural_ai_credit_lots WHERE scope=?').all(scope);
    let available=0,expired=0,reserved=0,charged=0;
    for(const lot of lots){const unused=lot.amount_micro-lot.charged_micro-lot.reserved_micro; if(lot.expires_at>time)available+=unused;else expired+=unused;reserved+=lot.reserved_micro;charged+=lot.charged_micro;}
    const frozen=!!db.prepare('SELECT 1 FROM neural_ai_credit_scope_holds WHERE scope=? LIMIT 1').get(scope);
    return {enabled:active,currency:'BRL',unit:'microBRL',availableMicroBrl:frozen?0:available,reservedMicroBrl:reserved,chargedMicroBrl:charged,expiredMicroBrl:expired,frozen,frozenMicroBrl:frozen?available:0};
  }
  // A dispute/reversal blocks NEW expenditure without erasing balances, provider
  // receipts or in-flight reservations. Release requires separately audited review.
  const freeze=atomic((scope,input)=>{
    requireEnabled();scopeOf(scope);object(input,['paymentReference','reason']);
    const reference=identifier(input.paymentReference);
    if(!['refunded','charged_back','in_mediation','partial_refund','duplicate_payment','payment_review'].includes(input.reason))fail('ai_wallet_input_invalid');
    const prior=db.prepare('SELECT reason FROM neural_ai_credit_scope_holds WHERE scope=? AND payment_reference=?').get(scope,reference);
    if(prior)return {frozen:true,duplicate:true};
    db.prepare('INSERT INTO neural_ai_credit_scope_holds VALUES(?,?,?,?)').run(scope,reference,input.reason,clock());
    event(scope,null,'frozen',0);return {frozen:true,duplicate:false};
  });
  const grant=atomic((scope,input)=>{
    requireEnabled();scopeOf(scope);object(input,['paymentReference','amountMicroBrl','termsVersion']);
    const payment=identifier(input.paymentReference),amount=number(input.amountMicroBrl,1),terms=identifier(input.termsVersion);
    const fingerprint=hash({scope,payment,amount,terms}),prior=db.prepare('SELECT * FROM neural_ai_credit_lots WHERE payment_reference=?').get(payment);
    const lotView=lot=>({id:lot.id,amountMicroBrl:lot.amount_micro,expiresAt:lot.expires_at,termsVersion:lot.terms_version});
    if(prior){if(prior.request_hash!==fingerprint)fail('ai_wallet_conflict',409);return {...lotView(prior),duplicate:true};}
    // Explicit lifetime cap keeps every SQLite/JS sum in a proven exact range.
    const total=db.prepare('SELECT COALESCE(SUM(amount_micro),0) n FROM neural_ai_credit_lots WHERE scope=?').get(scope).n;
    if(total+amount>MAX_TOTAL)fail('ai_wallet_capacity',409);
    const id=randomUUID(),time=clock();
    db.prepare('INSERT INTO neural_ai_credit_lots(id,scope,payment_reference,amount_micro,terms_version,request_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id,scope,payment,amount,terms,fingerprint,time,time+60*DAY);
    event(scope,null,'granted',amount);
    return lotView(db.prepare('SELECT * FROM neural_ai_credit_lots WHERE id=?').get(id));
  });
  const reserve=atomic((scope,input)=>{
    requireEnabled();scopeOf(scope);object(input,['requestId','maximumMicroBrl','quoteId','requestHash']);
    if(db.prepare('SELECT 1 FROM neural_ai_credit_scope_holds WHERE scope=? LIMIT 1').get(scope))fail('ai_wallet_frozen',423);
    const requestId=identifier(input.requestId),maximum=number(input.maximumMicroBrl,1),quote=identifier(input.quoteId);
    if(typeof input.requestHash!=='string'||! /^[a-f0-9]{64}$/.test(input.requestHash))fail('ai_wallet_input_invalid');
    const fingerprint=hash({requestId,maximum,quote,requestHash:input.requestHash});
    const prior=db.prepare('SELECT * FROM neural_ai_credit_reservations WHERE scope=? AND request_id=?').get(scope,requestId);
    if(prior){if(prior.identity_hash!==fingerprint)fail('ai_wallet_conflict',409);return {...view(prior),duplicate:true};}
    const time=clock(),lots=db.prepare('SELECT * FROM neural_ai_credit_lots WHERE scope=? AND expires_at>? AND charged_micro+reserved_micro<amount_micro ORDER BY expires_at,created_at,id').all(scope,time);
    if(lots.reduce((sum,lot)=>sum+lot.amount_micro-lot.charged_micro-lot.reserved_micro,0)<maximum)fail('ai_wallet_insufficient',402);
    db.prepare("INSERT INTO neural_ai_credit_reservations(scope,request_id,maximum_micro,quote_id,request_hash,identity_hash,state,created_at,updated_at) VALUES(?,?,?,?,?,?,'reserved',?,?)")
      .run(scope,requestId,maximum,quote,input.requestHash,fingerprint,time,time);
    let left=maximum;
    for(const lot of lots){
      if(!left)break;
      const amount=Math.min(left,lot.amount_micro-lot.charged_micro-lot.reserved_micro);
      db.prepare('UPDATE neural_ai_credit_lots SET reserved_micro=reserved_micro+? WHERE id=? AND scope=?').run(amount,lot.id,scope);
      db.prepare('INSERT INTO neural_ai_credit_allocations VALUES(?,?,?,?)').run(scope,requestId,lot.id,amount);left-=amount;
    }
    event(scope,requestId,'reserved',maximum);return view(row(scope,requestId));
  });
  function applySettlement(scope,requestId,cost){
    let left=cost;
    const allocations=db.prepare('SELECT a.lot_id,a.amount_micro FROM neural_ai_credit_allocations a JOIN neural_ai_credit_lots l ON l.id=a.lot_id AND l.scope=a.scope WHERE a.scope=? AND a.request_id=? ORDER BY l.expires_at,l.created_at,l.id').all(scope,requestId);
    for(const allocation of allocations){
      const charged=Math.min(left,allocation.amount_micro);left-=charged;
      db.prepare('UPDATE neural_ai_credit_lots SET reserved_micro=reserved_micro-?,charged_micro=charged_micro+? WHERE scope=? AND id=?')
        .run(allocation.amount_micro,charged,scope,allocation.lot_id);
    }
    if(left!==0)fail('ai_wallet_integrity',500);
  }
  const settle=atomic((scope,requestId,input)=>{
    requireEnabled();object(input,['actualMicroBrl','receiptId']);const prior=row(scope,requestId),receipt=identifier(input.receiptId);
    const cost=input.actualMicroBrl==null?null:number(input.actualMicroBrl);
    const fingerprint=hash({cost,receipt});
    if(prior.state==='settled'){if(prior.settlement_hash!==fingerprint)fail('ai_wallet_conflict',409);return {...view(prior),duplicate:true};}
    if(prior.state==='released')fail('ai_wallet_conflict',409);
    // Retain provider evidence even when the quote is exceeded or usage is unknown.
    // Unknown -> known is allowed once, for the same receipt. A known amount must
    // never be silently rewritten; reconciliation requires a separate audited flow.
    const evidence=db.prepare('SELECT * FROM neural_ai_credit_receipt_evidence WHERE scope=? AND request_id=?').get(scope,requestId);
    if(evidence&&(evidence.receipt_id!==receipt||(evidence.observed_micro!==null&&evidence.observed_micro!==cost)))fail('ai_wallet_conflict',409);
    const claimed=db.prepare('SELECT scope,request_id FROM neural_ai_credit_reservations WHERE receipt_id=?').get(receipt);
    const observed=db.prepare('SELECT scope,request_id FROM neural_ai_credit_receipt_evidence WHERE receipt_id=?').get(receipt);
    if([claimed,observed].some(value=>value&&(value.scope!==scope||value.request_id!==requestId)))fail('ai_wallet_conflict',409);
    if(!evidence){
      db.prepare('INSERT INTO neural_ai_credit_receipt_evidence VALUES(?,?,?,?,?,?)').run(scope,requestId,receipt,cost,clock(),clock());
      event(scope,requestId,cost===null?'receipt_unknown':'receipt_observed',cost??0);
    }else if(evidence.observed_micro===null&&cost!==null){
      db.prepare('UPDATE neural_ai_credit_receipt_evidence SET observed_micro=?,updated_at=? WHERE scope=? AND request_id=?').run(cost,clock(),scope,requestId);
      event(scope,requestId,'receipt_observed',cost);
    }
    db.prepare('UPDATE neural_ai_credit_reservations SET receipt_id=? WHERE scope=? AND request_id=?').run(receipt,scope,requestId);
    if(cost===null||cost>prior.maximum_micro){
      if(prior.state!=='review_required'){
        db.prepare("UPDATE neural_ai_credit_reservations SET state='review_required',updated_at=? WHERE scope=? AND request_id=?").run(clock(),scope,requestId);
        event(scope,requestId,'review_required',0);
      }
      return view(row(scope,requestId));
    }
    applySettlement(scope,requestId,cost);
    db.prepare("UPDATE neural_ai_credit_reservations SET state='settled',charged_micro=?,receipt_id=?,settlement_hash=?,updated_at=? WHERE scope=? AND request_id=?")
      .run(cost,receipt,fingerprint,clock(),scope,requestId);
    event(scope,requestId,'settled',cost);return view(row(scope,requestId));
  });
  const release=atomic((scope,requestId,input)=>{
    requireEnabled();object(input,['reason','noConsumptionConfirmed']);
    if(input.noConsumptionConfirmed!==true||typeof input.reason!=='string'||input.reason.trim().length<3||input.reason.length>200||/[\u0000-\u001f\u007f]/.test(input.reason))fail('ai_wallet_input_invalid');
    const prior=row(scope,requestId),fingerprint=hash({reason:input.reason,noConsumptionConfirmed:true});
    if(prior.state==='released'){if(prior.release_hash!==fingerprint)fail('ai_wallet_conflict',409);return {...view(prior),duplicate:true};}
    if(prior.state==='settled')fail('ai_wallet_conflict',409);
    const evidence=db.prepare('SELECT observed_micro FROM neural_ai_credit_receipt_evidence WHERE scope=? AND request_id=?').get(scope,requestId);
    if(evidence?.observed_micro>0)fail('ai_wallet_conflict',409);
    applySettlement(scope,requestId,0);
    db.prepare("UPDATE neural_ai_credit_reservations SET state='released',release_hash=?,updated_at=? WHERE scope=? AND request_id=?").run(fingerprint,clock(),scope,requestId);
    event(scope,requestId,'released',prior.maximum_micro);return view(row(scope,requestId));
  });
  const history=scope=>{scopeOf(scope);return db.prepare('SELECT request_id requestId,type,amount_micro amountMicroBrl,created_at createdAt FROM neural_ai_credit_events WHERE scope=? ORDER BY created_at DESC,rowid DESC LIMIT 100').all(scope);};
  return {enabled:active,status,grant,reserve,settle,release,history,freeze};
}
