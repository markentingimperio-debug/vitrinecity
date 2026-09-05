// Narrow protections compatible with existing inline scripts, maps and payment providers.
// A script-src policy requires a separate nonce migration; this is not a complete XSS defence.
export function setupProductionHardening(app, {now=Date.now}={}) {
  const windows=new Map();
  app.use((req,res,next)=>{
    res.setHeader('Content-Security-Policy',"base-uri 'self'; object-src 'none'; frame-ancestors 'self'");
    if(req.method!=='POST'||!/^\/api\/store-portal\/[^/]+\/mfa\/(verify|confirm)$/.test(req.path))return next();
    const time=now(),duration=300000;
    for(const [key,value] of windows)if(value.expires<=time)windows.delete(key);
    const keys=[['ip:'+req.ip,30],['store:'+req.ip+':'+req.path.split('/')[3],8]];
    for(const [key,max] of keys){const value=windows.get(key);if(value&&value.count>=max){
      res.setHeader('Retry-After',String(Math.max(1,Math.ceil((value.expires-time)/1000))));
      return res.status(429).json({error:'Muitas tentativas de autenticação. Aguarde alguns minutos e tente novamente.'});
    }}
    if(windows.size>10000)return res.status(429).set('Retry-After','60').json({error:'Autenticação temporariamente ocupada. Tente novamente em instantes.'});
    for(const [key] of keys){const value=windows.get(key)||{count:0,expires:time+duration};value.count++;windows.set(key,value);}
    res.setHeader('Cache-Control','no-store');return next();
  });
}
