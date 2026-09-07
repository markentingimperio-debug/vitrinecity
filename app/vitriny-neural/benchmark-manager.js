import {randomUUID} from 'node:crypto';
import {createEnvModelProviders} from './providers/from-env.js';
import {runSemanticBenchmark} from './benchmarks/semantic.js';
import {vitrinyNeuralCoreBenchmark} from './benchmarks/core-set.js';

function parse(value,fallback={}){try{return JSON.parse(value||'');}catch{return fallback;}}
function clamp(value,min,max,fallback){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;}

export function createNeuralBenchmarkManager({db,env=process.env,fetchImpl=globalThis.fetch,now=Date.now,recordQualification,logger=console}={}){
  if(!db?.prepare||!db?.exec)throw new TypeError('Benchmark manager requer SQLite.');
  if(typeof recordQualification!=='function')throw new TypeError('Benchmark manager requer recordQualification.');
  db.exec(`CREATE TABLE IF NOT EXISTS neural_benchmark_runs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    provider_id TEXT NOT NULL DEFAULT '',
    model_name TEXT NOT NULL DEFAULT '',
    suite TEXT NOT NULL DEFAULT 'vitriny-neural-semantic-v1',
    total INTEGER NOT NULL DEFAULT 0,
    passed INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    score REAL NOT NULL DEFAULT 0,
    grade TEXT NOT NULL DEFAULT '',
    report_json TEXT NOT NULL DEFAULT '{}',
    qualification_id TEXT,
    error TEXT NOT NULL DEFAULT '',
    actor_id INTEGER,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_neural_benchmark_runs_created ON neural_benchmark_runs(created_at DESC);`);
  db.prepare("UPDATE neural_benchmark_runs SET status='interrupted',error='process_restarted',completed_at=? WHERE status='running'")
    .run(new Date(Number(now())).toISOString());

  let activeId=null;
  const stamp=()=>new Date(Number(now())).toISOString();
  function row(row){if(!row)return null;return{
    id:row.id,status:row.status,providerId:row.provider_id,modelName:row.model_name,suite:row.suite,
    total:Number(row.total||0),passed:Number(row.passed||0),failed:Number(row.failed||0),score:Number(row.score||0),grade:row.grade,
    report:parse(row.report_json,{}),qualificationId:row.qualification_id||null,error:row.error||'',actorId:row.actor_id??null,
    createdAt:row.created_at,startedAt:row.started_at,completedAt:row.completed_at
  };}
  function get(id){return row(db.prepare('SELECT * FROM neural_benchmark_runs WHERE id=?').get(String(id||'')));}
  function list(limit=20){const n=Math.max(1,Math.min(50,Number(limit)||20));return db.prepare('SELECT * FROM neural_benchmark_runs ORDER BY created_at DESC,id DESC LIMIT ?').all(n).map(row);}
  function status(){return{activeId,active:activeId?get(activeId):null,recent:list(10)};}

  function resolveProvider(){
    const providers=createEnvModelProviders({env,fetchImpl});
    if(!providers.length)throw Object.assign(new Error('Nenhum modelo Neural configurado para benchmark.'),{status:503});
    return providers[0];
  }

  function start({actorId=null}={}){
    if(activeId)throw Object.assign(new Error('Já existe um benchmark Neural em execução.'),{status:409});
    const provider=resolveProvider(),id=randomUUID(),createdAt=stamp();
    db.prepare(`INSERT INTO neural_benchmark_runs(id,status,provider_id,actor_id,created_at,started_at)
      VALUES(?,'running',?,?,?,?)`).run(id,provider.id,actorId==null?null:Number(actorId),createdAt,createdAt);
    activeId=id;
    const timeoutMs=clamp(env.VITRINY_NEURAL_BENCHMARK_TIMEOUT_MS,5000,300000,90000);
    Promise.resolve().then(async()=>{
      try{
        const report=await runSemanticBenchmark({provider,cases:vitrinyNeuralCoreBenchmark,timeoutMs,now});
        const modelName=report.results.find(item=>item.model)?.model||'';
        const saved=recordQualification({providerId:provider.id,modelName,suite:report.suite,report});
        db.prepare(`UPDATE neural_benchmark_runs SET status='completed',model_name=?,suite=?,total=?,passed=?,failed=?,score=?,grade=?,report_json=?,qualification_id=?,completed_at=? WHERE id=?`)
          .run(modelName,report.suite,report.total,report.passed,report.failed,report.score,report.grade,JSON.stringify(report),saved.id,stamp(),id);
      }catch(error){
        logger?.error?.('[vitriny-neural] benchmark failed',String(error?.message||error));
        db.prepare("UPDATE neural_benchmark_runs SET status='failed',error=?,completed_at=? WHERE id=?")
          .run(String(error?.message||error).slice(0,500),stamp(),id);
      }finally{if(activeId===id)activeId=null;}
    });
    return get(id);
  }

  return{start,get,list,status};
}
