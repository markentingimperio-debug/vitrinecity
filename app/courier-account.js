import {randomBytes} from 'node:crypto';
import path from 'node:path';

const RECOVERY_MESSAGE='Se houver uma conta ativa com esse e-mail verificado, enviaremos as instruções de recuperação.';
const VERIFY_MESSAGE='Se o e-mail puder ser vinculado, você receberá um link de confirmação. Confira também a caixa de spam.';
const TOKEN_TTL=30*60*1000;
const emailValue=value=>String(value||'').trim().toLowerCase();
const validEmail=value=>value.length<=254&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
const validPassword=value=>typeof value==='string'&&value.length>=10&&value.length<=200;
const validToken=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);

// Courier credentials are separate from customer credentials. A recovery address is
// usable only after the courier proves their current password AND owns the mailbox.
export function setupCourierAccount({app,db,requireCourier,requireAdmin,sameOriginOnly,
  hashPassword,verifyPassword,sessionHash,allowAttempt,sendMail,siteUrl,publicDir,
  redispatch=()=>{},now=Date.now}){
  db.exec(`CREATE TABLE IF NOT EXISTS courier_recovery_profiles (
    courier_id INTEGER PRIMARY KEY REFERENCES local_delivery_couriers(id),
    email TEXT NOT NULL UNIQUE COLLATE NOCASE, verified_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS courier_recovery_tokens (
    token_hash TEXT PRIMARY KEY,courier_id INTEGER NOT NULL REFERENCES local_delivery_couriers(id),
    purpose TEXT NOT NULL CHECK(purpose IN ('email_verify','password_reset')),
    email TEXT NOT NULL,password_version TEXT NOT NULL,expires_at INTEGER NOT NULL,used_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS courier_recovery_tokens_courier ON courier_recovery_tokens(courier_id,purpose);
  CREATE TABLE IF NOT EXISTS courier_account_audit (
    id INTEGER PRIMARY KEY,admin_user_id INTEGER NOT NULL REFERENCES users(id),
    courier_id INTEGER NOT NULL REFERENCES local_delivery_couriers(id),action TEXT NOT NULL,
    reason TEXT NOT NULL,created_at INTEGER NOT NULL
  );`);
  const noStore=(_req,res,next)=>{res.set('Cache-Control','no-store');next();};
  app.use(['/api/courier/account','/api/courier/password-reset'],noStore);
  app.get('/recuperar-acesso-entregador.html',(_req,res)=>res.set({
    'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'
  }).sendFile(path.join(publicDir,'recuperar-acesso-entregador.html')));
  const courier=id=>db.prepare('SELECT * FROM local_delivery_couriers WHERE id=?').get(id);
  const revoke=id=>{
    db.prepare('DELETE FROM local_delivery_courier_sessions WHERE courier_id=?').run(id);
    db.prepare('UPDATE courier_recovery_tokens SET used_at=? WHERE courier_id=? AND used_at IS NULL').run(now(),id);
  };
  const limited=(req,scope,key,limit=5)=>allowAttempt(`courier:${scope}:ip:${req.ip}`,20,15*60*1000)&&
    allowAttempt(`courier:${scope}:${key}`,limit,15*60*1000);
  function issue(account,email,purpose){
    const token=randomBytes(32).toString('base64url'),hash=sessionHash(token);
    db.transaction(()=>{
      db.prepare('UPDATE courier_recovery_tokens SET used_at=? WHERE courier_id=? AND purpose=? AND used_at IS NULL').run(now(),account.id,purpose);
      db.prepare('DELETE FROM courier_recovery_tokens WHERE expires_at<?').run(now()-24*60*60*1000);
      db.prepare('INSERT INTO courier_recovery_tokens(token_hash,courier_id,purpose,email,password_version,expires_at) VALUES (?,?,?,?,?,?)')
        .run(hash,account.id,purpose,email,sessionHash(account.password_hash),now()+TOKEN_TTL);
    })();
    return {token,hash};
  }
  function readToken(token,purpose){
    if(!validToken(token))return null;
    const row=db.prepare('SELECT * FROM courier_recovery_tokens WHERE token_hash=? AND purpose=? AND used_at IS NULL AND expires_at>?')
      .get(sessionHash(token),purpose,now());
    if(!row)return null;
    const account=courier(row.courier_id);
    if(!account||account.status!=='active'||row.password_version!==sessionHash(account.password_hash))return null;
    if(purpose==='password_reset'&&!db.prepare('SELECT 1 FROM courier_recovery_profiles WHERE courier_id=? AND email=?').get(account.id,row.email))return null;
    return {row,account};
  }
  const tokenError=res=>res.status(400).json({error:'Link inválido ou expirado. Solicite um novo link.'});
  function mail(email,token,purpose){
    const verify=purpose==='email_verify',link=new URL('/recuperar-acesso-entregador.html',siteUrl);
    link.searchParams.set(verify?'verify':'token',token);
    return sendMail({to:email,subject:verify?'Confirme seu e-mail — VC Entregas':'Redefina sua senha — VC Entregas',
      text:`${verify?'Confirme este e-mail para recuperar o acesso à sua conta de entregador':'Crie uma nova senha para sua conta de entregador'}:\n\n${link.href}\n\nEste link expira em 30 minutos e só pode ser usado uma vez. Se não foi você, ignore esta mensagem.`});
  }
  app.get('/api/courier/account',requireCourier,(req,res)=>{
    const profile=db.prepare('SELECT email,verified_at FROM courier_recovery_profiles WHERE courier_id=?').get(req.courier.id);
    return res.json({recoveryEmail:profile?.email||null,emailVerified:Boolean(profile),emailDeliveryConfigured:Boolean(sendMail)});
  });
  app.post('/api/courier/account/email',requireCourier,sameOriginOnly,async(req,res)=>{
    if(!limited(req,'bind',req.courier.id))return res.status(429).json({error:'Muitas tentativas. Tente novamente em alguns minutos.'});
    const email=emailValue(req.body?.email),password=req.body?.currentPassword;
    if(!validEmail(email))return res.status(400).json({error:'Informe um e-mail válido.'});
    if(typeof password!=='string'||password.length>200||!verifyPassword(password,req.courier.password_hash))return res.status(400).json({error:'Senha atual incorreta.'});
    if(!sendMail)return res.status(503).json({error:'O envio de e-mails está indisponível. Fale com a equipe pelo chat do entregador.'});
    if(db.prepare('SELECT 1 FROM courier_recovery_profiles WHERE email=? AND courier_id<>?').get(email,req.courier.id))return res.json({ok:true,message:VERIFY_MESSAGE});
    const issued=issue(req.courier,email,'email_verify');
    try{await mail(email,issued.token,'email_verify');}
    catch{
      db.prepare('UPDATE courier_recovery_tokens SET used_at=? WHERE token_hash=?').run(now(),issued.hash);
      return res.status(503).json({error:'Não foi possível enviar o e-mail agora. Tente novamente mais tarde.'});
    }
    return res.json({ok:true,message:VERIFY_MESSAGE});
  });
  app.post('/api/courier/account/email/confirm',sameOriginOnly,(req,res)=>{
    if(!limited(req,'verify',req.ip,20))return res.status(429).json({error:'Muitas tentativas. Tente novamente mais tarde.'});
    const result=db.transaction(()=>{
      const valid=readToken(req.body?.token,'email_verify');if(!valid)return false;
      const {row,account}=valid;
      if(db.prepare('SELECT 1 FROM courier_recovery_profiles WHERE email=? AND courier_id<>?').get(row.email,account.id))return false;
      db.prepare(`INSERT INTO courier_recovery_profiles(courier_id,email,verified_at) VALUES (?,?,?)
        ON CONFLICT(courier_id) DO UPDATE SET email=excluded.email,verified_at=excluded.verified_at`).run(account.id,row.email,now());
      db.prepare('UPDATE courier_recovery_tokens SET used_at=? WHERE courier_id=? AND used_at IS NULL').run(now(),account.id);
      return true;
    })();
    return result?res.json({ok:true,message:'E-mail confirmado. Você já pode usá-lo para recuperar sua senha.'}):tokenError(res);
  });
  app.post('/api/courier/password-reset/request',sameOriginOnly,(req,res)=>{
    const email=emailValue(req.body?.email);
    const permitted=limited(req,'reset-request',sessionHash(email),3);
    // Same response for unknown, unverified, blocked, throttled and unavailable mail.
    res.json({ok:true,message:RECOVERY_MESSAGE});
    if(!permitted||!validEmail(email)||!sendMail)return;
    const account=db.prepare(`SELECT c.* FROM courier_recovery_profiles p JOIN local_delivery_couriers c ON c.id=p.courier_id
      WHERE p.email=? AND c.status='active'`).get(email);
    if(!account)return;
    const issued=issue(account,email,'password_reset');
    Promise.resolve().then(()=>mail(email,issued.token,'password_reset')).catch(()=>{
      db.prepare('UPDATE courier_recovery_tokens SET used_at=? WHERE token_hash=?').run(now(),issued.hash);
    });
  });
  app.post('/api/courier/password-reset/confirm',sameOriginOnly,(req,res)=>{
    if(!limited(req,'reset-confirm',req.ip,20))return res.status(429).json({error:'Muitas tentativas. Tente novamente mais tarde.'});
    if(!validPassword(req.body?.password))return res.status(400).json({error:'A nova senha deve ter entre 10 e 200 caracteres.'});
    if(!readToken(req.body?.token,'password_reset'))return tokenError(res);
    const passwordHash=hashPassword(req.body.password);
    const result=db.transaction(()=>{
      const valid=readToken(req.body.token,'password_reset');if(!valid)return false;
      db.prepare('UPDATE local_delivery_couriers SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(passwordHash,valid.account.id);
      revoke(valid.account.id);return true;
    })();
    return result?res.json({ok:true,message:'Senha alterada. Entre novamente com a nova senha.'}):tokenError(res);
  });
  app.put('/api/courier/account/password',requireCourier,sameOriginOnly,(req,res)=>{
    if(!limited(req,'password',req.courier.id))return res.status(429).json({error:'Muitas tentativas. Tente novamente mais tarde.'});
    const current=req.body?.currentPassword;
    if(typeof current!=='string'||current.length>200||!verifyPassword(current,req.courier.password_hash))return res.status(400).json({error:'Senha atual incorreta.'});
    if(!validPassword(req.body?.password))return res.status(400).json({error:'A nova senha deve ter entre 10 e 200 caracteres.'});
    db.transaction(()=>{
      db.prepare('UPDATE local_delivery_couriers SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(hashPassword(req.body.password),req.courier.id);
      revoke(req.courier.id);
    })();
    return res.json({ok:true,message:'Senha alterada. Entre novamente com a nova senha.'});
  });
  app.delete('/api/admin/local-delivery/couriers/:id',requireAdmin,sameOriginOnly,(req,res)=>{
    res.set('Cache-Control','no-store');
    const id=Number(req.params.id),reason=String(req.body?.reason||'').trim();
    if(!Number.isSafeInteger(id)||id<=0||reason.length<5||reason.length>500)return res.status(400).json({error:'Informe o entregador e um motivo de 5 a 500 caracteres.'});
    const result=db.transaction(()=>{
      const account=courier(id);if(!account)return {status:404,error:'Entregador não encontrado.'};
      if(db.prepare("SELECT 1 FROM local_delivery_jobs WHERE courier_id=? AND status IN ('assigned','picked_up') LIMIT 1").get(id))
        return {status:409,error:'Conclua ou transfira as entregas em andamento antes de excluir do operacional.'};
      if(db.prepare(`SELECT 1 FROM local_delivery_jobs j JOIN marketplace_orders o ON o.reference=j.order_reference
        WHERE j.courier_id=? AND j.status='delivered' AND o.payment_status='approved' AND o.customer_confirmed_at IS NULL LIMIT 1`).get(id))
        return {status:409,error:'Há entrega aguardando confirmação do cliente e apuração do repasse. Resolva essa pendência antes de excluir do operacional.'};
      if(Number(account.balance_cents)!==0||db.prepare("SELECT 1 FROM local_delivery_withdrawals WHERE courier_id=? AND status IN ('requested','approved') LIMIT 1").get(id)||
        db.prepare("SELECT 1 FROM marketplace_manual_payouts WHERE recipient_type='courier' AND recipient_reference=? AND status IN ('pending','blocked') AND amount_cents<>0 LIMIT 1").get(String(id)))
        return {status:409,error:'Há saldo, saque ou repasse pendente. Regularize os valores antes de excluir do operacional.'};
      const offers=db.prepare("SELECT job_id FROM local_delivery_offers WHERE courier_id=? AND status='offered'").all(id);
      db.prepare("UPDATE local_delivery_couriers SET status='blocked',available=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
      db.prepare("UPDATE local_delivery_offers SET status='cancelled',responded_at=CURRENT_TIMESTAMP WHERE courier_id=? AND status='offered'").run(id);
      revoke(id);
      db.prepare("INSERT INTO courier_account_audit(admin_user_id,courier_id,action,reason,created_at) VALUES (?,?,'remove_from_operations',?,?)").run(req.user.id,id,reason,now());
      return {offers};
    })();
    if(result.error)return res.status(result.status).json({error:result.error});
    for(const offer of result.offers){try{redispatch(offer.job_id);}catch{/* An available job remains available for the dispatch worker. */}}
    return res.json({ok:true,removedFromOperations:true,message:'Entregador excluído do operacional. Histórico e registros financeiros preservados.'});
  });
}
