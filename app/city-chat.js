import {randomUUID} from 'node:crypto';

// Literal phrases, never administrator-provided regular expressions.
const baseline = ['filho da puta','filha da puta','vai tomar no cu','vai se foder','vai se fuder','porra','caralho','puta que pariu','fdp','vtnc','nazismo','heil hitler','sieg heil','pornografia','porno','pornhub','xvideos','nudes','sexo com crianca','pedofilia','vendo drogas','compro drogas','vou te matar','morte aos negros','negro imundo','preto imundo','raca inferior'];
export function normalizeChat(value){return String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[013457@$]/g,c=>({'0':'o','1':'i','3':'e','4':'a','5':'s','7':'t','@':'a','$':'s'}[c])).replace(/(.)\1{2,}/g,'$1$1').replace(/[^a-z0-9]+/g,' ').trim();}
export function chatViolation(value,extra=[]){
  const raw=String(value||'');
  if(!raw.trim()||[...raw].length>400)return 'Escreva entre 1 e 400 caracteres.';
  if(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f<>]/u.test(raw))return 'Use apenas texto, sem marcações ou caracteres ocultos.';
  if(/(?:https?:|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|br|xyz)\b)/i.test(raw))return 'Links não são permitidos nas salas.';
  const normalized=' '+normalizeChat(raw)+' ';
  // Detect separated letters such as p.o.r.r.a without substring-blocking ordinary words.
  const joined=' '+normalizeChat(raw.replace(/\b(?:[a-zA-Z0-9@][\s._*-]+){2,}[a-zA-Z0-9@]\b/g,m=>m.replace(/[\s._*-]/g,'')))+' ';
  if([...baseline,...extra].some(phrase=>{const term=normalizeChat(phrase);return term&&(normalized.includes(' '+term+' ')||joined.includes(' '+term+' '));}))return 'Mensagem bloqueada pelas regras de convivência. Reformule com respeito.';
  return '';
}

export function setupCityChat({app,db,requireUser,requireAdmin,sameOriginOnly,publicDir,now=Date.now}){
  db.exec(`CREATE TABLE IF NOT EXISTS city_chat_rooms(slug TEXT PRIMARY KEY,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS city_chat_messages(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,room TEXT NOT NULL REFERENCES city_chat_rooms(slug),body TEXT NOT NULL,created_ms INTEGER NOT NULL,hidden INTEGER NOT NULL DEFAULT 0,client_key TEXT NOT NULL,UNIQUE(user_id,client_key));
    CREATE INDEX IF NOT EXISTS idx_city_chat_room ON city_chat_messages(room,id DESC);
    CREATE TABLE IF NOT EXISTS city_chat_mutes(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,until_ms INTEGER NOT NULL,reason TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS city_chat_blocks(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(user_id,blocked_id));
    CREATE TABLE IF NOT EXISTS city_chat_reports(message_id INTEGER NOT NULL REFERENCES city_chat_messages(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,reason TEXT NOT NULL,created_ms INTEGER NOT NULL,reviewed INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(message_id,user_id));
    CREATE TABLE IF NOT EXISTS city_chat_rules(phrase TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS city_chat_audit(id INTEGER PRIMARY KEY,admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,action TEXT NOT NULL,target TEXT NOT NULL,reason TEXT NOT NULL,created_ms INTEGER NOT NULL);`);
  const seeds=[['vitrine-city','Praça Vitrine City'],['silvania','Silvânia'],['vianopolis','Vianópolis'],['anapolis','Anápolis'],['goiania','Goiânia'],['musica','Pulse Arena · música'],['cinema','Cinema · conversa'],['jogos','Jogos e fazenda']];
  for(const [slug,name] of seeds)db.prepare('INSERT OR IGNORE INTO city_chat_rooms(slug,name) VALUES (?,?)').run(slug,name);
  const attempts=new Map();let cleanupAt=0;
  function limit(key,max,window){const time=now();let entry=attempts.get(key);if(!entry||entry.until<=time){entry={n:0,until:time+window};if(attempts.size>=10000){for(const [k,v] of attempts)if(v.until<=time)attempts.delete(k);if(attempts.size>=10000)return false;}attempts.set(key,entry);}return ++entry.n<=max;}
  function cleanup(){if(now()<cleanupAt)return;cleanupAt=now()+3600000;db.prepare('DELETE FROM city_chat_messages WHERE created_ms<?').run(now()-30*86400000);db.prepare('DELETE FROM city_chat_audit WHERE created_ms<?').run(now()-180*86400000);}
  const rules=()=>db.prepare('SELECT phrase FROM city_chat_rules').all().map(r=>r.phrase);
  const muted=id=>db.prepare('SELECT until_ms,reason FROM city_chat_mutes WHERE user_id=? AND until_ms>?').get(id,now())||null;
  const room=slug=>db.prepare('SELECT * FROM city_chat_rooms WHERE slug=? AND active=1').get(String(slug||''));
  const audit=(id,action,target,reason)=>db.prepare('INSERT INTO city_chat_audit(admin_id,action,target,reason,created_ms) VALUES(?,?,?,?,?)').run(id,action,String(target),reason,now());
  const alias=(name,id)=>{const first=String(name||'').trim().split(/\s+/)[0].slice(0,30);return first&&!chatViolation(first,rules())?first:'Visitante '+id;};
  app.get('/api/city-chat/rooms',requireUser,(req,res)=>res.set('Cache-Control','private,no-store').json({rooms:db.prepare('SELECT slug,name FROM city_chat_rooms WHERE active=1 ORDER BY name').all(),me:req.user.id,mute:muted(req.user.id),retentionDays:30}));
  app.get('/api/city-chat/rooms/:room/messages',requireUser,(req,res)=>{
    if(!room(req.params.room))return res.sendStatus(404);if(!limit('read:'+req.user.id,40,60000))return res.status(429).json({error:'Aguarde alguns segundos.'});cleanup();
    const rows=db.prepare(`SELECT m.id,m.user_id,m.body,m.created_ms,u.name FROM city_chat_messages m JOIN users u ON u.id=m.user_id WHERE m.room=? AND m.hidden=0 AND u.account_status='active' AND NOT EXISTS(SELECT 1 FROM city_chat_blocks b WHERE b.user_id=? AND b.blocked_id=m.user_id) ORDER BY m.id DESC LIMIT 60`).all(req.params.room,req.user.id);
    return res.set('Cache-Control','private,no-store').json({messages:rows.reverse().map(m=>({id:m.id,userId:m.user_id,name:alias(m.name,m.user_id),body:m.body,createdAt:m.created_ms})),mute:muted(req.user.id)});
  });
  app.post('/api/city-chat/rooms/:room/messages',requireUser,sameOriginOnly,(req,res)=>{
    if(!room(req.params.room))return res.sendStatus(404);
    if(muted(req.user.id))return res.status(403).json({error:'Seu envio está temporariamente silenciado.',mute:muted(req.user.id)});
    const body=typeof req.body?.body==='string'?req.body.body.trim():'',key=String(req.body?.key||'');
    if(!/^[a-zA-Z0-9-]{12,80}$/.test(key))return res.status(400).json({error:'Identificação do envio inválida.'});
    const prior=db.prepare('SELECT id,body,room FROM city_chat_messages WHERE user_id=? AND client_key=?').get(req.user.id,key);
    if(prior)return prior.body===body&&prior.room===req.params.room?res.json({ok:true,id:prior.id,replayed:true}):res.status(409).json({error:'Envio já utilizado.'});
    if(!limit('send:'+req.user.id,12,60000)||!limit('slow:'+req.user.id,1,3000))return res.status(429).json({error:'Modo lento: aguarde 3 segundos entre mensagens (até 12 por minuto).'});
    const violation=chatViolation(body,rules());
    if(violation){if(!limit('reject:'+req.user.id,2,600000)){db.prepare('INSERT INTO city_chat_mutes(user_id,until_ms,reason) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET until_ms=MAX(until_ms,excluded.until_ms),reason=excluded.reason').run(req.user.id,now()+600000,'Bloqueios repetidos pelo filtro');audit(null,'automatic_mute',req.user.id,'Bloqueios repetidos pelo filtro');}return res.status(422).json({error:violation});}
    const duplicate=db.prepare('SELECT 1 FROM city_chat_messages WHERE user_id=? AND body=? AND created_ms>?').get(req.user.id,body,now()-60000);
    if(duplicate)return res.status(409).json({error:'Evite repetir a mesma mensagem.'});
    const insert=db.prepare('INSERT INTO city_chat_messages(user_id,room,body,created_ms,client_key) VALUES(?,?,?,?,?)').run(req.user.id,req.params.room,body,now(),key);
    return res.status(201).json({ok:true,id:Number(insert.lastInsertRowid)});
  });
  app.delete('/api/city-chat/messages/:id',requireUser,sameOriginOnly,(req,res)=>{const result=db.prepare('UPDATE city_chat_messages SET hidden=1 WHERE id=? AND user_id=?').run(Number(req.params.id)||0,req.user.id);return res.sendStatus(result.changes?204:404);});
  app.post('/api/city-chat/messages/:id/report',requireUser,sameOriginOnly,(req,res)=>{
    if(!limit('report:'+req.user.id,10,600000))return res.sendStatus(429);
    const message=db.prepare('SELECT * FROM city_chat_messages WHERE id=? AND hidden=0').get(Number(req.params.id)||0),reason=String(req.body?.reason||'').trim();
    if(!message||message.user_id===req.user.id)return res.sendStatus(404);
    if(!['assedio','odio','sexual','golpe','outro'].includes(reason))return res.status(400).json({error:'Escolha o motivo da denúncia.'});
    db.transaction(()=>{db.prepare('INSERT OR IGNORE INTO city_chat_reports(message_id,user_id,reason,created_ms) VALUES(?,?,?,?)').run(message.id,req.user.id,reason,now());const count=db.prepare('SELECT COUNT(*) n FROM city_chat_reports WHERE message_id=? AND reviewed=0').get(message.id).n;if(count>=3)db.prepare('UPDATE city_chat_messages SET hidden=1 WHERE id=?').run(message.id);})();return res.json({ok:true});
  });
  app.get('/api/city-chat/blocks',requireUser,(req,res)=>res.set('Cache-Control','private,no-store').json({blocks:db.prepare('SELECT b.blocked_id id,u.name FROM city_chat_blocks b JOIN users u ON u.id=b.blocked_id WHERE b.user_id=? LIMIT 100').all(req.user.id).map(b=>({id:b.id,name:alias(b.name,b.id)}))}));
  app.put('/api/city-chat/blocks/:id',requireUser,sameOriginOnly,(req,res)=>{
    const target=Number(req.params.id);if(target===req.user.id||!Number.isSafeInteger(target)||!db.prepare('SELECT 1 FROM users WHERE id=?').get(target))return res.sendStatus(404);
    if(req.body?.blocked===false)db.prepare('DELETE FROM city_chat_blocks WHERE user_id=? AND blocked_id=?').run(req.user.id,target);
    else{if(db.prepare('SELECT COUNT(*) n FROM city_chat_blocks WHERE user_id=?').get(req.user.id).n>=100)return res.status(409).json({error:'Limite de 100 silenciamentos pessoais.'});db.prepare('INSERT OR IGNORE INTO city_chat_blocks(user_id,blocked_id) VALUES(?,?)').run(req.user.id,target);}return res.json({ok:true});
  });
  app.get('/admin-chat-cidade.html',requireAdmin,(_req,res)=>res.sendFile(publicDir+'/admin-chat-cidade.html'));
  app.get('/api/admin/city-chat',requireAdmin,(_req,res)=>res.set('Cache-Control','private,no-store').json({rooms:db.prepare('SELECT * FROM city_chat_rooms ORDER BY name').all(),rules:rules(),mutes:db.prepare('SELECT user_id,until_ms,reason FROM city_chat_mutes WHERE until_ms>? LIMIT 100').all(now()),messages:db.prepare(`SELECT m.*,u.name,(SELECT COUNT(*) FROM city_chat_reports r WHERE r.message_id=m.id AND reviewed=0) reports FROM city_chat_messages m JOIN users u ON u.id=m.user_id ORDER BY reports DESC,m.id DESC LIMIT 100`).all(),audit:db.prepare('SELECT * FROM city_chat_audit ORDER BY id DESC LIMIT 50').all()}));
  app.post('/api/admin/city-chat',requireAdmin,sameOriginOnly,(req,res)=>{
    const b=req.body||{},action=String(b.action||''),reason=String(b.reason||'').trim().slice(0,300),target=String(b.target||'').slice(0,120);if(reason.length<5)return res.status(400).json({error:'Registre o motivo (mínimo 5 caracteres).'});
    let error='';db.transaction(()=>{
      if(['hide','restore'].includes(action)){const changed=db.prepare('UPDATE city_chat_messages SET hidden=? WHERE id=?').run(action==='hide'?1:0,Number(target)||0);if(!changed.changes){error='Mensagem não encontrada.';return;}db.prepare('UPDATE city_chat_reports SET reviewed=1 WHERE message_id=?').run(Number(target));}
      else if(['mute','unmute'].includes(action)){const user=Number(target);if(!db.prepare('SELECT 1 FROM users WHERE id=?').get(user||0)){error='Pessoa não encontrada.';return;}if(action==='unmute')db.prepare('DELETE FROM city_chat_mutes WHERE user_id=?').run(user);else db.prepare('INSERT INTO city_chat_mutes(user_id,until_ms,reason) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET until_ms=excluded.until_ms,reason=excluded.reason').run(user,now()+Math.min(30,Math.max(1,Number(b.days)||1))*86400000,reason);}
      else if(['add_rule','remove_rule'].includes(action)){const phrase=normalizeChat(target);if(phrase.length<3){error='Use uma frase ou palavra com 3 a 120 caracteres.';return;}if(action==='remove_rule')db.prepare('DELETE FROM city_chat_rules WHERE phrase=?').run(phrase);else if(rules().length<500)db.prepare('INSERT OR IGNORE INTO city_chat_rules(phrase) VALUES(?)').run(phrase);else{error='Limite de 500 expressões.';return;}}
      else if(action==='room'){const slug=target||randomUUID(),name=String(b.name||'').trim().slice(0,60);if(!/^[a-z0-9-]{1,60}$/.test(slug)||!name){error='Nome e identificador da sala inválidos.';return;}if(!db.prepare('SELECT 1 FROM city_chat_rooms WHERE slug=?').get(slug)&&db.prepare('SELECT COUNT(*) n FROM city_chat_rooms').get().n>=30){error='Limite de 30 salas.';return;}db.prepare('INSERT INTO city_chat_rooms(slug,name,active) VALUES(?,?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name,active=excluded.active').run(slug,name,b.active===false?0:1);}
      else{error='Ação inválida.';return;}audit(req.user.id,action,target,reason);
    })();return error?res.status(400).json({error}):res.json({ok:true});
  });
  return {exportUser:id=>({messages:db.prepare('SELECT room,body,created_ms,hidden FROM city_chat_messages WHERE user_id=? ORDER BY id DESC LIMIT 10000').all(id),blocks:db.prepare('SELECT blocked_id FROM city_chat_blocks WHERE user_id=?').all(id)})};
}
