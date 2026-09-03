import { randomBytes } from 'node:crypto';

const token=()=>randomBytes(10).toString('hex');
const BASE_ALGORITHM=Object.freeze({version:1,objective:'lucro_liquido',productStrategy:'estoque_ativo_melhor_margem',channelPolicy:'somente_conectados',messagePolicy:'sem_spam_sem_promessas',mutationRate:0.05});

export function setupSalesAgentEngine({app,db,requireAdmin}){
  db.exec(`CREATE TABLE IF NOT EXISTS sales_agents(
    id INTEGER PRIMARY KEY,parent_id INTEGER REFERENCES sales_agents(id),code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'standard' CHECK(tier IN ('standard','super')),generation INTEGER NOT NULL DEFAULT 1,
    algorithm_version INTEGER NOT NULL DEFAULT 1,algorithm_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired','paused')),
    sales_count INTEGER NOT NULL DEFAULT 0,revenue_cents INTEGER NOT NULL DEFAULT 0,profit_cents INTEGER NOT NULL DEFAULT 0,
    last_sale_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,retired_at TEXT);
  CREATE TABLE IF NOT EXISTS sales_agent_events(id INTEGER PRIMARY KEY,agent_id INTEGER NOT NULL REFERENCES sales_agents(id),order_reference TEXT UNIQUE,
    event_type TEXT NOT NULL,revenue_cents INTEGER NOT NULL DEFAULT 0,profit_cents INTEGER NOT NULL DEFAULT 0,algorithm_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE INDEX IF NOT EXISTS idx_sales_agents_status ON sales_agents(status,tier,id);
  CREATE INDEX IF NOT EXISTS idx_sales_agent_events_agent ON sales_agent_events(agent_id,id);`);
  const columns=db.prepare('PRAGMA table_info(marketplace_orders)').all().map(x=>x.name);
  if(!columns.includes('sales_agent_code'))db.exec("ALTER TABLE marketplace_orders ADD COLUMN sales_agent_code TEXT NOT NULL DEFAULT ''");
  if(!db.prepare('SELECT 1 FROM sales_agents LIMIT 1').get())db.prepare(`INSERT INTO sales_agents(code,name,algorithm_json) VALUES (?,?,?)`).run(token(),'Vendedor Autônomo 01',JSON.stringify(BASE_ALGORITHM));

  function lifecycle(){
    const orders=db.prepare(`SELECT o.reference,o.sales_agent_code,o.products_cents,
      MAX(0,o.platform_percent_cents+o.platform_fixed_cents-o.return_operation_cents) profit_cents
      FROM marketplace_orders o WHERE o.payment_status='approved' AND o.sales_agent_code<>''`).all();
    const record=db.prepare(`INSERT OR IGNORE INTO sales_agent_events(agent_id,order_reference,event_type,revenue_cents,profit_cents,algorithm_json) VALUES (?,?,?,?,?,?)`);
    for(const order of orders){const agent=db.prepare("SELECT * FROM sales_agents WHERE code=?").get(order.sales_agent_code);if(!agent||order.profit_cents<=0)continue;
      const info=record.run(agent.id,order.reference,'paid_profitable_sale',order.products_cents,order.profit_cents,agent.algorithm_json);if(!info.changes)continue;
      db.prepare("UPDATE sales_agents SET sales_count=sales_count+1,revenue_cents=revenue_cents+?,profit_cents=profit_cents+?,last_sale_at=CURRENT_TIMESTAMP WHERE id=?").run(order.products_cents,order.profit_cents,agent.id);
      const active=db.prepare("SELECT COUNT(*) n FROM sales_agents WHERE status='active' AND tier='standard'").get().n;
      if(active<10){const algorithm={...JSON.parse(agent.algorithm_json),version:agent.algorithm_version+1,parentPerformance:{revenueCents:agent.revenue_cents+order.products_cents,profitCents:agent.profit_cents+order.profit_cents}};db.prepare(`INSERT INTO sales_agents(parent_id,code,name,generation,algorithm_version,algorithm_json) VALUES (?,?,?,?,?,?)`).run(agent.id,token(),`Vendedor Autônomo ${String(active+1).padStart(2,'0')}`,agent.generation+1,algorithm.version,JSON.stringify(algorithm));}
    }
    db.prepare("UPDATE sales_agents SET status='retired',retired_at=CURRENT_TIMESTAMP WHERE status='active' AND sales_count=0 AND created_at<=datetime('now','-24 hours')").run();
    const qualified=db.prepare("SELECT COUNT(*) n FROM sales_agents WHERE tier='standard' AND revenue_cents>=1000000").get().n,superCount=db.prepare("SELECT COUNT(*) n FROM sales_agents WHERE tier='super'").get().n;
    if(qualified>=10&&!superCount){const best=db.prepare("SELECT * FROM sales_agents WHERE tier='standard' ORDER BY profit_cents DESC LIMIT 1").get();for(let i=1;i<=10;i++)db.prepare(`INSERT INTO sales_agents(parent_id,code,name,tier,generation,algorithm_version,algorithm_json) VALUES (?,?,?,'super',?,?,?)`).run(best.id,token(),`Super Agente ${String(i).padStart(2,'0')}`,best.generation+1,best.algorithm_version+1,best.algorithm_json);}
  }
  app.get('/api/admin/sales-agents',requireAdmin,(_req,res)=>{lifecycle();const agents=db.prepare(`SELECT a.*,(SELECT COUNT(*) FROM sales_agents c WHERE c.parent_id=a.id) children FROM sales_agents a ORDER BY a.tier DESC,a.id`).all().map(a=>({...a,algorithm:JSON.parse(a.algorithm_json)}));res.json({agents,rules:{standardCap:10,superUnlockRevenueCents:1000000,reserveRateBps:500,inactivityHours:24}})});
  lifecycle();const timer=setInterval(lifecycle,5*60*1000);timer.unref();
}
