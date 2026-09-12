import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {isIP} from 'node:net';

export const YOUTUBE_PRAYER_CHANNEL='UCPN5ciXL85GdPGNjpWRIqrA';
export const YOUTUBE_UPLOAD_SCOPES=Object.freeze(['https://www.googleapis.com/auth/youtube.upload','https://www.googleapis.com/auth/youtube.readonly']);
const API='/api/admin/prayer-sharing/youtube',TOKEN_URL='https://oauth2.googleapis.com/token';
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
const validToken=value=>typeof value==='string'&&value.length>0&&value.length<=8192&&!/[\u0000-\u0020\u007f]/.test(value);
const failure=code=>Object.assign(Error(code),{code});
const scopes=value=>typeof value==='string'?value.split(/\s+/).filter(Boolean):[];
const hasScopes=value=>YOUTUBE_UPLOAD_SCOPES.every(scope=>scopes(value).includes(scope));

// No credentials or network calls on construction. Google Search Console remains independent.
export function createYouTubeOAuth({db,encrypt,decrypt,siteUrl,expectedChannelId=YOUTUBE_PRAYER_CHANNEL,fetchImpl=fetch,now=Date.now}){
  if(expectedChannelId!==YOUTUBE_PRAYER_CHANNEL)throw failure('youtube_configuration_invalid');
  let site;try{site=new URL(siteUrl);}catch{}
  const host=site?.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'')||'';
  const enabled=Boolean(site?.protocol==='https:'&&!site.username&&!site.password&&!site.port&&host.includes('.')&&!isIP(host)&&host!=='localhost'&&!host.endsWith('.localhost')&&!host.endsWith('.local'));
  const redirectUri=enabled?site.origin+API+'/callback':null;let refreshing=null;
  const requireSecureOrigin=()=>{if(!enabled)throw failure('youtube_https_origin_required');};
  db.exec(`CREATE TABLE IF NOT EXISTS youtube_upload_app(id INTEGER PRIMARY KEY CHECK(id=1),client_id TEXT NOT NULL DEFAULT '',client_secret_encrypted TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO youtube_upload_app(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS youtube_upload_oauth_states(state_hash TEXT PRIMARY KEY,admin_id INTEGER NOT NULL,session_hash TEXT NOT NULL,verifier_encrypted TEXT NOT NULL,revision INTEGER NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS youtube_upload_account(id INTEGER PRIMARY KEY CHECK(id=1),channel_id TEXT NOT NULL,channel_title TEXT NOT NULL,access_encrypted TEXT NOT NULL,refresh_encrypted TEXT NOT NULL,expires_at INTEGER NOT NULL,scope TEXT NOT NULL,revision TEXT NOT NULL,app_revision INTEGER NOT NULL,status TEXT NOT NULL,refresh_owner TEXT NOT NULL DEFAULT '',refresh_until INTEGER NOT NULL DEFAULT 0);`);
  db.transaction(()=>{const columns=db.prepare('PRAGMA table_info(youtube_upload_account)').all();for(const name of ['refresh_failures','refresh_next_at'])if(!columns.some(c=>c.name===name))db.exec(`ALTER TABLE youtube_upload_account ADD COLUMN ${name} INTEGER NOT NULL DEFAULT 0`);}).immediate();
  const config=()=>db.prepare('SELECT * FROM youtube_upload_app WHERE id=1').get();
  const account=()=>db.prepare('SELECT * FROM youtube_upload_account WHERE id=1').get();
  function status(){
    if(!enabled)return {enabled:false,configured:false,connected:false,requiresConnection:false,channelId:expectedChannelId,channelTitle:null,revision:null,redirectUri:null,scopes:[...YOUTUBE_UPLOAD_SCOPES],status:'unconfigured',publicUploadVerified:false,refreshRetryAt:null,configurationError:'youtube_https_origin_required',detail:'YouTube desativado neste ambiente. Configure um endereço público HTTPS para autorizar o canal.'};
    const c=config(),a=account(),connected=Boolean(c.client_id&&c.client_secret_encrypted&&a?.status==='connected'&&a.channel_id===expectedChannelId&&a.app_revision===c.revision&&hasScopes(a.scope)&&a.refresh_encrypted);
    return {enabled:true,configured:Boolean(c.client_id&&c.client_secret_encrypted),connected,requiresConnection:!connected,channelId:expectedChannelId,channelTitle:connected?a.channel_title:null,revision:connected?a.revision:null,
      redirectUri,scopes:[...YOUTUBE_UPLOAD_SCOPES],status:a?.status||'not_connected',publicUploadVerified:false,refreshRetryAt:connected&&a.refresh_next_at>now()?a.refresh_next_at:null,
      detail:connected&&a.refresh_next_at>now()?'O Google está temporariamente indisponível. A renovação será conferida novamente após o intervalo de espera.':connected?'Canal autorizado. Um upload recebido como privado não confirma publicação pública.':'Autorize o canal para permitir o envio. Conectar não ativa a rotina.'};
  }
  function configure({clientId,clientSecret}){
    requireSecureOrigin();
    if(typeof clientId!=='string'||!/^[-A-Za-z0-9.]{10,250}\.apps\.googleusercontent\.com$/.test(clientId)||!validToken(clientSecret))throw failure('youtube_app_invalid');
    const protectedSecret=encrypt(clientSecret);if(!validToken(protectedSecret))throw failure('youtube_encryption_unavailable');
    db.transaction(()=>{db.prepare('UPDATE youtube_upload_app SET client_id=?,client_secret_encrypted=?,revision=revision+1 WHERE id=1').run(clientId,protectedSecret);db.exec('DELETE FROM youtube_upload_account; DELETE FROM youtube_upload_oauth_states;');}).immediate();return status();
  }
  function begin({adminId,sessionKey}){
    requireSecureOrigin();
    if(!Number.isSafeInteger(adminId)||adminId<=0||!validToken(sessionKey))throw failure('youtube_admin_session_invalid');
    const c=config();if(!c.client_id||!c.client_secret_encrypted)throw failure('youtube_app_missing');
    decrypt(c.client_secret_encrypted);
    const state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
    db.transaction(()=>{
      db.prepare('UPDATE youtube_upload_app SET revision=revision+1 WHERE id=1').run();
      db.exec("DELETE FROM youtube_upload_oauth_states; UPDATE youtube_upload_account SET status='reconnecting';");
      db.prepare('INSERT INTO youtube_upload_oauth_states VALUES(?,?,?,?,?,?)').run(hash(state),adminId,hash(sessionKey),encrypt(verifier),c.revision+1,now()+600000);
    }).immediate();
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search=new URLSearchParams({client_id:c.client_id,redirect_uri:redirectUri,response_type:'code',scope:YOUTUBE_UPLOAD_SCOPES.join(' '),access_type:'offline',prompt:'consent',state,
      code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
    return {authorizationUrl:url.href};
  }
  async function json(url,options={}){
    let response,payload;
    try{response=await fetchImpl(url,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(15000),...options});payload=await response.json();}catch{throw failure('youtube_oauth_unreachable');}
    if(payload?.error==='invalid_grant')throw failure('youtube_reconnect_required');
    if((response.status===429||response.status>=500)&&typeof payload?.error==='string'&&payload.error&&!payload.access_token&&!payload.refresh_token){
      const after=response.headers?.get('retry-after'),delay=after?(/^\d+$/.test(after)?Number(after)*1000:Date.parse(after)-now()):0;
      throw Object.assign(failure('youtube_oauth_temporary'),{retryAfterMs:Number.isSafeInteger(delay)&&delay>0?delay:0});
    }
    if(!response.ok||!payload||payload.error)throw failure('youtube_oauth_rejected');
    return payload;
  }
  function tokenData(payload,previousScope=''){
    const scope=payload.scope||previousScope;
    if(!validToken(payload.access_token)||String(payload.token_type).toLowerCase()!=='bearer'||!Number.isSafeInteger(payload.expires_in)||payload.expires_in<60||payload.expires_in>86400||!hasScopes(scope))throw failure('youtube_scopes_or_token_invalid');
    return {scope,expiresAt:now()+payload.expires_in*1000};
  }
  async function complete({state,code,adminId,sessionKey}){
    requireSecureOrigin();
    if(!validToken(state)||!validToken(code)||!validToken(sessionKey))throw failure('youtube_oauth_state_invalid');
    const attempt=db.transaction(()=>{
      const row=db.prepare('SELECT * FROM youtube_upload_oauth_states WHERE state_hash=? AND admin_id=? AND session_hash=? AND expires_at>?').get(hash(state),adminId,hash(sessionKey),now());
      if(!row||row.revision!==config().revision)throw failure('youtube_oauth_state_invalid');
      db.prepare('DELETE FROM youtube_upload_oauth_states WHERE state_hash=?').run(hash(state));return row;
    }).immediate();
    const c=config();
    const payload=await json(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.client_id,client_secret:decrypt(c.client_secret_encrypted),code,code_verifier:decrypt(attempt.verifier_encrypted),redirect_uri:redirectUri,grant_type:'authorization_code'})});
    const accepted=tokenData(payload);if(!validToken(payload.refresh_token))throw failure('youtube_offline_access_missing');
    const channels=await json('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true',{headers:{Authorization:'Bearer '+payload.access_token}});
    if(!Array.isArray(channels.items)||channels.items.length!==1||channels.items[0].id!==expectedChannelId)throw failure('youtube_channel_mismatch');
    const title=String(channels.items[0].snippet?.title||'').trim().slice(0,200);if(!title)throw failure('youtube_channel_mismatch');
    db.transaction(()=>{
      if(config().revision!==attempt.revision)throw failure('youtube_connection_changed');
      db.prepare(`INSERT INTO youtube_upload_account(id,channel_id,channel_title,access_encrypted,refresh_encrypted,expires_at,scope,revision,app_revision,status) VALUES(1,?,?,?,?,?,?,?,?,'connected')
        ON CONFLICT(id) DO UPDATE SET channel_id=excluded.channel_id,channel_title=excluded.channel_title,access_encrypted=excluded.access_encrypted,refresh_encrypted=excluded.refresh_encrypted,expires_at=excluded.expires_at,scope=excluded.scope,revision=excluded.revision,app_revision=excluded.app_revision,status='connected',refresh_owner='',refresh_until=0,refresh_failures=0,refresh_next_at=0`)
        .run(expectedChannelId,title,encrypt(payload.access_token),encrypt(payload.refresh_token),accepted.expiresAt,accepted.scope,randomUUID(),attempt.revision);
    }).immediate();return status();
  }
  function disconnect(){if(!enabled)return status();db.transaction(()=>{db.prepare('UPDATE youtube_upload_app SET revision=revision+1 WHERE id=1').run();db.exec('DELETE FROM youtube_upload_account; DELETE FROM youtube_upload_oauth_states;');}).immediate();return {...status(),detail:'Conexão removida desta plataforma. Você também pode revogar o acesso nas permissões da Conta Google.'};}
  async function renew(){
    requireSecureOrigin();
    const a=account();if(!status().connected)throw failure('youtube_reconnect_required');
    if(a.expires_at>now()+120000){const token=decrypt(a.access_encrypted);if(!validToken(token))throw failure('youtube_token_invalid');return token;}
    if(a.refresh_next_at>now())throw Object.assign(failure('youtube_refresh_retry_later'),{retryAt:a.refresh_next_at});
    if(a.refresh_owner){if(a.refresh_until<=now())db.prepare("UPDATE youtube_upload_account SET status='needs_review' WHERE revision=? AND refresh_owner=?").run(a.revision,a.refresh_owner);throw failure('youtube_refresh_pending_review');}
    const owner=randomUUID(),c=config();
    if(!db.prepare("UPDATE youtube_upload_account SET refresh_owner=?,refresh_until=? WHERE id=1 AND revision=? AND refresh_owner='' AND status='connected'").run(owner,now()+45000,a.revision).changes)throw failure('youtube_refresh_busy');
    try{
      const payload=await json(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.client_id,client_secret:decrypt(c.client_secret_encrypted),refresh_token:decrypt(a.refresh_encrypted),grant_type:'refresh_token'})});
      const accepted=tokenData(payload,a.scope);if(payload.refresh_token&&!validToken(payload.refresh_token))throw failure('youtube_token_invalid');
      const saved=db.prepare("UPDATE youtube_upload_account SET access_encrypted=?,refresh_encrypted=?,expires_at=?,scope=?,refresh_owner='',refresh_until=0,refresh_failures=0,refresh_next_at=0 WHERE id=1 AND revision=? AND app_revision=? AND refresh_owner=? AND status='connected' AND refresh_until>?")
        .run(encrypt(payload.access_token),payload.refresh_token?encrypt(payload.refresh_token):a.refresh_encrypted,accepted.expiresAt,accepted.scope,a.revision,c.revision,owner,now());
      if(!saved.changes||config().revision!==c.revision)throw failure('youtube_connection_changed');return payload.access_token;
    }catch(error){
      if(error.code==='youtube_oauth_temporary'){
        const failures=a.refresh_failures+1,retryAt=now()+Math.max(failures===1?60000:300000,error.retryAfterMs||0),retry=failures<3&&Number.isSafeInteger(retryAt);
        const saved=db.prepare("UPDATE youtube_upload_account SET status=?,refresh_failures=?,refresh_next_at=?,refresh_owner='',refresh_until=0 WHERE id=1 AND revision=? AND app_revision=? AND refresh_owner=? AND status='connected'")
          .run(retry?'connected':'needs_review',failures,retry?retryAt:0,a.revision,c.revision,owner);
        if(saved.changes&&retry)throw Object.assign(failure('youtube_refresh_retry_later'),{retryAt});
      }
      db.prepare("UPDATE youtube_upload_account SET status='needs_review' WHERE id=1 AND revision=? AND refresh_owner=?").run(a.revision,owner);throw failure(error.code==='youtube_reconnect_required'?error.code:'youtube_refresh_pending_review');
    }
  }
  return {status,configure,begin,complete,disconnect,accessToken(){if(!refreshing)refreshing=renew().finally(()=>{refreshing=null;});return refreshing;}};
}

export function setupYouTubeOAuth({app,requireAdmin,sameOriginOnly,getSessionKey,...deps}){
  const service=createYouTubeOAuth(deps);
  const identity=req=>({adminId:req.user?.id,sessionKey:getSessionKey(req)});
  const safeError=(error,res)=>res.status(409).json({error:error?.code==='youtube_https_origin_required'?'YouTube desativado neste ambiente. Configure um endereço público HTTPS para autorizar o canal.':'Não foi possível concluir a conexão do YouTube. Confira o aplicativo, as permissões e o canal autorizado.'});
  app.get(API+'/status',requireAdmin,(_req,res)=>res.set('Cache-Control','no-store').json(service.status()));
  app.post(API+'/app',requireAdmin,sameOriginOnly,(req,res)=>{try{res.set('Cache-Control','no-store').json(service.configure(req.body||{}));}catch(e){safeError(e,res);}});
  app.post(API+'/connect',requireAdmin,sameOriginOnly,(req,res)=>{try{res.set('Cache-Control','no-store').json(service.begin(identity(req)));}catch(e){safeError(e,res);}});
  app.get(API+'/callback',requireAdmin,async(req,res)=>{
    try{await service.complete({...identity(req),state:req.query.state,code:req.query.code});res.redirect(303,'/admin-youtube.html?youtube=connected');}
    catch{res.redirect(303,'/admin-youtube.html?youtube=needs_review');}
  });
  app.post(API+'/disconnect',requireAdmin,sameOriginOnly,(_req,res)=>res.set('Cache-Control','no-store').json(service.disconnect()));
  return service;
}
