import {KLING_API_LINKS,KLING_READINESS_STATES,assertKlingReadiness} from './neural-kling-contract.js';

/** Readiness only: this module cannot generate, purchase or activate billing. */
export function mountNeuralKlingAdmin(environment=globalThis){
  const {document,location,AbortController}=environment;
  const fetch=environment.fetch.bind(environment),setTimeout=environment.setTimeout.bind(environment),clearTimeout=environment.clearTimeout.bind(environment);
  const $=id=>document.getElementById(id);
  if(!$('kling-panel'))return;
  let snapshot=null,busy=false,controller=null,epoch=0;
  const base='/api/admin/vitriny-neural/kling';
  const links={console:'kling-console-link',pricing:'kling-pricing-link',documentation:'kling-documentation-link',terms:'kling-terms-link'};
  for(const [key,id]of Object.entries(links)){
    const link=$(id);link.href=KLING_API_LINKS[key];link.target='_blank';link.rel='noopener noreferrer';
  }
  function controls(){
    $('kling-panel').setAttribute('aria-busy',String(busy));
    $('kling-check').disabled=busy||snapshot?.configured!==true;
    $('kling-refresh').disabled=busy;
  }
  function resetEvidence(){
    snapshot=null;
    $('kling-credential').textContent='Configuração não confirmada nesta leitura.';
    $('kling-access').textContent='Acesso não confirmado nesta leitura.';
    $('kling-commercial').textContent='Pendentes de conferência na conta da API. Nenhum saldo foi confirmado.';
    $('kling-checked-at').textContent='Nenhuma conferência de acesso carregada.';
    $('kling-package-count').textContent='';$('kling-package-count').hidden=true;
  }
  function renderStatus(value){
    snapshot=value;
    $('kling-stage').textContent=KLING_READINESS_STATES[value.stage];$('kling-stage').setAttribute('data-state',value.stage);
    $('kling-credential').textContent=value.configured?'Configurada no servidor. A chave não é exibida.':'Pendente de configuração segura no servidor.';
    $('kling-access').textContent=KLING_READINESS_STATES[value.stage];
    const summaries={
      credentials_missing:'A credencial da API ainda não foi configurada. Geração para clientes e cobrança continuam desativadas.',
      not_checked:'A credencial foi configurada, mas o acesso ainda não foi conferido. Isso não libera geração nem cobrança.',
      access_verified:'O acesso à API foi conferido. Nenhum vídeo foi gerado; o teste de geração e a cobrança dos clientes continuam pendentes.',
      credentials_rejected:'A API não aceitou a credencial na última conferência. Geração e cobrança continuam desativadas.',
      unavailable:'A última conferência não confirmou o acesso. Geração e cobrança continuam desativadas.'
    };
    $('kling-status').textContent=summaries[value.stage];
    if(value.checkedAt){
      const checked=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'medium',timeZone:'America/Sao_Paulo'}).format(new Date(value.checkedAt));
      $('kling-checked-at').textContent='Última conferência: '+checked+' · horário de Brasília.';
    }
    if(value.stage==='access_verified'){
      $('kling-package-count').textContent='Pacotes retornados pela API: '+value.packageCount+'. Isso não confirma saldo disponível.';
      $('kling-package-count').hidden=false;
      $('kling-commercial').textContent='Acesso conferido; créditos disponíveis e condições comerciais ainda precisam ser confirmados na conta da API.';
    }
    if(['credentials_rejected','unavailable'].includes(value.stage)){
      $('kling-error').textContent=summaries[value.stage];$('kling-error').hidden=false;
    }
  }
  async function load(check=false){
    if(busy||check&&snapshot?.configured!==true)return;
    const generation=epoch;busy=true;resetEvidence();
    $('kling-error').textContent='';$('kling-error').hidden=true;$('kling-login').hidden=true;
    $('kling-stage').textContent=check?'Conferindo acesso…':'Carregando estado';$('kling-stage').setAttribute('data-state','loading');
    $('kling-status').textContent=check?'Conferindo acesso em modo somente leitura. Nenhum vídeo ou pagamento será iniciado.':'Carregando o estado salvo, sem iniciar uma conferência de acesso.';
    controls();
    controller=new AbortController();const activeController=controller,timer=setTimeout(()=>activeController.abort(),20000);
    try{
      const response=await fetch(base+(check?'/check':'/status'),{method:check?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:activeController.signal,
        headers:{Accept:'application/json',...(check?{'content-type':'application/json','x-neural-request':'1'}:{})},...(check?{body:'{}'}:{})});
      if(generation!==epoch)return;
      if(!response.ok)throw Object.assign(new Error('kling_http_failed'),{status:response.status});
      const data=await response.json();
      if(generation!==epoch)return;
      if(!data||data.ok!==true)throw new TypeError('kling_response_invalid');
      renderStatus(assertKlingReadiness(data.status));
    }catch(error){
      if(generation!==epoch)return;
      resetEvidence();$('kling-stage').textContent='Estado não confirmado';$('kling-stage').setAttribute('data-state','error');
      $('kling-status').textContent='Esta leitura não confirmou o acesso à API. Um resultado anterior não está sendo apresentado como validação atual.';
      $('kling-error').textContent=error?.status===401?'Sua sessão expirou. Entre novamente para conferir o estado da integração.':error?.status===403?'Este acesso não tem permissão para conferir a integração Kling.':'Não foi possível confirmar o estado da integração. Atualize o estado salvo e tente novamente. Nenhuma geração ou cobrança foi iniciada.';
      $('kling-error').hidden=false;
      if(error?.status===401){$('kling-login').hidden=false;location.assign('/admin-login.html');}
    }finally{
      clearTimeout(timer);if(generation===epoch){busy=false;controller=null;controls();}
    }
  }
  $('kling-check').addEventListener('click',()=>load(true));
  $('kling-refresh').addEventListener('click',()=>load(false));
  environment.window?.addEventListener('pagehide',()=>{epoch++;controller?.abort();busy=false;resetEvidence();$('kling-stage').textContent='Estado não confirmado';$('kling-stage').setAttribute('data-state','loading');controls();});
  environment.window?.addEventListener('pageshow',event=>{if(event.persisted)load(false);});
  load(false);
}
if(typeof document!=='undefined'&&typeof window!=='undefined')mountNeuralKlingAdmin();
