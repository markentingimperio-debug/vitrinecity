import {randomUUID} from 'node:crypto';

function dayKey(now){return new Date(Number(now())).toISOString().slice(0,10);}
function text(value,max=180,min=1){const v=String(value??'').trim();if(v.length<min||v.length>max)throw new Error('Ação Neural inválida.');return v;}

export function createNeuralActionBudget({db,now=Date.now,limit=100}={}){
  if(!db?.prepare||!db?.exec)throw new TypeError('Action budget requer SQLite.');
  const dailyLimit=Math.max(0,Math.min(100000,Math.floor(Number(limit)||0)));
  db.exec(`CREATE TABLE IF NOT EXISTS neural_auto_actions (
    id TEXT PRIMARY KEY,
    day_key TEXT NOT NULL,
    action_key TEXT NOT NULL,
    domain TEXT NOT NULL DEFAULT '',
    capability TEXT NOT NULL DEFAULT '',
    risk TEXT NOT NULL DEFAULT 'low',
    status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','committed','released')),
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(day_key,action_key)
  );
  CREATE INDEX IF NOT EXISTS idx_neural_auto_actions_day_status ON neural_auto_actions(day_key,status,created_at);`);

  function usage(){
    const day=dayKey(now);
    const row=db.prepare("SELECT COUNT(*) n FROM neural_auto_actions WHERE day_key=? AND status IN ('reserved','committed')").get(day);
    const used=Number(row?.n||0);
    return{day,limit:dailyLimit,used,remaining:Math.max(0,dailyLimit-used),exhausted:used>=dailyLimit};
  }

  function reserve({actionKey,domain='',capability='',risk='low',details={}}={}){
    const key=text(actionKey,180,3),day=dayKey(now),at=new Date(Number(now())).toISOString();
    return db.transaction(()=>{
      const existing=db.prepare('SELECT id,status FROM neural_auto_actions WHERE day_key=? AND action_key=?').get(day,key);
      if(existing)return{ok:false,reason:'duplicate_action',id:existing.id,status:existing.status,usage:usage()};
      const current=usage();
      if(current.exhausted)return{ok:false,reason:'daily_budget_exhausted',usage:current};
      const id=randomUUID();
      db.prepare(`INSERT INTO neural_auto_actions(id,day_key,action_key,domain,capability,risk,status,details_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?, 'reserved',?,?,?)`).run(id,day,key,String(domain||'').slice(0,80),String(capability||'').slice(0,100),String(risk||'low').slice(0,40),JSON.stringify(details??{}),at,at);
      return{ok:true,id,status:'reserved',usage:usage()};
    }).immediate();
  }

  function transition(id,status){
    if(!['committed','released'].includes(status))throw new Error('Status de ação inválido.');
    const at=new Date(Number(now())).toISOString();
    const result=db.prepare("UPDATE neural_auto_actions SET status=?,updated_at=? WHERE id=? AND status='reserved'").run(status,at,String(id||''));
    return{ok:Boolean(result.changes),status:result.changes?status:null,usage:usage()};
  }
  function commit(id){return transition(id,'committed');}
  function release(id){return transition(id,'released');}
  function recent(limitRows=20){const n=Math.max(1,Math.min(100,Number(limitRows)||20));return db.prepare('SELECT id,day_key,action_key,domain,capability,risk,status,created_at,updated_at FROM neural_auto_actions ORDER BY created_at DESC,id DESC LIMIT ?').all(n);}

  return{reserve,commit,release,usage,recent};
}
