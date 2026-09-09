import {storyHistoryLink,storyPublicHref,storyOutcomeSummary,storyDiagnosticLines} from './admin-web-story-recovery.js';
export {storyHistoryLink} from './admin-web-story-recovery.js';
const ENDPOINT='/api/admin/web-story-automation';
const GROUPS={products:'Produtos e ofertas',services:'Lojas, serviços e cursos',news:'Notícias e celebridades',recipes:'Receitas',sports:'Esportes',trends:'Cidade e tendências'};
const JOBS={running:'Em preparação',published:'Publicada nesta tentativa',review:'Tentativa ficou em revisão',failed:'Tentativa não concluída',interrupted:'Tentativa interrompida'};
const REASONS={disabled:'A rotina está pausada.',not_configured:'A preparação automática ainda não está disponível. Confira a configuração da IA Gestora.',running:'Uma rodada está em preparação. Você pode acompanhar o andamento abaixo.',daily_limit:'O limite de hoje foi utilizado. A próxima rodada respeitará o próximo dia.',before_schedule:'Aguardando o horário programado.',already_scheduled:'A rodada programada de hoje já foi executada.',completed:'Rodada concluída.',no_candidates:'Não há novos conteúdos elegíveis para as categorias escolhidas.',candidate_error:'Não foi possível consultar os conteúdos. Atualize o status e tente novamente.',worker_error:'A rodada não foi concluída. Confira o histórico e tente novamente mais tarde.',interrupted:'A rodada foi interrompida. Confira o histórico antes de continuar.',clock_behind:'A rotina aguarda a regularização do horário do servidor.',closed:'A rotina está temporariamente indisponível.',settings_changed:'Configuração salva. A rotina seguirá o horário e o limite escolhidos.'};

export function validAutomationStatus(value){
  if(!value||typeof value.enabled!=='boolean'||typeof value.configured!=='boolean'||typeof value.running!=='boolean'||!Number.isInteger(value.revision)||!Number.isInteger(value.dailyLimit)||value.dailyLimit<1||value.dailyLimit>24||!Number.isInteger(value.hour)||value.hour<0||value.hour>23||!Array.isArray(value.groups)||!value.groups.every(group=>Object.hasOwn(GROUPS,group))||!value.quota||!Number.isInteger(value.quota.attempted)||!Number.isInteger(value.quota.remaining))throw Error('Não foi possível ler a configuração completa. Atualize o status para tentar novamente.');
  return value;
}
Object.assign(REASONS,{global_paused:'As publicações estão pausadas na Central de Operações.',centrally_coordinated:'A agenda é coordenada pela Central de Operações.',candidate_retry_wait:'A consulta de fontes falhou. Aguarde a próxima consulta indicada; nenhuma preparação foi iniciada nessa consulta.',candidate_retry_limit:'O limite de consultas com falha foi atingido hoje. Confira o catálogo antes do próximo ciclo.'});
export const canRunAutomation=status=>!!status&&status.enabled&&status.configured&&!status.closed&&!status.running&&status.reason!=='global_paused'&&status.quota.remaining>0&&!status.catalogRetry?.pending;
const formattedDate=value=>{if(value===null||value===undefined||value==='')return 'Horário ainda não definido';const date=new Date(value);return Number.isNaN(date.valueOf())?'Horário ainda não definido':new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(date);};

export function mountStoryAutomation(root,{fetcher=globalThis.fetch,document=root.ownerDocument,window=globalThis.window,setTimer=globalThis.setTimeout,clearTimer=globalThis.clearTimeout,pollMs=5000}={}) {
  const $=id=>root.querySelector('#'+id),form=$('automation-form'),message=$('automation-message');
  const node=(tag,text,attrs={})=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;Object.assign(el,attrs);return el;};
  let state=null,editRevision=null,dirty=false,writing=false,readFailed=false,destroyed=false,suspended=false,timer=null,reader=null,writer=null,generation=0;
  const visible=()=>!destroyed&&!suspended&&!document.hidden;
  function stop(){if(timer!==null)clearTimer(timer);timer=null;}
  function controls(){
    const unavailable=writing||!state||!!state.closed||readFailed;
    for(const el of form.querySelectorAll('input,select'))el.disabled=unavailable;
    $('automation-save').disabled=unavailable;
    $('automation-run').disabled=writing||readFailed||dirty||!canRunAutomation(state);
    $('automation-pause').disabled=writing||readFailed||!state?.enabled||!!state?.closed;
    $('automation-pause').hidden=!state?.enabled;
    $('automation-refresh').disabled=writing;
    root.setAttribute('aria-busy',String(writing||(!state&&!readFailed)));
  }
  function render(data,{reset=false}={}){
    state=validAutomationStatus(data);readFailed=false;
    if(reset||!dirty){$('automation-enabled').checked=state.enabled;$('automation-limit').value=String(state.dailyLimit);$('automation-hour').value=String(state.hour);for(const input of form.querySelectorAll('input[name=groups]'))input.checked=state.groups.includes(input.value);editRevision=state.revision;dirty=false;}
    $('automation-state').textContent=state.closed?'Indisponível':state.reason==='global_paused'?'Pausa global ativa':!state.enabled?'Pausada':!state.configured?'Aguardando IA':state.running?'Em preparação':state.catalogRetry?.pending?'Consulta de fontes pendente':state.quota.remaining<=0?'Limite de hoje atingido':'Programada';
    $('automation-state').dataset.active=String(state.running&&!state.closed);
    $('automation-next').textContent=state.reason==='global_paused'?'Aguardando retomada na Central':state.running?'Rodada em andamento':!state.enabled?'Rotina pausada':!state.configured?'Aguardando configuração':formattedDate(state.nextAt);
    $('automation-quota').textContent=`${state.quota.attempted} de ${state.dailyLimit} tentativas`;
    $('automation-results').textContent=storyOutcomeSummary(state);
    if($('automation-published'))$('automation-published').textContent=Number.isInteger(state.publications?.today)?String(state.publications.today):'Não informado';
    if($('automation-publication-note'))$('automation-publication-note').textContent='Primeiras publicações ainda disponíveis hoje, incluindo revisão manual. Tentativas antigas não são apagadas.';
    $('automation-provider').textContent=state.configured?'Disponível':'Precisa de configuração';
    const history=$('automation-history');history.replaceChildren();
    for(const item of (Array.isArray(state.history)?state.history:[]).slice(0,30)){
      const li=node('li'),copy=node('div'),heading=node('strong',JOBS[item.status]||'Não concluída'),context=node('span',GROUPS[item.sourceGroup]||'Conteúdo'),time=node('time',formattedDate(item.finishedAt??item.startedAt));
      copy.append(heading,context,time);if(typeof item.summary==='string'&&item.summary.trim())copy.append(node('p',item.summary));
      else if(item.status==='review')copy.append(node('p','Esta tentativa não registrou um motivo detalhado. Confira a fonte e o rascunho antes de publicar.'));
      else if(item.status==='failed')copy.append(node('p','A preparação não foi concluída. Nenhuma publicação foi confirmada nesta tentativa.'));
      const recovery=item.recovery||{};
      if(typeof recovery.title==='string'&&recovery.title.trim())copy.append(node('p',recovery.title,{className:'history-source-title'}));
      for(const detail of storyDiagnosticLines(item.diagnostics))copy.append(node('p',detail));
      if(recovery.published===true&&item.status!=='published')copy.append(node('p','Uma versão atual desta fonte já está publicada. O resultado desta tentativa foi preservado.',{className:'history-recovered'}));
      else if(recovery.sourceAvailable===false)copy.append(node('p','A origem não está disponível no catálogo publicado. Confira o cadastro original antes de continuar.'));
      li.append(copy);const actions=node('div',undefined,{className:'history-actions'}),href=storyHistoryLink(item);
      if(href)actions.append(node('a',recovery.storyId||item.storyId?'Abrir editor →':'Revisar esta fonte →',{href}));
      const sourceUrl=storyPublicHref(recovery.sourceUrl);if(sourceUrl)actions.append(node('a','Ver página de origem ↗',{href:sourceUrl,target:'_blank',rel:'noopener'}));
      const publishedUrl=recovery.published===true&&storyPublicHref(recovery.publishedUrl);if(publishedUrl)actions.append(node('a','Ver publicação ↗',{href:publishedUrl,target:'_blank',rel:'noopener'}));
      if(actions.children.length)li.append(actions);history.append(li);
    }
    if(!history.children.length)history.append(node('li','Nenhuma preparação registrada ainda.'));
    message.textContent=dirty?'Há alterações não salvas. Salve a rotina para aplicá-las.':REASONS[state.reason]||(state.enabled?'Rotina configurada. Confira abaixo os resultados confirmados.':'A rotina está pausada.');
    if(!dirty&&state.catalogRetry?.pending)message.textContent+=' '+(state.catalogRetry.nextAt?'Próxima consulta: '+formattedDate(state.catalogRetry.nextAt)+'.':'Sem nova consulta prevista hoje.');controls();
  }
  async function responseData(response){
    const data=await response.json().catch(()=>({}));
    if(response.status===401){window?.location?.assign?.('/admin-login.html?returnTo=%2Fadmin-web-stories');throw Error('Entre novamente no painel para continuar.');}
    if(!response.ok){const error=Error(typeof data.error==='string'&&data.error.trim()?data.error:response.status===409?'A configuração mudou em outra sessão. Atualize o status e confira os valores antes de salvar.':'Não foi possível concluir. Atualize o status e tente novamente.');error.status=response.status;throw error;}
    return validAutomationStatus(data);
  }
  function poll(){stop();if(visible()&&state?.running&&!writing&&!readFailed)timer=setTimer(()=>{timer=null;refresh();},pollMs);}
  async function refresh({reset=false}={}){
    if(!visible()||writing)return;stop();reader?.abort();reader=new AbortController();const own=++generation;
    try{const response=await fetcher(ENDPOINT,{credentials:'same-origin',signal:reader.signal});const data=await responseData(response);if(own===generation&&visible())render(data,{reset});}
    catch(error){if(own===generation&&error.name!=='AbortError'&&visible()){readFailed=true;message.textContent=error.message;controls();}}
    finally{if(own===generation)poll();}
  }
  function payload(enabled){return {enabled:enabled??$('automation-enabled').checked,dailyLimit:Number($('automation-limit').value),hour:Number($('automation-hour').value),groups:[...form.querySelectorAll('input[name=groups]')].filter(input=>input.checked).map(input=>input.value),revision:editRevision};}
  async function mutate(suffix,method,body){
    if(writing||!state||readFailed)return;stop();reader?.abort();generation++;writing=true;writer=new AbortController();message.textContent=suffix? 'Iniciando a rodada…':'Salvando a rotina…';controls();
    try{const response=await fetcher(ENDPOINT+suffix,{method,credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:writer.signal});const data=await responseData(response);if(visible())render(data,{reset:true});}
    catch(error){if(error.name!=='AbortError'&&visible()){message.textContent=error.message;if(error.status===409){readFailed=true;dirty=false;}controls();}}
    finally{const interrupted=writer?.signal.aborted;writing=false;writer=null;controls();if(interrupted&&visible())refresh();else poll();}
  }
  function change(){dirty=true;message.textContent='Há alterações não salvas. Salve a rotina para aplicá-las.';controls();}
  function save(event){event.preventDefault();if(!form.reportValidity())return;const data=payload();if(!data.groups.length){message.textContent='Escolha pelo menos uma categoria.';return;}mutate('','PUT',data);}
  const pause=()=>{if(state?.enabled)mutate('','PUT',{enabled:false,dailyLimit:state.dailyLimit,hour:state.hour,groups:[...state.groups],revision:state.revision});};
  const run=()=>{if(!dirty&&canRunAutomation(state))mutate('/run','POST',{});};
  const refreshClick=()=>refresh({reset:readFailed});
  const suspend=()=>{stop();reader?.abort();writer?.abort();generation++;};
  const visibility=()=>{if(document.hidden)suspend();else refresh();};
  const pageHide=()=>{suspended=true;suspend();};
  const pageShow=()=>{suspended=false;refresh();};
  for(let hour=0;hour<24;hour++)if(hour!==9)$('automation-hour').append(node('option',String(hour).padStart(2,'0')+':00 · Brasília',{value:String(hour)}));
  const hours=[...$('automation-hour').children].sort((a,b)=>Number(a.value)-Number(b.value));$('automation-hour').replaceChildren(...hours);$('automation-hour').value='9';
  form.addEventListener('change',change);form.addEventListener('submit',save);$('automation-pause').addEventListener('click',pause);$('automation-run').addEventListener('click',run);$('automation-refresh').addEventListener('click',refreshClick);
  document.addEventListener('visibilitychange',visibility);window?.addEventListener?.('pagehide',pageHide);window?.addEventListener?.('pageshow',pageShow);controls();refresh();
  return {refresh,destroy(){destroyed=true;suspend();form.removeEventListener('change',change);form.removeEventListener('submit',save);$('automation-pause').removeEventListener('click',pause);$('automation-run').removeEventListener('click',run);$('automation-refresh').removeEventListener('click',refreshClick);document.removeEventListener('visibilitychange',visibility);window?.removeEventListener?.('pagehide',pageHide);window?.removeEventListener?.('pageshow',pageShow);}};
}

if(typeof document!=='undefined'){const root=document.getElementById('story-automation');if(root)mountStoryAutomation(root);}
