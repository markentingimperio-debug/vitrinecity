import {createHash,randomUUID} from 'node:crypto';

const DOMAINS=new Set(['growth','ranking','search','content','ads','commerce','operations','code','vision','support','platform']);
const SOURCES=new Set(['manual','lesson','evaluation','approved-knowledge']);
const STATUSES=new Set(['candidate','approved','rejected']);
const SENSITIVE_PATTERNS=[
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:sk-proj-|sk-|ghp_|github_pat_|AKIA)[A-Za-z0-9_\-]{10,}/,
  /\b(?:authorization\s*:\s*bearer|bearer)\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\b(?:senha|password|passwd|api[_ -]?key|secret|token)\s*[:=]\s*\S{4,}/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?<!\d)(?:\+?55[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)?9?\d{4}[\s.-]?\d{4}(?!\d)/,
  /(?<!\d)\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-.\s]?\d{2}(?!\d)/,
  /(?<!\d)(?:\d[ -]*?){13,19}(?!\d)/
];
const SYSTEM_PROMPT='Você é a Vitriny Neural. Responda usando somente políticas e fatos aprovados da Vitrine City. Separe fatos de hipóteses, não invente dados e não execute ações críticas sem autorização humana.';

function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function cleanText(value,{name='texto',min=0,max=4000,optional=false}={}){
  const text=String(value??'').trim();
  if(optional&&!text)return'';
  if(text.length<min||text.length>max||/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text))fail(`${name} inválido ou acima do limite.`);
  if(SENSITIVE_PATTERNS.some(pattern=>pattern.test(text)))fail(`${name} contém credencial ou dado pessoal e não pode entrar no dataset.`);
  return text;
}
function identifier(value,{name='Identificador',min=1,max=160,optional=false}={}){
  const text=String(value??'').trim();
  if(optional&&!text)return'';
  if(text.length<min||text.length>max||!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(text))fail(`${name} inválido.`);
  return text;
}
function stamp(now){return new Date(Number(now())).toISOString();}
function digest(value){return createHash('sha256').update(String(value)).digest('hex');}
function parseRow(row){return row?{
  id:row.id,domain:row.domain,instruction:row.instruction,input:row.input_text,expectedOutput:row.expected_output,
  source:row.source,sourceId:row.source_id,status:row.status,reviewActor:row.review_actor,
  reviewReason:row.review_reason,contentHash:row.content_hash,createdAt:row.created_at,updatedAt:row.updated_at,nodeId:row.node_id
}:null;}
function splitFor(id,validationPercent){return parseInt(digest(id).slice(0,8),16)%100<validationPercent?'validation':'train';}
function trainingRecord(example){
  const user=example.input?`Tarefa (${example.domain}): ${example.instruction}\n\nContexto aprovado:\n${example.input}`:`Tarefa (${example.domain}): ${example.instruction}`;
  return{messages:[
    {role:'system',content:SYSTEM_PROMPT},
    {role:'user',content:user},
    {role:'assistant',content:example.expectedOutput}
  ]};
}

export function createNeuralDatasetBuilder({db,now=Date.now,nodeId='service',pilotMinimumExamples=50,pilotMinimumDomains=4,pilotMinimumValidationExamples=5,validationPercent=20}={}){
  if(!db?.prepare||!db?.exec)throw new TypeError('Dataset Builder requer SQLite.');
  db.exec(`CREATE TABLE IF NOT EXISTS neural_training_examples (
    id TEXT PRIMARY KEY,
    domain TEXT NOT NULL,
    instruction TEXT NOT NULL,
    input_text TEXT NOT NULL DEFAULT '',
    expected_output TEXT NOT NULL,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate','approved','rejected')),
    review_actor TEXT NOT NULL DEFAULT '',
    review_reason TEXT NOT NULL DEFAULT '',
    content_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    node_id TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_neural_training_status ON neural_training_examples(status,domain,updated_at DESC);
  CREATE TABLE IF NOT EXISTS neural_audit (
    id TEXT PRIMARY KEY,kind TEXT NOT NULL,subject_id TEXT NOT NULL DEFAULT '',actor TEXT NOT NULL DEFAULT '',
    details_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL
  );`);

  function audit(kind,subjectId,actor,details,at){
    db.prepare('INSERT INTO neural_audit(id,kind,subject_id,actor,details_json,created_at) VALUES(?,?,?,?,?,?)')
      .run(randomUUID(),kind,subjectId,actor,JSON.stringify(details??{}),at);
  }
  function get(id){return parseRow(db.prepare('SELECT * FROM neural_training_examples WHERE id=?').get(String(id||'')));}
  function createCandidate(input={}){
    const domain=cleanText(input.domain,{name:'Domínio',min:2,max:40});
    if(!DOMAINS.has(domain))fail('Domínio de treinamento inválido.');
    const source=cleanText(input.source||'manual',{name:'Origem',min:2,max:40});
    if(!SOURCES.has(source))fail('Origem de treinamento inválida.');
    const instruction=cleanText(input.instruction,{name:'Instrução',min:10,max:4000});
    const context=cleanText(input.input,{name:'Contexto',max:8000,optional:true});
    const expectedOutput=cleanText(input.expectedOutput,{name:'Resposta esperada',min:2,max:12000});
    const sourceId=identifier(input.sourceId,{name:'Identificador da origem',max:160,optional:true});
    const actor=identifier(input.actor||'admin',{name:'Responsável',min:2,max:120});
    const contentHash=digest(JSON.stringify({domain,instruction,input:context,expectedOutput,source,sourceId}));
    const at=stamp(now),id=input.id?identifier(input.id,{name:'ID',min:8,max:120}):randomUUID();
    const result=db.prepare(`INSERT OR IGNORE INTO neural_training_examples
      (id,domain,instruction,input_text,expected_output,source,source_id,status,content_hash,created_at,updated_at,node_id)
      VALUES(?,?,?,?,?,?,?,'candidate',?,?,?,?)`)
      .run(id,domain,instruction,context,expectedOutput,source,sourceId,contentHash,at,at,nodeId);
    if(!result.changes){
      const existing=parseRow(db.prepare('SELECT * FROM neural_training_examples WHERE content_hash=?').get(contentHash));
      return{...existing,duplicate:true};
    }
    audit('training_example_created',id,actor,{domain,source,sourceId,status:'candidate'},at);
    return{...get(id),duplicate:false};
  }
  function review(id,{status,actor='admin',reason='',confirmed=false}={}){
    const target=String(status||'');
    if(!['approved','rejected'].includes(target))fail('Revisão de treinamento inválida.');
    if(target==='approved'&&confirmed!==true)fail('Aprovação explícita do exemplo é obrigatória.',409);
    const safeActor=identifier(actor,{name:'Responsável',min:2,max:120});
    const safeReason=cleanText(reason||'',{name:'Motivo',max:500,optional:target==='approved'});
    if(target==='rejected'&&!safeReason)fail('Informe o motivo da rejeição.');
    const safeId=identifier(id,{name:'ID',min:8,max:120}),at=stamp(now);
    const result=db.prepare(`UPDATE neural_training_examples SET status=?,review_actor=?,review_reason=?,updated_at=?
      WHERE id=? AND status='candidate'`).run(target,safeActor,safeReason,at,safeId);
    if(!result.changes){
      if(!get(safeId))fail('Exemplo de treinamento não encontrado.',404);
      fail('Somente exemplos candidatos podem ser revisados.',409);
    }
    audit(`training_example_${target}`,safeId,safeActor,{reason:safeReason},at);
    return get(safeId);
  }
  function list({status='candidate',domain='',limit=50}={}){
    if(!STATUSES.has(status))fail('Status de treinamento inválido.');
    const safeDomain=String(domain||'');
    if(safeDomain&&!DOMAINS.has(safeDomain))fail('Domínio de treinamento inválido.');
    const max=Math.max(1,Math.min(200,Number(limit)||50));
    const rows=safeDomain
      ?db.prepare('SELECT * FROM neural_training_examples WHERE status=? AND domain=? ORDER BY updated_at DESC,id DESC LIMIT ?').all(status,safeDomain,max)
      :db.prepare('SELECT * FROM neural_training_examples WHERE status=? ORDER BY updated_at DESC,id DESC LIMIT ?').all(status,max);
    return rows.map(parseRow);
  }
  function exportDataset({split='all',validationPercent=20}={}){
    if(!['all','train','validation'].includes(split))fail('Divisão do dataset inválida.');
    const percent=Math.max(10,Math.min(40,Math.floor(Number(validationPercent)||20)));
    const approved=db.prepare("SELECT * FROM neural_training_examples WHERE status='approved' ORDER BY id").all().map(parseRow);
    const selected=approved.filter(example=>split==='all'||splitFor(example.id,percent)===split);
    const jsonl=selected.map(example=>JSON.stringify(trainingRecord(example))).join('\n')+(selected.length?'\n':'');
    const datasetId=`vitriny-neural-v1-${digest(approved.map(item=>item.contentHash).join(':')).slice(0,16)}`;
    return{datasetId,format:'chat-jsonl',split,validationPercent,totalApproved:approved.length,examples:selected.length,jsonl};
  }
  function status(){
    const counts=Object.fromEntries(db.prepare('SELECT status,COUNT(*) total FROM neural_training_examples GROUP BY status').all().map(row=>[row.status,Number(row.total||0)]));
    const approvedRows=db.prepare("SELECT id,domain FROM neural_training_examples WHERE status='approved'").all();
    const approved=Number(counts.approved||0),minimum=Math.max(1,Math.floor(Number(pilotMinimumExamples)||50));
    const minimumDomains=Math.max(1,Math.min(DOMAINS.size,Math.floor(Number(pilotMinimumDomains)||4)));
    const minimumValidation=Math.max(1,Math.floor(Number(pilotMinimumValidationExamples)||5));
    const percent=Math.max(10,Math.min(40,Math.floor(Number(validationPercent)||20)));
    const domains=new Set(approvedRows.map(row=>row.domain)).size;
    const validationExamples=approvedRows.filter(row=>splitFor(row.id,percent)==='validation').length,trainingExamples=approved-validationExamples;
    const last=db.prepare("SELECT MAX(updated_at) last_at FROM neural_training_examples WHERE status='approved'").get();
    return{version:1,counts:{candidate:Number(counts.candidate||0),approved,rejected:Number(counts.rejected||0)},pilotMinimumExamples:minimum,pilotMinimumDomains:minimumDomains,pilotMinimumValidationExamples:minimumValidation,domainCoverage:domains,trainingExamples,validationExamples,validationPercent:percent,readyForPilot:approved>=minimum&&domains>=minimumDomains&&validationExamples>=minimumValidation&&trainingExamples>0,lastApprovedAt:last?.last_at||null,humanApprovalRequired:true,automaticTraining:false,sensitiveDataBlocked:true};
  }
  return{createCandidate,review,get,list,exportDataset,status};
}

export const neuralDatasetPolicy=Object.freeze({
  version:1,domains:[...DOMAINS],sources:[...SOURCES],humanApprovalRequired:true,automaticTraining:false,sensitiveDataBlocked:true
});
