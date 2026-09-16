import {createHash,randomUUID} from 'node:crypto';

const GIFT={id:'zamioculca',bookId:'guide-zamioculca-2026',slug:'guia-pratico-da-zamioculca',source:'owned-social-plant-care-guide',version:'lia-gift-zamioculca-v1'};
const API='/api/gifts/zamioculca',COURSE='livro-'+GIFT.slug,READER='/ler-livro/'+GIFT.slug,STALE_MS=120000;
const fail=(code,message,status=409)=>Object.assign(Error(message),{code,status,giftSafe:true});
const email=value=>typeof value==='string'&&value.length<=160&&/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(value)?value.trim().toLowerCase():'';
const reference=userId=>'gift_'+createHash('sha256').update(GIFT.version+'|'+userId).digest('hex');
const publicText=value=>String(value||'').replace(/<[^>]*>/g,'').replace(/[\x00-\x1f]/g,' ').trim();
export function validGiftEmailReceipt(result,recipient){
  return typeof result?.messageId==='string'&&result.messageId.length<=250&&/^[\x21-\x7e]+$/.test(result.messageId)&&!['undefined','null','true','false'].includes(result.messageId)&&Array.isArray(result.accepted)&&result.accepted.some(value=>email(value)===recipient)&&!result.rejected?.some?.(value=>email(value)===recipient);
}

export function setupSiteAssistantGifts({app,db,requireUser,sameOriginOnly,siteUrl,sendGiftEmail=null,now=Date.now,schedule=true,mailWaitMs=20000}){
  const origin=new URL(siteUrl).origin;
  db.exec(`CREATE TABLE IF NOT EXISTS site_assistant_gift_claims(
    id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),gift_id TEXT NOT NULL,version TEXT NOT NULL,
    order_reference TEXT NOT NULL REFERENCES course_orders(reference),created_at INTEGER NOT NULL,
    recipient TEXT NOT NULL,email_status TEXT NOT NULL DEFAULT 'pending',email_claim_id TEXT NOT NULL DEFAULT '',
    email_started_at INTEGER,email_sent_at INTEGER,email_attempts INTEGER NOT NULL DEFAULT 0,
    email_provider_id TEXT NOT NULL DEFAULT '',email_reason TEXT NOT NULL DEFAULT '',UNIQUE(user_id,gift_id)
  );`);
  const claimFor=userId=>db.prepare('SELECT * FROM site_assistant_gift_claims WHERE user_id=? AND gift_id=?').get(userId,GIFT.id);
  const active=userId=>db.prepare("SELECT order_reference FROM course_enrollments WHERE user_id=? AND course_slug=? AND status='active' ORDER BY id LIMIT 1").get(userId,COURSE);
  function book(){
    const item=db.prepare('SELECT * FROM digital_books WHERE id=? AND slug=? AND source_trend_id=? AND status=\'published\'').get(GIFT.bookId,GIFT.slug,GIFT.source);
    if(!item||item.word_count<9000||item.page_count<30||!String(item.cover_url||'').startsWith('/uploads/'))return null;
    const chapters=db.prepare("SELECT COUNT(*) n FROM digital_book_chapters WHERE book_id=? AND status='approved' AND LENGTH(TRIM(content))>0").get(GIFT.bookId).n;
    const course=db.prepare('SELECT status,material_url FROM managed_courses WHERE slug=?').get(COURSE);
    return chapters>=10&&course?.status==='active'&&course.material_url===READER?item:null;
  }
  function catalog(){const item=book();return item?{id:GIFT.id,title:publicText(item.title).slice(0,180),summary:publicText(item.summary).slice(0,600),coverUrl:item.cover_url,topic:'plants',amountCents:0,requiresAccount:true,available:typeof sendGiftEmail==='function',readerUrl:READER,libraryUrl:'/meus-cursos.html',version:GIFT.version}:null;}
  function emailState(row){
    if(!row)return null;
    if(row.email_status==='sent'&&row.email_provider_id)return {status:'sent',confirmation:'accepted',needsReview:false};
    const unknown=row.email_status==='uncertain'||row.email_status==='sent'||row.email_status==='sending'&&row.email_started_at<now()-STALE_MS;
    if(unknown)return {status:'pending',confirmation:'unknown',needsReview:true};
    if(row.email_status==='failed')return {status:'failed',confirmation:'not_submitted',needsReview:true};
    return {status:'pending',confirmation:row.email_status==='sending'?'sending':typeof sendGiftEmail==='function'?'queued':'not_configured',needsReview:false};
  }
  function access(userId){
    const row=claimFor(userId),hasAccess=Boolean(active(userId)&&book());
    return {ok:true,giftId:GIFT.id,claimed:Boolean(row),accessGranted:hasAccess,alreadyOwned:hasAccess,readerUrl:READER,libraryUrl:'/meus-cursos.html',email:emailState(row)};
  }
  function grant(user){
    if(!Number.isSafeInteger(user?.id)||user.id<=0||!email(user.email))throw fail('gift_account_required','Entre na sua conta para receber o guia.',401);
    return db.transaction(()=>{
      const item=book();if(!item)throw fail('gift_unavailable','Este guia não está disponível agora.');
      const prior=claimFor(user.id),owned=active(user.id);
      if(prior){if(!owned)throw fail('gift_access_changed','O acesso deste guia precisa ser conferido pela equipe.');return {created:false,alreadyOwned:true};}
      if(typeof sendGiftEmail!=='function')throw fail('gift_email_unavailable','O envio do guia por e-mail está temporariamente indisponível.',503);
      if(!owned&&db.prepare("SELECT 1 FROM course_orders WHERE user_id=? AND course_slug=? AND status IN ('created','pending','in_process','authorized') LIMIT 1").get(user.id,COURSE))throw fail('gift_purchase_pending','Há uma compra deste guia em andamento. Confira esse pagamento antes de receber outro acesso.');
      const id=reference(user.id);let order=owned?.order_reference;
      if(!order){
        if(db.prepare('SELECT 1 FROM course_orders WHERE reference=?').get(id))throw fail('gift_access_changed','O registro deste presente precisa ser conferido pela equipe.');
        db.prepare("INSERT INTO course_orders(reference,user_id,course_slug,course_title,amount_cents,status) VALUES(?,?,?,?,0,'gift')").run(id,user.id,COURSE,item.title);
        db.prepare("INSERT INTO course_enrollments(user_id,course_slug,order_reference,status) VALUES(?,?,?,'active')").run(user.id,COURSE,id);order=id;
      }
      db.prepare('INSERT INTO site_assistant_gift_claims(id,user_id,gift_id,version,order_reference,created_at,recipient) VALUES(?,?,?,?,?,?,?)').run(id,user.id,GIFT.id,GIFT.version,order,now(),email(user.email));
      return {created:true,alreadyOwned:Boolean(owned)};
    }).immediate();
  }
  let running=false,closed=false,timer;
  async function processEmails(){
    if(running||closed)return {processed:0};running=true;let processed=0;
    try{
      db.prepare("UPDATE site_assistant_gift_claims SET email_status='uncertain',email_reason='interrupted' WHERE email_status='sending' AND (email_started_at IS NULL OR email_started_at<?)").run(now()-STALE_MS);
      if(typeof sendGiftEmail!=='function')return {processed:0};
      const pending=db.prepare("SELECT * FROM site_assistant_gift_claims WHERE email_status='pending' AND email_attempts=0 ORDER BY created_at LIMIT 3").all();
      for(const row of pending){
        if(closed)break;
        if(!book()||!active(row.user_id)){db.prepare("UPDATE site_assistant_gift_claims SET email_status='failed',email_reason='access_unavailable' WHERE id=? AND email_status='pending'").run(row.id);continue;}
        const token=randomUUID(),claimed=db.prepare("UPDATE site_assistant_gift_claims SET email_status='sending',email_claim_id=?,email_started_at=?,email_attempts=email_attempts+1 WHERE id=? AND email_status='pending' AND email_attempts=0").run(token,now(),row.id);
        if(!claimed.changes)continue;processed++;
        const settle=(status,reason='',providerId='')=>db.prepare("UPDATE site_assistant_gift_claims SET email_status=?,email_reason=?,email_provider_id=?,email_sent_at=CASE WHEN ?='sent' THEN ? ELSE email_sent_at END WHERE id=? AND email_claim_id=? AND email_status IN ('sending','uncertain')").run(status,reason,providerId,status,now(),row.id,token);
        let waitTimer;
        const delivery=Promise.resolve().then(()=>{
          const live=db.prepare('SELECT email_status,email_claim_id,recipient FROM site_assistant_gift_claims WHERE id=?').get(row.id);
          if(live?.email_status!=='sending'||live.email_claim_id!==token||live.recipient!==row.recipient)return null;
          if(closed||!book()||!active(row.user_id))throw Object.assign(Error('access_unavailable'),{notSubmitted:true});
          return sendGiftEmail({to:row.recipient,messageId:`<${row.id}@${new URL(origin).hostname}>`,subject:'Seu guia gratuito da zamioculca — VitrineCity',
            text:`Seu guia gratuito da Editora Digital VitrineCity está disponível na sua conta.\n\nGuia prático da zamioculca: cultivo e cuidados em casa\n\nAbra sua biblioteca e entre com o e-mail desta conta:\n${origin}/meus-cursos.html\n\nLeitura do guia após entrar:\n${origin}${READER}\n\nO acesso é gratuito e não depende de uma compra. Este e-mail atende ao seu pedido do guia e não inscreve você em mensagens promocionais.\n\nVitrineCity`});
        }).then(result=>{if(validGiftEmailReceipt(result,row.recipient))settle('sent','',result.messageId);else settle('uncertain','receipt_missing');}).catch(error=>settle(error?.notSubmitted===true?'failed':'uncertain',error?.notSubmitted===true?'not_submitted':'provider_result_unknown'));
        await Promise.race([delivery,new Promise(resolve=>{waitTimer=setTimeout(()=>{settle('uncertain','timeout');resolve();},mailWaitMs);waitTimer.unref?.();})]);clearTimeout(waitTimer);
      }
      return {processed};
    }finally{running=false;}
  }
  const respondError=(res,error)=>res.status(error.status||500).json({error:error.giftSafe?error.message:'Não foi possível liberar o guia agora. Consulte o estado antes de tentar novamente.',code:error.code||'gift_unavailable'});
  if(app){
    app.get(API,(_req,res)=>res.set('Cache-Control','no-store').json({gift:catalog()}));
    app.get(API+'/status',requireUser,(req,res)=>res.set('Cache-Control','private,no-store').json(access(req.user.id)));
    app.post(API+'/claim',requireUser,sameOriginOnly,(req,res)=>{
      const input=req.body;
      if(!input||Array.isArray(input)||Object.keys(input).some(key=>!['accepted','version'].includes(key))||input.accepted!==true||input.version!==GIFT.version)return res.status(400).json({error:'Confirme que deseja receber este guia gratuito na sua conta e por e-mail.',code:'gift_consent_required'});
      try{const result=grant(req.user);void processEmails().catch(()=>{});return res.set('Cache-Control','private,no-store').status(result.created?201:200).json({...access(req.user.id),alreadyOwned:result.alreadyOwned});}catch(error){return respondError(res,error);}
    });
  }
  if(schedule){timer=setInterval(()=>{void processEmails().catch(()=>{});},30000);timer.unref?.();}
  return {catalog,available:()=>catalog()?.available===true,grant,access,processEmails,close(){closed=true;clearInterval(timer);}};
}
