import {createHash, randomUUID} from 'node:crypto';

const ENDPOINT='https://open.tiktokapis.com/v2/oauth/token/';
const HTTP_TIMEOUT_MS=15_000;
const LOCK_MS=45_000;
const EXPIRY_MARGIN_MS=5*60_000;
const token=value=>typeof value==='string'&&value.length>0&&value.length<=8192&&!/[\u0000-\u0020\u007f]/.test(value);
const timestamp=value=>typeof value==='string'?Date.parse(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?$/.test(value)?value.replace(' ','T')+'Z':value):NaN;
const outcome=(status,reason,extra={})=>({ok:status==='fresh'||status==='refreshed',status,reason,...extra});

/** Explicit renewal only; importing or constructing this module makes no requests.
 * Dependencies decrypt/encrypt/getAppConfig and the better-sqlite3 API are synchronous.
 * Returned objects contain no credentials or raw provider error text.
 * https://developers.tiktok.com/docs/en/oauth-user-access-token-management
 */
export function createTikTokTokenRefresh({db,decrypt,encrypt,getAppConfig,fetchImpl=fetch,now=Date.now}){
  if(!db?.prepare||!db?.transaction||![decrypt,encrypt,getAppConfig,fetchImpl,now].every(fn=>typeof fn==='function'))throw new TypeError('Invalid TikTok refresh dependencies');
  let inFlight=null;

  function migrate(){
    return db.transaction(()=>{
      const columns=db.prepare('PRAGMA table_info(tiktok_oauth_account)').all();
      if(!columns.length)return false;
      if(!columns.some(c=>c.name==='refresh_lock_owner'))db.exec("ALTER TABLE tiktok_oauth_account ADD COLUMN refresh_lock_owner TEXT NOT NULL DEFAULT ''");
      if(!columns.some(c=>c.name==='refresh_lock_until'))db.exec('ALTER TABLE tiktok_oauth_account ADD COLUMN refresh_lock_until INTEGER NOT NULL DEFAULT 0');
      return true;
    }).immediate();
  }
  function read(){
    const account=db.prepare('SELECT * FROM tiktok_oauth_account WHERE id=1').get();
    const credentials=db.prepare("SELECT credentials_encrypted,updated_at FROM social_provider_credentials WHERE provider='tiktok'").get();
    const config=getAppConfig();
    return {account,credentials,config};
  }
  function revision(value){
    const a=value.account,c=value.credentials,p=value.config;
    return createHash('sha256').update(JSON.stringify([
      a?.open_id,a?.refresh_token_encrypted,a?.scopes,a?.expires_at,a?.refresh_expires_at,a?.status,a?.updated_at,
      c?.credentials_encrypted,c?.updated_at,p?.configured,p?.clientKey,p?.clientSecret,p?.environment
    ])).digest('hex');
  }
  function publicAccount(account){
    return {openId:account.open_id,scopes:String(account.scopes||'').split(',').map(s=>s.trim()).filter(Boolean),expiresAt:account.expires_at,refreshExpiresAt:account.refresh_expires_at};
  }
  function claim(){
    return db.transaction(()=>{
      const baseline=read(),{account:a,credentials:c,config}=baseline,time=now();
      if(!a?.open_id||!['connected','expired'].includes(a.status))return {result:outcome('not_connected','Autorize uma conta TikTok para continuar.')};
      if(!config?.configured||!token(config.clientKey)||!token(config.clientSecret))return {result:outcome('missing_configuration','Confira a configuração do aplicativo TikTok.')};
      if(!c?.credentials_encrypted)return {result:outcome('reconnect_required','A credencial da conta está incompleta. Reconecte o TikTok.')};
      const credentialUpdated=timestamp(c.updated_at),accountUpdated=timestamp(a.updated_at);
      if(Number.isFinite(credentialUpdated)&&Number.isFinite(accountUpdated)&&credentialUpdated>accountUpdated)return {result:outcome('reconnect_required','A credencial foi substituída depois da autorização desta conta. Reconecte o TikTok para confirmar a associação.')};
      const rev=revision(baseline),owner=String(a.refresh_lock_owner||''),parts=owner.split(':');
      // A timed-out/crashed rotation is not repeated against the same credential revision.
      if(parts[1]===rev&&parts[0]==='u')return {result:outcome('unknown','A renovação anterior não foi confirmada. Reconecte a conta para substituir a autorização.')};
      if(parts[1]===rev&&parts[0]==='p'){
        if(Number(a.refresh_lock_until)>time)return {result:outcome('busy','A renovação desta conta já está em andamento.')};
        db.prepare('UPDATE tiktok_oauth_account SET refresh_lock_owner=? WHERE id=1 AND refresh_lock_owner=?').run('u:'+rev+':'+parts[2],owner);
        return {result:outcome('unknown','A renovação anterior foi interrompida. Reconecte a conta para confirmar a autorização.')};
      }
      let refreshToken;
      try{
        const values=JSON.parse(decrypt(c.credentials_encrypted));
        if(!token(values?.TIKTOK_CONTENT_ACCESS_TOKEN))throw Error('invalid');
        if(a.status==='connected'&&Number(a.expires_at)>time+EXPIRY_MARGIN_MS)return {result:outcome('fresh','A autorização ainda está válida.',{account:publicAccount(a)})};
        refreshToken=decrypt(a.refresh_token_encrypted);
      }catch{return {result:outcome('reconnect_required','Não foi possível ler a autorização protegida. Reconecte o TikTok.')};}
      if(!token(refreshToken)||!Number.isSafeInteger(a.refresh_expires_at)||a.refresh_expires_at<=time)return {result:outcome('reconnect_required','A autorização de renovação expirou ou está ausente. Reconecte o TikTok.')};
      const lock='p:'+rev+':'+randomUUID(),until=time+LOCK_MS;
      const updated=db.prepare('UPDATE tiktok_oauth_account SET refresh_lock_owner=?,refresh_lock_until=? WHERE id=1 AND open_id=? AND refresh_token_encrypted IS ? AND refresh_lock_owner IS ? AND refresh_lock_until IS ?')
        .run(lock,until,a.open_id,a.refresh_token_encrypted,a.refresh_lock_owner,a.refresh_lock_until);
      if(updated.changes!==1)return {result:outcome('busy','A autorização foi atualizada por outra operação. Consulte novamente.')};
      return {baseline,rev,lock,until,refreshToken};
    }).immediate();
  }
  function finishLock(attempt,uncertain){
    return db.transaction(()=>{
      const current=read();
      if(current.account?.refresh_lock_owner!==attempt.lock)return false;
      const same=revision(current)===attempt.rev;
      db.prepare('UPDATE tiktok_oauth_account SET refresh_lock_owner=?,refresh_lock_until=? WHERE id=1 AND refresh_lock_owner=?')
        .run(uncertain&&same?'u:'+attempt.rev+':'+attempt.lock.split(':')[2]:'',uncertain&&same?attempt.until:0,attempt.lock);
      return same;
    }).immediate();
  }
  function accepted(data,attempt){
    if(!data||data.error||data.open_id!==attempt.baseline.account.open_id||!token(data.access_token)||!token(data.refresh_token)||data.token_type!=='Bearer')return false;
    if(typeof data.scope!=='string'||data.scope.length>2048)return false;
    if(data.scope.split(',').some(s=>s.trim()&&!/^[a-z][a-z0-9_.]{0,99}$/.test(s.trim())))return false;
    return ['expires_in','refresh_expires_in'].every(key=>Number.isSafeInteger(data[key])&&data[key]>0&&Number.isSafeInteger(now()+data[key]*1000));
  }
  async function transport(attempt){
    const controller=new AbortController();let timer;
    const timedOut=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('timeout'));},HTTP_TIMEOUT_MS);});
    try{
      return await Promise.race([(async()=>{
        const response=await fetchImpl(ENDPOINT,{method:'POST',redirect:'error',credentials:'omit',headers:{'Content-Type':'application/x-www-form-urlencoded','Cache-Control':'no-cache'},
          body:new URLSearchParams({client_key:attempt.baseline.config.clientKey,client_secret:attempt.baseline.config.clientSecret,grant_type:'refresh_token',refresh_token:attempt.refreshToken}),signal:controller.signal});
        const data=await response.json();
        return {ok:response.ok,status:response.status,data};
      })(),timedOut]);
    }finally{clearTimeout(timer);}
  }
  function persist(attempt,data){
    const encryptedAccess=encrypt(JSON.stringify({TIKTOK_CONTENT_ACCESS_TOKEN:data.access_token})),encryptedRefresh=encrypt(data.refresh_token);
    if(!token(encryptedAccess)||!token(encryptedRefresh))throw Error('encryption_failed');
    return db.transaction(()=>{
      const current=read(),a=current.account;
      if(a?.refresh_lock_owner!==attempt.lock||revision(current)!==attempt.rev)return null;
      const timestamp=now(),expiresAt=timestamp+data.expires_in*1000,refreshExpiresAt=timestamp+data.refresh_expires_in*1000,updatedAt=new Date(timestamp).toISOString().slice(0,19).replace('T',' ');
      if(Number(a.refresh_lock_until)<=timestamp)return null;
      const scopes=[...new Set(data.scope.split(',').map(s=>s.trim()).filter(Boolean))].join(',');
      const accountUpdate=db.prepare("UPDATE tiktok_oauth_account SET refresh_token_encrypted=?,scopes=?,expires_at=?,refresh_expires_at=?,status='connected',updated_at=?,refresh_lock_owner='',refresh_lock_until=0 WHERE id=1 AND open_id=? AND refresh_token_encrypted IS ? AND refresh_lock_owner=? AND refresh_lock_until=?")
        .run(encryptedRefresh,scopes,expiresAt,refreshExpiresAt,updatedAt,a.open_id,a.refresh_token_encrypted,attempt.lock,attempt.until);
      if(accountUpdate.changes!==1)throw Error('write_conflict');
      const credentialUpdate=db.prepare("UPDATE social_provider_credentials SET credentials_encrypted=?,updated_at=? WHERE provider='tiktok' AND credentials_encrypted=?")
        .run(encryptedAccess,updatedAt,attempt.baseline.credentials.credentials_encrypted);
      if(credentialUpdate.changes!==1)throw Error('write_conflict');
      return {openId:a.open_id,scopes:scopes.split(',').filter(Boolean),expiresAt,refreshExpiresAt};
    }).immediate();
  }
  async function perform(){
    let attempt;
    try{
      if(!migrate())return outcome('not_connected','Não há uma conta TikTok cadastrada.');
      attempt=claim();if(attempt.result)return attempt.result;
      let response;
      try{response=await transport(attempt);}catch{
        const same=finishLock(attempt,true);
        return same?outcome('unknown','O TikTok não confirmou a renovação. Nenhuma tentativa automática será repetida.'):outcome('superseded','A conta mudou durante a renovação. A autorização mais recente foi preservada.');
      }
      if(!response.ok){
        const reconnect=response.status===400&&response.data?.error==='invalid_grant';
        const uncertain=response.status>=500||reconnect;
        const same=finishLock(attempt,uncertain);
        if(!same)return outcome('superseded','A conta mudou durante a renovação. A autorização mais recente foi preservada.');
        if(reconnect)return outcome('reconnect_required','O TikTok recusou a autorização de renovação. Reconecte a conta.');
        return uncertain?outcome('unknown','O TikTok não confirmou a renovação. Reconecte a conta antes de tentar novamente.'):outcome('failed',response.status===429?'O TikTok limitou a solicitação. Tente novamente mais tarde.':'O TikTok recusou a renovação. Confira a conexão do aplicativo.');
      }
      if(!accepted(response.data,attempt)){
        const same=finishLock(attempt,true);
        return same?outcome('unknown','A resposta de renovação não pôde ser validada. Reconecte a conta.'):outcome('superseded','A conta mudou. A autorização mais recente foi preservada.');
      }
      const account=persist(attempt,response.data);
      if(!account){finishLock(attempt,true);return outcome('superseded','A conta ou configuração mudou. A autorização mais recente foi preservada.');}
      return outcome('refreshed','Autorização TikTok renovada. As permissões continuam sendo as concedidas pela conta.',{account});
    }catch{
      if(attempt?.lock)try{finishLock(attempt,true);}catch{}
      return outcome('failed','Não foi possível concluir a renovação protegida. Confira a conexão antes de tentar novamente.');
    }
  }
  return {run(){if(inFlight)return inFlight;inFlight=perform().finally(()=>{inFlight=null;});return inFlight;}};
}
