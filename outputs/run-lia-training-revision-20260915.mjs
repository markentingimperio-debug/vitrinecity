import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {createAdminTeachingPilot} from '/app/vitriny-neural/admin-teaching-pilot.js';
import {teachingPilotConfig} from '/app/scripts/run-admin-teaching-pilot.mjs';
import {teachingSources} from '/app/vitriny-neural/admin-teaching-sources.js';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const profile='plain-text-v1';
const maxLessons=9;
function parseJson(raw){
  if(typeof raw!=='string'||raw.length>50000)fail('revision_response_invalid');
  const text=raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{return JSON.parse(text);}catch{fail('revision_response_invalid');}
}
function safe(value,max){
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value)||/-----BEGIN|\b(?:api[_ -]?key|senha|password|bearer)\s*[:=]/i.test(value))fail('revision_response_invalid');
  return value.trim();
}
function readReport(file){
  const report=JSON.parse(fs.readFileSync(file,'utf8'));
  if(report.state!=='completed'||report.externalPublication!==false||report.weightTraining!==false)fail('revision_source_report_invalid');
  const rows=[];
  for(const batch of report.batches||[]){
    for(const review of batch.reviews||[]){
      if(review.decision!=='accept'){
        const lesson=batch.lessons.find(item=>item.id===review.id);
        const answer=batch.answers.find(item=>item.id===review.id);
        if(!lesson||!answer||!Array.isArray(answer.sourceIds))fail('revision_source_report_invalid');
        rows.push({id:lesson.id,domain:lesson.domain,question:lesson.question,sourceIds:answer.sourceIds,oldAnswer:answer.answer,reason:review.reason,origin:path.basename(file)});
      }
    }
  }
  return rows;
}
function sourcePack(rows){
  const ids=[...new Set(rows.flatMap(x=>x.sourceIds))].sort();
  return ids.map(id=>{const source=teachingSources.find(item=>item.id===id);if(!source)fail('revision_source_missing');return{id:source.id,title:source.title,body:source.body};});
}
function teacherMessages(rows,sources){
  return [{role:'user',content:'Revisão privada de capacitação da Lia. Corrija somente as respostas marcadas para revisão, preservando a pergunta e o foco. Use regras originais: diferencie fato sustentado de heurística, qualifique sugestões práticas, não invente capacidades da VitrineCity, não copie conteúdo de terceiros, não use dados pessoais, credenciais, preço, estoque ou promessas. Responda SOMENTE JSON válido {"lessons":[{"id":"...","answer":"...","sourceIds":["..."]}]} com exatamente os IDs recebidos; answer entre 120 e 700 caracteres; sourceIds deve ser subconjunto não vazio das fontes permitidas.'},{role:'user',content:`Dados para corrigir: ${JSON.stringify({rows,sources})}`}];
}
function reviewerMessages(rows,answers,sources){
  return [{role:'user',content:'Revisão final privada. Aceite apenas respostas claras, originais e úteis que não atribuam às fontes capacidades ou fatos inexistentes. Sugestões práticas devem ser explicitamente qualificadas como sugestões. Recuse invenções, pressão, promessas, dados pessoais, segredos e cópia de terceiros. Responda SOMENTE JSON válido {"reviews":[{"id":"...","decision":"accept" ou "revise","reason":"..."}]} com os IDs exatos.'},{role:'user',content:`Dados da revisão: ${JSON.stringify({rows,answers,sources})}`}];
}
function validateTeacher(raw,rows){
  const value=parseJson(raw);if(!value||Array.isArray(value)||Object.keys(value).length!==1||!Array.isArray(value.lessons)||value.lessons.length!==rows.length)fail('revision_teacher_invalid');
  const expected=new Map(rows.map(x=>[x.id,x])),seen=new Set();
  return rows.map(row=>{
    const item=value.lessons.find(x=>x&&x.id===row.id);if(!item||seen.has(item.id)||Object.keys(item).length!==3||!Array.isArray(item.sourceIds)||!item.sourceIds.length||item.sourceIds.some(id=>!row.sourceIds.includes(id)))fail('revision_teacher_invalid');
    seen.add(item.id);return{id:row.id,answer:safe(item.answer,900),sourceIds:[...new Set(item.sourceIds)].sort()};
  });
}
function validateReviewer(raw,rows){
  const value=parseJson(raw);if(!value||Array.isArray(value)||Object.keys(value).length!==1||!Array.isArray(value.reviews)||value.reviews.length!==rows.length)fail('revision_reviewer_invalid');
  const ids=new Set(rows.map(x=>x.id)),seen=new Set();
  return rows.map(row=>{
    const item=value.reviews.find(x=>x&&x.id===row.id);if(!item||seen.has(item.id)||Object.keys(item).length!==3||!ids.has(item.id)||!['accept','revise'].includes(item.decision))fail('revision_reviewer_invalid');
    seen.add(item.id);return{id:row.id,decision:item.decision,reason:safe(item.reason,500)};
  });
}
function summary(row){return row?{id:row.id,state:row.state,code:row.code||null,maximumMicroBrl:row.maximumMicroBrl,chargedMicroBrl:row.chargedMicroBrl,actualMicroBrl:row.actualMicroBrl,actualMicroUsd:row.actualMicroUsd,receiptId:row.receiptId||null}:null;}
function atomic(file,value){const temp=`${file}.${process.pid}.tmp`;fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{encoding:'utf8',mode:0o600});fs.renameSync(temp,file);}

const mode=process.argv[2]||'dry-run';
if(!['dry-run','execute'].includes(mode))fail('revision_mode_invalid');
const videoFile=process.env.VIDEO_REPORT||'/tmp/video-training-report-v1.json';
const salesFile=process.env.SALES_REPORT||'/tmp/sales-training-report-v1.json';
const rows=[...readReport(videoFile),...readReport(salesFile)];
if(rows.length!==maxLessons||new Set(rows.map(x=>x.id)).size!==maxLessons)fail('revision_target_count_invalid');
const sources=sourcePack(rows);
const base={format:'vitrinecity-lia-training-revision-report-v1',reviewProfile:profile,targetCount:rows.length,coinDebits:0,weightTraining:false,externalPublication:false,sourceReports:[videoFile,salesFile]};
if(mode==='dry-run'){console.log(JSON.stringify({...base,mode,state:'prepared',targets:rows.map(x=>({id:x.id,domain:x.domain,reason:x.reason})),budgetMicroBrl:'20000000',providerCalls:0}));process.exit(0);}
for(const key of ['DEEPSEEK_API_KEY','OPENAI_API_KEY'])if(typeof process.env[key]!=='string'||!/^[\x21-\x7e]{1,512}$/.test(process.env[key]))fail('revision_provider_keys_missing');
const root=process.env.TRAINING_ROOT||'/data/lia-training-revision-20260915';fs.mkdirSync(root,{recursive:true,mode:0o700});
const db=new Database(path.join(root,'lia-training-revision.sqlite'));fs.chmodSync(path.join(root,'lia-training-revision.sqlite'),0o600);
try{
  const pilot=createAdminTeachingPilot({db,config:{...teachingPilotConfig(),budgetMicroBrl:'20000000',maxOutputTokens:4096,openAiRequestProfile:profile},providerKeys:{deepseek:process.env.DEEPSEEK_API_KEY,openai:process.env.OPENAI_API_KEY}});
  const allAnswers=[],allReviews=[],providerRows=[];
  // Keep each provider message below the adapter's 16k character limit.
  for(let chunkIndex=0;chunkIndex<Math.ceil(rows.length/3);chunkIndex++){
    const chunk=rows.slice(chunkIndex*3,chunkIndex*3+3);
    const teacherId=`lia-revision-20260915-v2-teacher-${String(chunkIndex+1).padStart(2,'0')}`;
    const reviewerId=`lia-revision-20260915-v2-reviewer-${String(chunkIndex+1).padStart(2,'0')}-${profile}`;
    const teacher=pilot.get(teacherId)||await pilot.executeLesson({id:teacherId,providerId:'deepseek',model:'deepseek-flash',role:'teacher',messages:teacherMessages(chunk,sourcePack(chunk))});
    if(teacher.state!=='completed'||teacher.result?.ok!==true)fail(teacher.code||'revision_teacher_dispatch_failed');
    const answers=validateTeacher(teacher.result.text,chunk);allAnswers.push(...answers);
    const reviewer=pilot.get(reviewerId)||await pilot.executeLesson({id:reviewerId,providerId:'openai',model:'gpt-5.6-luna',role:'reviewer',messages:reviewerMessages(chunk,answers,sourcePack(chunk))});
    if(reviewer.state!=='completed'||reviewer.result?.ok!==true)fail(reviewer.code||'revision_reviewer_dispatch_failed');
    const reviews=validateReviewer(reviewer.result.text,chunk);allReviews.push(...reviews);
    providerRows.push({chunk:chunkIndex+1,ids:chunk.map(x=>x.id),teacher:summary(teacher),reviewer:summary(reviewer)});
  }
  const answers=allAnswers, reviews=allReviews;
  const replacements=rows.map(row=>({id:row.id,domain:row.domain,question:row.question,sourceIds:row.sourceIds,oldAnswer:row.oldAnswer,previousReason:row.reason,newAnswer:answers.find(x=>x.id===row.id).answer,review:reviews.find(x=>x.id===row.id)}));
  const report={...base,mode,state:'completed',observedAt:new Date().toISOString(),targets:rows,providers:providerRows,replacements,accepted:reviews.filter(x=>x.decision==='accept').length,revise:reviews.filter(x=>x.decision==='revise').length,providerCalls:db.prepare("SELECT COUNT(*) count FROM admin_teaching_pilot_runs WHERE state='completed'").get().count,budget:pilot.status()};
  atomic(path.join(root,'lia-training-revision-report-v1.json'),report);console.log(JSON.stringify(report));
}finally{db.close();}
