import {createHash,randomUUID} from 'node:crypto';
import {coinAtoms,coinsFromAtoms,VITRINE_COINS_POLICY} from './public/vitrine-coins-contract.js';

const MAX=9_000_000_000_000_000n;
const LOCAL_SERVICES=new Set(['ads','ads_cpc','ads_impression','course_discount','course','avatar','avatar_premium','social_video_link','social_story_link','web_story','web_story_credit','sponsored_click','whatsapp_message','social_link','story_link','reward_course','reward_avatar']);
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function id(value){if(typeof value!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/.test(value))fail('coin_input_invalid');return value;}
function text(value,max=200){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))fail('coin_input_invalid');return value;}
function object(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))fail('coin_input_invalid');return value;}
function integer(value){if(!Number.isSafeInteger(value)||value<0||value>8_640_000_000_000_000)fail('coin_input_invalid');return value;}
function amount(value,positive=false){if(typeof value!=='string')fail('coin_amount_invalid');let result;try{result=coinAtoms(value);}catch{fail('coin_amount_invalid');}if(positive&&result===0n)fail('coin_amount_invalid');return Number(result);}

/** Additive, exact-atom ledger. Callers authenticate the numeric users.id and
 * verify payment/provider evidence; this internal module never calls an API.
 * No fees are taken here: grants contain the once-netted top-up and settlement
 * contains the independently proved provider cost. Legacy tables are untouched.
 */
export function createCoinWallet({db,enabled=false,now=Date.now}={}){
  if(!db?.transaction)throw new TypeError('Coin wallet requires SQLite');
  const active=enabled===true;
  const clock=()=>integer(now());
  const requireEnabled=()=>{if(!active)fail('coin_wallet_disabled',503);};
  const atomic=fn=>{const tx=db.transaction(fn);return (...args)=>tx.immediate(...args);};
  db.exec(`
    CREATE TABLE IF NOT EXISTS vitrine_coin_lots(
      id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),source_id TEXT NOT NULL UNIQUE,
      payment_reference TEXT UNIQUE,origin TEXT NOT NULL,amount_atoms INTEGER NOT NULL CHECK(amount_atoms>0),
      charged_atoms INTEGER NOT NULL DEFAULT 0 CHECK(charged_atoms>=0),reserved_atoms INTEGER NOT NULL DEFAULT 0 CHECK(reserved_atoms>=0),
      terms_version TEXT NOT NULL,identity_hash TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,
      CHECK(charged_atoms+reserved_atoms<=amount_atoms),CHECK(expires_at>=created_at));
    CREATE INDEX IF NOT EXISTS idx_vitrine_coin_lots_owner ON vitrine_coin_lots(user_id,expires_at);
    CREATE TABLE IF NOT EXISTS vitrine_coin_requests(
      request_id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),mode TEXT NOT NULL CHECK(mode IN ('api','local')),
      service TEXT NOT NULL,description TEXT,maximum_atoms INTEGER NOT NULL CHECK(maximum_atoms>0),quote_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,identity_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('reserved','held','settled','released','restored')),
      charged_atoms INTEGER NOT NULL DEFAULT 0 CHECK(charged_atoms>=0),receipt_id TEXT UNIQUE,
      observed_atoms INTEGER CHECK(observed_atoms>=0),settlement_hash TEXT,release_hash TEXT,restore_hash TEXT,
      created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,CHECK(charged_atoms<=maximum_atoms));
    CREATE INDEX IF NOT EXISTS idx_vitrine_coin_requests_owner ON vitrine_coin_requests(user_id,created_at);
    CREATE TABLE IF NOT EXISTS vitrine_coin_allocations(
      request_id TEXT NOT NULL REFERENCES vitrine_coin_requests(request_id),lot_id TEXT NOT NULL REFERENCES vitrine_coin_lots(id),
      amount_atoms INTEGER NOT NULL CHECK(amount_atoms>0),charged_atoms INTEGER NOT NULL DEFAULT 0 CHECK(charged_atoms>=0),
      PRIMARY KEY(request_id,lot_id),CHECK(charged_atoms<=amount_atoms));
    CREATE TABLE IF NOT EXISTS vitrine_coin_events(
      id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),request_id TEXT,source_id TEXT,type TEXT NOT NULL,
      amount_atoms INTEGER NOT NULL CHECK(amount_atoms>=0),details_json TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_vitrine_coin_events_owner ON vitrine_coin_events(user_id,created_at);
    CREATE TABLE IF NOT EXISTS vitrine_coin_holds(
      user_id INTEGER NOT NULL REFERENCES users(id),payment_reference TEXT NOT NULL,reason TEXT NOT NULL,
      created_at INTEGER NOT NULL,PRIMARY KEY(user_id,payment_reference));
  `);
  function owner(value){
    if(typeof value==='string'&&/^[1-9]\d{0,15}$/.test(value))value=Number(value);
    if(!Number.isSafeInteger(value)||value<1||!db.prepare('SELECT 1 FROM users WHERE id=?').get(value))fail('coin_owner_denied',403);
    return value;
  }
  const frozen=user=>!!db.prepare('SELECT 1 FROM vitrine_coin_holds WHERE user_id=? LIMIT 1').get(user);
  const event=(user,requestId,sourceId,type,value,details={})=>db.prepare('INSERT INTO vitrine_coin_events VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),user,requestId,sourceId,type,value,JSON.stringify(details),clock());
  function view(row){return {requestId:row.request_id,userId:row.user_id,mode:row.mode,service:row.service,state:row.state,maximumAtoms:String(row.maximum_atoms),chargedAtoms:String(row.charged_atoms),quoteId:row.quote_id,receiptId:row.receipt_id,observedAtoms:row.observed_atoms===null?null:String(row.observed_atoms),createdAt:row.created_at,updatedAt:row.updated_at};}
  function request(user,requestId){const row=db.prepare('SELECT * FROM vitrine_coin_requests WHERE request_id=?').get(id(requestId));if(!row||row.user_id!==user)fail('coin_request_not_found',404);return row;}
  function status(userId){
    const user=owner(userId),time=clock();let available=0n,reserved=0n,charged=0n,expired=0n;
    for(const lot of db.prepare('SELECT * FROM vitrine_coin_lots WHERE user_id=?').all(user)){
      const unused=BigInt(lot.amount_atoms)-BigInt(lot.reserved_atoms)-BigInt(lot.charged_atoms);
      if(lot.expires_at>time)available+=unused;else expired+=unused;
      reserved+=BigInt(lot.reserved_atoms);charged+=BigInt(lot.charged_atoms);
    }
    const hold=frozen(user),spendable=hold?0n:available;
    return {enabled:active,unified:true,currency:VITRINE_COINS_POLICY.currency,policyVersion:VITRINE_COINS_POLICY.version,
      userId:user,frozen:hold,availableAtoms:String(spendable),reservedAtoms:String(reserved),chargedAtoms:String(charged),expiredAtoms:String(expired),
      frozenAtoms:String(hold?available:0n),availableCoins:coinsFromAtoms(String(spendable)),reservedCoins:coinsFromAtoms(String(reserved))};
  }
  const grant=atomic((userId,input)=>{
    requireEnabled();const user=owner(userId);object(input,['sourceId','amountAtoms','origin','createdAt','expiresAt','termsVersion','paymentReference']);
    const source=id(input.sourceId),value=amount(input.amountAtoms,true),origin=id(input.origin),created=integer(input.createdAt),expires=integer(input.expiresAt),terms=id(input.termsVersion),payment=input.paymentReference==null?null:id(input.paymentReference);
    if(expires<created||created>clock())fail('coin_input_invalid');
    const identity=digest({user,source,value,origin,created,expires,terms,payment});
    const prior=db.prepare('SELECT * FROM vitrine_coin_lots WHERE source_id=?').get(source);
    const lotView=row=>({id:row.id,userId:row.user_id,sourceId:row.source_id,amountAtoms:String(row.amount_atoms),origin:row.origin,createdAt:row.created_at,expiresAt:row.expires_at,termsVersion:row.terms_version,paymentReference:row.payment_reference});
    if(prior){if(prior.identity_hash!==identity)fail('coin_conflict',409);return {...lotView(prior),duplicate:true};}
    if(payment&&db.prepare('SELECT 1 FROM vitrine_coin_lots WHERE payment_reference=?').get(payment))fail('coin_conflict',409);
    const total=db.prepare('SELECT amount_atoms FROM vitrine_coin_lots WHERE user_id=?').all(user).reduce((n,row)=>n+BigInt(row.amount_atoms),0n);
    if(total+BigInt(value)>MAX)fail('coin_wallet_capacity',409);
    const lotId=randomUUID();
    db.prepare('INSERT INTO vitrine_coin_lots(id,user_id,source_id,payment_reference,origin,amount_atoms,terms_version,identity_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(lotId,user,source,payment,origin,value,terms,identity,created,expires);
    event(user,null,source,'granted',value,{origin,termsVersion:terms,paymentReference:payment,expiresAt:expires});
    return {...lotView(db.prepare('SELECT * FROM vitrine_coin_lots WHERE id=?').get(lotId)),duplicate:false};
  });
  function allocate(user,{requestId,maximum,quote,requestHash,service,mode,description=null}){
    const identity=digest({user,requestId,maximum,quote,requestHash,service,mode,description});
    const prior=db.prepare('SELECT * FROM vitrine_coin_requests WHERE request_id=?').get(requestId);
    if(prior){if(prior.user_id!==user||prior.identity_hash!==identity)fail('coin_conflict',409);return {...view(prior),duplicate:true};}
    if(frozen(user))fail('coin_wallet_frozen',423);
    const time=clock(),lots=db.prepare('SELECT * FROM vitrine_coin_lots WHERE user_id=? AND expires_at>? AND charged_atoms+reserved_atoms<amount_atoms ORDER BY expires_at,created_at,id').all(user,time);
    if(lots.reduce((n,lot)=>n+BigInt(lot.amount_atoms)-BigInt(lot.charged_atoms)-BigInt(lot.reserved_atoms),0n)<BigInt(maximum))fail('coin_wallet_insufficient',402);
    db.prepare("INSERT INTO vitrine_coin_requests(request_id,user_id,mode,service,description,maximum_atoms,quote_id,request_hash,identity_hash,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'reserved',?,?)").run(requestId,user,mode,service,description,maximum,quote,requestHash,identity,time,time);
    let left=maximum;
    for(const lot of lots){if(!left)break;const used=Math.min(left,lot.amount_atoms-lot.charged_atoms-lot.reserved_atoms);left-=used;
      db.prepare('UPDATE vitrine_coin_lots SET reserved_atoms=reserved_atoms+? WHERE id=?').run(used,lot.id);
      db.prepare('INSERT INTO vitrine_coin_allocations(request_id,lot_id,amount_atoms) VALUES(?,?,?)').run(requestId,lot.id,used);
    }
    event(user,requestId,null,'reserved',maximum,{service,mode});return {...view(request(user,requestId)),duplicate:false};
  }
  const reserve=atomic((userId,input)=>{
    requireEnabled();const user=owner(userId);object(input,['requestId','maximumAtoms','quoteId','requestHash','service']);
    if(typeof input.requestHash!=='string'||! /^[a-f0-9]{64}$/.test(input.requestHash))fail('coin_input_invalid');
    const service=id(input.service);
    return allocate(user,{requestId:id(input.requestId),maximum:amount(input.maximumAtoms,true),quote:id(input.quoteId),requestHash:input.requestHash,service,mode:LOCAL_SERVICES.has(service)?'local':'api'});
  });
  function applySettlement(user,requestId,cost){
    let left=cost;const allocations=db.prepare('SELECT a.*,l.user_id FROM vitrine_coin_allocations a JOIN vitrine_coin_lots l ON l.id=a.lot_id WHERE a.request_id=? ORDER BY l.expires_at,l.created_at,l.id').all(requestId);
    if(allocations.reduce((sum,item)=>sum+BigInt(item.amount_atoms),0n)!==BigInt(request(user,requestId).maximum_atoms))fail('coin_integrity',500);
    for(const allocation of allocations){if(allocation.user_id!==user)fail('coin_integrity',500);const charged=Math.min(left,allocation.amount_atoms);left-=charged;
      const result=db.prepare('UPDATE vitrine_coin_lots SET reserved_atoms=reserved_atoms-?,charged_atoms=charged_atoms+? WHERE id=? AND user_id=? AND reserved_atoms>=?').run(allocation.amount_atoms,charged,allocation.lot_id,user,allocation.amount_atoms);
      if(result.changes!==1)fail('coin_integrity',500);
      db.prepare('UPDATE vitrine_coin_allocations SET charged_atoms=? WHERE request_id=? AND lot_id=?').run(charged,requestId,allocation.lot_id);
    }
    if(left!==0)fail('coin_integrity',500);
  }
  const settle=atomic((userId,requestId,input)=>{
    requireEnabled();const user=owner(userId);object(input,['actualAtoms','receiptId']);const prior=request(user,requestId),receipt=id(input.receiptId);
    const cost=input.actualAtoms===null?null:amount(input.actualAtoms),identity=digest({cost,receipt});
    if(prior.state==='settled'){if(prior.settlement_hash!==identity)fail('coin_conflict',409);return {...view(prior),duplicate:true};}
    if(!['reserved','held'].includes(prior.state))fail('coin_conflict',409);
    if(prior.receipt_id&&(prior.receipt_id!==receipt||(prior.observed_atoms!==null&&prior.observed_atoms!==cost)))fail('coin_conflict',409);
    const claimed=db.prepare('SELECT request_id FROM vitrine_coin_requests WHERE receipt_id=?').get(receipt);
    if(claimed&&claimed.request_id!==requestId)fail('coin_conflict',409);
    if(prior.receipt_id===null||prior.observed_atoms===null&&cost!==null)event(user,requestId,null,cost===null?'receipt_unknown':'receipt_observed',cost??0,{receiptId:receipt});
    db.prepare('UPDATE vitrine_coin_requests SET receipt_id=?,observed_atoms=?,updated_at=? WHERE request_id=?').run(receipt,cost,clock(),requestId);
    if(cost===null||cost>prior.maximum_atoms){
      if(prior.state!=='held')event(user,requestId,null,'held',prior.maximum_atoms,{reason:cost===null?'unknown_consumption':'quote_exceeded'});
      db.prepare("UPDATE vitrine_coin_requests SET state='held' WHERE request_id=?").run(requestId);return {...view(request(user,requestId)),duplicate:prior.state==='held'&&prior.observed_atoms===cost};
    }
    applySettlement(user,requestId,cost);
    db.prepare("UPDATE vitrine_coin_requests SET state='settled',charged_atoms=?,settlement_hash=?,updated_at=? WHERE request_id=?").run(cost,identity,clock(),requestId);
    event(user,requestId,null,'settled',cost,{receiptId:receipt});return {...view(request(user,requestId)),duplicate:false};
  });
  const release=atomic((userId,requestId,input)=>{
    requireEnabled();const user=owner(userId);object(input,['reason','noConsumptionConfirmed']);
    if(input.noConsumptionConfirmed!==true)fail('coin_input_invalid');const reason=text(input.reason),prior=request(user,requestId),identity=digest({reason,noConsumptionConfirmed:true});
    if(prior.state==='released'){if(prior.release_hash!==identity)fail('coin_conflict',409);return {...view(prior),duplicate:true};}
    if(!['reserved','held'].includes(prior.state)||prior.observed_atoms>0)fail('coin_conflict',409);
    applySettlement(user,requestId,0);
    db.prepare("UPDATE vitrine_coin_requests SET state='released',release_hash=?,updated_at=? WHERE request_id=?").run(identity,clock(),requestId);
    event(user,requestId,null,'released',prior.maximum_atoms,{reason});return {...view(request(user,requestId)),duplicate:false};
  });
  const freeze=atomic((userId,input)=>{
    requireEnabled();const user=owner(userId);object(input,['paymentReference','reason']);const payment=id(input.paymentReference),reason=text(input.reason),prior=db.prepare('SELECT reason FROM vitrine_coin_holds WHERE user_id=? AND payment_reference=?').get(user,payment);
    if(prior){
      if(prior.reason===reason)return {frozen:true,duplicate:true};
      // Provider disputes can progress from mediation to refund. Keep the hold,
      // record both reasons, and never reject newer verified receipt evidence.
      db.prepare('UPDATE vitrine_coin_holds SET reason=? WHERE user_id=? AND payment_reference=?').run(reason,user,payment);
      event(user,null,null,'freeze_updated',0,{paymentReference:payment,reason,previousReason:prior.reason});return {frozen:true,duplicate:false};
    }
    db.prepare('INSERT INTO vitrine_coin_holds VALUES(?,?,?,?)').run(user,payment,reason,clock());event(user,null,null,'frozen',0,{paymentReference:payment,reason});return {frozen:true,duplicate:false};
  });
  const spend=atomic((userId,input)=>{
    requireEnabled();const user=owner(userId);object(input,['requestId','amountAtoms','service','description']);const requestId=id(input.requestId),maximum=amount(input.amountAtoms,true),service=id(input.service),description=input.description==null?null:text(input.description,500);
    if(!LOCAL_SERVICES.has(service))fail('coin_local_service_denied',403);
    const reserved=allocate(user,{requestId,maximum,quote:`local:${requestId}`,requestHash:digest({maximum,service,description}),service,mode:'local',description});
    if(reserved.duplicate)return reserved;
    applySettlement(user,requestId,maximum);
    db.prepare("UPDATE vitrine_coin_requests SET state='settled',charged_atoms=?,updated_at=? WHERE request_id=?").run(maximum,clock(),requestId);
    event(user,requestId,null,'spent',maximum,{service,description});return {...view(request(user,requestId)),duplicate:false};
  });
  const restore=atomic((userId,requestId,input)=>{
    requireEnabled();const user=owner(userId);object(input,['reason']);const reason=text(input.reason),prior=request(user,requestId),identity=digest({reason});
    if(prior.mode!=='local')fail('coin_api_restore_denied',403);
    if(prior.state==='restored'){if(prior.restore_hash!==identity)fail('coin_conflict',409);return {...view(prior),duplicate:true};}
    if(prior.state!=='settled')fail('coin_conflict',409);
    let restored=0;for(const allocation of db.prepare('SELECT * FROM vitrine_coin_allocations WHERE request_id=?').all(requestId)){
      if(!allocation.charged_atoms)continue;
      const result=db.prepare('UPDATE vitrine_coin_lots SET charged_atoms=charged_atoms-? WHERE id=? AND user_id=? AND charged_atoms>=?').run(allocation.charged_atoms,allocation.lot_id,user,allocation.charged_atoms);
      if(result.changes!==1)fail('coin_integrity',500);restored+=allocation.charged_atoms;
    }
    if(restored!==prior.charged_atoms)fail('coin_integrity',500);
    db.prepare("UPDATE vitrine_coin_requests SET state='restored',restore_hash=?,updated_at=? WHERE request_id=?").run(identity,clock(),requestId);
    event(user,requestId,null,'restored',restored,{reason});return {...view(request(user,requestId)),duplicate:false};
  });
  const history=userId=>db.prepare('SELECT request_id requestId,source_id sourceId,type,amount_atoms amountAtoms,details_json detailsJson,created_at createdAt FROM vitrine_coin_events WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').all(owner(userId)).map(row=>({...row,amountAtoms:String(row.amountAtoms),details:JSON.parse(row.detailsJson),detailsJson:undefined}));
  return {enabled:active,status,grant,reserve,settle,release,freeze,spend,restore,history};
}
