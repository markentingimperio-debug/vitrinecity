import {randomUUID} from 'node:crypto';
import {isIP} from 'node:net';

const API='/api/admin/live-avatar',PROVIDER='https://api.liveavatar.com';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const keyValid=value=>typeof value==='string'&&value.length>=16&&value.length<=2048&&!/[^\x21-\x7e]/.test(value);
const fail=(code,status=409)=>Object.assign(Error(code),{code,status});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const errors=new Set(['unauthorized','not_found','unavailable','invalid_response','configuration_changed','encryption_unavailable']);
const errorState=error=>errors.has(error?.code)?error.code:'unavailable';
function secureOrigin(siteUrl){try{const u=new URL(siteUrl),host=u.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'');return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&host.includes('.')&&!isIP(host)&&host!=='localhost'&&!host.endsWith('.localhost')&&!host.endsWith('.local');}catch{return false;}}

// Private setup only: no session/token/embed endpoints, uploads, transcript reads,
// SDK injection or automatic provider requests. Opening the panel is entirely local.
export function createLiveAvatarAdmin({db,encrypt,decrypt,siteUrl,fetchImpl=fetch,now=Date.now}){
  if(!db||typeof encrypt!=='function'||typeof decrypt!=='function')throw fail('configuration_invalid');
  const enabled=secureOrigin(siteUrl);
  db.exec(`CREATE TABLE IF NOT EXISTS live_avatar_admin_settings (
    id INTEGER PRIMARY KEY CHECK(id=1),key_encrypted TEXT NOT NULL DEFAULT '',avatar_id TEXT NOT NULL DEFAULT '',context_id TEXT NOT NULL DEFAULT '',voice_id TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 0,verification_json TEXT,verified_at INTEGER NOT NULL DEFAULT 0,last_attempt_at INTEGER NOT NULL DEFAULT 0,
    claim_owner TEXT NOT NULL DEFAULT '',claim_until INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO live_avatar_admin_settings(id) VALUES(1);`);
  const read=()=>db.prepare('SELECT * FROM live_avatar_admin_settings WHERE id=1').get();
  const requireEnabled=()=>{if(!enabled)throw fail('secure_origin_required');};
  function status(){
    const row=read();let saved;try{saved=JSON.parse(row.verification_json);}catch{}
    const current=object(saved)&&saved.revision===row.revision&&row.verified_at>0;
    const stale=current&&now()-row.verified_at>86400000;
    const checks=current?saved.checks:null;
    return {enabled,configured:enabled&&Boolean(row.key_encrypted),hasApiKey:Boolean(row.key_encrypted),revision:row.revision,
      avatarId:row.avatar_id,contextId:row.context_id,voiceId:row.voice_id,verifiedAt:current?new Date(row.verified_at).toISOString():null,
      verificationDue:!current||stale,checking:row.claim_until>now(),retryAt:row.last_attempt_at&&row.last_attempt_at+30000>now()?new Date(row.last_attempt_at+30000).toISOString():null,
      apiConnection:!enabled?'disabled':!row.key_encrypted?'not_configured':stale?'verification_due':checks?.api?.state||'not_verified',
      checks:checks||{api:{state:'not_verified'},avatar:{state:row.avatar_id?'not_verified':'not_configured'},context:{state:row.context_id?'not_verified':'not_configured'},voice:{state:row.voice_id?'not_verified':'not_configured'}},
      configurationVerified:Boolean(enabled&&!stale&&checks?.api?.state==='verified'&&['avatar','context','voice'].every(name=>checks?.[name]?.state==='verified')&&checks.voice.portugueseConfirmed),
      liveEnabled:false,transmission:'not_tested',sessionStarted:false,
      detail:!enabled?'A configuração está desativada neste ambiente. Use a administração no endereço HTTPS da plataforma.':'Esta página verifica a conexão e os dados do avatar. A apresentação ao vivo permanece desativada; nenhuma sessão é iniciada.'};
  }
  function configure(input){
    requireEnabled();
    if(!object(input)||Object.keys(input).some(name=>!['revision','apiKey','avatarId','contextId','voiceId'].includes(name))||!Number.isSafeInteger(input.revision)||input.revision<0)throw fail('configuration_invalid',400);
    const row=read();if(row.revision!==input.revision)throw fail('configuration_changed');
    for(const name of ['avatarId','contextId','voiceId'])if(input[name]!==undefined&&(typeof input[name]!=='string'||(input[name]!==''&&!uuid(input[name]))))throw fail('configuration_invalid',400);
    const secret=input.apiKey===undefined?'':typeof input.apiKey==='string'?input.apiKey.trim():null;
    if(secret===null||(secret&&!keyValid(secret)))throw fail('configuration_invalid',400);
    let protectedKey=row.key_encrypted;
    if(secret){try{protectedKey=encrypt(secret);}catch{throw fail('encryption_unavailable');}if(typeof protectedKey!=='string'||!protectedKey||protectedKey===secret)throw fail('encryption_unavailable');}
    const values=['avatarId','contextId','voiceId'].map((name,index)=>(input[name]??[row.avatar_id,row.context_id,row.voice_id][index]).toLowerCase());
    if(protectedKey===row.key_encrypted&&values.every((value,index)=>value===[row.avatar_id,row.context_id,row.voice_id][index]))return status();
    const changed=db.prepare("UPDATE live_avatar_admin_settings SET key_encrypted=?,avatar_id=?,context_id=?,voice_id=?,revision=revision+1,verification_json=NULL,verified_at=0,claim_owner='',claim_until=0 WHERE id=1 AND revision=?").run(protectedKey,...values,row.revision);
    if(changed.changes!==1)throw fail('configuration_changed');return status();
  }
  async function verify(){
    requireEnabled();const row=read();if(!row.key_encrypted)throw fail('key_missing');
    if(row.claim_until>now()||(row.last_attempt_at&&now()<row.last_attempt_at+30000))throw fail('verification_throttled',429);
    const owner=randomUUID(),at=now();
    if(!db.prepare("UPDATE live_avatar_admin_settings SET claim_owner=?,claim_until=?,last_attempt_at=? WHERE id=1 AND revision=? AND claim_until<=? AND (last_attempt_at=0 OR last_attempt_at<=?)").run(owner,at+120000,at,row.revision,at,at-30000).changes)throw fail('verification_throttled',429);
    const current=()=>{const latest=read();return latest.revision===row.revision&&latest.claim_owner===owner&&latest.claim_until>now();};
    const checks={api:{state:'not_verified'},avatar:{state:row.avatar_id?'not_verified':'not_configured'},context:{state:row.context_id?'not_verified':'not_configured'},voice:{state:row.voice_id?'not_verified':'not_configured'}};
    try{
      let key;try{key=decrypt(row.key_encrypted);}catch{throw fail('encryption_unavailable');}if(!keyValid(key))throw fail('encryption_unavailable');
      async function get(pathname){
        if(!current())throw fail('configuration_changed');
        let response,data;
        try{response=await fetchImpl(PROVIDER+pathname,{method:'GET',headers:{'X-API-KEY':key,Accept:'application/json'},redirect:'error',credentials:'omit',signal:AbortSignal.timeout(15000)});}catch{throw fail('unavailable');}
        if(!current())throw fail('configuration_changed');
        if(response.status===401||response.status===403)throw fail('unauthorized');if(response.status===404)throw fail('not_found');
        if(response.status!==200)throw fail('unavailable');
        try{data=await response.json();}catch{throw fail('invalid_response');}
        // Both success codes occur in the provider's official OpenAPI/examples.
        if(!object(data)||![100,1000].includes(data.code)||!object(data.data))throw fail('invalid_response');return data.data;
      }
      const credits=await get('/v1/users/credits');
      if(typeof credits.credits_left!=='string'||credits.credits_left.length>32||! /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(credits.credits_left)||!Number.isFinite(Number(credits.credits_left)))throw fail('invalid_response');
      checks.api={state:'verified',creditsRemaining:credits.credits_left};
      for(const [name,id,route] of [['avatar',row.avatar_id,'avatars'],['context',row.context_id,'contexts'],['voice',row.voice_id,'voices']]){
        if(!id)continue;
        try{
          const data=await get('/v1/'+route+'/'+id);
          if(!uuid(data.id)||data.id.toLowerCase()!==id)throw fail('invalid_response');
          if(name==='avatar'){
            if(!['ACTIVE','INIT','DEPLOYING','FAILED'].includes(data.status)||typeof data.is_expired!=='boolean')throw fail('invalid_response');
            checks.avatar={state:data.is_expired?'expired':data.status==='ACTIVE'?'verified':data.status==='FAILED'?'failed':'preparing',providerStatus:data.status};
          }else if(name==='context'){
            if(!Array.isArray(data.required_dynamic_variables)||data.required_dynamic_variables.some(item=>typeof item!=='string'))throw fail('invalid_response');
            checks.context={state:data.required_dynamic_variables.length?'variables_required':'verified',requiredVariablesCount:data.required_dynamic_variables.length};
          }else{
            if(typeof data.language!=='string'||!data.language.trim()||data.language.length>100)throw fail('invalid_response');
            checks.voice={state:'verified',portugueseConfirmed:/^(pt(?:[-_]br)?|portugu[eê]s(?: brasileiro)?|portuguese(?: \(brazil\))?)$/i.test(data.language.trim())};
          }
        }catch(error){if(error.code==='configuration_changed')throw error;checks[name]={state:errorState(error)};if(error.code==='unauthorized'){checks.api={state:'unauthorized'};break;}}
      }
    }catch(error){if(error.code==='configuration_changed')throw error;checks.api={state:errorState(error)};}
    finally{
      // A delayed response cannot overwrite a newer admin configuration.
      if(current())db.prepare("UPDATE live_avatar_admin_settings SET verification_json=?,verified_at=?,claim_owner='',claim_until=0 WHERE id=1 AND revision=? AND claim_owner=?").run(JSON.stringify({revision:row.revision,checks}),now(),row.revision,owner);
    }
    if(read().revision!==row.revision)throw fail('configuration_changed');return status();
  }
  return {status,configure,verify};
}

export function setupLiveAvatarAdmin({app,requireAdmin,sameOriginOnly,...dependencies}){
  const service=createLiveAvatarAdmin(dependencies);
  const route=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{return res.json(await fn(req));}catch(error){return res.status(error.status||409).json({error:error.code==='verification_throttled'?'Aguarde alguns segundos antes de verificar novamente.':error.code==='configuration_changed'?'A configuração mudou. Atualize a página e confira os dados.':error.code==='configuration_invalid'?'Confira os identificadores e a chave informados.':'Não foi possível concluir esta etapa. Confira a configuração protegida e tente novamente.',code:errors.has(error.code)||['configuration_invalid','verification_throttled','secure_origin_required','key_missing'].includes(error.code)?error.code:'live_avatar_setup_failed'});}};
  const jsonOnly=(req,res,next)=>req.is('application/json')?next():res.status(415).json({error:'Use o formulário da administração.'});
  app.get(API+'/status',requireAdmin,route(()=>service.status()));
  app.post(API+'/settings',requireAdmin,sameOriginOnly,jsonOnly,route(req=>service.configure(req.body)));
  app.post(API+'/verify',requireAdmin,sameOriginOnly,jsonOnly,route(req=>{if(!object(req.body)||Object.keys(req.body).length)throw fail('configuration_invalid',400);return service.verify();}));
  return service;
}
