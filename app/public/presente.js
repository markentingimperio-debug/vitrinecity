const GIFT_ID='zamioculca',GIFT_VERSION='lia-gift-zamioculca-v1',LIBRARY='/meus-cursos.html',READER='/ler-livro/guia-pratico-da-zamioculca';
export function selectedGiftId(search){const values=new URLSearchParams(search).getAll('guia');return values.length===1&&values[0]===GIFT_ID?GIFT_ID:'';}
export function validGift(data){const gift=data?.gift;return gift?.id===GIFT_ID&&gift.version===GIFT_VERSION&&gift.amountCents===0&&gift.requiresAccount===true&&typeof gift.available==='boolean'&&typeof gift.title==='string'&&gift.title.trim()&&gift.title.length<=200&&gift.readerUrl===READER&&gift.libraryUrl===LIBRARY?gift:null;}
export function validGiftReceipt(data){return data?.ok===true&&data.giftId===GIFT_ID&&data.claimed===true&&data.accessGranted===true&&typeof data.alreadyOwned==='boolean'&&data.readerUrl===READER&&data.libraryUrl===LIBRARY&&['pending','sent','failed'].includes(data.email?.status)&&['queued','sending','accepted','unknown','not_configured','not_submitted'].includes(data.email?.confirmation);}
export function giftEmailMessage(email){
  if(email?.status==='sent'&&email.confirmation==='accepted')return 'Seu link foi encaminhado por e-mail. Confira também o spam; a chegada pode levar alguns minutos.';
  if(email?.confirmation==='not_configured')return 'O envio por e-mail está indisponível no momento. Seu guia já pode ser aberto pela sua conta.';
  if(email?.status==='pending'&&['queued','sending'].includes(email.confirmation)&&email.needsReview!==true)return 'O e-mail com o link aguarda confirmação de envio. Você já pode abrir o guia pela sua conta.';
  return 'Não foi possível confirmar o envio do e-mail. Seu guia continua disponível na sua conta.';
}

export function mountGiftPage({doc=document,win=window,fetchImpl=fetch}={}){
  const byId=id=>doc.getElementById(id),form=byId('gift-form'),button=byId('gift-button'),message=byId('gift-message'),giftId=selectedGiftId(win.location.search);
  let gift=null,user=null,mode='register',ready=false,busy=false,uncertain=false,granted=false;
  const request=(url,body)=>fetchImpl(url,body?{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{credentials:'same-origin',cache:'no-store'});
  function update(){
    for(const section of ['register','login']){byId(section+'-fields').hidden=mode!==section;byId(section+'-fields').disabled=mode!==section||busy;}
    byId('optional-fields').hidden=mode!=='register';byId('optional-fields').disabled=mode!=='register'||busy;
    byId('account-tabs').hidden=mode==='signed';byId('signed-account').hidden=mode!=='signed';
    byId('choose-register').setAttribute('aria-pressed',String(mode==='register'));byId('choose-login').setAttribute('aria-pressed',String(mode==='login'));
    for(const id of ['choose-register','choose-login','other-account'])byId(id).disabled=busy;
    form.hidden=granted;byId('gift-receipt').hidden=!granted;
    button.disabled=!ready||busy||uncertain||granted||gift?.available!==true||(mode==='register'&&!byId('account-consent').checked);
    button.textContent=busy?'Preparando seu guia…':!ready?'Consultando presente e acesso…':mode==='signed'?'Receber meu guia gratuito':mode==='login'?'Entrar e receber meu guia':'Criar conta e receber meu guia';
  }
  function changeMode(next){
    if(busy)return;
    if(next==='login'&&!byId('login-email').value)byId('login-email').value=byId('register-email').value;
    if(next==='register'&&!byId('register-email').value)byId('register-email').value=byId('login-email').value;
    byId('register-password').value='';byId('login-password').value='';byId('marketing-consent').checked=false;
    mode=next;user=null;granted=false;message.textContent='';update();
  }
  function showUser(value){user=value;mode='signed';byId('account-name').textContent=value.name||'Sua conta';byId('account-email').textContent=value.email;}
  function renderGift(value){
    gift=value;byId('gift-title').textContent=value.title;byId('gift-description').textContent=typeof value.summary==='string'?value.summary.slice(0,1000):'Um guia educativo para consultar no seu tempo.';
    const cover=byId('gift-cover');cover.hidden=true;
    try{if(typeof value.coverUrl==='string'&&value.coverUrl){const url=new URL(value.coverUrl,win.location.origin);if(url.origin===win.location.origin&&!url.username&&!url.password&&/^\/(assets|uploads)\//.test(url.pathname)){cover.src=url.href;cover.alt='Capa do guia '+value.title;cover.hidden=false;}}}catch{}
  }
  async function getGift(){const response=await request('/api/gifts/'+giftId),value=response.ok?validGift(await response.json()):null;if(!value)throw Error('Não foi possível confirmar este presente. Consulte novamente em instantes.');return value;}
  async function getUser(){
    const response=await request('/api/auth/me');if(response.status===401)return null;
    const data=await response.json();if(!response.ok||data.authenticated!==true||typeof data.user?.email!=='string'||!data.user.email)throw Error('Não foi possível verificar sua conta. Seus dados permanecem nesta etapa.');return data.user;
  }
  function renderReceipt(data){
    if(!validGiftReceipt(data))throw Error('Ainda não foi possível confirmar a liberação do guia. Consulte novamente antes de continuar.');
    granted=true;uncertain=false;byId('gift-receipt-detail').textContent=data.alreadyOwned?'Você já tem acesso a este guia. Nenhuma compra ou cobrança foi criada.':'Seu presente gratuito foi liberado. Nenhuma compra ou cobrança foi criada.';
    byId('gift-email-status').textContent=giftEmailMessage(data.email);byId('gift-access').href=LIBRARY;
    byId('retry-load').hidden=data.email?.status==='sent'&&data.email.confirmation==='accepted';byId('retry-load').textContent='Verificar envio do e-mail';message.textContent='';update();
  }
  async function getStatus(){
    const response=await request('/api/gifts/'+giftId+'/status');
    if(response.status===401){user=null;mode='login';throw Error('Entre na sua conta aqui para consultar seu presente.');}
    const data=await response.json();
    if(response.ok&&data?.ok===true&&data.giftId===GIFT_ID&&data.claimed===false&&typeof data.accessGranted==='boolean'&&typeof data.alreadyOwned==='boolean'&&data.readerUrl===READER&&data.libraryUrl===LIBRARY&&data.email===null)return null;
    if(!response.ok||!validGiftReceipt(data))throw Error('Não foi possível consultar seu presente agora. Use “Consultar novamente”; isso não reenvia o e-mail.');return data;
  }
  async function load(){
    if(busy)return;busy=true;ready=false;byId('retry-load').hidden=true;byId('retry-load').textContent='Consultar novamente';message.textContent='';update();
    try{
      if(!giftId){byId('gift-title').textContent='Presente não encontrado';throw Error('Abra o convite do guia enviado pela VitrineCity.');}
      renderGift(await getGift());if(!gift.available)throw Error('Este presente não está disponível agora. Nenhuma conta foi criada por esta página.');
      const current=await getUser();
      if(current){showUser(current);const status=await getStatus();if(status)renderReceipt(status);else{granted=false;uncertain=false;}}
      else{user=null;mode='register';granted=false;uncertain=false;}
      ready=true;
    }catch(error){message.textContent=error.message||'Não foi possível consultar o presente.';byId('retry-load').hidden=!giftId;}
    finally{busy=false;update();}
  }
  for(const id of ['account-consent','marketing-consent']){byId(id).checked=false;byId(id).addEventListener('change',update);}
  byId('choose-register').addEventListener('click',()=>changeMode('register'));byId('choose-login').addEventListener('click',()=>changeMode('login'));byId('other-account').addEventListener('click',()=>{if(!busy){byId('login-email').value=user?.email||'';changeMode('login');}});
  byId('retry-load').addEventListener('click',load);
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(button.disabled||busy||!form.reportValidity())return;
    if(mode==='register'&&byId('marketing-consent').checked&&byId('gift-whatsapp').value.replace(/\D/g,'').length<10){message.textContent='Informe um WhatsApp com DDD para receber mensagens, ou desmarque essa opção. O guia é gratuito em qualquer caso.';return;}
    busy=true;update();message.textContent='';let claimStarted=false;
    try{
      const fresh=await getGift();if(!fresh.available){ready=false;renderGift(fresh);throw Error('Este presente ficou indisponível. Nenhuma conta foi criada nesta tentativa.');}
      renderGift(fresh);
      const expectedEmail=(mode==='signed'?user.email:byId(mode==='login'?'login-email':'register-email').value).trim().toLowerCase();
      if(mode!=='signed'){
        const registering=mode==='register',body={email:expectedEmail,password:byId(registering?'register-password':'login-password').value};
        if(registering)Object.assign(body,{name:byId('register-name').value.trim(),whatsapp:byId('gift-whatsapp').value.trim(),adultConfirmed:byId('account-consent').checked,termsAccepted:byId('account-consent').checked,communications:{email:false,whatsapp:byId('marketing-consent').checked===true}});
        const response=await request(registering?'/api/auth/register':'/api/auth/login',body),data=await response.json();
        if(!response.ok||data.ok!==true){if(registering&&response.status===409){mode='login';byId('login-email').value=expectedEmail;}throw Error(response.status===409?'Esse e-mail já tem uma conta. Entre aqui para receber seu guia.':data.error||'Não foi possível entrar. Confira seus dados.');}
      }
      const current=await getUser();if(!current||current.email.trim().toLowerCase()!==expectedEmail){user=null;mode='login';throw Error('Confirme seu acesso com o e-mail escolhido antes de receber o guia.');}
      showUser(current);const existing=await getStatus();if(existing){renderReceipt(existing);return;}
      claimStarted=true;uncertain=true;
      const response=await request('/api/gifts/'+giftId+'/claim',{accepted:true,version:gift.version}),data=await response.json();
      if(!response.ok||!validGiftReceipt(data)){
        if(response.status===409&&data.code==='gift_purchase_pending'){message.textContent='Você já iniciou uma compra deste guia. Confira essa compra na sua conta ou fale com a equipe antes de pedir o presente.';byId('retry-load').hidden=false;byId('retry-load').textContent='Consultar novamente';return;}
        throw Error('Ainda não foi possível confirmar a liberação. Use “Consultar novamente”; o e-mail não será reenviado.');
      }
      renderReceipt(data);
    }catch(error){message.textContent=claimStarted?'Ainda não foi possível confirmar a liberação. Use “Consultar novamente” para conferir seu guia sem reenviar o e-mail.':error.message||'Não foi possível continuar.';byId('retry-load').hidden=false;byId('retry-load').textContent='Consultar novamente';}
    finally{byId('register-password').value='';byId('login-password').value='';busy=false;update();}
  });
  const readyPromise=load();return {ready:readyPromise,reload:load};
}
