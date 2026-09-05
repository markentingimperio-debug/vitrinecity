export function recordOperation(db,metric,value=1){
  try{db.prepare(`INSERT INTO platform_operations_daily(day,metric,count,total) VALUES (date('now'),?,1,?)
    ON CONFLICT(day,metric) DO UPDATE SET count=count+1,total=total+excluded.total`).run(metric,value);}catch{}
}
export function setupPlatformOperations({app,db,requireAdmin,sameOriginOnly,publicDir}){
  db.exec(`CREATE TABLE IF NOT EXISTS platform_operations_daily(day TEXT NOT NULL,metric TEXT NOT NULL,count INTEGER NOT NULL,total REAL NOT NULL,PRIMARY KEY(day,metric));`);
  let cleaned='';const windows=new Map();
  app.use((req,res,next)=>{
    const day=new Date().toISOString().slice(0,10);if(day!==cleaned){try{db.prepare("DELETE FROM platform_operations_daily WHERE day<date('now','-30 days')").run();cleaned=day;}catch{}}
    const started=Date.now();res.once('finish',()=>{recordOperation(db,'server_request_ms',Date.now()-started);if(res.statusCode>=500)recordOperation(db,'server_error');});next();
  });
  app.post('/api/platform-performance',sameOriginOnly,(req,res)=>{
    if(req.body?.consent!==true)return res.status(204).end();
    const {metric,value}=req.body;
    if(!['page_load_ms','js_error'].includes(metric)||typeof value!=='number'||!Number.isFinite(value)||value<0||value>60000)return res.status(400).end();
    const now=Date.now();for(const [key,v] of windows)if(v.until<=now)windows.delete(key);
    const entry=windows.get(req.ip)||{until:now+300000,count:0};
    if(entry.count>=30||windows.size>=5000&&!windows.has(req.ip))return res.status(429).end();
    entry.count++;windows.set(req.ip,entry);recordOperation(db,metric,value);res.status(204).end();
  });
  app.get('/admin-saude.html',requireAdmin,(_req,res)=>res.sendFile(publicDir+'/admin-saude.html'));
  app.get('/api/admin/platform-health',requireAdmin,(_req,res)=>{
    res.set('Cache-Control','no-store').json({uptimeSeconds:Math.round(process.uptime()),
      metrics:db.prepare("SELECT metric,SUM(count) count,SUM(total) total FROM platform_operations_daily WHERE day>=date('now','-7 days') GROUP BY metric").all(),
      affiliates:db.prepare("SELECT status,health,COUNT(*) count,SUM(clicks) clicks FROM affiliate_catalog GROUP BY status,health").all(),
      linksToReview:db.prepare("SELECT slug,title,health,checked_at FROM affiliate_catalog WHERE status='published' AND health IN ('broken','review','unchecked') ORDER BY checked_at LIMIT 30").all(),
      indexnow:db.prepare('SELECT COUNT(*) pages,MAX(submitted_at) lastSubmittedAt FROM affiliate_indexnow_state').get()});
  });
}
