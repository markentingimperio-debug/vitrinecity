// Explicit operator utility, not an HTTP endpoint or a tool available to Jarvis.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {createJarvis} from '../jarvis-core.js';

export function validateCurriculum(pack) {
  assert.match(pack.id,/^[a-z0-9-]{3,64}$/);assert.match(pack.verifiedCommit,/^[a-f0-9]{40}$/);
  assert.ok(typeof pack.authorization==='string' && pack.authorization.length>=30);
  assert.ok(Array.isArray(pack.documents)&&pack.documents.length<=10);
  assert.ok(Array.isArray(pack.corrections)&&pack.corrections.length<=2);
  const temp=new Database(':memory:'),core=createJarvis(temp,{env:{JARVIS_LOCAL_MODEL:'0'}}),seen=new Set();
  try {
    for(const doc of [...pack.documents,...pack.corrections.map(c=>c.document)]) {
      assert.ok(doc.source.startsWith(`Jarvis ${pack.id}/`));assert.ok(!seen.has(doc.source));seen.add(doc.source);
      assert.ok(!seen.has(doc.title));seen.add(doc.title);
      const saved=core.save(doc,0);core.transition(saved.id,{status:'approved',revision:1,confirmed:true},0);
    }
    for(const correction of pack.corrections){
      assert.equal(correction.expected.updated_by,0);assert.equal(correction.expected.status,'approved');
      assert.equal(correction.expected.revision,1);
      assert.deepEqual(Object.keys(correction.expected).sort(),['body','revision','source','status','title','updated_by']);
      assert.equal(correction.expected.title,correction.document.title);
    }
  }finally{temp.close();}
  return pack;
}

export function planCurriculum(db,pack) {
  validateCurriculum(pack);
  const operations=[],skipped=[];
  for(const correction of pack.corrections){
    const existing=db.prepare('SELECT * FROM jarvis_documents WHERE source=?').get(correction.document.source);
    if(existing){skipped.push({id:existing.id,status:existing.status,reason:'source_already_present'});continue;}
    const matches=db.prepare('SELECT * FROM jarvis_documents WHERE title=?').all(correction.expected.title);
    assert.equal(matches.length,1,'Correction target missing or ambiguous; inspect manually.');
    const old=matches[0];
    if(old.body===correction.document.body){skipped.push({id:old.id,status:old.status,reason:'correct_content_already_present'});continue;}
    for(const [key,value]of Object.entries(correction.expected))assert.equal(old[key],value,'Correction conflicts with existing knowledge; do not overwrite.');
    operations.push({kind:'correct',id:old.id,revision:old.revision,document:correction.document});
  }
  for(const doc of pack.documents){
    const matches=db.prepare('SELECT id,status,source,title,body FROM jarvis_documents WHERE source=? OR title=? OR body=?').all(doc.source,doc.title,doc.body);
    if(matches.length){skipped.push(...matches.map(row=>({id:row.id,status:row.status,reason:'existing_knowledge_preserved'})));continue;}
    operations.push({kind:'create',document:doc});
  }
  const count=db.prepare('SELECT COUNT(*) n FROM jarvis_documents').get().n;
  assert.ok(count+operations.filter(op=>op.kind==='create').length<=500,'Knowledge limit exceeded.');
  return {id:pack.id,operations,skipped};
}

export function applyCurriculum(db,pack,{confirmed=false}={}) {
  assert.equal(confirmed,true,'Operator review and approval are required.');
  return db.transaction(()=>{
    const plan=planCurriculum(db,pack),at=new Date().toISOString(),changes=[];
    const event=(kind,id,revision)=>db.prepare('INSERT INTO jarvis_events(kind,document_id,revision,actor_id,created_at) VALUES(?,?,?,0,?)').run(kind,id,revision,at);
    for(const op of plan.operations){
      const d=op.document;let id=op.id,revision=op.revision;
      if(op.kind==='create'){
        id=Number(db.prepare("INSERT INTO jarvis_documents(title,body,source,status,revision,expires_at,created_at,updated_at,updated_by) VALUES(?,?,?,'draft',1,?,?,?,0)").run(d.title,d.body,d.source,d.expiresAt||null,at,at).lastInsertRowid);revision=1;
      }else{
        db.prepare("UPDATE jarvis_documents SET title=?,body=?,source=?,status='draft',revision=revision+1,expires_at=?,updated_at=?,updated_by=0 WHERE id=? AND revision=?").run(d.title,d.body,d.source,d.expiresAt||null,at,id,revision);revision++;
      }
      event('curriculum_draft:'+pack.id,id,revision);
      db.prepare("UPDATE jarvis_documents SET status='approved',revision=revision+1 WHERE id=?").run(id);revision++;
      event('curriculum_approved:'+pack.id,id,revision);
      changes.push({id,revision,kind:op.kind,title:d.title});
    }
    return {id:pack.id,changes,skipped:plan.skipped,actor:'system_operator',authorization:pack.authorization};
  }).immediate();
}

export async function evaluateCurriculum(pack,{localModel=false,guard=()=>{}}={}) {
  const db=new Database(':memory:'),core=createJarvis(db,{env:{JARVIS_LOCAL_MODEL:localModel?'1':'0'},
    fetchImpl:async(url,options)=>{
      const response=await fetch(url,{...options,signal:AbortSignal.any([options.signal,AbortSignal.timeout(25000)])});
      if(url.endsWith('/v1/chat/completions')&&response.ok){
        const data=await response.clone().json(),choice=data.choices?.[0],content=choice?.message?.content||'';
        console.log(JSON.stringify({modelDiagnostic:{finishReason:choice?.finish_reason,characters:content.length,citations:[...content.matchAll(/\[(\d+)\]/g)].map(m=>m[1])}}));
      }
      return response;
    }});
  // Reproduce the original memory for a genuine before/after comparison even after seed fixes.
  for(const c of pack.corrections)db.prepare('UPDATE jarvis_documents SET body=?,source=?,status=?,revision=?,updated_by=? WHERE title=?').run(c.expected.body,c.expected.source,c.expected.status,c.expected.revision,c.expected.updated_by,c.expected.title);
  try{
    const baseline=pack.questions.map(q=>({question:q.question,expected:q.title,sourceFound:core.retrieve(q.question).some(s=>s.title===q.title)}));
    const installed=applyCurriculum(db,pack,{confirmed:true}),results=[];
    for(const q of pack.questions){
      await guard();const sources=core.retrieve(q.question),sourceFound=sources.some(s=>s.title===q.title);
      const answer=localModel?await core.ask({question:q.question},0):null;
      const termsFound=answer?q.answerIncludes.every(term=>answer.answer.toLocaleLowerCase('pt-BR').includes(term.toLocaleLowerCase('pt-BR'))):null;
      const result={question:q.question,expected:q.title,sourceFound,rank:sources.findIndex(s=>s.title===q.title)+1,
        ...(answer?{mode:answer.mode,answer:answer.answer,durationMs:answer.durationMs,termsFound}:{}),sources:sources.map(s=>s.title)};
      results.push(result);if(localModel)console.log(JSON.stringify(result));
    }
    const absent=await core.ask({question:'Qual será o faturamento exato amanhã?'},0);
    const report={id:pack.id,baseline,installed,results,noFabricatedForecast:absent.status==='no_sources',
      summary:{baselineSourceMatches:baseline.filter(r=>r.sourceFound).length,sourceMatches:results.filter(r=>r.sourceFound).length,total:results.length,
        localAnswers:results.filter(r=>r.mode==='local_model').length,explicitFallbacks:results.filter(r=>r.mode==='retrieval').length,termChecks:results.filter(r=>r.termsFound).length}};
    return report;
  }finally{db.close();}
}

async function main(){
  const [mode,packFile,...args]=process.argv.slice(2),pack=validateCurriculum(JSON.parse(fs.readFileSync(packFile,'utf8')));
  if(mode==='evaluate'){
    // The guard reads only state, never private document bodies, sessions or credentials.
    const guardDb=args[0]?new Database(args[0],{readonly:true,fileMustExist:true}):null;
    try{
      const guard=()=>{if(guardDb){assert.equal(guardDb.prepare('SELECT enabled FROM jarvis_settings WHERE id=1').get().enabled,1,'Jarvis paused by administrator.');assert.equal(guardDb.prepare("SELECT COUNT(*) n FROM jarvis_runs WHERE status='running'").get().n,0,'Live query in progress; postpone evaluation.');}};
      const report=await evaluateCurriculum(pack,{localModel:true,guard});console.log(JSON.stringify({summary:report.summary,noFabricatedForecast:report.noFabricatedForecast}));
      assert.equal(report.summary.sourceMatches,report.summary.total);assert.ok(report.summary.localAnswers>0,'No successful local generation; inspect runtime before teaching.');assert.ok(report.noFabricatedForecast);
    }finally{guardDb?.close();}return;
  }
  assert.ok(['plan','apply'].includes(mode),'Use plan/apply/evaluate.');
  const [dbFile,confirmation,backupFile]=args;
  const db=new Database(dbFile,{readonly:mode==='plan',fileMustExist:true});
  try{
    if(mode==='plan'){console.log(JSON.stringify(planCurriculum(db,pack)));return;}
    assert.equal(confirmation,'--confirm-reviewed');assert.ok(backupFile&&path.isAbsolute(backupFile));assert.equal(fs.existsSync(backupFile),false,'Backup target exists.');
    planCurriculum(db,pack); // Fail closed before creating backup if conflicts exist.
    fs.mkdirSync(path.dirname(backupFile),{recursive:true,mode:0o700});await db.backup(backupFile);fs.chmodSync(backupFile,0o600);
    const backup=new Database(backupFile,{readonly:true});assert.equal(backup.pragma('quick_check',{simple:true}),'ok');backup.close();
    console.log(JSON.stringify(applyCurriculum(db,pack,{confirmed:true})));
  }finally{db.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
