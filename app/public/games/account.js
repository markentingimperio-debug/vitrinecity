const params=new URLSearchParams(location.search);
const returnTo=['/games/','/games/fazenda','/games/dados'].includes(params.get('returnTo'))?params.get('returnTo'):'/games/fazenda';
const startedAt=Date.now();
function requireLogin(){const panel=document.getElementById('games-private-data');if(panel)panel.hidden=true;document.getElementById('games-requests')?.replaceChildren();const signIn=document.getElementById('games-account-required');if(signIn)signIn.hidden=false;}
const privacyProtocol=value=>typeof value==='string'&&/^LGPD-\d{8}-[A-F0-9]{8}$/.test(value);
async function request(url,body){
  const response=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify(body)}:{credentials:'same-origin',cache:'no-store'});
  const result=await response.json();
  if(!response.ok){const error=new Error([result.error||'Não foi possível concluir agora.',result.protocol&&'Protocolo: '+result.protocol].filter(Boolean).join(' '));error.status=response.status;throw error;}
  return result;
}
for(const form of document.querySelectorAll('[data-games-form]')){
  form.addEventListener('submit',async event=>{
    event.preventDefault();const button=form.querySelector('button'),message=form.querySelector('[role=status]');if(button.disabled)return;
    button.disabled=true;message.textContent='Enviando…';const input=new FormData(form),kind=form.dataset.gamesForm;
    try{
      if(kind==='login'||kind==='register'){
        const body={email:input.get('email'),password:input.get('password')};
        if(kind==='register')Object.assign(body,{name:input.get('name'),adultConfirmed:input.get('adult')==='on',termsAccepted:input.get('terms')==='on',accountContext:'games',communications:{email:false,whatsapp:false}});
        const result=await request('/api/auth/'+kind,body);if(result.ok!==true)throw Error('Não foi possível confirmar o acesso. Tente novamente.');location.assign(returnTo);
      }else if(kind==='reset'){
        const result=await request('/api/auth/password-reset/request',{email:input.get('email')});message.textContent=result.message;
      }else if(kind==='contact'){
        const result=await request('/api/contact',{name:input.get('name'),email:input.get('email'),details:'[VitrineCity Cultiva] '+input.get('details'),subject:'Suporte da minha conta',consent:input.get('consent')==='on',formStartedAt:startedAt,accountContext:'games'});
        if(result.ok!==true||!/^VC-\d{6,}$/.test(result.protocol||''))throw Error('Não foi possível confirmar o protocolo. Tente novamente.');message.textContent='Solicitação recebida. Guarde o protocolo '+result.protocol+'.';form.reset();
      }else if(kind==='deletion'){
        const result=await request('/api/privacy/requests',{requestType:'deletion',details:input.get('details')});if(result.ok!==true||!privacyProtocol(result.protocol))throw Error('Não foi possível confirmar o protocolo. Consulte seus pedidos antes de tentar novamente.');message.textContent='Pedido recebido para análise. Protocolo '+result.protocol+'. Sua conta ainda não foi excluída.';await loadRequests();
      }
    }catch(error){message.textContent=error.status===401&&kind==='deletion'?'Sua sessão terminou. Entre novamente pela opção abaixo.':error.message||'Sem conexão. Tente novamente quando estiver online.';if(error.status===401&&kind==='deletion'){requireLogin();document.getElementById('games-data-status').textContent='Sua sessão terminou. Entre novamente para consultar seus dados.';}}
    finally{button.disabled=false;}
  });
}
if(params.get('assunto')==='exclusao'){
  const details=document.querySelector('[data-games-form=contact] textarea');if(details)details.value='Solicito ajuda para excluir minha conta VitrineCity e os dados associados. Não consigo acessar minha conta.';
}
if(params.get('assunto')==='lia'){
  const details=document.querySelector('[data-games-form=contact] textarea');if(details)details.value='Quero reportar uma resposta da Lia. Conteúdo da resposta e motivo do relato: ';
}
async function loadRequests(){
  const container=document.getElementById('games-requests');if(!container)return;
  const result=await request('/api/privacy/requests');container.replaceChildren();
  for(const item of result.items||[]){const article=document.createElement('article');const status={received:'Recebido',in_progress:'Em análise',completed:'Concluído',rejected:'Não atendido'}[item.status]||item.status;article.textContent=[item.protocol,status,item.responseNote].filter(Boolean).join(' — ');container.append(article);}
  if(!container.childElementCount)container.textContent='Você ainda não tem solicitações registradas.';
}
if(document.getElementById('games-private-data')){
  try{const account=await request('/api/auth/me');if(account.authenticated!==true)throw Error('account_unverified');document.getElementById('games-private-data').hidden=false;await loadRequests();}
  catch(error){if(error.status===401)requireLogin();else document.getElementById('games-data-status').textContent='Não foi possível carregar sua conta. Verifique a conexão e tente novamente.';}
  document.getElementById('games-logout').addEventListener('click',async event=>{event.currentTarget.disabled=true;try{await request('/api/auth/logout',{});location.replace('/games/');}catch{event.currentTarget.disabled=false;document.getElementById('games-data-status').textContent='Não foi possível sair. Tente novamente.';}});
}
