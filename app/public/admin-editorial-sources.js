const API='/api/admin/editorial-sources';
const TOPICS={news:'Notícias',recipes:'Receitas',gardening:'Jardinagem'};
const STATES={discovery_only:['Pauta encontrada','O título e os dados do vídeo ajudam a escolher um assunto. Ainda falta uma fonte completa para preparar conteúdo.'],research_pending:['Pesquisa pendente','O assunto ainda precisa de informações verificadas antes de seguir para o estúdio.'],text_ready:['Texto da fonte disponível','O material precisa de revisão editorial. Encontrar o texto não autoriza uma publicação automática.'],evidence_ready:['Fontes conferidas para revisão','Há trechos de fontes conferidas para revisão no estúdio. Isso não confirma criação nem publicação.']};
const REASONS={ready:'Você pode consultar os canais agora.',global_paused:'As consultas estão pausadas na Central de Operações.',closed:'A consulta de fontes está temporariamente indisponível.',busy:'Uma consulta está em andamento. Acompanhe o estado abaixo.',cooldown:'Aguarde o intervalo entre consultas.',disabled:'A consulta automática destas fontes está desativada.'};
const ERRORS={feed_unavailable:'Canal indisponível nesta consulta.',feed_invalid:'O canal não retornou uma lista válida.',feed_identity_mismatch:'A identidade retornada não corresponde ao canal cadastrado.',feed_too_large:'A resposta excedeu o limite de leitura.',feed_timeout:'A consulta do canal excedeu o tempo de espera.',feed_aborted:'A consulta foi interrompida.'};
const text=value=>typeof value==='string'?value:'';
const count=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0}).format(value):'Não informado';
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
const date=value=>timestamp(value)===null?'Ainda não consultado':new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(value));

export function editorialSourceHref(value,{editor=false,youtube=false}={}){
  if(typeof value!=='string'||!value||value.length>2048||/[\u0000-\u0020\u007f\\]/.test(value)||value.startsWith('//'))return null;
  try{
    const url=new URL(value,'https://vitrinecity.invalid');
    if(editor){
      if(!value.startsWith('/')||url.origin!=='https://vitrinecity.invalid'||!/^\/admin-web-stories(?:\.html)?$/.test(url.pathname))return null;
      const source=url.searchParams.get('source'),story=url.searchParams.get('story');
      if(story&&story.length<=200&&!/[\u0000-\u001f\u007f]/.test(story))return '/admin-web-stories?story='+encodeURIComponent(story)+'#editor';
      if(source&&source.length<=300&&!/[\u0000-\u001f\u007f]/.test(source))return '/admin-web-stories?source='+encodeURIComponent(source)+'#source-manual';
      return null;
    }
    if(url.protocol!=='https:'||url.username||url.password||url.port||url.origin==='https://vitrinecity.invalid')return null;
    if(youtube){
      if(!['youtube.com','www.youtube.com','youtu.be'].includes(url.hostname))return null;
      const valid=url.hostname==='youtu.be'?/^\/[A-Za-z0-9_-]{11}$/.test(url.pathname):url.pathname==='/watch'?/^[A-Za-z0-9_-]{11}$/.test(url.searchParams.get('v')||''):/^\/(?:channel\/UC[A-Za-z0-9_-]{22}|@[A-Za-z0-9_.-]+|shorts\/[A-Za-z0-9_-]{11})\/?$/.test(url.pathname);
      return valid?url.href:null;
    }
    if(!url.hostname.includes('.')||/^[\d.]+$/.test(url.hostname)||/[:]|(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname))return null;
    return url.href;
  }catch{return null;}
}
export function editorialSourcesSnapshot(value){
  if(!value||!Array.isArray(value.channels)||!Array.isArray(value.items)||typeof value.busy!=='boolean'||!value.controls||typeof value.controls.canSync!=='boolean')throw Error('Não foi possível ler o estado completo das fontes. Atualize o status antes de continuar.');
  return value;
}
export const canSyncEditorialSources=value=>!!value&&value.controls?.canSync===true&&!value.busy&&value.controls.reason==='ready';
export function editorialSourceState(value){return STATES[value]||['Estado não informado','Não há confirmação de que esta fonte esteja pronta para criar conteúdo.'];}

export function mountEditorialSources(root,{document=root.ownerDocument,window=document.defaultView,fetcher=globalThis.fetch,setTimer=globalThis.setTimeout,clearTimer=globalThis.clearTimeout,pollMs=5000}={}){
  const $=name=>root.querySelector('#es'+name),node=(tag,value,attrs={})=>{const el=document.createElement(tag);if(value!==undefined)el.textContent=String(value);Object.assign(el,attrs);return el;};
  let state=null,query='',topic='all',sort='recent',offset=0,nextOffset=null,loading=false,writing=false,readFailed=false,destroyed=false,suspended=false,reader=null,writer=null,generation=0,timer=null,polls=0;
  const listeners=[];const listen=(target,event,handler)=>{target.addEventListener(event,handler);listeners.push(()=>target.removeEventListener(event,handler));};
  const visible=()=>!destroyed&&!suspended&&!document.hidden;
  function stopPoll(){if(timer!==null)clearTimer(timer);timer=null;}
  function message(copy,error=false){$('Message').textContent=copy;$('Message').dataset.error=String(error);}
  function link(copy,value,options={}){const href=editorialSourceHref(value,options);if(!href)return null;return node('a',copy,{href,...(!options.editor?{target:'_blank',rel:'noopener noreferrer'}:{})});}
  function controls(){
    $('Sync').disabled=loading||writing||readFailed||!canSyncEditorialSources(state);$('Refresh').disabled=writing||loading;
    $('Search').disabled=writing||loading;$('Previous').disabled=writing||loading||offset===0;$('Next').disabled=writing||loading||nextOffset===null;
    root.setAttribute('aria-busy',String(loading||writing||state?.busy===true));
  }
  function channelState(channel){
    if(channel.status==='error'||channel.errorCode)return ['Consulta não concluída',ERRORS[channel.errorCode]||'Não foi possível consultar este canal. Os dados anteriores foram preservados.'];
    if(channel.status==='never'||!channel.lastCheckedAt)return ['Aguardando primeira consulta','A identidade está cadastrada; a leitura do canal ainda não foi confirmada.'];
    if(channel.status==='empty')return ['Consulta sem itens','A consulta terminou sem itens retornados. Isso não significa que o canal não tenha vídeos.'];
    if(channel.status==='ready'&&channel.lastSuccessAt)return ['Consulta confirmada','Dados públicos recebidos do canal.'];
    return ['Sem confirmação de leitura','Confira novamente o estado antes de usar esta fonte.'];
  }
  function renderChannels(){
    const target=$('Channels');target.replaceChildren();
    for(const channel of state.channels.slice(0,30)){
      const card=node('article',undefined,{className:'editorial-channel'}),[label,detail]=channelState(channel),head=node('div',undefined,{className:'editorial-channel-head'}),initial=node('span',text(channel.name).slice(0,2).toUpperCase()||'FC',{className:'editorial-channel-mark'});initial.setAttribute('aria-hidden','true');
      const identity=node('div');identity.append(node('h3',channel.name||'Canal não identificado'),node('span',TOPICS[channel.topic]||'Assunto não informado',{className:'muted'}));head.append(initial,identity);card.append(head,node('strong',label,{className:'editorial-state'}),node('p',detail));
      card.append(node('small','Última tentativa: '+date(channel.lastCheckedAt)),node('small','Última leitura confirmada: '+date(channel.lastSuccessAt)));
      if(channel.lastSuccessAt)card.append(node('small',count(channel.itemsCount)+' itens na última consulta'));
      if(channel.channelId)card.append(node('small','Canal: '+text(channel.channelId),{className:'editorial-channel-id'}));
      const open=link('Conferir canal no YouTube ↗',channel.url,{youtube:true});if(open)card.append(open);target.append(card);
    }
    if(!state.channels.length)target.append(node('p','Nenhum canal foi informado pela configuração.',{className:'muted'}));
  }
  function renderItems(){
    const target=$('Items');target.replaceChildren();
    for(const item of state.items.slice(0,200)){
      const card=node('article',undefined,{className:'editorial-item'}),[label,detail]=editorialSourceState(item.sourceStatus);card.append(node('span',TOPICS[item.topic]||'Pauta',{className:'eyebrow'}),node('h3',item.title||'Título não informado'),node('p',item.channelName||'Canal não informado',{className:'editorial-item-channel'}),node('strong',label,{className:'editorial-state'}),node('p',detail));
      card.append(node('small','Publicado no canal: '+(timestamp(item.publishedAt)===null?'Data não informada':date(item.publishedAt))),node('small','Visualizações na coleta: '+count(item.views)));
      const actions=node('div',undefined,{className:'editorial-item-actions'}),original=link('Ver original no YouTube ↗',item.url,{youtube:true});if(original)actions.append(original);
      if(item.sourceStatus==='evidence_ready'){const editor=link('Revisar fonte no estúdio →',item.editorUrl,{editor:true});if(editor)actions.append(editor);}
      card.append(actions);
      if(item.evidence&&['text_ready','evidence_ready'].includes(item.sourceStatus)){
        const evidence=item.evidence,details=node('details'),summary=node('summary','Ler material encontrado');details.append(summary);
        if(evidence.title)details.append(node('p',evidence.title));
        if(evidence.kind==='recipe'){for(const [field,label] of [['ingredients','Ingredientes informados'],['steps','Preparo informado']])if(Array.isArray(evidence[field])&&evidence[field].length){const list=node(field==='steps'?'ol':'ul');for(const line of evidence[field].slice(0,60))list.append(node('li',text(line)));details.append(node('strong',label),list);}}
        else if(typeof evidence.text==='string')details.append(node('p',evidence.text.slice(0,5000)));
        if(evidence.excerptOnly===true||typeof evidence.text==='string'&&evidence.text.length>5000)details.append(node('small','Trecho de leitura; confira a fonte original.'));
        const source=link('Conferir texto na origem ↗',evidence.sourceUrl);if(source)details.append(source);if(evidence.publishedAt)details.append(node('small','Data original da fonte: '+(timestamp(evidence.publishedAt)===null?'Não informada':date(evidence.publishedAt))));details.append(node('small','Material consultado em: '+date(evidence.checkedAt)));card.append(details);
      }
      const sources=(Array.isArray(item.sourceLinks)?item.sourceLinks:[]).flatMap(source=>{const open=link(typeof source==='object'&&source?.title?source.title:'Fonte de apoio ↗',typeof source==='string'?source:source?.url);return open?[open]:[];}).slice(0,4);
      if(sources.length){const details=node('details'),summary=node('summary','Consultar fontes de apoio');details.append(summary,...sources);card.append(details);}target.append(card);
    }
    if(!state.items.length){const unavailable=state.channels.some(channel=>channel.errorCode||channel.status==='error'),never=state.channels.length>0&&state.channels.every(channel=>channel.status==='never'||!channel.lastCheckedAt);target.append(node('p',never?'Os canais ainda não foram consultados. Use “Atualizar fontes” quando a consulta estiver disponível.':unavailable?'Nenhuma pauta armazenada corresponde a este filtro. A consulta de um ou mais canais falhou; os resultados podem estar incompletos.':'Nenhuma pauta armazenada corresponde a este filtro. Tente outro assunto ou categoria.',{className:'editorial-empty'}));}
  }
  function render(data){
    state=editorialSourcesSnapshot(data);readFailed=false;renderChannels();renderItems();
    const p=state.pagination||state;offset=Number.isInteger(p.offset)?p.offset:offset;nextOffset=Number.isInteger(p.nextOffset)&&p.nextOffset>offset?p.nextOffset:null;
    $('Page').textContent=state.items.length?`${offset+1}–${offset+state.items.length}`+(Number.isInteger(p.total)?' de '+p.total+' pautas armazenadas':' pautas nesta consulta'):'Sem itens nesta página';
    $('Checked').textContent='Última consulta: '+date(state.lastCheckedAt)+' · horário de Brasília';
    $('NextCheck').textContent=state.controls.nextAt?'Próxima consulta permitida: '+date(state.controls.nextAt):state.busy?'Consulta em andamento.':'O estado acima informa quando consultar novamente.';
    message(REASONS[state.controls.reason]||'Estado carregado. Confira as condições antes de consultar.');controls();
  }
  async function data(response){let body;try{body=await response.json();}catch{throw Error('A resposta das fontes veio incompleta. Atualize o status para conferir.');}if(!response.ok){const error=Error(response.status===401||response.status===403?'Seu acesso ao painel precisa ser confirmado. Entre novamente como administrador.':text(body?.error)||'A consulta não foi concluída. Atualize o status antes de tentar novamente.');error.status=response.status;throw error;}return body;}
  function schedulePoll(){stopPoll();if(visible()&&state?.busy&&!writing&&!readFailed&&polls<12)timer=setTimer(()=>{timer=null;polls++;refresh();},pollMs);else if(state?.busy&&polls>=12)message('A consulta ainda não foi confirmada. Use “Atualizar status” para acompanhar, sem iniciar outra consulta.');}
  async function refresh(){
    if(!visible()||writing)return;stopPoll();reader?.abort();reader=new AbortController();const own=++generation;loading=true;controls();
    const params=new URLSearchParams({q:query,topic,sort,offset:String(offset),limit:'12'});
    try{const result=await data(await fetcher(API+'?'+params,{credentials:'same-origin',signal:reader.signal}));if(own===generation&&visible())render(result);}
    catch(error){if(own===generation&&error.name!=='AbortError'&&visible()){readFailed=true;message(error.message+(state?' Os dados exibidos são da última leitura bem-sucedida.':''),true);}}
    finally{if(own===generation){loading=false;controls();schedulePoll();}}
  }
  async function sync(){
    if(loading||writing||readFailed||!canSyncEditorialSources(state))return;stopPoll();reader?.abort();generation++;writing=true;writer=new AbortController();controls();message('Consultando os canais. Esta ação não cria nem publica conteúdo…');let success=false;
    try{await data(await fetcher(API+'/sync',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}',signal:writer.signal}));success=true;}
    catch(error){if(visible()){readFailed=true;message(error.name==='AbortError'?'A confirmação da consulta foi interrompida. Atualize o status; não inicie outra consulta.':error.message+' Atualize o status para conferir o resultado antes de tentar novamente.',true);}}
    finally{writing=false;writer=null;controls();if(success&&visible()){polls=0;await refresh();}}
  }
  const search=event=>{event.preventDefault();query=$('Query').value.trim().slice(0,120);topic=Object.hasOwn(TOPICS,$('Topic').value)?$('Topic').value:'all';sort=['views','popular'].includes($('Sort').value)?$('Sort').value:'recent';offset=0;polls=0;refresh();};
  const refreshClick=()=>{polls=0;refresh();};
  const previous=()=>{offset=Math.max(0,offset-12);refresh();};const next=()=>{if(nextOffset!==null){offset=nextOffset;refresh();}};
  const hide=()=>{stopPoll();reader?.abort();generation++;loading=false;};const visibility=()=>{if(document.hidden)hide();else {polls=0;refresh();}};const pageHide=()=>{suspended=true;hide();};const pageShow=()=>{suspended=false;polls=0;refresh();};
  listen($('Form'),'submit',search);listen($('Sync'),'click',sync);listen($('Refresh'),'click',refreshClick);listen($('Previous'),'click',previous);listen($('Next'),'click',next);listen(document,'visibilitychange',visibility);listen(window,'pagehide',pageHide);listen(window,'pageshow',pageShow);controls();refresh();
  return {refresh,destroy(){destroyed=true;hide();writer?.abort();for(const remove of listeners)remove();}};
}
if(typeof document!=='undefined'){const root=document.getElementById('editorial-sources');if(root)mountEditorialSources(root);}
