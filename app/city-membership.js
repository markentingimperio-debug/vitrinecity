import {memberPage,memberReturn} from './public/vitriny-membership-core.js';
import {randomUUID} from 'node:crypto';
import {newFarm,restoreFarm,farmAction,CROPS,ANIMALS} from './public/vitriny-farm-core.js';
export function setupCityMembership(app,{db,currentUser,requireUser,sameOriginOnly,isAdministrativeUser=()=>false,grantGameReward=()=>0}){
  db.exec(`CREATE TABLE IF NOT EXISTS city_farm_progress(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,state_json TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  app.use((req,res,next)=>{
    if(!['GET','HEAD'].includes(req.method)||!memberPage(req.path))return next();
    res.set('Cache-Control','private,no-store');const user=currentUser(req);
    if(!user)return res.redirect(302,`/entrar-cidade.html?returnTo=${encodeURIComponent(memberReturn(req.originalUrl))}`);
    if(user.account_status!=='active'&&!isAdministrativeUser(user))return res.status(403).type('html').send('<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acesso à cidade</title><body><h1>Conta temporariamente restrita.</h1><p>Entre em contato com o atendimento para continuar.</p><a href="/contato.html">Falar com o atendimento</a></body></html>');
    return next();
  });
  function read(userId){const saved=db.prepare('SELECT state_json FROM city_farm_progress WHERE user_id=?').get(userId);if(saved){try{return restoreFarm(JSON.parse(saved.state_json))||newFarm();}catch{}}return newFarm();}
  app.get('/api/games/farm',requireUser,(req,res)=>res.set('Cache-Control','private,no-store').json({state:read(req.user.id),serverNow:Date.now()}));
  app.post('/api/games/farm/action',sameOriginOnly,requireUser,(req,res)=>{
    const raw=req.body||{},action={type:String(raw.type||''),plot:raw.plot,crop:String(raw.crop||''),animal:String(raw.animal||'')};
    const result=db.transaction(()=>{const before=read(req.user.id),result=farmAction(before,action,Date.now());if(result.changed){
      db.prepare(`INSERT INTO city_farm_progress(user_id,state_json) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json,updated_at=CURRENT_TIMESTAMP`).run(req.user.id,JSON.stringify(result.state));
      const earned=action.type==='harvest'?CROPS[before.plots[action.plot]?.crop]:action.type==='collect'?ANIMALS[action.animal]:null;
      result.rewardPoints=earned?grantGameReward(req.user.id,earned.reward-earned.cost,'farm:'+randomUUID()):0;
      if(result.rewardPoints)result.message+=` +${result.rewardPoints} Vitrine Coins de recompensa.`;
    }return result;})();
    return res.set('Cache-Control','private,no-store').status(result.changed?200:409).json({...result,serverNow:Date.now()});
  });
}
