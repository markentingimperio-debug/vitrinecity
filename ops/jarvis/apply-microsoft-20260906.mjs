// Operator-only, exact reviewed data import. Mount alongside /app/jarvis-core.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import Database from 'better-sqlite3';
import {validateCurriculum,planCurriculum,applyCurriculum} from './scripts/jarvis-curriculum.mjs';
const [mode,confirmation]=process.argv.slice(2);
assert.ok(['apply','verify','rollback'].includes(mode));
if(mode!=='verify')assert.equal(confirmation,'--confirm-reviewed-microsoft-v2');
const bytes=fs.readFileSync('/lesson.json');
const digest=value=>createHash('sha256').update(value).digest('hex');
assert.equal(digest(bytes),'c1d93767fec988cbd81d1a7840cafa7434fe7abf2a78104075c103131ea3a15a');
const pack=validateCurriculum(JSON.parse(bytes));
assert.equal(pack.id,'microsoft-20260906-v2');assert.equal(pack.documents.length,2);assert.equal(pack.corrections.length,0);
const expectedSnapshot='0243eba1ff09af5cf1323373c40bd75d10ea6c998cdbd12fbf6004f9836f1056';
const snapshotHash=rows=>digest(JSON.stringify([...rows].sort((a,b)=>a.id-b.id).map(row=>Object.fromEntries(Object.keys(row).sort().map(key=>[key,row[key]])))));
const backupFile='/data/recovery-backups/before-jarvis-microsoft-v2-20260906.db';
const reportFile='/work/import-result-microsoft-v2.json';
let reportFd;
const persistReport=report=>{
  const payload=JSON.stringify(report,null,2)+'\n';
  fs.writeSync(reportFd,payload,0,'utf8');
  fs.ftruncateSync(reportFd,Buffer.byteLength(payload));
  fs.fsyncSync(reportFd);
};
const db=new Database('/data/vitrinecity.db',{readonly:mode==='verify',fileMustExist:true,timeout:5000});
const rows=()=>db.prepare('SELECT * FROM jarvis_documents ORDER BY id').all();
const currentDoc=d=>db.prepare('SELECT * FROM jarvis_documents WHERE source=?').all(d.source);
const verifyDoc=(row,d)=>{
  assert.ok(row && row.title===d.title && row.body===d.body && row.source===d.source && row.expires_at===d.expiresAt && row.updated_by===0,'New document identity/content changed; inspect without overwriting.');
};
const verify=()=>{
  assert.equal(db.pragma('quick_check',{simple:true}),'ok');
  const created=pack.documents.map(d=>{const matches=currentDoc(d);assert.equal(matches.length,1);const row=matches[0];verifyDoc(row,d);assert.equal(row.status,'approved');assert.equal(row.revision,2);return row;});
  const newIds=new Set(created.map(d=>d.id)),existing=rows().filter(row=>!newIds.has(row.id));
  assert.equal(existing.length,13);assert.equal(snapshotHash(existing),expectedSnapshot,'Existing memory changed; do not overwrite.');
  assert.equal(planCurriculum(db,pack).operations.length,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM jarvis_events WHERE kind IN (?,?)').get('curriculum_draft:'+pack.id,'curriculum_approved:'+pack.id).n,4);
  return {pilot:pack.id,approvedTotal:rows().filter(d=>d.status==='approved').length,existingPreserved:13,reapplyChanges:0,integrity:'ok',created:created.map(d=>({id:d.id,title:d.title,source:d.source,revision:d.revision,bodySha256:digest(d.body)}))};
};
try{
  if(mode==='verify'){console.log(JSON.stringify(verify()));}
  else if(mode==='rollback'){
    const result=db.transaction(()=>{
      const at=new Date().toISOString(),ids=[];
      for(const d of pack.documents){
        const matches=currentDoc(d);assert.ok(matches.length<=1);
        if(!matches.length)continue;
        const row=matches[0];verifyDoc(row,d);
        if(row.status==='archived' && row.revision===3)continue;
        assert.equal(row.status,'approved');assert.equal(row.revision,2,'Administrator changed pilot; do not roll it back automatically.');
        assert.equal(db.prepare("UPDATE jarvis_documents SET status='archived',revision=revision+1,updated_at=?,updated_by=0 WHERE id=? AND revision=2 AND status='approved'").run(at,row.id).changes,1);
        db.prepare('INSERT INTO jarvis_events(kind,document_id,revision,actor_id,created_at) VALUES(?,?,3,0,?)').run('curriculum_rollback:'+pack.id,row.id,at);ids.push(row.id);
      }
      return {archivedOnlyNewIds:ids,restoredDatabase:false,deletedData:false};
    }).immediate();console.log(JSON.stringify(result));
  }else{
    assert.equal(snapshotHash(rows()),expectedSnapshot,'Memory changed since evaluation; rerun evaluation.');
    assert.equal(db.prepare('SELECT enabled FROM jarvis_settings WHERE id=1').get().enabled,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM jarvis_runs WHERE status='running'").get().n,0);
    const plan=planCurriculum(db,pack);assert.equal(plan.operations.length,2);assert.ok(plan.operations.every(op=>op.kind==='create'));assert.equal(plan.skipped.length,0);
    assert.equal(fs.existsSync(backupFile),false,'Never overwrite an existing backup.');
    // Reserve and test the audit destination before making a backup or approving rows.
    // Any abandoned pending report is preserved for inspection, never overwritten.
    reportFd=fs.openSync(reportFile,'wx+',0o600);
    persistReport({pilot:pack.id,status:'pending',expectedSnapshot,packSha256:digest(bytes)});
    fs.mkdirSync('/data/recovery-backups',{recursive:true,mode:0o700});
    await db.backup(backupFile);fs.chmodSync(backupFile,0o600);
    const backup=new Database(backupFile,{readonly:true,fileMustExist:true});
    try{assert.equal(backup.pragma('quick_check',{simple:true}),'ok');assert.equal(snapshotHash(backup.prepare('SELECT * FROM jarvis_documents ORDER BY id').all()),expectedSnapshot);}finally{backup.close();}
    const result=db.transaction(()=>{
      assert.equal(snapshotHash(rows()),expectedSnapshot,'Memory changed while taking backup; postpone.');
      assert.equal(db.prepare('SELECT enabled FROM jarvis_settings WHERE id=1').get().enabled,1);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM jarvis_runs WHERE status='running'").get().n,0);
      const settings=db.prepare('SELECT * FROM jarvis_settings').all();
      const trading=db.prepare('SELECT demo_enabled,real_enabled FROM binance_trading_control WHERE id=1').get();
      const installed=applyCurriculum(db,pack,{confirmed:true});assert.equal(installed.changes.length,2);
      const verified=verify();
      assert.ok(isDeepStrictEqual(db.prepare('SELECT * FROM jarvis_settings').all(),settings));
      assert.ok(isDeepStrictEqual(db.prepare('SELECT demo_enabled,real_enabled FROM binance_trading_control WHERE id=1').get(),trading));
      return {...verified,backup:backupFile,settingsAndTrading:'preserved',actor:'system_operator',approval:'Administrator-authorized and operator-reviewed Microsoft curriculum v2'};
    }).immediate();
    try{persistReport({...result,status:'committed'});}catch(error){
      console.error(JSON.stringify({status:'database_committed_audit_write_failed',code:error.code??'UNKNOWN',next:'Inspect with verify; do not repeat apply blindly. The wrapper must use selective rollback if postchecks fail.'}));
      process.exitCode=74;
    }
    console.log(JSON.stringify(result));
  }
}finally{if(reportFd!==undefined)fs.closeSync(reportFd);db.close();}
