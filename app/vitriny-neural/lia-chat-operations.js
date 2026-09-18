import express from 'express';
import {createHash,randomUUID} from 'node:crypto';
import {atomsFromMicroBRL,coinsFromAtoms} from '../public/vitrine-coins-contract.js';

const BASE='/api/neural/chat/operations';
const IDEMPOTENCY=/^[A-Za-z0-9_-]{12,100}$/;
const MEDIA_MIME=new Set(['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime','audio/mpeg','audio/mp4','audio/wav','audio/ogg']);
const MAX_UPLOAD=50*1024*1024;

function truthy(v){return ['1','true','yes','on'].includes(String(v||'').trim().toLowerCase());}
function clean(value,max=6000){
  const text=String(value||'').trim();
  if(text.length<3||text.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))throw Object.assign(Error('lia_operation_invalid'),{status:400});
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
  if(!/^(?:browser|completed)\/[A-Za-z0-9._/-]{1,220}$/.test(v)||v.includes('..'))throw Object.assign(Error('lia_artifact_invalid'),{status:400});
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
    if(!configured)throw Object.assign(Error('lia_operations_unavailable'),{status:503});
    const h={authorization:`Bearer ${token}`,...headers};
    if(body!==undefined&&!raw)h['content-type']='application/json';
    let res;
    try{res=await fetchImpl(origin+path,{method,headers:h,redirect:'error',signal:AbortSignal.timeout(timeout),...(body!==undefined?{body:raw?body:JSON.stringify(body)}:{})});}
    catch(error){throw Object.assign(Error('lia_operations_unavailable'),{status:502,cause:error});}
    if(raw)return res;
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw Object.assign(Error(String(data?.error||'lia_operation_failed')),{status:res.status||502});
    return data;
  }
  function conversation(userId,id){
    if(id){
      const row=db.prepare("SELECT * FROM neural_chat_conversations WHERE id=? AND scope=?").get(id,`user:${userId}`);
      if(!row)throw Object.assign(Error('chat_not_found'),{status:404});return row;
    }
    return null;
  }
  function appendMessages(userId,conversationId,instruction,operationId,assistantText,status='completed'){
    const scope=`user:${userId}`,time=Date.now();
    let cid=conversationId;
    if(!cid){
      cid=randomUUID();db.prepare('INSERT INTO neural_chat_conversations(id,scope,title,created_at,updated_at) VALUES(?,?,?,?,?)').run(cid,scope,instruction.slice(0,90),time,time);
    }else conversation(userId,cid);
    const count=db.prepare('SELECT COUNT(*) n FROM neural_chat_messages WHERE conversation_id=?').get(cid).n;
    db.prepare('INSERT INTO neural_chat_messages(id,conversation_id,request_id,role,text,status,sequence,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(randomUUID(),cid,operationId,'user',instruction,'completed',count+1,time);
    db.prepare('INSERT INTO neural_chat_messages(id,conversation_id,request_id,role,text,status,sequence,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(randomUUID(),cid,operationId,'assistant',assistantText,status,count+2,time);
    db.prepare('UPDATE neural_chat_conversations SET updated_at=? WHERE id=? AND scope=?').run(time,cid,scope);
    return cid;
  }
  function updateAssistant(conversationId,operationId,text,status){
    db.prepare("UPDATE neural_chat_messages SET text=?,status=? WHERE conversation_id=? AND request_id=? AND role='assistant'").run(text,status,conversationId,operationId);
    db.prepare('UPDATE neural_chat_conversations SET updated_at=? WHERE id=?').run(Date.now(),conversationId);
  }
  const mutation=[requireUser,sameOriginOnly];
  app.get(BASE+'/status',requireUser,(req,res)=>{
    const status=coinWallet.status(req.user.id);
    res.set('Cache-Control','private,no-store').json({ok:true,enabled:configured,prices:{browser:publicQuote('browser',browserMicro),media:publicQuote('media',mediaMicro)},wallet:status});
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
      if(!upstream.ok||!data.artifactPath)throw Object.assign(Error('lia_upload_failed'),{status:upstream.status||502});
      const id=randomUUID();db.prepare('INSERT INTO lia_chat_operation_uploads(id,user_id,artifact_path,mime_type,size_bytes,created_at) VALUES(?,?,?,?,?,?)')
        .run(id,req.user.id,data.artifactPath,mime,req.body.length,Date.now());
      return res.status(201).json({ok:true,upload:{id,mimeType:mime,sizeBytes:req.body.length}});
    }catch(error){return res.status(error?.status||502).json({ok:false,error:'Não foi possível enviar o arquivo para a LIA.'});}
  });
  app.post(BASE+'/run',...mutation,async(req,res)=>{
    let opId='',cid='';
    try{
      if(req.get('x-lia-operations-request')!=='1'||!req.is('application/json'))return res.status(403).json({ok:false,error:'Confirmação operacional ausente.'});
      const instruction=clean(req.body?.instruction),key=String(req.body?.idempotencyKey||''),uploadId=String(req.body?.uploadId||''),requestedConversation=String(req.body?.conversationId||'');
      if(!IDEMPOTENCY.test(key)||req.body?.confirmCharge!==true)return res.status(400).json({ok:false,error:'Confirme a cobrança antes de executar.'});
      let upload=null;if(uploadId)upload=db.prepare('SELECT * FROM lia_chat_operation_uploads WHERE id=? AND user_id=?').get(uploadId,req.user.id);
      const plan=classifier(instruction,upload?.mime_type||'');if(!plan.supported)return res.status(422).json({ok:false,error:'Este comando não é uma operação suportada.'});
      if(plan.needsUpload&&!upload)return res.status(400).json({ok:false,error:'Envie a mídia antes de executar.'});
      if(requestedConversation)conversation(req.user.id,requestedConversation);
      const hash=createHash('sha256').update(JSON.stringify({instruction,conversationId:requestedConversation||null,uploadId:uploadId||null})).digest('hex');
      const prior=db.prepare('SELECT * FROM lia_chat_operations WHERE user_id=? AND idempotency_key=?').get(req.user.id,key);
      if(prior){if(prior.instruction_hash!==hash)return res.status(409).json({ok:false,error:'Esta confirmação identifica outro pedido.'});return res.json({ok:true,conversationId:prior.conversation_id,duplicate:true});}
      const amountMicro=plan.kind==='browser'?browserMicro:mediaMicro,maximumAtoms=atomsFromMicroBRL(String(amountMicro)),quoteId=randomUUID();
      opId=randomUUID();const requestHash=createHash('sha256').update(JSON.stringify({opId,instruction,kind:plan.kind,maximumAtoms,quoteId,uploadId:uploadId||null})).digest('hex');
      cid=requestedConversation||randomUUID();
      db.prepare(`INSERT INTO lia_chat_operations(id,user_id,conversation_id,idempotency_key,instruction_hash,kind,quote_id,amount_micro,maximum_atoms,request_hash,status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,'created',?,?)`).run(opId,req.user.id,cid,key,hash,plan.kind,quoteId,amountMicro,maximumAtoms,requestHash,Date.now(),Date.now());
      coinWallet.reserve(req.user.id,{requestId:opId,maximumAtoms,quoteId,requestHash,service:'lia_operations'});
      if(!requestedConversation)db.prepare('INSERT INTO neural_chat_conversations(id,scope,title,created_at,updated_at) VALUES(?,?,?,?,?)').run(cid,`user:${req.user.id}`,instruction.slice(0,90),Date.now(),Date.now());
      appendMessages(req.user.id,cid,instruction,opId,'Tarefa operacional confirmada. Executando com a LIA…','completed');
      db.prepare("UPDATE lia_chat_operations SET status='reserved',updated_at=? WHERE id=?").run(Date.now(),opId);
      const remoteResult=await remote('/v1/operations/tasks',{method:'POST',body:{instruction,actor:`user:${req.user.id}`,artifactPath:upload?.artifact_path||''},timeout:15*60*1000});
      const item=remoteResult.item||{},artifacts=Array.isArray(item.artifacts)?item.artifacts:[];
      const receipt='lia:'+String(item.id||opId).replace(/[^A-Za-z0-9_.:-]/g,'').slice(0,150);
      coinWallet.settle(req.user.id,opId,{actualAtoms:maximumAtoms,receiptId:receipt});
      let text=String(item.result||'Tarefa concluída pela LIA.').slice(0,12000);
      for(const artifact of artifacts.slice(0,4)){
        const p=safePath(artifact.path),name=p.split('/').pop()||'arquivo';
        text+=`\n[[LIA_ARTIFACT|${opId}|${encodeURIComponent(p)}|${encodeURIComponent(name)}]]`;
      }
      updateAssistant(cid,opId,text,'completed');
      db.prepare("UPDATE lia_chat_operations SET status='completed',remote_task_id=?,result_json=?,updated_at=? WHERE id=?").run(String(item.id||''),JSON.stringify(item),Date.now(),opId);
      return res.status(201).json({ok:true,conversationId:cid,operationId:opId,balance:coinWallet.status(req.user.id)});
    }catch(error){
      if(opId){
        const op=db.prepare('SELECT status FROM lia_chat_operations WHERE id=? AND user_id=?').get(opId,req.user.id);
        if(op?.status==='created'){
          db.prepare('DELETE FROM lia_chat_operations WHERE id=? AND user_id=?').run(opId,req.user.id);
        }else if(op){
          try{coinWallet.release(req.user.id,opId,{reason:'operation_not_completed',noConsumptionConfirmed:true});}catch{}
          try{updateAssistant(cid,opId,'A tarefa operacional não foi concluída. A reserva foi liberada quando não houve consumo confirmado.','failed');}catch{}
          db.prepare("UPDATE lia_chat_operations SET status='failed',error=?,updated_at=? WHERE id=?").run(String(error?.message||'operation_failed').slice(0,300),Date.now(),opId);
        }
      }
      const status=error?.status||502;
      return res.status(status).json({ok:false,error:status===402?'Saldo de Vitrine Coins insuficiente para esta tarefa.':'A LIA não conseguiu concluir esta operação.'});
    }
  });
  app.get(BASE+'/artifact',requireUser,async(req,res)=>{
    try{
      const operationId=String(req.query.operation||''),artifactPath=safePath(req.query.path);
      const op=db.prepare("SELECT * FROM lia_chat_operations WHERE id=? AND user_id=? AND status='completed'").get(operationId,req.user.id);
      if(!op)return res.status(404).json({error:'Arquivo não encontrado.'});
      let item={};try{item=JSON.parse(op.result_json||'{}');}catch{}
      const allowed=new Set((item.artifacts||[]).map(a=>String(a.path||'')));if(!allowed.has(artifactPath))return res.status(403).json({error:'Arquivo não autorizado.'});
      const upstream=await remote('/v1/operations/artifact?path='+encodeURIComponent(artifactPath),{raw:true,timeout:120000});
      if(!upstream.ok)return res.status(upstream.status).json({error:'Arquivo indisponível.'});
      res.set('Content-Type',upstream.headers.get('content-type')||'application/octet-stream');res.set('Content-Disposition',upstream.headers.get('content-disposition')||'attachment');res.set('Cache-Control','private,no-store');
      if(!upstream.body)return res.status(502).end();for await(const chunk of upstream.body)res.write(chunk);return res.end();
    }catch{return res.status(502).json({error:'Não foi possível baixar o arquivo.'});}
  });
  return {enabled:configured};
}
