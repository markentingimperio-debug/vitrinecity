// Only disposable tmpfs /data and /work; live volume is mounted /baseline:ro.
import assert from 'node:assert/strict';import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {isDeepStrictEqual} from 'node:util';import Database from 'better-sqlite3';
const source=new Database('/baseline/vitrinecity.db',{readonly:true,fileMustExist:true}),db=new Database('/data/vitrinecity.db');
const docs=source.prepare('SELECT * FROM jarvis_documents ORDER BY id').all();
assert.equal(docs.length,15);assert.ok(docs.filter(d=>[14,15].includes(d.id)).every(d=>d.status==='archived'&&d.revision===3));
for(const table of ['jarvis_documents','jarvis_settings','jarvis_events','jarvis_runs','binance_trading_control']){
  if(table==='binance_trading_control'){
    db.exec('CREATE TABLE binance_trading_control(id INTEGER PRIMARY KEY,demo_enabled INTEGER,real_enabled INTEGER)');
    db.prepare('INSERT INTO binance_trading_control VALUES(@id,@demo_enabled,@real_enabled)').run(source.prepare('SELECT id,demo_enabled,real_enabled FROM binance_trading_control WHERE id=1').get());continue;
  }
  db.exec(source.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table).sql);
  if(table==='jarvis_runs')continue;
  for(const row of source.prepare(`SELECT * FROM ${table}`).all()){
    const keys=Object.keys(row);db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(k=>'@'+k).join(',')})`).run(row);
  }
}
const run=mode=>spawnSync(process.execPath,['/app/recover-microsoft.mjs',mode,'--confirm-own-rollback-recovery'],{encoding:'utf8',timeout:30000});
// Administrator edit simulation in tmpfs only; ensure neither document is reapproved.
db.prepare('UPDATE jarvis_documents SET revision=4,updated_by=77 WHERE id=15').run();
let result=run('resume');assert.notEqual(result.status,0);assert.equal(db.prepare("SELECT COUNT(*) n FROM jarvis_documents WHERE id IN (14,15) AND status='approved'").get().n,0);
assert.equal(fs.existsSync('/data/recovery-backups/before-jarvis-microsoft-recovery-20260906.db'),false);
db.prepare('UPDATE jarvis_documents SET revision=3,updated_by=0 WHERE id=15').run();
// Same status/revision but an altered event must also be rejected.
db.prepare("UPDATE jarvis_events SET kind='administrator_archive' WHERE id=31").run();result=run('resume');assert.notEqual(result.status,0);
db.prepare("UPDATE jarvis_events SET kind='curriculum_rollback:microsoft-20260906-v2' WHERE id=31").run();
console.log(JSON.stringify({test:'administrator edit or archive trail rejected before writes',result:'PASS'}));
for(const mode of ['resume','verify','rollback-recovery']){result=run(mode);assert.equal(result.status,0,result.stderr);console.log(result.stdout.trim());}
assert.equal(db.prepare("SELECT COUNT(*) n FROM jarvis_documents WHERE status='approved'").get().n,13);
assert.ok(db.prepare('SELECT status,revision FROM jarvis_documents WHERE id IN (14,15)').all().every(d=>d.status==='archived'&&d.revision===5));
assert.ok(isDeepStrictEqual(db.prepare('SELECT * FROM jarvis_documents WHERE id NOT IN (14,15) ORDER BY id').all(),docs.filter(d=>![14,15].includes(d.id))),'Existing memory changed in fixture.');
assert.ok(isDeepStrictEqual(source.prepare('SELECT * FROM jarvis_documents ORDER BY id').all(),docs),'Production memory changed during the test.');
assert.equal(db.pragma('quick_check',{simple:true}),'ok');db.close();source.close();
console.log(JSON.stringify({test:'guarded recovery/verify/selective reversal',result:'PASS',productionMemory:'unchanged',network:false}));
