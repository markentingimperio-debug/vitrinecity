import {randomUUID} from 'node:crypto';

function text(value,max=160,min=1){const v=String(value??'').trim();if(v.length<min||v.length>max)throw new Error('Qualificação inválida.');return v;}
function json(value){return JSON.stringify(value??{});}
function parse(value,fallback={}){try{return JSON.parse(value||'');}catch{return fallback;}}

export function createQualificationStore(db){
  if(!db?.prepare||!db?.exec)throw new TypeError('Qualification store requer SQLite.');
  db.exec(`CREATE TABLE IF NOT EXISTS neural_model_qualifications (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    model_name TEXT NOT NULL DEFAULT '',
    benchmark_suite TEXT NOT NULL DEFAULT '',
    score REAL NOT NULL DEFAULT 0,
    safety_score REAL NOT NULL DEFAULT 0,
    production_eligible INTEGER NOT NULL DEFAULT 0,
    report_json TEXT NOT NULL DEFAULT '{}',
    qualification_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_neural_model_qualifications_provider_created
  ON neural_model_qualifications(provider_id,created_at DESC);`);

  function save({providerId,modelName='',suite='',report,qualification,at=new Date().toISOString()}={}){
    const id=randomUUID(),provider=text(providerId,64,2),model=String(modelName||'').slice(0,160),benchmarkSuite=String(suite||'').slice(0,120);
    db.prepare(`INSERT INTO neural_model_qualifications
      (id,provider_id,model_name,benchmark_suite,score,safety_score,production_eligible,report_json,qualification_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
        id,provider,model,benchmarkSuite,Number(report?.score)||0,Number(report?.categories?.safety?.score)||0,
        qualification?.productionEligible?1:0,json(report),json(qualification),String(at)
      );
    return get(id);
  }

  function rowToObject(row){if(!row)return null;return{
    id:row.id,providerId:row.provider_id,modelName:row.model_name,suite:row.benchmark_suite,
    score:Number(row.score||0),safetyScore:Number(row.safety_score||0),productionEligible:Boolean(row.production_eligible),
    report:parse(row.report_json,{}),qualification:parse(row.qualification_json,{}),createdAt:row.created_at
  };}
  function get(id){return rowToObject(db.prepare('SELECT * FROM neural_model_qualifications WHERE id=?').get(String(id||'')));}
  function latest(providerId){return rowToObject(db.prepare('SELECT * FROM neural_model_qualifications WHERE provider_id=? ORDER BY created_at DESC,id DESC LIMIT 1').get(text(providerId,64,2)));}
  function list({providerId='',limit=20}={}){
    const n=Math.max(1,Math.min(100,Number(limit)||20));
    const rows=providerId?db.prepare('SELECT * FROM neural_model_qualifications WHERE provider_id=? ORDER BY created_at DESC,id DESC LIMIT ?').all(text(providerId,64,2),n):db.prepare('SELECT * FROM neural_model_qualifications ORDER BY created_at DESC,id DESC LIMIT ?').all(n);
    return rows.map(rowToObject);
  }
  return{save,get,latest,list};
}
