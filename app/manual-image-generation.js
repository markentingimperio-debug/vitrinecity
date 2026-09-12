import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {rasterSize} from './web-story-assets.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const fields=['task_id','format','production_status','image_provider','model','prompt','aspect_ratio','output_url','caption','channels','source_notes','script','remote_job_id','polling_url'];
const fingerprint=(project,taskStatus)=>hash(JSON.stringify([fields.map(key=>project?.[key]??null),taskStatus]));
const fail=(code,status=409)=>Object.assign(Error(code),{code,status});
const ratios=new Set(['1:1','4:5','9:16','16:9','2:3','3:2']);
export function manualImageFailureMessage(error){
  if(error?.code==='manual_image_already_started')return 'Esta geração já foi reservada. Confira o projeto; nenhuma nova solicitação foi enviada.';
  if(error?.code==='manual_image_project_changed')return 'O projeto ou a pausa geral mudou. Nenhuma nova solicitação foi enviada.';
  if(error?.code==='manual_image_options_invalid')return 'Confira o modelo, o texto e o formato da imagem antes de gerar.';
  return 'O resultado da geração precisa de conferência. A tentativa foi preservada e não será reenviada automaticamente.';
}

/** One durable paid attempt per project, including across restarts. No retry or
 * fallback. Received bytes are retained separately from the editable project. */
export async function generateManualMediaImage({db,project,config,outputDir,requestImage,canRun=()=>true}){
  db.exec(`CREATE TABLE IF NOT EXISTS manual_image_generation_attempts(
    project_id INTEGER PRIMARY KEY REFERENCES admin_media_projects(id),attempt_id TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,model TEXT NOT NULL,source_hash TEXT NOT NULL,state TEXT NOT NULL,
    output_url TEXT,sha256 TEXT,bytes INTEGER,usage_cost_usd REAL,error_code TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const read=()=>db.prepare('SELECT * FROM admin_media_projects WHERE id=?').get(project.id);
  const task=()=>db.prepare('SELECT status,title,instructions FROM admin_agent_tasks WHERE id=?').get(project.task_id);
  const receipt=()=>db.prepare('SELECT * FROM manual_image_generation_attempts WHERE project_id=?').get(project.id);
  const model=project.model||config.imageModel;
  if(!config.imageConfigured||project.image_provider!==config.provider||!config.imageOptions?.includes(model)||typeof project.prompt!=='string'||!project.prompt.trim()||project.prompt.length>8000||!ratios.has(project.aspect_ratio)||!path.isAbsolute(outputDir))throw fail('manual_image_options_invalid',400);
  const reservation=db.transaction(()=>{
    if(receipt())throw fail('manual_image_already_started');
    const current=read(),taskStatus=task();
    if(!canRun()||!current||current.format!=='image'||!['briefing','script','assets'].includes(current.production_status)||current.output_url||!taskStatus||taskStatus.status==='cancelled'||fingerprint(current,taskStatus)!==fingerprint(project,taskStatus))throw fail('manual_image_project_changed');
    const expected={...current,production_status:'editing'},sourceHash=fingerprint(expected,taskStatus),attemptId=randomUUID();
    db.prepare(`INSERT INTO manual_image_generation_attempts(project_id,attempt_id,provider,model,source_hash,state) VALUES(?,?,?,?,?,'submitting')`).run(project.id,attemptId,config.provider,model,sourceHash);
    const claimed=db.prepare("UPDATE admin_media_projects SET production_status='editing',progress=25,error_message='',updated_at=CURRENT_TIMESTAMP WHERE id=? AND format='image' AND image_provider=? AND production_status=? AND COALESCE(output_url,'')=''").run(project.id,config.provider,current.production_status);
    if(claimed.changes!==1)throw fail('manual_image_project_changed');
    return {attemptId,sourceHash};
  }).immediate();
  const unchanged=()=>fingerprint(read(),task())===reservation.sourceHash;
  try{
    // No await between the committed claim and this single paid request.
    const result=await requestImage({model,prompt:project.prompt,aspectRatio:project.aspect_ratio});
    if(result?.provider!==config.provider)throw fail('manual_image_receipt_invalid',502);
    const raw=result.data?.data?.[0]?.b64_json||result.data?.images?.[0]?.b64_json||result.data?.data?.[0]?.image_url?.url||'';
    if(typeof raw!=='string'||raw.length>36*1024*1024)throw fail('manual_image_receipt_invalid',502);
    const encoded=raw.replace(/^data:image\/(?:png|jpeg|webp);base64,/, '');
    if(!encoded||encoded.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw fail('manual_image_receipt_invalid',502);
    const bytes=Buffer.from(encoded,'base64'),size=rasterSize(bytes);
    if(bytes.length>25*1024*1024||Math.min(size.width,size.height)<512||size.width*size.height>40000000||!['png','jpeg','webp'].includes(size.type))throw fail('manual_image_receipt_invalid',502);
    const file=`factory-${project.id}-${reservation.attemptId}.${size.type==='jpeg'?'jpg':size.type}`,url='/uploads/generated-videos/'+file;
    fs.mkdirSync(outputDir,{recursive:true});fs.writeFileSync(path.join(outputDir,file),bytes,{flag:'wx'});
    const rawCost=result.data?.usage?.cost??result.data?.usage?.total_cost;
    const cost=typeof rawCost==='number'&&Number.isFinite(rawCost)&&rawCost>=0?rawCost:null;
    // Save the received artifact even if the project was cancelled/edited while
    // the provider ran. A later retry can never spend again for this project.
    db.prepare("UPDATE manual_image_generation_attempts SET state='received',output_url=?,sha256=?,bytes=?,usage_cost_usd=?,error_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE project_id=? AND attempt_id=? AND state='submitting'").run(url,hash(bytes),bytes.length,cost,project.id,reservation.attemptId);
    const applied=db.transaction(()=>{
      if(!canRun()||!unchanged())return false;
      db.prepare("UPDATE admin_media_projects SET production_status='review',progress=100,output_url=?,usage_cost_usd=COALESCE(?,usage_cost_usd),error_message='',updated_at=CURRENT_TIMESTAMP WHERE id=? AND production_status='editing'").run(url,cost,project.id);
      db.prepare("UPDATE admin_agent_tasks SET status='awaiting_approval',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status<>'cancelled'").run(project.task_id);
      db.prepare("UPDATE manual_image_generation_attempts SET state='completed',updated_at=CURRENT_TIMESTAMP WHERE project_id=? AND attempt_id=?").run(project.id,reservation.attemptId);
      return true;
    }).immediate();
    return {applied,outputUrl:url,attemptId:reservation.attemptId};
  }catch(error){
    const code=error?.code==='manual_image_receipt_invalid'?'manual_image_receipt_invalid':'manual_image_result_unknown';
    db.transaction(()=>{
      db.prepare("UPDATE manual_image_generation_attempts SET state='unknown',error_code=?,updated_at=CURRENT_TIMESTAMP WHERE project_id=? AND attempt_id=? AND state='submitting'").run(code,project.id,reservation.attemptId);
      if(unchanged())db.prepare("UPDATE admin_media_projects SET error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND production_status='editing'").run(manualImageFailureMessage(error),project.id);
    }).immediate();
    throw fail(code,[400,401,402,403,429,502,503,504].includes(error?.status)?error.status:502);
  }
}
