import {randomUUID} from 'node:crypto';

export const EXPLORATION_VIEW_MS=10000;
const SESSION_MS=30*60*1000;
const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});
export function explorationDay(time){const parts=Object.fromEntries(dayFormat.formatToParts(new Date(time)).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}`;}
export function explorationLevel(xp){const level=Math.floor(xp/100)+1,names=['Visitante','Explorador','Conhecedor','Especialista','Embaixador'];return {level,name:names[Math.min(level-1,names.length-1)],xp,progress:xp%100,nextLevelXp:level*100};}
export function decorateExplorationPage(html,{storeReference,productId=''}){
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return html.replace('</body>',`<span hidden data-reward-store="${escape(storeReference)}" data-reward-product="${escape(productId)}"></span><script type="module" src="/vitriny-exploration-rewards.js"></script></body>`);
}

export function setupCityExploration({app,db,requireUser,sameOriginOnly,rewards,now=Date.now}){
  db.exec(`CREATE TABLE IF NOT EXISTS city_exploration_visits(
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store_reference TEXT NOT NULL,reward_day TEXT NOT NULL,token TEXT NOT NULL UNIQUE,
    entered_ms INTEGER NOT NULL,product_id INTEGER,viewed_ms INTEGER,claimed_ms INTEGER,
    PRIMARY KEY(user_id,store_reference,reward_day));
    CREATE TABLE IF NOT EXISTS city_exploration_checkins(
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reward_day TEXT NOT NULL,created_ms INTEGER NOT NULL,PRIMARY KEY(user_id,reward_day));`);
  const eligibleStore=reference=>db.prepare(`SELECT s.order_reference,s.business_name,
    EXISTS(SELECT 1 FROM store_products p WHERE p.store_reference=s.order_reference AND p.active=1 AND p.marketplace_enabled=1 AND p.stock_quantity>0 AND p.price_cents>0) eligible
    FROM store_profiles s WHERE s.order_reference=? AND s.review_status='published'`).get(reference);
  const eligibleProduct=(id,reference)=>db.prepare(`SELECT p.id FROM store_products p JOIN store_profiles s ON s.order_reference=p.store_reference
    WHERE p.id=? AND p.store_reference=? AND p.active=1 AND p.marketplace_enabled=1 AND p.stock_quantity>0 AND p.price_cents>0 AND s.review_status='published'`).get(id,reference);
  function summary(id){
    const day=explorationDay(now()),visits=db.prepare('SELECT store_reference,claimed_ms FROM city_exploration_visits WHERE user_id=? AND claimed_ms IS NOT NULL ORDER BY claimed_ms DESC').all(id);
    const days=db.prepare('SELECT reward_day FROM city_exploration_checkins WHERE user_id=? ORDER BY reward_day DESC').all(id).map(r=>r.reward_day);
    let cursor=Date.parse(day+'T12:00:00Z'),streak=0;if(days[0]!==day)cursor-=86400000;
    const checkins=new Set(days);while(checkins.has(explorationDay(cursor))){streak++;cursor-=86400000;}
    return {...explorationLevel(visits.length*10+days.length*5),streak,checkedIn:checkins.has(day),totalVisits:visits.length,
      visitedToday:visits.filter(v=>explorationDay(v.claimed_ms)===day).map(v=>v.store_reference),day,timeZone:'America/Sao_Paulo',balance:rewards.available(id).points,
      rules:{coinsPerStore:1,viewSeconds:EXPLORATION_VIEW_MS/1000,visitXp:10,checkinXp:5,validityDays:60},enabled:Boolean(rewards.settings().enabled)};
  }
  const error=(message,status=409,code='invalid_visit')=>Object.assign(new Error(message),{status,code});
  function session(req){
    const token=String(req.body?.token||'');if(!/^[a-f0-9-]{36}$/.test(token))throw error('Entre na loja para iniciar sua visita.');
    const row=db.prepare('SELECT * FROM city_exploration_visits WHERE token=? AND user_id=?').get(token,req.user.id);
    if(!row||row.reward_day!==explorationDay(now()))throw error('Começou um novo dia. Entre na loja para iniciar outra visita.',409,'expired');
    if(!row.claimed_ms&&now()-row.entered_ms>SESSION_MS)throw error('Sua visita expirou. Volte à loja para começar novamente.',409,'expired');
    return row;
  }
  const route=handler=>(req,res)=>{res.set('Cache-Control','private,no-store');try{return res.json(handler(req));}catch(e){if(e.status)return res.status(e.status).json({error:e.message,code:e.code});throw e;}};
  const base='/api/rewards/exploration';
  app.get(base,requireUser,route(req=>summary(req.user.id)));
  app.post(base+'/check-in',sameOriginOnly,requireUser,route(req=>db.transaction(()=>{
    const result=db.prepare('INSERT OR IGNORE INTO city_exploration_checkins(user_id,reward_day,created_ms) VALUES(?,?,?)').run(req.user.id,explorationDay(now()),now());
    return {...summary(req.user.id),checkedInNow:Boolean(result.changes)};
  })()));
  app.post(base+'/start',sameOriginOnly,requireUser,route(req=>db.transaction(()=>{
    const reference=String(req.body?.storeReference||'').trim();if(!reference||reference.length>120)throw error('Loja inválida.',400);
    const store=eligibleStore(reference);if(!store)throw error('Esta loja não está disponível.',404);
    if(!store.eligible)return {eligible:false,message:'Esta loja ainda não tem produtos elegíveis para a recompensa.'};
    const day=explorationDay(now());let row=db.prepare('SELECT * FROM city_exploration_visits WHERE user_id=? AND store_reference=? AND reward_day=?').get(req.user.id,reference,day);
    if(!row){db.prepare('INSERT INTO city_exploration_visits(user_id,store_reference,reward_day,token,entered_ms) VALUES(?,?,?,?,?)').run(req.user.id,reference,day,randomUUID(),now());}
    else if(!row.claimed_ms&&now()-row.entered_ms>SESSION_MS){db.prepare('UPDATE city_exploration_visits SET token=?,entered_ms=?,product_id=NULL,viewed_ms=NULL WHERE user_id=? AND store_reference=? AND reward_day=?').run(randomUUID(),now(),req.user.id,reference,day);}
    row=db.prepare('SELECT * FROM city_exploration_visits WHERE user_id=? AND store_reference=? AND reward_day=?').get(req.user.id,reference,day);
    return {eligible:true,token:row.token,day,store:store.business_name,alreadyClaimed:row.claimed_ms!==null,viewSeconds:EXPLORATION_VIEW_MS/1000};
  })()));
  app.post(base+'/view',sameOriginOnly,requireUser,route(req=>db.transaction(()=>{
    const row=session(req);if(row.claimed_ms!==null)return {alreadyClaimed:true,...summary(req.user.id)};
    const id=Number(req.body?.productId);if(!Number.isSafeInteger(id)||!eligibleProduct(id,row.store_reference))throw error('Abra um produto disponível desta mesma loja.',400,'product_mismatch');
    if(row.product_id!==id||row.viewed_ms===null)db.prepare('UPDATE city_exploration_visits SET product_id=?,viewed_ms=? WHERE token=?').run(id,now(),row.token);
    return {viewSeconds:EXPLORATION_VIEW_MS/1000,productId:id};
  })()));
  app.post(base+'/complete',sameOriginOnly,requireUser,route(req=>db.transaction(()=>{
    const row=session(req);if(row.claimed_ms!==null)return {awarded:false,alreadyClaimed:true,...summary(req.user.id)};
    const id=Number(req.body?.productId);
    if(row.product_id!==id||row.viewed_ms===null||!eligibleProduct(id,row.store_reference))throw error('Entre na loja e abra um produto para conquistar sua moeda.',409,'product_required');
    if(now()-row.viewed_ms<EXPLORATION_VIEW_MS)throw error('Continue conhecendo o produto para liberar sua moeda.',409,'view_incomplete');
    if(!rewards.settings().enabled)throw error('As recompensas estão temporariamente pausadas.',409,'paused');
    const granted=rewards.grantGame(req.user.id,1,`exploration:${req.user.id}:${row.store_reference}:${row.reward_day}`);
    if(!granted)throw error('Você atingiu o limite diário de recompensas. Volte amanhã.',409,'daily_limit');
    db.prepare('UPDATE city_exploration_visits SET claimed_ms=? WHERE token=? AND claimed_ms IS NULL').run(now(),row.token);
    return {awarded:true,coins:1,...summary(req.user.id)};
  })()));
  return {summary,exportUser:id=>({visits:db.prepare('SELECT store_reference,reward_day,product_id,entered_ms,viewed_ms,claimed_ms FROM city_exploration_visits WHERE user_id=?').all(id),checkins:db.prepare('SELECT reward_day,created_ms FROM city_exploration_checkins WHERE user_id=?').all(id)})};
}
