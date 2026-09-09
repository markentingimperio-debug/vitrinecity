import {safeResultImageUrl} from './search-result-image.js';

const API='/api/admin/ecosystem';
export const OPERATION_GROUPS=['products','services','news','recipes','sports','trends'];
const CATALOGS={products:'Produtos',stores:'Lojas',pages:'Páginas',buildings:'Prédios',networks:'Redes'};
const STATES={planned:['Planejado','neutral'],queued:['Na fila','neutral'],running:['Em preparação','active'],in_progress:['Em andamento','active'],processing:['Em processamento','active'],published:['Publicado','good'],sent:['Enviado','good'],review:['Precisa de atenção','warn'],awaiting_approval:['Aguardando decisão','warn'],failed:['Não concluído','bad'],interrupted:['Interrompido','warn'],blocked:['Com pendência','warn'],paused:['Pausado','neutral'],completed:['Etapa concluída','good'],draft:['Rascunho','neutral'],active:['Ativo','neutral'],unknown:['Sem confirmação','warn'],cancelled:['Cancelado','neutral'],approved:['Aprovado','good'],ready:['Pronto','neutral'],disabled:['Desligado','neutral']};
const STEPS=[{label:'Pautas',kinds:['content','source','topic','trend','planned_content']},{label:'Páginas',kinds:['page','article','product','pages']},{label:'Web Stories',kinds:['story','stories','web_story']},{label:'Distribuição',kinds:['distribution','social','internal_social','external_social']},{label:'Resultados',kinds:['result','results','metrics']}];
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const count=value=>number(value)===null?'—':value.toLocaleString('pt-BR');
const text=value=>typeof value==='string'?value:'';
const date=value=>{if(value===null||value===undefined||value==='')return null;const d=new Date(value);return Number.isFinite(d.valueOf())?d:null;};
const dateLabel=value=>{const d=date(value);return d?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(d):'Horário não informado';};
const timeLabel=value=>{const d=date(value);return d?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(d):'—';};

export function operationState(value){return STATES[value]||({preview:['Prévia','neutral'],connected:['Conectado','neutral'],partial:['Conexão parcial','warn'],missing:['Conexão pendente','warn'],pending:['Pendente','warn']})[value]||['Estado não informado','neutral'];}
export function operationHref(value,origin){
  if(typeof value!=='string'||!value||value.length>2048||/[\u0000-\u0020\u007f\\]/.test(value)||value.startsWith('//'))return '';
  try{const own=new URL(origin),url=new URL(value,own);if(url.username||url.password)return '';if(url.origin===own.origin){if(!value.startsWith('/')&&!/^https?:\/\//.test(value))return '';if(/^\/api(?:\/|$)|^\/(?:logout|sair)(?:[/.]|$)/i.test(url.pathname))return '';return url.pathname+url.search+url.hash;}if(url.protocol!=='https:'||url.port||!url.hostname.includes('.')||/^[\d.]+$/.test(url.hostname)||/[:]|(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname))return '';return url.href;}catch{return '';}
}
export function operationPolicy(value){
  if(!value||!Number.isInteger(value.revision)||value.revision<0||typeof value.enabled!=='boolean'||typeof value.paused!=='boolean'||typeof value.internalSocialEnabled!=='boolean'||!Number.isInteger(value.dailyLimit)||value.dailyLimit<1||value.dailyLimit>24||!Number.isInteger(value.hour)||value.hour<0||value.hour>23||!Array.isArray(value.groups)||!value.groups.length||value.groups.some(group=>!OPERATION_GROUPS.includes(group))||new Set(value.groups).size!==value.groups.length)throw Error('Não foi possível ler as opções completas da rotina. Atualize o painel.');
  return {revision:value.revision,enabled:value.enabled,paused:value.paused,dailyLimit:value.dailyLimit,hour:value.hour,groups:[...value.groups],internalSocialEnabled:value.internalSocialEnabled};
}
export function operationSnapshot(value){
  operationPolicy(value?.policy);
  if(!value.automation||!value.plan||!Array.isArray(value.plan.items)||!['inventory','connections','agents','exceptions','events'].every(key=>Array.isArray(value[key]))||!value.metrics||!Array.isArray(value.metrics.items))throw Error('Os dados da operação estão incompletos. Atualize antes de executar uma ação.');
  return value;
}
export function canRunOperation(value){return !!value&&value.policy.enabled&&!value.policy.paused&&value.automation.enabled===true&&value.automation.configured===true&&value.automation.running===false&&!value.automation.closed&&((number(value.automation.quota?.remaining)>0&&!value.automation.catalogRetry?.pending)||value.policy.internalSocialEnabled===true);}
export function metricValue(item){
  if(item?.available!==true||number(item.value)===null)return '—';
  if(item.unit==='BRL_cents')return (item.value/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  if(item.unit==='BRL'||item.unit==='brl'||item.unit==='currency')return item.value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  if(item.unit==='percent'||item.unit==='%')return item.value.toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
  return item.value.toLocaleString('pt-BR',{maximumFractionDigits:2});
}

export function mountOperations(root,{document=root.ownerDocument,window=document.defaultView,fetcher=(...args)=>fetch(...args),setTimer=setTimeout,clearTimer=clearTimeout,pollMs=30000}={}){
  const $=name=>root.querySelector('#ec'+name),form=$('PolicyForm'),groupInputs=[...form.querySelectorAll('input[name=groups]')],tabs=[...$('CatalogTabs').querySelectorAll('[data-kind]')];
  const origin=window.location.origin,node=(tag,value,cls)=>{const el=document.createElement(tag);if(value!==undefined)el.textContent=String(value);if(cls)el.className=cls;return el;};
  let snapshot=null,dirty=false,editRevision=null,busy=false,readFailed=false,destroyed=false,suspended=false,timer=null,readController=null,writeController=null,readGeneration=0,catalogController=null,catalogGeneration=0,catalogBusy=false,kind='products',query='',offset=0,nextOffset=null;
  const listeners=[];
  const listen=(target,event,handler)=>{target.addEventListener(event,handler);listeners.push(()=>target.removeEventListener(event,handler));};
  const visible=()=>!destroyed&&!suspended&&!document.hidden;
  function announce(message,error=false){$('Notice').textContent=message;$('Notice').dataset.error=String(error);}
  function stopPoll(){if(timer!==null)clearTimer(timer);timer=null;}
  function schedulePoll(){stopPoll();if(visible()&&snapshot&&!readFailed&&!busy)timer=setTimer(()=>{timer=null;refresh();},pollMs);}
  function badge(status,label){const [fallback,tone]=operationState(status),el=node('span',label||fallback,'badge');el.dataset.tone=tone;return el;}
  function link(label,value){const href=operationHref(value,origin);if(!href)return null;const el=node('a',label);el.href=href;if(/^https:\/\//.test(href)){el.target='_blank';el.rel='noopener noreferrer';}return el;}
  function empty(target,message,tag='p'){target.replaceChildren(node(tag,message,'empty'));}
  function controls(){
    const unavailable=busy||!snapshot||readFailed;
    for(const input of form.querySelectorAll('input,select'))input.disabled=unavailable;
    $('Save').disabled=unavailable;$('Run').disabled=unavailable||dirty||!canRunOperation(snapshot);$('Pause').disabled=unavailable;$('Refresh').disabled=busy;
    $('Run').textContent=snapshot?.policy.internalSocialEnabled&&number(snapshot.automation.quota?.remaining)===0?'Divulgar aprovados':'Executar rodada';
    $('Pause').textContent=snapshot?.policy.paused?'Retomar automações':'Pausar automações';
    $('Search').disabled=catalogBusy;$('Previous').disabled=catalogBusy||offset===0;$('NextPage').disabled=catalogBusy||nextOffset===null;
    root.setAttribute('aria-busy',String(busy||(!snapshot&&!readFailed)));
  }
  function renderPolicy(reset=false){
    const p=snapshot.policy,a=snapshot.automation;
    if(reset||!dirty){$('Enabled').checked=p.enabled;$('Limit').value=String(p.dailyLimit);$('Hour').value=String(p.hour);$('InternalSocial').checked=p.internalSocialEnabled;groupInputs.forEach(input=>input.checked=p.groups.includes(input.value));editRevision=p.revision;dirty=false;}
    $('PolicyNote').textContent=dirty?'Há alterações não salvas. Salve a rotina antes de executar.':p.paused?'Pausa global ativa. As opções continuam salvas.':'Opções carregadas. Salvar não executa uma rodada imediata.';
    $('Quota').textContent=number(a.quota?.attempted)!==null?count(a.quota.attempted)+' de '+count(p.dailyLimit)+' tentativas hoje':'Limite de hoje não informado';
    $('PauseNote').textContent=p.paused?'Pausa global ativa. O histórico e as publicações são preservados. Uma ação já enviada ao serviço pode concluir. Retomar preserva as opções de cada rotina.':'Pausar impede novas ações coordenadas. Uma ação já enviada ao serviço pode concluir; o histórico e as publicações são preservados.';
  }
  function renderHeader(){
    const p=snapshot.policy,a=snapshot.automation,day=text(snapshot.plan.date);
    const d=date(/^\d{4}-\d{2}-\d{2}$/.test(day)?day+'T15:00:00Z':day);
    $('Date').textContent=d?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'numeric',month:'long'}).format(d):'Data da agenda não informada';
    const state=p.paused?'Pausa global ativa':a.running===true?'Preparação em andamento':!p.enabled?'Coordenação desligada':a.configured!==true?'Aguardando configuração':a.enabled!==true?'Produção diária desligada':a.catalogRetry?.pending?'Consulta de fontes pendente':number(a.quota?.remaining)===0?'Limite de criação utilizado':'Rotina programada';
    $('State').textContent=state;$('State').dataset.tone=p.paused||!p.enabled?'neutral':a.running?'active':!a.configured?'warn':'neutral';
    $('Next').textContent=p.paused?'Retome quando quiser continuar.':a.running?'Acompanhe as etapas e as pendências abaixo.':number(a.quota?.remaining)===0&&p.internalSocialEnabled?'Você pode divulgar conteúdos já aprovados, sem novas gerações de IA.':snapshot.plan.nextAt?'Próxima rodada: '+dateLabel(snapshot.plan.nextAt):'Próxima rodada ainda não informada.';
    $('Updated').textContent='Painel atualizado agora · horários de Brasília';
    if($('Published'))$('Published').textContent=count(a.publications?.today);
    if($('Attempts'))$('Attempts').textContent=count(a.quota?.attempted);
    if($('Reviews'))$('Reviews').textContent=count(a.quota?.review);
    if($('ProductionNote'))$('ProductionNote').textContent='Web Stories: '+count(a.quota?.published)+' publicadas pela rotina · '+count(a.quota?.failed)+' tentativas com falha · '+count(a.quota?.interrupted)+' interrompidas. A revisão manual pode publicar uma versão depois; o resultado da tentativa é preservado.';
  }
  function renderPlan(){
    const items=snapshot.plan.items;$('PlanCount').textContent=items.length+' etapas registradas';const target=$('Plan');target.replaceChildren();
    for(const item of items.slice(0,50)){const li=node('li'),time=node('time',timeLabel(item.startedAt||item.finishedAt)),copy=node('div',undefined,'item-copy'),heading=node('div',undefined,'item-head'),recovered=item.recovery?.published===true&&item.status!=='published';heading.append(node('h3',item.recovery?.title||item.label||'Etapa da operação'),badge(item.status,recovered?'Resultado da tentativa preservado':undefined));copy.append(heading);if(item.reason)copy.append(node('p',item.reason));if(recovered)copy.append(badge('published','Versão atual publicada'));const open=link('Abrir detalhe ↗',item.url);if(open)copy.append(open);if(item.recovery?.published===true){const published=link('Ver publicação ↗',item.recovery.publishedUrl);if(published)copy.append(published);}li.append(time,copy);target.append(li);}
    if(!items.length)empty(target,'Ainda não há etapas registradas para este dia. A rotina usa os conteúdos disponíveis e respeita o limite salvo.','li');
    const flow=$('Workflow');flow.replaceChildren();
    STEPS.forEach((step,index)=>{const rows=items.filter(item=>step.kinds.includes(item.kind)),li=node('li');li.append(node('span',String(index+1).padStart(2,'0'),'step-index'),node('strong',step.label));let description='Sem atividade informada';if(rows.length){const working=rows.filter(item=>['running','in_progress','processing'].includes(item.status)).length,needs=rows.filter(item=>!item.recovery?.published&&['review','blocked','failed','interrupted'].includes(item.status)).length;description=working?working+' em andamento':needs?needs+' precisam de atenção':rows.length+' etapas registradas';}li.append(node('small',description));flow.append(li);});
  }
  function renderExceptions(){
    const target=$('Exceptions');target.replaceChildren();$('ExceptionCount').textContent=String(snapshot.exceptions.length);
    for(const item of snapshot.exceptions.slice(0,30)){const card=node('article');card.append(node('h3',item.title||'Pendência da operação'));if(item.detail)card.append(node('p',item.detail));const open=link(item.actionLabel||'Resolver pendência ↗',item.actionUrl);if(open)card.append(open);target.append(card);}
    if(!snapshot.exceptions.length)empty(target,'Nenhuma pendência informada nesta atualização.');
  }
  function renderInventory(){const target=$('Inventory');target.replaceChildren();for(const item of snapshot.inventory){const card=node('div',undefined,'inventory-item');card.append(node('strong',item.available===false?'—':count(item.total)),node('span',item.label||CATALOGS[item.kind]||'Cadastros'));target.append(card);}}
  function renderConnections(){
    const target=$('Connections');target.replaceChildren();
    for(const item of snapshot.connections){const card=node('article',undefined,'connection-card');card.append(node('h3',item.label||'Canal'),badge(item.canPublish===true?'approved':'blocked',item.canPublish===true?'Publicação habilitada':'Publicação não habilitada'));if(number(item.connectedCount)!==null)card.append(node('p',count(item.connectedCount)+' contas conectadas'));if(item.reason)card.append(node('p',item.reason));const open=link('Ver conexão e pendências ↗',item.adminUrl);if(open)card.append(open);target.append(card);}
    if(!snapshot.connections.length)empty(target,'Nenhuma conexão foi informada pela operação.');
  }
  function renderMetrics(){
    $('MetricsPeriod').textContent=(number(snapshot.metrics.periodDays)>0?'Últimos '+count(snapshot.metrics.periodDays)+' dias':'Período não informado')+(snapshot.metrics.updatedAt?' · atualizado em '+dateLabel(snapshot.metrics.updatedAt):'');
    const target=$('Metrics');target.replaceChildren();for(const item of snapshot.metrics.items){const card=node('article',undefined,'metric');card.append(node('span',item.label||'Indicador'),node('strong',metricValue(item)));if(item.note)card.append(node('small',item.note));else if(item.available!==true)card.append(node('small','Dado ainda indisponível.'));if(item.available===true&&item.confirmed===false)card.append(node('small','Informação sem confirmação de resultado.'));target.append(card);}if(!snapshot.metrics.items.length)empty(target,'Ainda não há indicadores informados.');
  }
  function renderActivity(){
    const agents=$('Agents');agents.replaceChildren();for(const item of snapshot.agents.slice(0,15)){const card=node('article'),head=node('div',undefined,'item-head');head.append(node('h3',item.name||'Atividade da equipe'),badge(item.status));card.append(head);if(item.detail)card.append(node('p',item.detail));agents.append(card);}if(!snapshot.agents.length)empty(agents,'Nenhuma atividade de aprendizado informada nesta atualização.');
    const events=$('Events');events.replaceChildren();for(const item of snapshot.events.slice(0,20)){const li=node('li'),head=node('div',undefined,'item-head');head.append(node('strong',item.title||'Atividade registrada'),badge(item.status));li.append(head);if(item.detail)li.append(node('p',item.detail));li.append(node('time',dateLabel(item.at)));events.append(li);}if(!snapshot.events.length)empty(events,'Nenhuma atividade recente informada.','li');
  }
  function render(value,{reset=false}={}){snapshot=operationSnapshot(value);readFailed=false;renderHeader();renderPolicy(reset);renderPlan();renderExceptions();renderInventory();renderConnections();renderMetrics();renderActivity();controls();}
  async function responseData(response){let data;try{data=await response.json();}catch{throw Error('O painel recebeu uma resposta incompleta. Atualize novamente.');}if(response.status===401||response.status===403){const error=Error('Seu acesso expirou ou não permite esta operação. Entre novamente pelo painel administrativo.');error.status=response.status;throw error;}if(!response.ok){const error=Error(text(data?.error)|| (response.status===409?'A rotina mudou em outra sessão. Atualize antes de salvar novamente.':'Não foi possível concluir. Atualize o painel e confira o estado.'));error.status=response.status;throw error;}return data;}
  async function request(path,options={}){
    const signal=typeof AbortSignal.any==='function'&&typeof AbortSignal.timeout==='function'?AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(20000)]):options.signal;
    try{return await responseData(await fetcher(API+path,{credentials:'same-origin',cache:'no-store',...options,signal}));}
    catch(error){if(error.name==='TimeoutError')throw Error('O serviço demorou a responder. Atualize para conferir o estado da operação.');if(error instanceof TypeError)throw Error('A conexão falhou. Atualize para conferir o estado da operação.');throw error;}
  }
  async function refresh({reset=false}={}){
    if(!visible()||busy)return;stopPoll();readController?.abort();const controller=new AbortController(),generation=++readGeneration;readController=controller;
    try{const data=await request('',{signal:controller.signal});if(generation!==readGeneration||!visible())return;render(data,{reset:reset||readFailed});announce(dirty?'Painel atualizado. Suas alterações ainda não foram salvas.':'Estado da operação atualizado.');}
    catch(error){if(error.name!=='AbortError'&&generation===readGeneration&&visible()){readFailed=true;announce(error.message||'Não foi possível consultar a operação.',true);$('State').textContent='Leitura indisponível';$('State').dataset.tone='warn';$('Updated').textContent=snapshot?'Exibindo a última leitura. Atualize antes de agir.':'Nenhum estado confirmado.';controls();}}
    finally{if(readController===controller)readController=null;if(generation===readGeneration)schedulePoll();}
  }
  async function mutate(path,body){
    if(busy||!snapshot||readFailed||destroyed)return;busy=true;stopPoll();readController?.abort();readGeneration++;const controller=new AbortController();writeController=controller;controls();announce(path==='/run'?(number(snapshot.automation.quota?.remaining)===0?'Solicitando a divulgação de conteúdos aprovados, sem novas gerações de IA…':'Solicitando uma rodada dentro do limite diário…'):'Salvando o controle da operação…');
    try{const data=await request(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:controller.signal});if(destroyed)return;render(data,{reset:path==='/policy'&&Object.hasOwn(body,'enabled')});if(path==='/policy'&&!Object.hasOwn(body,'enabled')&&dirty)editRevision=snapshot.policy.revision;announce(path==='/run'?'Solicitação registrada. Acompanhe as etapas; publicação só aparece após confirmação.':snapshot.policy.paused?'Automações pausadas. Confira abaixo as ações que já estavam em andamento.':'Controle salvo. Confira o estado atual e a próxima execução.');}
    catch(error){if(!destroyed){readFailed=true;announce(error.name==='AbortError'?'A confirmação foi interrompida. Atualize para conferir o estado antes de tentar outra ação.':(error.message||'Não foi possível confirmar a ação.')+' Atualize antes de tentar novamente.',true);}}
    finally{if(writeController===controller)writeController=null;busy=false;if(!destroyed){controls();schedulePoll();}}
  }
  function changed(){dirty=true;$('PolicyNote').textContent='Há alterações não salvas. Salve a rotina antes de executar.';controls();}
  function save(event){event.preventDefault();if(busy||readFailed||!snapshot||!form.reportValidity())return;try{const p=operationPolicy({revision:editRevision,enabled:$('Enabled').checked,paused:snapshot.policy.paused,dailyLimit:Number($('Limit').value),hour:Number($('Hour').value),groups:groupInputs.filter(input=>input.checked).map(input=>input.value),internalSocialEnabled:$('InternalSocial').checked});mutate('/policy',p);}catch{announce('Escolha ao menos um assunto, um horário e um limite entre 1 e 24 preparações.',true);}}
  function pause(){if(snapshot&&!busy&&!readFailed)mutate('/policy',{revision:snapshot.policy.revision,paused:!snapshot.policy.paused});}
  function run(){if(!dirty&&canRunOperation(snapshot))mutate('/run',{});}
  function catalogRows(data){
    if(!data||data.kind!==kind||!Array.isArray(data.items)||!Number.isInteger(data.offset)||data.offset<0||!Number.isInteger(data.total)||data.total<0||!(data.nextOffset===null||Number.isInteger(data.nextOffset)))throw Error('Não foi possível ler o catálogo completo. Busque novamente.');
    offset=data.offset;nextOffset=Number.isInteger(data.nextOffset)&&data.nextOffset>offset?data.nextOffset:null;const target=$('Catalog');target.replaceChildren();
    for(const item of data.items){const card=node('article',undefined,'catalog-row'),image=safeResultImageUrl(item.image,origin);if(image){const img=node('img');img.className='catalog-cover';img.src=image;img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';img.addEventListener('error',()=>{img.hidden=true;},{once:true});card.append(img);}const copy=node('div',undefined,'item-copy'),head=node('div',undefined,'item-head');head.append(node('h3',item.title||'Cadastro sem título'),badge(item.status));copy.append(head);if(item.summary)copy.append(node('p',item.summary));const meta=(Array.isArray(item.meta)?item.meta:[]).filter(value=>typeof value==='string').join(' · ');if(meta)copy.append(node('p',meta,'catalog-meta'));const actions=node('div',undefined,'actions'),edit=link(text(item.adminUrl).startsWith('/admin')?'Abrir gestão ↗':'Abrir área ↗',item.adminUrl),open=link('Ver página ↗',item.url);if(edit)actions.append(edit);if(open)actions.append(open);if(actions.children.length)copy.append(actions);card.append(copy);target.append(card);}
    if(!data.items.length)empty(target,query?'Nenhum resultado para esta busca. Tente outro nome ou assunto.':'Nenhum cadastro informado neste catálogo.');
    $('CatalogNotice').textContent=count(data.total)+' resultados em '+CATALOGS[kind].toLowerCase()+'.';$('CatalogPage').textContent=data.total?(offset+1)+'–'+Math.min(offset+data.items.length,data.total)+' de '+count(data.total):'Sem resultados';
  }
  async function loadCatalog(newOffset=0){
    if(!visible())return;catalogController?.abort();const controller=new AbortController(),generation=++catalogGeneration;catalogController=controller;catalogBusy=true;nextOffset=null;controls();$('CatalogNotice').textContent='Consultando '+CATALOGS[kind].toLowerCase()+'…';tabs.forEach(tab=>tab.setAttribute('aria-pressed',String(tab.dataset.kind===kind)));
    try{const data=await request('/catalog?'+new URLSearchParams({kind,q:query,offset:String(newOffset),limit:'20'}),{signal:controller.signal});if(generation!==catalogGeneration||!visible())return;catalogRows(data);}
    catch(error){if(error.name!=='AbortError'&&generation===catalogGeneration&&visible()){nextOffset=null;offset=0;empty($('Catalog'),'Os itens não puderam ser carregados.');$('CatalogNotice').textContent=error.message||'Falha ao consultar o catálogo.';$('CatalogPage').textContent='Indisponível';}}
    finally{if(catalogController===controller)catalogController=null;if(generation===catalogGeneration){catalogBusy=false;controls();}}
  }
  function suspend(){stopPoll();readController?.abort();readGeneration++;catalogController?.abort();catalogGeneration++;catalogBusy=false;}
  const visibility=()=>{if(document.hidden)suspend();else{refresh();loadCatalog(offset);}},pageHide=()=>{suspended=true;suspend();},pageShow=()=>{suspended=false;refresh();loadCatalog(offset);};
  for(let hour=0;hour<24;hour++)if(hour!==9){const option=node('option',String(hour).padStart(2,'0')+':00');option.value=String(hour);$('Hour').append(option);}const options=[...$('Hour').children].sort((a,b)=>Number(a.value)-Number(b.value));$('Hour').replaceChildren(...options);$('Hour').value='9';
  listen(form,'change',changed);listen(form,'input',changed);listen(form,'submit',save);listen($('Pause'),'click',pause);listen($('Run'),'click',run);listen($('Refresh'),'click',()=>{refresh({reset:readFailed});loadCatalog(offset);});
  listen($('CatalogForm'),'submit',event=>{event.preventDefault();query=$('Query').value.trim().slice(0,120);loadCatalog(0);});
  tabs.forEach(tab=>listen(tab,'click',()=>{if(Object.hasOwn(CATALOGS,tab.dataset.kind)){kind=tab.dataset.kind;query=$('Query').value.trim().slice(0,120);loadCatalog(0);}}));
  listen($('Previous'),'click',()=>{if(!catalogBusy&&offset>0)loadCatalog(Math.max(0,offset-20));});listen($('NextPage'),'click',()=>{if(!catalogBusy&&nextOffset!==null)loadCatalog(nextOffset);});
  listen(document,'visibilitychange',visibility);listen(window,'pagehide',pageHide);listen(window,'pageshow',pageShow);controls();refresh();loadCatalog();
  return {refresh,loadCatalog,destroy(){destroyed=true;suspend();writeController?.abort();listeners.forEach(remove=>remove());}};
}

if(typeof document!=='undefined'){const root=document.getElementById('main');if(root&&document.getElementById('ecPolicyForm'))mountOperations(root);}
