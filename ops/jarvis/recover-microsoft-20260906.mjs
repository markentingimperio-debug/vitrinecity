// One incident only: reverse this operator's own rollback, never an administrator archive.
// Mount beside the trusted /app scripts. Hold the external deployment lock throughout.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import Database from 'better-sqlite3';
import {validateCurriculum,planCurriculum} from './scripts/jarvis-curriculum.mjs';
const [mode,confirmation]=process.argv.slice(2);
assert.ok(['resume','verify','rollback-recovery'].includes(mode));
if(mode!=='verify')assert.equal(confirmation,'--confirm-own-rollback-recovery');
const hash=value=>createHash('sha256').update(value).digest('hex');
const bytes=fs.readFileSync('/lesson.json');
assert.equal(hash(bytes),'c1d93767fec988cbd81d1a7840cafa7434fe7abf2a78104075c103131ea3a15a');
const pack=validateCurriculum(JSON.parse(bytes));
assert.equal(pack.id,'microsoft-20260906-v2');assert.equal(pack.documents.length,2);assert.equal(pack.corrections.length,0);
const ids=[14,15],baseline='0243eba1ff09af5cf1323373c40bd75d10ea6c998cdbd12fbf6004f9836f1056';
const createdAt='2026-09-06T16:00:56.587Z',rolledBackAt='2026-09-06T16:00:57.348Z';
const backupPath='/data/recovery-backups/before-jarvis-microsoft-recovery-20260906.db';
const reportPath='/work/recovery-result-microsoft-v2.json';
const db=new Database('/data/vitrinecity.db',{readonly:mode==='verify',fileMustExist:true,timeout:5000});
const allRows=()=>db.prepare('SELECT * FROM jarvis_documents ORDER BY id').all();
const stable=rows=>hash(JSON.stringify(rows.map(row=>Object.fromEntries(Object.keys(row).sort().map(k=>[k,row[k]])))));
const preserved=()=>{
  const rows=allRows().filter(row=>!ids.includes(row.id));assert.equal(rows.length,13);assert.equal(stable(rows),baseline);
};
const knownEvents=[
  [26,'curriculum_draft',14,1,createdAt],[27,'curriculum_approved',14,2,createdAt],
  [28,'curriculum_draft',15,1,createdAt],[29,'curriculum_approved',15,2,createdAt],
  [30,'curriculum_rollback',14,3,rolledBackAt],[31,'curriculum_rollback',15,3,rolledBackAt]
].map(([id,kind,document_id,revision,created_at])=>({id,kind:kind+':'+pack.id,document_id,revision,actor_id:0,created_at}));
const guarded=(status,revision)=>{
  preserved();assert.equal(db.pragma('quick_check',{simple:true}),'ok');
  const docs=pack.documents.map((d,i)=>{
    const matches=db.prepare('SELECT * FROM jarvis_documents WHERE source=?').all(d.source);assert.equal(matches.length,1);
    const row=matches[0];
    assert.ok(row.id===ids[i]&&row.title===d.title&&row.body===d.body&&row.expires_at===d.expiresAt&&row.updated_by===0&&row.created_at===createdAt,'Pilot identity/content changed; stop for administrator review.');
    assert.equal(row.status,status);assert.equal(row.revision,revision,'Never reactivate an administrator edit/archive.');return row;
  });
  const events=db.prepare('SELECT * FROM jarvis_events WHERE document_id IN (14,15) ORDER BY id').all();
  assert.ok(isDeepStrictEqual(events.slice(0,6),knownEvents),'Original operator audit trail changed.');
  assert.equal(events.length,revision===3?6:8);
  if(revision===3)assert.ok(docs.every(d=>d.updated_at===rolledBackAt));
  else for(const d of docs){
    const event=events.slice(6).filter(e=>e.document_id===d.id);assert.equal(event.length,1);
    assert.ok(event[0].kind==='curriculum_recovered:'+pack.id&&event[0].revision===4&&event[0].actor_id===0&&event[0].created_at===d.updated_at);
  }
  return docs;
};
const idle=()=>{
  assert.equal(db.prepare('SELECT enabled FROM jarvis_settings WHERE id=1').get().enabled,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM jarvis_runs WHERE status='running'").get().n,0);
};
const verify=()=>{
  const docs=guarded('approved',4);assert.equal(planCurriculum(db,pack).operations.length,0);
  return {pilot:pack.id,approvedTotal:15,existingPreserved:13,ids:docs.map(d=>d.id),revisions:docs.map(d=>d.revision),integrity:'ok',reapplyChanges:0};
};
let reportFd;
const report=value=>{
  const text=JSON.stringify(value,null,2)+'\n';fs.writeSync(reportFd,text,0,'utf8');fs.ftruncateSync(reportFd,Buffer.byteLength(text));fs.fsyncSync(reportFd);
};
try{
  if(mode==='verify')console.log(JSON.stringify(verify()));
  else if(mode==='rollback-recovery'){
    const result=db.transaction(()=>{
      const docs=guarded('approved',4),at=new Date().toISOString();
      for(const d of docs){
        assert.equal(db.prepare("UPDATE jarvis_documents SET status='archived',revision=5,updated_at=?,updated_by=0 WHERE id=? AND revision=4 AND status='approved'").run(at,d.id).changes,1);
        db.prepare('INSERT INTO jarvis_events(kind,document_id,revision,actor_id,created_at) VALUES(?,?,5,0,?)').run('curriculum_recovery_rollback:'+pack.id,d.id,at);
      }
      preserved();return {archivedOnlyNewIds:ids,revision:5,deletedData:false};
    }).immediate();console.log(JSON.stringify(result));
  }else{
    guarded('archived',3);idle();
    assert.equal(fs.existsSync(backupPath),false,'Never replace a prior backup.');
    reportFd=fs.openSync(reportPath,'wx+',0o600);report({status:'pending',pilot:pack.id,incident:'host localhost health used instead of container localhost'});
    fs.mkdirSync('/data/recovery-backups',{recursive:true,mode:0o700});
    await db.backup(backupPath);fs.chmodSync(backupPath,0o600);
    const backup=new Database(backupPath,{readonly:true,fileMustExist:true});
    try{assert.equal(backup.pragma('quick_check',{simple:true}),'ok');assert.equal(stable(backup.prepare('SELECT * FROM jarvis_documents ORDER BY id').all()),stable(allRows()));}finally{backup.close();}
    const result=db.transaction(()=>{
      const docs=guarded('archived',3);idle();
      const settings=db.prepare('SELECT * FROM jarvis_settings').all();
      const trading=db.prepare('SELECT demo_enabled,real_enabled FROM binance_trading_control WHERE id=1').get();
      const at=new Date().toISOString();
      for(const d of docs){
        assert.equal(db.prepare("UPDATE jarvis_documents SET status='approved',revision=4,updated_at=?,updated_by=0 WHERE id=? AND revision=3 AND status='archived'").run(at,d.id).changes,1);
        db.prepare('INSERT INTO jarvis_events(kind,document_id,revision,actor_id,created_at) VALUES(?,?,4,0,?)').run('curriculum_recovered:'+pack.id,d.id,at);
      }
      const verified=verify();
      assert.ok(isDeepStrictEqual(db.prepare('SELECT * FROM jarvis_settings').all(),settings));
      assert.ok(isDeepStrictEqual(db.prepare('SELECT demo_enabled,real_enabled FROM binance_trading_control WHERE id=1').get(),trading));
      return {...verified,status:'committed',backup:backupPath,settingsAndTrading:'preserved',recoveredOwnRollbackAt:rolledBackAt};
    }).immediate();
    try{report(result);}catch(error){console.error(JSON.stringify({status:'database_committed_audit_write_failed',code:error.code??'UNKNOWN',next:'verify; never repeat resume blindly'}));process.exitCode=74;}
    console.log(JSON.stringify(result));
  }
}finally{if(reportFd!==undefined)fs.closeSync(reportFd);db.close();}
