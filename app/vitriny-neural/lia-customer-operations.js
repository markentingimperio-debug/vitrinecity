import express from 'express';
import {createHash, randomUUID} from 'node:crypto';

const USER_BASE='/api/lia/operations';
const IDEMPOTENCY=/^[A-Za-z0-9_-]{12,100}$/;
const ALLOWED_UPLOADS=new Set(['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime','audio/mpeg','audio/mp4','audio/wav','audio/ogg']);

function truthy(v){return ['1','true','yes','on'].includes(String(v||'').trim().toLowerCase());}
function boundedInt(value,fallback,min,max){const n=Number(value);return Number.isSafeInteger(n)&&n>=min&&n<=max?n:fallback;}
function cleanInstruction(value){
  const text=String(value||'').trim();
  if(text.length<3||text.length>6000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))throw Object.assign(new Error('lia_instruction_invalid'),{status:400});
  return text;
}
function safeJson(value){try{return JSON.stringify(value);}catch{return '{}';}}
function publicOperation(row){
  let result=null;try{result=row.result_json?JSON.parse(row.result_json):null;}catch{}
  return {id:row.id,status:row.status,kind:row.kind,chargeCoins:Number(row.charge_units||0)/100,
    remoteTaskId:row.remote_task_id||null,result,error:row.error||null,createdAt:row.created_at,updatedAt:row.updated_at};
}

export function setupLiaCustomerOperations({app,db,requireUser,sameOriginOnly,expireCreditBatches,env=process.env,fetchImpl=globalThis.fetch}={}){
  if(!app||!db||typeof requireUser!=='function'||typeof sameOriginOnly!=='function'||typeof expireCreditBatches!=='function')throw new TypeError('LIA customer operations requer app, db, auth e carteira.');
  const enabled=truthy(env.LIA_CUSTOMER_OPERATIONS_ENABLED);
  const origin=String(env.LIA_OPERATIONS_URL||'https://lia.vitrinecity.com').replace(/\/+$/,'');
  const token=String(env.LIA_OPERATIONS_TOKEN||'');
  const browserUnits=boundedInt(env.LIA_BROWSER_PRICE_UNITS,100,0,1_000_000);
  const mediaUnits=boundedInt(env.LIA_MEDIA_PRICE_UNITS,500,0,1_000_000);
  const configured=enabled&&/^https:\/\//i.test(origin)&&token.length>=32;

  db.exec(`CREATE TABLE IF NOT EXISTS lia_customer_operations(
    id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,instruction_hash TEXT NOT NULL,kind TEXT NOT NULL DEFAULT '',
    charge_units INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'created',
    remote_task_id TEXT,result_json TEXT,error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id,idempotency_key));
    CREATE INDEX IF NOT EXISTS idx_lia_customer_operations_user ON lia_customer_operations(user_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS lia_operation_credit_allocations(
      operation_id TEXT NOT NULL REFERENCES lia_customer_operations(id) ON DELETE CASCADE,
      batch_id INTEGER NOT NULL,units INTEGER NOT NULL,PRIMARY KEY(operation_id,batch_id));
    CREATE TABLE IF NOT EXISTS lia_customer_uploads(
      id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      artifact_path TEXT NOT NULL UNIQUE,mime_type TEXT NOT NULL,size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS idx_lia_customer_uploads_user ON lia_customer_uploads(user_id,created_at DESC);`);

  function priceUnits(kind){if(kind==='browser')return browserUnits;if(kind==='media')return mediaUnits;return 0;}
  async function remote(path,{method='GET',body,headers={},raw=false,timeout=180000}={}){
    if(!configured)throw Object.assign(new Error('lia_operations_unavailable'),{status:503,code:'lia_operations_unavailable'});
    const h={authorization:`Bearer ${token}`,...headers};
    if(body!==undefined&&!raw)h['content-type']='application/json';
    let response;
    try{response=await fetchImpl(origin+path,{method,headers:h,redirect:'error',signal:AbortSignal.timeout(timeout),...(body!==undefined?{body:raw?body:JSON.stringify(body)}:{})});}
    catch(error){throw Object.assign(new Error('lia_operations_unavailable'),{status:502,code:'lia_operations_unavailable',cause:error});}
    if(raw)return response;
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(String(data?.error||'lia_operation_failed')),{status:response.status,code:data?.error||'lia_operation_failed',data});
    return data;
  }
  async function quote(instruction){
    const data=await remote('/v1/operations/quote',{method:'POST',body:{instruction},timeout:15000});
    const units=data.supported?priceUnits(data.kind):0;
    return {...data,priceUnits:units,priceCoins:units/100};
  }
  const reserveCredits=db.transaction((userId,operationId,units)=>{
    expireCreditBatches(userId);
    const wallet=db.prepare('SELECT balance_units FROM wallets WHERE user_id=?').get(userId);
    if(!wallet||Number(wallet.balance_units)<units)throw Object.assign(new Error('lia_insufficient_coins'),{status:402,code:'lia_insufficient_coins'});
    let remaining=units;
    const batches=db.prepare(`SELECT id,remaining_units FROM credit_batches
      WHERE user_id=? AND status='active' AND remaining_units>0 ORDER BY expires_at,id`).all(userId);
    for(const batch of batches){
      if(remaining<=0)break;
      const used=Math.min(remaining,Number(batch.remaining_units));
      const next=Number(batch.remaining_units)-used;
      db.prepare(`UPDATE credit_batches SET remaining_units=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(next,next>0?'active':'used',batch.id);
      db.prepare('INSERT INTO lia_operation_credit_allocations(operation_id,batch_id,units) VALUES (?,?,?)').run(operationId,batch.id,used);
      remaining-=used;
    }
    if(remaining>0)throw Object.assign(new Error('lia_insufficient_active_coins'),{status:402,code:'lia_insufficient_coins'});
    const after=Number(wallet.balance_units)-units;
    db.prepare('UPDATE wallets SET balance_units=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(after,userId);
    db.prepare(`INSERT INTO wallet_ledger(user_id,delta_units,balance_after_units,kind,description)
      VALUES (?,?,?,?,?)`).run(userId,-units,after,'lia_operation_reserve',`Reserva para tarefa LIA ${operationId}`);
    db.prepare("UPDATE lia_customer_operations SET status='reserved',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(operationId);
    return after;
  });
  const refundCredits=db.transaction((userId,operationId,reason)=>{
    const op=db.prepare('SELECT * FROM lia_customer_operations WHERE id=? AND user_id=?').get(operationId,userId);
    if(!op||!['reserved','executing'].includes(op.status)||Number(op.charge_units)<=0)return false;
    const allocations=db.prepare('SELECT batch_id,units FROM lia_operation_credit_allocations WHERE operation_id=?').all(operationId);
    for(const a of allocations)db.prepare("UPDATE credit_batches SET remaining_units=remaining_units+?,status='active',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(a.units,a.batch_id);
    const current=Number(db.prepare('SELECT balance_units FROM wallets WHERE user_id=?').get(userId)?.balance_units||0),after=current+Number(op.charge_units);
    db.prepare('UPDATE wallets SET balance_units=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(after,userId);
    db.prepare(`INSERT INTO wallet_ledger(user_id,delta_units,balance_after_units,kind,description)
      VALUES (?,?,?,?,?)`).run(userId,Number(op.charge_units),after,'lia_operation_refund',`Devolução tarefa LIA ${operationId}: ${String(reason||'falha').slice(0,120)}`);
    db.prepare("UPDATE lia_customer_operations SET status='refunded',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(String(reason||'falha').slice(0,300),operationId);
    expireCreditBatches(userId);
    return true;
  });

  const mutation=[requireUser,sameOriginOnly];
  app.get(USER_BASE+'/status',requireUser,(req,res)=>{
    expireCreditBatches(req.user.id);
    const balance=Number(db.prepare('SELECT balance_units FROM wallets WHERE user_id=?').get(req.user.id)?.balance_units||0);
    res.set('Cache-Control','no-store').json({ok:true,enabled:configured,balanceCoins:balance/100,prices:{browserCoins:browserUnits/100,mediaCoins:mediaUnits/100}});
  });
  app.post(USER_BASE+'/quote',...mutation,async(req,res)=>{
    try{const instruction=cleanInstruction(req.body?.instruction),item=await quote(instruction);return res.json({ok:true,item});}
    catch(error){return res.status(error?.status||500).json({ok:false,code:error?.code||'lia_quote_failed',error:error?.status?error.message:'Não foi possível calcular o uso da LIA.'});}
  });
  app.post(USER_BASE+'/upload',...mutation,express.raw({type:()=>true,limit:'50mb'}),async(req,res)=>{
    try{
      const mime=String(req.get('content-type')||'').split(';')[0].toLowerCase();
      if(!ALLOWED_UPLOADS.has(mime)||!Buffer.isBuffer(req.body)||!req.body.length)return res.status(400).json({ok:false,code:'lia_upload_invalid',error:'Arquivo de mídia inválido.'});
      const response=await remote('/v1/operations/upload',{method:'POST',body:req.body,raw:true,headers:{'content-type':mime},timeout:180000});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.artifactPath)throw Object.assign(new Error(String(data.error||'lia_upload_failed')),{status:response.status||502,code:'lia_upload_failed'});
      const id=randomUUID();
      db.prepare('INSERT INTO lia_customer_uploads(id,user_id,artifact_path,mime_type,size_bytes) VALUES (?,?,?,?,?)').run(id,req.user.id,data.artifactPath,mime,req.body.length);
      return res.status(201).json({ok:true,upload:{id,artifactPath:data.artifactPath,mimeType:mime,sizeBytes:req.body.length}});
    }catch(error){return res.status(error?.status||500).json({ok:false,code:error?.code||'lia_upload_failed',error:'Não foi possível enviar o arquivo para a LIA.'});}
  });
  app.post(USER_BASE+'/run',...mutation,async(req,res)=>{
    let operationId='';
    try{
      if(req.get('x-lia-operations-request')!=='1'||!req.is('application/json'))return res.status(403).json({ok:false,code:'lia_request_invalid',error:'Confirmação da tarefa ausente.'});
      const instruction=cleanInstruction(req.body?.instruction),key=String(req.body?.idempotencyKey||'');
      if(!IDEMPOTENCY.test(key)||req.body?.confirmCharge!==true)return res.status(400).json({ok:false,code:'lia_confirmation_required',error:'Confirme a cobrança antes de executar.'});
      const hash=createHash('sha256').update(instruction).digest('hex');
      const prior=db.prepare('SELECT * FROM lia_customer_operations WHERE user_id=? AND idempotency_key=?').get(req.user.id,key);
      if(prior){
        if(prior.instruction_hash!==hash)return res.status(409).json({ok:false,code:'lia_idempotency_conflict',error:'Esta confirmação já identifica outra tarefa.'});
        return res.json({ok:true,item:publicOperation(prior),duplicate:true});
      }
      const q=await quote(instruction);
      if(!q.supported)return res.status(422).json({ok:false,code:'lia_operation_unsupported',error:'Este comando ainda não está disponível nesta versão da LIA.',quote:q});
      let artifactPath='';
      if(q.needsUpload){
        const uploadId=String(req.body?.uploadId||'');
        const upload=db.prepare('SELECT * FROM lia_customer_uploads WHERE id=? AND user_id=?').get(uploadId,req.user.id);
        if(!upload)return res.status(400).json({ok:false,code:'lia_upload_required',error:'Envie a foto, vídeo ou áudio antes de executar.'});
        artifactPath=upload.artifact_path;
      }
      operationId=randomUUID();
      db.prepare(`INSERT INTO lia_customer_operations(id,user_id,idempotency_key,instruction_hash,kind,charge_units,status)
        VALUES (?,?,?,?,?,?,'created')`).run(operationId,req.user.id,key,hash,q.kind,q.priceUnits);
      if(q.priceUnits>0)reserveCredits(req.user.id,operationId,q.priceUnits);
      db.prepare("UPDATE lia_customer_operations SET status='executing',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='reserved'").run(operationId);
      const remoteResult=await remote('/v1/operations/tasks',{method:'POST',body:{instruction,actor:`user:${req.user.id}`,artifactPath},timeout:15*60*1000});
      const item=remoteResult.item;
      db.prepare(`UPDATE lia_customer_operations SET status='completed',remote_task_id=?,result_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(String(item?.id||''),safeJson(item),operationId);
      const saved=db.prepare('SELECT * FROM lia_customer_operations WHERE id=?').get(operationId);
      expireCreditBatches(req.user.id);
      const balance=Number(db.prepare('SELECT balance_units FROM wallets WHERE user_id=?').get(req.user.id)?.balance_units||0);
      return res.status(201).json({ok:true,item:publicOperation(saved),balanceCoins:balance/100});
    }catch(error){
      if(operationId){try{refundCredits(req.user.id,operationId,error?.message||'Falha na operação');}catch{}}
      return res.status(error?.status||500).json({ok:false,code:error?.code||'lia_operation_failed',error:error?.status?error.message:'A LIA não conseguiu concluir esta tarefa.'});
    }
  });
  app.get(USER_BASE+'/operations',requireUser,(req,res)=>{
    const items=db.prepare('SELECT * FROM lia_customer_operations WHERE user_id=? ORDER BY created_at DESC LIMIT 30').all(req.user.id).map(publicOperation);
    res.set('Cache-Control','no-store').json({ok:true,items});
  });
  app.get(USER_BASE+'/artifact',requireUser,async(req,res)=>{
    try{
      const opId=String(req.query?.operation||''),artifactPath=String(req.query?.path||'');
      const op=db.prepare('SELECT * FROM lia_customer_operations WHERE id=? AND user_id=? AND status=?').get(opId,req.user.id,'completed');
      if(!op)return res.status(404).json({ok:false,error:'Resultado não encontrado.'});
      let result=null;try{result=JSON.parse(op.result_json||'null');}catch{}
      const allowed=new Set((result?.artifacts||[]).map(a=>String(a.path||'')));
      if(!allowed.has(artifactPath))return res.status(403).json({ok:false,error:'Arquivo não autorizado para esta tarefa.'});
      const response=await remote('/v1/operations/artifact?path='+encodeURIComponent(artifactPath),{raw:true,timeout:120000});
      if(!response.ok)return res.status(response.status).json({ok:false,error:'Arquivo indisponível.'});
      res.set('Content-Type',response.headers.get('content-type')||'application/octet-stream');
      res.set('Content-Disposition',response.headers.get('content-disposition')||'attachment');
      res.set('Cache-Control','private,no-store');
      if(!response.body)return res.status(502).end();
      for await(const chunk of response.body)res.write(chunk);
      return res.end();
    }catch{return res.status(502).json({ok:false,error:'Não foi possível baixar o resultado.'});}
  });

  return {enabled:configured,prices:{browserUnits,mediaUnits},quote};
}
