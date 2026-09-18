import express from 'express';
import {createHash,randomUUID} from 'node:crypto';
import {atomsFromMicroBRL,coinsFromAtoms} from '../public/vitrine-coins-contract.js';

const BASE='/api/neural/chat/operations';
const IDEMPOTENCY=/^[A-Za-z0-9_-]{12,100}$/;
const MEDIA_MIME=new Set(['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime','audio/mpeg','audio/mp4','audio/wav','audio/ogg']);
const MAX_UPLOAD=50*1024*1024;
const fail=(code,status=400)=>{throw Object.assign(Error(code),{status});};
function truthy(v){return ['1','true','yes','on'].includes(String(v||'').trim().toLowerCase());}
function clean(value,max=6000){
  const text=String(value||'').trim();
  if(text.length<3||text.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))fail('lia_operation_invalid');
  return text;
}
function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
function classifier(instruction,mime=''){
  const n=norm(instruction),hasUrl=/https:\/\/[^\s<>"']+/i.test(instruction);
  const browser=(hasUrl||/\bvitrine\s*city\b|\bvitrinecity\.com\b/.test(n))&&/\b(abra|abrir|acesse|acessar|navegue|navegar|visite|captura|screenshot|print|leia|verifique|veja)\b/.test(n);
  const isVideo=/^video\//.test(mime),isAudio=/^audio\//.test(mime),isImage=/^image\//.test(mime);
  const dimensions=/\b\d{2,4}\s*[x×]\s*\d{2,4}\b/.test(n);
  const clip=isVideo&&/\b(corte|cortar|recorte|recortar)\b/.test(n);
  const thumbnail=isVideo&&/\b(thumbnail|capa)\b/.test(n);
  const resize=(isVideo||isImage)&&(/\b(redimensione|redimensionar)\b/.test(n)||dimensions||isVideo&&/\bvertical\b|\b9\s*:\s*16\b/.test(n));
  const normalize=(isVideo||isAudio)&&/\b(normalize|normalizar)\b/.test(n);
  const media=Boolean(mime)&&MEDIA_MIME.has(mime)&&(clip||thumbnail||resize||normalize);
  if(browser&&!media)return {kind:'browser',supported:true,needsUpload:false};
  if(media&&!browser)return {kind:'media',supported:true,needsUpload:true};
  return {kind:'unsupported',supported:false,needsUpload:false};
}
function micro(env,key,fallback){const n=Number(env[key]);return Number.isSafeInteger(n)&&n>0&&n<=100_000_000?n:fallback;}
function publicQuote(kind,amountMicro){
  const atoms=atomsFromMicroBRL(String(amountMicro));
  return {kind,supported:true,needsUpload:kind==='media',amountMicro,priceCoins:coinsFromAtoms(atoms),currency:'VITRINE_COINS'};
}
function safePath(value){
  const v=String(value||'');
  if(!/^(?:browser|completed)\/[A-Za-z0-9._/-]{1,220}$/.test(v)||v.includes('..'))fail('lia_artifact_invalid');
  return v;
}

export function setupLiaChatOperations({app,db,coinWallet,requireUser,sameOriginOnly,env=process.env,fetchImpl=globalThis.fetch}={}){
  if(!app||!db||!coinWallet||typeof requireUser!=='function'||typeof sameOriginOnly!=='function')throw new TypeError('LIA chat operations requires app, db, coin wallet and auth.');
  const enabled=truthy(env.LIA_CHAT_OPERATIONS_ENABLED);
  const origin=String(env.LIA_OPERATIONS_URL||'https://lia.vitrinecity.com').replace(/\/+$/,'');
  const token=String(env.LIA_OPERATIONS_TOKEN||'');
  const browserMicro=micro(env,'LIA_BROWSER_PRICE_MICRO_BRL',104167);
  const mediaMicro=micro(env,'LIA_MEDIA_PRICE_MICRO_BRL',520833);
  const configured=enabled&&coinWallet.enabled===true&&/^https:\/\//.test(origin)&&token.length>=32;

  db.exec(`CREATE TABLE IF NOT EXISTS lia_chat_operations(
    id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,conversation_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,
    instruction_hash TEXT NOT NULL,kind TEXT NOT NULL,quote_id TEXT NOT NULL,amount_micro INTEGER NOT NULL,
    maximum_atoms TEXT NOT NULL,request_hash TEXT NOT NULL,status TEXT NOT NULL,remote_task_id TEXT,
    result_json TEXT,error TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
    UNIQUE(user_id,idempotency_key));
    CREATE INDEX IF NOT EXISTS idx_lia_chat_operations_user ON lia_chat_operations(user_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS lia_chat_operation_uploads(
      id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,artifact_path TEXT NOT NULL UNIQUE,mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_lia_chat_operation_uploads_user ON lia_chat_operation_uploads(user_id,created_at DESC);`);

  async function remote(path,{method='GET',body,headers={},raw=false,timeout=180000}={}){
    if(!configured)fail('lia_operations_unavailable',503);
    const h={authorization:`Bearer ${token}`,...headers};
    if(body!==undefined&&!raw)h['content-type']='application/json';
    let res;
    try{res=await fetchImpl(origin+path,{method,headers:h,redirect:'error',signal:AbortSignal.timeout(timeout),...(body!==undefined?{body:raw?body:JSON.stringify(body)}:{})});}
    catch{fail('lia_operations_transport_uncertain',502);}
    if(raw)return res;
    const data=await res.json().catch(()=>null);
    if(!res.ok||!data||data.ok!==true)fail('lia_operation_result_unconfirmed',502);
    return data;
  }
  function conversation(userId,id){
    const row=db.prepare('SELECT * FROM neural_chat_conversations WHERE id=? AND scope=?').get(id,`user:${userId}`);
    if(!row)fail('chat_not_found',404);
    return row;
  }
  function appendMessages(userId,cid,instruction,operationId){
    conversation(userId,cid);
    const count=db.prepare('SELECT COALESCE(MAX(sequence),0) n FROM neural_chat_messages WHERE conversation_id=?').get(cid).n,time=Date.now();
    const insert=db.prepare('INSERT INTO neural_chat_messages(id,conversation_id,request_id,role,text,status,sequence,created_at) VALUES(?,?,?,?,?,?,?,?)');
    insert.run(randomUUID(),cid,operationId,'user',instruction,'completed',count+1,time);
    // Execution state is owned by lia_chat_operations, not the text-provider queue.
    insert.run(randomUUID(),cid,operationId,'assistant','Tarefa operacional confirmada. Executando com a LIA…','completed',count+2,time);
    db.prepare('UPDATE neural_chat_conversations SET updated_at=? WHERE id=? AND scope=?').run(time,cid,`user:${userId}`);
  }
  function updateAssistant(cid,id,text,status){
    const changed=db.prepare("UPDATE neural_chat_messages SET text=?,status=? WHERE conversation_id=? AND request_id=? AND role='assistant'").run(text,status,cid,id).changes;
    if(changed!==1)fail('lia_message_state_conflict',409);
    db.prepare('UPDATE neural_chat_conversations SET updated_at=? WHERE id=?').run(Date.now(),cid);
  }
  const claim=db.transaction((userId,{instruction,key,uploadId,requestedConversation})=>{
    if(!configured)fail('lia_operations_unavailable',503);
    const hash=createHash('sha256').update(JSON.stringify({instruction,conversationId:requestedConversation||null,uploadId:uploadId||null})).digest('hex');
    const prior=db.prepare('SELECT * FROM lia_chat_operations WHERE user_id=? AND idempotency_key=?').get(userId,key);
    if(prior){if(prior.instruction_hash!==hash)fail('lia_idempotency_conflict',409);return {duplicate:true,op:prior};}
    if(db.prepare("SELECT 1 FROM lia_chat_operations WHERE user_id=? AND status IN ('created','reserved') LIMIT 1").get(userId))fail('lia_operation_requires_review',409);
    let upload=null;
    if(uploadId){upload=db.prepare('SELECT * FROM lia_chat_operation_uploads WHERE id=? AND user_id=?').get(uploadId,userId);if(!upload)fail('lia_upload_not_found',404);}
    const plan=classifier(instruction,upload?.mime_type||'');
    if(!plan.supported)fail('lia_operation_unsupported',422);
    if(plan.needsUpload&&!upload)fail('lia_upload_required');
    if(requestedConversation){
      conversation(userId,requestedConversation);
      const hasRequests=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='neural_chat_requests'").get();
      if(hasRequests&&db.prepare("SELECT 1 FROM neural_chat_requests WHERE scope=? AND conversation_id=? AND status IN ('awaiting_confirmation','queued','running','interrupted') LIMIT 1").get(`user:${userId}`,requestedConversation))fail('chat_busy',409);
    }
    const amountMicro=plan.kind==='browser'?browserMicro:mediaMicro,maximumAtoms=atomsFromMicroBRL(String(amountMicro));
    const opId=randomUUID(),cid=requestedConversation||randomUUID(),quoteId=randomUUID(),time=Date.now();
    const requestHash=createHash('sha256').update(JSON.stringify({opId,instruction,kind:plan.kind,maximumAtoms,quoteId,uploadId:uploadId||null})).digest('hex');
    db.prepare(`INSERT INTO lia_chat_operations(id,user_id,conversation_id,idempotency_key,instruction_hash,kind,quote_id,amount_micro,maximum_atoms,request_hash,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,'reserved',?,?)`).run(opId,userId,cid,key,hash,plan.kind,quoteId,amountMicro,maximumAtoms,requestHash,time,time);
    // Wallet, messages and operation are committed together, on the same SQLite connection.
    coinWallet.reserve(userId,{requestId:opId,maximumAtoms,quoteId,requestHash,service:'lia_operations'});
    if(!requestedConversation)db.prepare('INSERT INTO neural_chat_conversations(id,scope,title,created_at,updated_at) VALUES(?,?,?,?,?)').run(cid,`user:${userId}`,instruction.slice(0,90),time,time);
    appendMessages(userId,cid,instruction,opId);
    return {op:db.prepare('SELECT * FROM lia_chat_operations WHERE id=?').get(opId),upload};
  });
  const mutation=[requireUser,sameOriginOnly];
  app.get(BASE+'/status',requireUser,(req,res)=>{
    const status=coinWallet.status(req.user.id);
    const reviewRequired=!!db.prepare("SELECT 1 FROM lia_chat_operations WHERE user_id=? AND status='reserved' AND error<>'' LIMIT 1").get(req.user.id);
    res.set('Cache-Control','private,no-store').json({ok:true,enabled:configured,reviewRequired,prices:{browser:publicQuote('browser',browserMicro),media:publicQuote('media',mediaMicro)},wallet:status});
  });
  app.post(BASE+'/quote',...mutation,(req,res)=>{
    try{
      const instruction=clean(req.body?.instruction),mime=String(req.body?.mimeType||'').toLowerCase(),plan=classifier(instruction,mime);
      if(!configured||!plan.supported)return res.json({ok:true,item:{...plan,supported:false}});
      return res.json({ok:true,item:{...plan,...publicQuote(plan.kind,plan.kind==='browser'?browserMicro:mediaMicro)}});
    }catch(error){return res.status(error?.status||400).json({ok:false,error:'Pedido operacional inválido.'});}
  });
  app.post(BASE+'/upload',...mutation,express.raw({type:()=>true,limit:'50mb'}),async(req,res)=>{
    try{
      const mime=String(req.get('content-type')||'').split(';')[0].toLowerCase();
      if(!MEDIA_MIME.has(mime)||!Buffer.isBuffer(req.body)||!req.body.length)return res.status(400).json({ok:false,error:'Arquivo de mídia inválido.'});
      if(req.body.length>MAX_UPLOAD)return res.status(413).json({ok:false,error:'Arquivo maior que 50 MB.'});
      const upstream=await remote('/v1/operations/upload',{method:'POST',body:req.body,raw:true,headers:{'content-type':mime},timeout:180000});
      const data=await upstream.json().catch(()=>({}));
      if(!upstream.ok||data.ok!==true||!/^incoming\/[A-Za-z0-9._-]+$/.test(data.artifactPath||''))fail('lia_upload_failed',502);
      const id=randomUUID();db.prepare('INSERT INTO lia_chat_operation_uploads(id,user_id,artifact_path,mime_type,size_bytes,created_at) VALUES(?,?,?,?,?,?)').run(id,req.user.id,data.artifactPath,mime,req.body.length,Date.now());
      return res.status(201).json({ok:true,upload:{id,mimeType:mime,sizeBytes:req.body.length}});
    }catch(error){return res.status(error?.status||502).json({ok:false,error:'Não foi possível enviar o arquivo para a LIA.'});}
  });
  app.post(BASE+'/run',...mutation,async(req,res)=>{
    let op=null;
    try{
      if(req.get('x-lia-operations-request')!=='1'||!req.is('application/json'))return res.status(403).json({ok:false,error:'Confirmação operacional ausente.'});
      const instruction=clean(req.body?.instruction),key=String(req.body?.idempotencyKey||''),uploadId=String(req.body?.uploadId||''),requestedConversation=String(req.body?.conversationId||'');
      if(!IDEMPOTENCY.test(key)||req.body?.confirmCharge!==true)return res.status(400).json({ok:false,error:'Confirme a cobrança antes de executar.'});
      const claimed=claim.immediate(req.user.id,{instruction,key,uploadId,requestedConversation});
      if(claimed.duplicate)return res.json({ok:true,conversationId:claimed.op.conversation_id,operationId:claimed.op.id,status:claimed.op.status,duplicate:true});
      op=claimed.op;
      // From this boundary onward, a timeout or HTTP error is NOT proof of zero work.
      const remoteResult=await remote('/v1/operations/tasks',{method:'POST',body:{instruction,actor:`user:${req.user.id}`,artifactPath:claimed.upload?.artifact_path||''},timeout:15*60*1000});
      const item=remoteResult.item;
      if(!item||item.status!=='completed'||!/^op_[A-Za-z0-9-]{1,100}$/.test(item.id||'')||typeof item.result!=='string')fail('lia_result_unconfirmed',502);
      if(item.artifacts!==undefined&&!Array.isArray(item.artifacts))fail('lia_result_unconfirmed',502);
      const artifacts=item.artifacts||[];
      if(artifacts.length>4)fail('lia_result_unconfirmed',502);
      let text=item.result.slice(0,12000);
      for(const artifact of artifacts){const p=safePath(artifact.path),name=p.split('/').pop()||'arquivo';text+=`\n[[LIA_ARTIFACT|${op.id}|${encodeURIComponent(p)}|${encodeURIComponent(name)}]]`;}
      // Persist the receipt before settlement, so loss of the app cannot erase evidence.
      db.prepare('UPDATE lia_chat_operations SET remote_task_id=?,result_json=?,updated_at=? WHERE id=? AND status=?').run(item.id,JSON.stringify(item),Date.now(),op.id,'reserved');
      db.transaction(()=>{
        const settled=coinWallet.settle(req.user.id,op.id,{actualAtoms:op.maximum_atoms,receiptId:'lia:'+item.id});
        if(settled?.state!=='settled')fail('lia_settlement_requires_review',409);
        updateAssistant(op.conversation_id,op.id,text,'completed');
        db.prepare("UPDATE lia_chat_operations SET status='completed',error='',updated_at=? WHERE id=? AND user_id=? AND status='reserved'").run(Date.now(),op.id,req.user.id);
      }).immediate();
      return res.status(201).json({ok:true,conversationId:op.conversation_id,operationId:op.id,balance:coinWallet.status(req.user.id)});
    }catch(error){
      if(op){
        // Never manufacture noConsumptionConfirmed. Preserve the hold and block replay.
        db.transaction(()=>{
          const current=db.prepare('SELECT status FROM lia_chat_operations WHERE id=? AND user_id=?').get(op.id,req.user.id);
          if(current?.status!=='reserved')return;
          updateAssistant(op.conversation_id,op.id,'Não foi possível confirmar o término da tarefa. A reserva permanece para conferência; o pedido não será reenviado automaticamente.','interrupted');
          db.prepare("UPDATE lia_chat_operations SET error='operation_requires_review',updated_at=? WHERE id=? AND user_id=?").run(Date.now(),op.id,req.user.id);
        }).immediate();
        return res.status(502).json({ok:false,code:'lia_operation_requires_review',conversationId:op.conversation_id,operationId:op.id,error:'Término não confirmado. Reserva preservada para conferência; não reenvie o pedido.'});
      }
      const status=error?.status||502;
      return res.status(status).json({ok:false,error:status===402?'Saldo de Vitrine Coins insuficiente para esta tarefa.':status===409?'Há um pedido em andamento ou pendente de conferência. Não reenvie.':'A LIA não conseguiu iniciar esta operação.'});
    }
  });
  app.get(BASE+'/artifact',requireUser,async(req,res)=>{
    try{
      const operationId=String(req.query.operation||''),artifactPath=safePath(req.query.path);
      const op=db.prepare("SELECT o.* FROM lia_chat_operations o JOIN neural_chat_conversations c ON c.id=o.conversation_id AND c.scope=? WHERE o.id=? AND o.user_id=? AND o.status='completed'").get(`user:${req.user.id}`,operationId,req.user.id);
      if(!op)return res.status(404).json({error:'Arquivo não encontrado.'});
      let item={};try{item=JSON.parse(op.result_json||'{}');}catch{}
      const allowed=new Set((item.artifacts||[]).map(a=>String(a.path||'')));if(!allowed.has(artifactPath))return res.status(403).json({error:'Arquivo não autorizado.'});
      const upstream=await remote('/v1/operations/artifact?path='+encodeURIComponent(artifactPath),{raw:true,timeout:120000});
      if(!upstream.ok)return res.status(upstream.status).json({error:'Arquivo indisponível.'});
      res.set('Content-Type',upstream.headers.get('content-type')||'application/octet-stream');res.set('Content-Disposition','attachment; filename="'+artifactPath.split('/').pop()+'"');res.set('Cache-Control','private,no-store');res.set('X-Content-Type-Options','nosniff');
      if(!upstream.body)return res.status(502).end();for await(const chunk of upstream.body)res.write(chunk);return res.end();
    }catch{if(res.headersSent)return res.destroy();return res.status(502).json({error:'Não foi possível baixar o arquivo.'});}
  });
  return {enabled:configured};
}
