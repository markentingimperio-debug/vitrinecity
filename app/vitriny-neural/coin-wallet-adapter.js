import {atomsFromMicroBRL,coinAtoms,VITRINE_COINS_POLICY} from '../public/vitrine-coins-contract.js';

const fail=(code,status=403)=>{throw Object.assign(Error(code),{code,status});};
const micro=atoms=>Number(coinAtoms(atoms)/96n); // display/affordability floor only; ledger stays exact
const money=value=>{if(!Number.isSafeInteger(value)||value<0)fail('ai_wallet_input_invalid',400);return atomsFromMicroBRL(String(value));};

/** Server-only adapter, not another balance. Store links never authorize a
 * personal wallet. Both admin and personal chat resolve to the same users.id.
 * Every mutation and dispatch rechecks the owner, including suspended accounts.
 */
export function createCoinAiWalletAdapter({db,coinWallet,now=Date.now,adminEmails=[]}={}){
  if(!db?.transaction||!coinWallet?.status)throw TypeError('Canonical wallet required');
  const admins=new Set(adminEmails.map(x=>String(x).trim().toLowerCase()));
  function owner(scope,{settlement=false}={}){
    const match=/^(admin|user):([1-9]\d{0,14})$/.exec(String(scope));
    if(!match||!Number.isSafeInteger(Number(match[2])))fail('ai_wallet_scope_denied');
    const user=db.prepare('SELECT * FROM users WHERE id=?').get(Number(match[2]));
    if(!user||!settlement&&user.account_status!==undefined&&user.account_status!=='active')fail('ai_wallet_scope_denied');
    if(!settlement&&match[1]==='admin'&&user.is_admin!==1&&!admins.has(String(user.email||'').toLowerCase()))fail('ai_wallet_scope_denied');
    return Number(match[2]);
  }
  const translate=fn=>{try{return fn();}catch(e){const map={coin_insufficient:'ai_wallet_insufficient',coin_wallet_insufficient:'ai_wallet_insufficient',coin_frozen:'ai_wallet_frozen',coin_wallet_frozen:'ai_wallet_frozen',coin_conflict:'ai_wallet_conflict',coin_disabled:'ai_wallet_disabled',coin_wallet_disabled:'ai_wallet_disabled'};if(map[e?.code])throw Object.assign(Error(map[e.code]),{code:map[e.code],status:e.status});throw e;}};
  const reservation=r=>({...r,maximumMicroBrl:micro(r.maximumAtoms),chargedMicroBrl:r.chargedAtoms==null?null:micro(r.chargedAtoms)});
  const status=(scope,options)=>{const s=coinWallet.status(owner(scope,options));return {enabled:s.enabled,currency:'BRL',unit:'microBRL',availableMicroBrl:micro(s.availableAtoms),reservedMicroBrl:micro(s.reservedAtoms),chargedMicroBrl:micro(s.chargedAtoms),expiredMicroBrl:micro(s.expiredAtoms),frozen:s.frozen,frozenMicroBrl:micro(s.frozenAtoms||'0')};};
  db.exec(`CREATE TABLE IF NOT EXISTS neural_coin_grants(payment_reference TEXT PRIMARY KEY,user_id INTEGER NOT NULL,amount_micro INTEGER NOT NULL,terms_version TEXT NOT NULL,created_ms INTEGER NOT NULL);`);
  const grantTx=db.transaction((scope,input)=>{
    const userId=owner(scope,{settlement:true}),amountAtoms=money(input.amountMicroBrl);
    if(input.termsVersion!==VITRINE_COINS_POLICY.version)fail('ai_wallet_legacy_review_required',409);
    if(typeof input.paymentReference!=='string'||!/^mercadopago:[1-9]\d{0,29}$/.test(input.paymentReference))fail('ai_wallet_input_invalid',400);
    const prior=db.prepare('SELECT * FROM neural_coin_grants WHERE payment_reference=?').get(input.paymentReference);
    if(prior&&(prior.user_id!==userId||prior.amount_micro!==input.amountMicroBrl||prior.terms_version!==input.termsVersion))fail('ai_wallet_conflict',409);
    const time=prior?.created_ms??now();
    if(!prior)db.prepare('INSERT INTO neural_coin_grants VALUES(?,?,?,?,?)').run(input.paymentReference,userId,input.amountMicroBrl,input.termsVersion,time);
    return coinWallet.grant(userId,{sourceId:input.paymentReference,paymentReference:input.paymentReference,amountAtoms,origin:'purchase',createdAt:time,expiresAt:time+60*86400000,termsVersion:input.termsVersion});
  });
  return {
    enabled:coinWallet.enabled===true,unified:true,
    allowsScope:scope=>{try{owner(scope);return true;}catch{return false;}},
    coinStatus:scope=>coinWallet.status(owner(scope)),
    authorizeReservation(scope,{requestId,requestHash,maximumMicroBrl,quoteId}){
      const userId=owner(scope),row=db.prepare('SELECT * FROM vitrine_coin_requests WHERE request_id=? AND user_id=?').get(requestId,userId);
      return !!row&&row.mode==='api'&&row.service==='ai'&&row.state==='reserved'&&row.request_hash===requestHash&&row.quote_id===quoteId&&String(row.maximum_atoms)===money(maximumMicroBrl)&&!coinWallet.status(userId).frozen;
    },
    status:scope=>status(scope),
    settlementStatus:scope=>status(scope,{settlement:true}),
    grant:(scope,input)=>translate(()=>grantTx.immediate(scope,input)),
    reserve:(scope,input)=>translate(()=>reservation(coinWallet.reserve(owner(scope),{requestId:input.requestId,maximumAtoms:money(input.maximumMicroBrl),quoteId:input.quoteId,requestHash:input.requestHash,service:'ai'}))),
    settle:(scope,id,input)=>translate(()=>reservation(coinWallet.settle(owner(scope,{settlement:true}),id,{actualAtoms:input.actualMicroBrl==null?null:money(input.actualMicroBrl),receiptId:input.receiptId}))),
    release:(scope,id,input)=>translate(()=>reservation(coinWallet.release(owner(scope,{settlement:true}),id,input))),
    freeze:(scope,input)=>translate(()=>coinWallet.freeze(owner(scope,{settlement:true}),input)),
    history:scope=>coinWallet.history(owner(scope))
  };
}
