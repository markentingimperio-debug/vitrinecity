import {safeResultImageUrl} from './search-result-image.js';

const API='/api/admin/whatsapp-qr/product-campaigns';
const STORAGE='vc-whatsapp-product-campaign-v1';
const slugPattern=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const idPattern=/^[A-Za-z0-9_-]{1,100}$/;
const groupPattern=/^[0-9A-Za-z._:-]{1,140}@g\.us$/;
const pricePattern=/(?:R\$|US\$|€|£|\$)\s*\d|\b\d+(?:[.,]\d+)?\s*(?:reais|dólares|euros)\b/i;
const text=(value,max=1200)=>String(value??'').trim().slice(0,max);
const searchText=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const labels={draft:'Prévia pronta',queued:'Campanha programada',processing:'Envios em andamento',running:'Envios em andamento',completed:'Campanha concluída',needs_review:'Há envios que precisam de atenção',cancelled:'Campanha cancelada'};
const active=campaign=>Boolean(campaign&&campaign.status!=='draft'&&!['completed','needs_review','cancelled'].includes(campaign.status)&&(campaign.status==='queued'||campaign.status==='processing'||Number(campaign.counts?.pending)>0||Number(campaign.counts?.processing)>0));

export function defaultProductMessage(item) {
  const description=text(item.description,360);
  return description&&!pricePattern.test(description)&&!/(?:https?:\/\/|www\.|meli\.la\/)/i.test(description)?description:'Conheça os detalhes e veja se este produto combina com o que você procura.';
}

export function campaignPayload({products,groupJids,startAt,intervalMinutes},now=Date.now()) {
  if(!Array.isArray(products)||products.length<1||products.length>5)throw Error('Selecione de 1 a 5 produtos.');
  if(products.some(item=>typeof item.message!=='string'||item.message.length>1200))throw Error('Use até 1.200 caracteres por mensagem.');
  const selected=products.map(item=>({slug:String(item.slug||''),message:text(item.message)}));
  if(selected.some(item=>!slugPattern.test(item.slug)||!item.message)||new Set(selected.map(item=>item.slug)).size!==selected.length)throw Error('Confira os produtos e escreva uma mensagem para cada um.');
  if(selected.some(item=>pricePattern.test(item.message)))throw Error('Retire os preços das mensagens. O visitante verá o valor atualizado na página do produto.');
  if(selected.some(item=>/(?:https?:\/\/|www\.|meli\.la\/)/i.test(item.message)))throw Error('Retire os links da mensagem. A prévia acrescentará o link correto da página automaticamente.');
  if(!Array.isArray(groupJids)||!groupJids.length||groupJids.some(jid=>!groupPattern.test(jid)))throw Error('Selecione pelo menos um grupo disponível.');
  const date=new Date(startAt),interval=Number(intervalMinutes);
  if(!Number.isFinite(date.getTime())||date.getTime()<=now)throw Error('Escolha uma data e hora futuras para o início.');
  if(date.getTime()>now+30*86400000)throw Error('Escolha uma data nos próximos 30 dias.');
  if(!Number.isInteger(interval)||interval<30||interval>1440)throw Error('Use um intervalo de 30 a 1.440 minutos.');
  return {products:selected,groupJids:[...new Set(groupJids)].sort(),startAtISO:date.toISOString(),intervalMinutes:interval};
}

export function campaignRequestKey(randomUUID=()=>crypto.randomUUID()) {
  let previous='',key='';
  return payload=>{const current=JSON.stringify(payload);if(current!==previous){key=randomUUID();previous=current;}return key;};
}

export function campaignImage(value,origin) {
  try{
    const raw=String(value||''),url=new URL(raw,origin);
    if(!/[\\\s#%]/.test(raw)&&!raw.startsWith('//')&&!url.username&&!url.password&&url.origin===origin&&!url.search&&new RegExp('^'+API+'/[A-Za-z0-9_-]+/(?:images?|media)/[A-Za-z0-9_.-]+$').test(url.pathname))return url.href;
  }catch{}
  return safeResultImageUrl(value,origin);
}

export function campaignPage(value,origin) {
  try{const raw=String(value||''),url=new URL(raw,origin);if(!/[\\\s#]/.test(raw)&&!raw.startsWith('//')&&!url.username&&!url.password&&url.origin===origin&&/^\/ofertas\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(url.pathname))return url.href;}catch{}
  return '';
}

function localDateTime(time){const date=new Date(time);return new Date(time-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
function dateLabel(value){const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'Horário indisponível';}

export function mountProductCampaigns(root,{document=root?.ownerDocument,window=document?.defaultView,fetcher=(...args)=>fetch(...args),now=()=>Date.now(),randomUUID=()=>crypto.randomUUID(),setTimer=setTimeout,clearTimer=clearTimeout}={}) {
  if(!root||!document||!window)return {destroy(){}};
  const get=id=>root.querySelector('#pc'+id),form=get('Form');
  const ui=Object.fromEntries(['Notice','Reload','Products','ProductSearch','ProductCount','Groups','GroupSearch','GroupCount','AllGroups','StartAt','Interval','Timezone','Prepare','Preview','PreviewTitle','Summary','Counts','DestinationsTitle','Destinations','PreviewProducts','PreviewNote','Publish','Refresh'].map(id=>[id,get(id)]));
  const origin=window.location.origin,selected=new Set(),destinations=new Set(),messages=new Map(),productControls=new Map(),groupControls=new Map(),listeners=[];
  const requestKey=campaignRequestKey(randomUUID);
  let items=[],groups=[],campaign=null,ready=false,busy=false,stale=false,destroyed=false,timer=null,readController=null,readVersion=0;
  const requests=new Set();
  const node=(tag,className,content)=>{const element=document.createElement(tag);if(className)element.className=className;if(content!==undefined)element.textContent=content;return element;};
  const listen=(target,name,fn)=>{target.addEventListener(name,fn);listeners.push(()=>target.removeEventListener(name,fn));};
  const notice=(message,error=false)=>{ui.Notice.textContent=message;ui.Notice.dataset.error=String(error);};
  const store=id=>{try{window.localStorage.setItem(STORAGE,id);}catch{}};
  const stopPolling=()=>{if(timer!==null)clearTimer(timer);timer=null;};
  const stopRead=()=>{readVersion++;readController?.abort();readController=null;stopPolling();};
  function controls(){
    for(const element of form.querySelectorAll('input,textarea,button'))element.disabled=busy||!ready;
    for(const [slug,control] of productControls){control.check.disabled=busy||!ready||(!selected.has(slug)&&selected.size>=5);control.caption.disabled=busy||!selected.has(slug);control.captionLabel.hidden=!selected.has(slug);}
    ui.Prepare.disabled=busy||!ready;ui.Reload.disabled=busy;ui.Refresh.disabled=busy||!campaign;
    ui.Publish.disabled=busy||!campaign||campaign.status!=='draft'||stale;
    ui.AllGroups.checked=groups.length>0&&destinations.size===groups.length;ui.AllGroups.indeterminate=destinations.size>0&&destinations.size<groups.length;
    ui.ProductCount.textContent=selected.size+' de 5 selecionados';ui.GroupCount.textContent=destinations.size+' de '+groups.length+' grupos selecionados';
    form.setAttribute('aria-busy',String(busy));
  }
  function changed(){if(campaign?.status==='draft'){stale=true;ui.PreviewNote.textContent='A seleção ou a mensagem mudou. Prepare uma nova prévia antes de publicar.';}controls();}
  function photo(value,title){
    const src=campaignImage(value,origin);if(!src)return node('div','pc-photo-unavailable','Foto indisponível');
    const image=node('img','pc-photo');image.src=src;image.alt='Foto de '+title;image.loading='lazy';image.referrerPolicy='no-referrer';
    image.addEventListener('error',()=>image.replaceWith(node('div','pc-photo-unavailable','Não foi possível exibir a foto.')),{once:true});return image;
  }
  function filterRows(query,rows){const term=searchText(query);let visible=0;for(const control of rows.values()){control.row.hidden=!searchText(control.search).includes(term);if(!control.row.hidden)visible++;}return visible;}
  function renderCatalog(){
    ui.Products.replaceChildren();ui.Groups.replaceChildren();productControls.clear();groupControls.clear();
    for(const item of items){
      const row=node('article','pc-product'),label=node('label'),check=node('input'),title=node('span','',item.title),captionLabel=node('label','pc-caption-label','Descrição da mensagem · sem preços ou links'),caption=node('textarea');
      check.type='checkbox';check.value=item.slug;check.checked=selected.has(item.slug);check.setAttribute('aria-label','Selecionar '+item.title);label.append(check,title);
      caption.maxLength=1200;caption.value=messages.get(item.slug)||defaultProductMessage(item);messages.set(item.slug,caption.value);caption.setAttribute('aria-label','Mensagem para '+item.title);captionLabel.append(caption);
      row.append(label,photo(item.image,item.title),node('small','',item.category||'Produto'),captionLabel);
      check.addEventListener('change',()=>{if(check.checked&&selected.size>=5){check.checked=false;notice('Você pode selecionar até 5 produtos.',true);return;}check.checked?selected.add(item.slug):selected.delete(item.slug);changed();});
      caption.addEventListener('input',()=>{messages.set(item.slug,caption.value);changed();});
      productControls.set(item.slug,{row,check,caption,captionLabel,search:item.title+' '+(item.category||'')});ui.Products.append(row);
    }
    for(const group of groups){const row=node('label','pc-check'),check=node('input');check.type='checkbox';check.value=group.jid;check.checked=destinations.has(group.jid);row.append(check,node('span','',group.name));check.addEventListener('change',()=>{check.checked?destinations.add(group.jid):destinations.delete(group.jid);changed();});groupControls.set(group.jid,{row,check,search:group.name});ui.Groups.append(row);}
    if(!items.length)ui.Products.append(node('p','pc-empty','Nenhum produto publicado com foto está disponível para esta campanha.'));
    if(!groups.length)ui.Groups.append(node('p','pc-empty','Nenhum grupo disponível. Confira a conexão do WhatsApp e sincronize as conversas acima.'));
    filterRows(ui.ProductSearch.value,productControls);filterRows(ui.GroupSearch.value,groupControls);controls();
  }
  async function request(path,{body,signal}={}){
    const controller=signal?null:new AbortController();if(controller)requests.add(controller);
    try{
      const response=await fetcher(API+path,{credentials:'same-origin',cache:'no-store',signal:signal||controller.signal,...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
      let data;try{data=await response.json();}catch{throw Error('A central não respondeu como esperado. Tente atualizar em instantes.');}
      if(!response.ok){const error=response.status===401?'Sua sessão expirou. Entre novamente no painel.':response.status===403?'Sua conta não tem permissão para esta campanha.':text(data.message||data.error,300);throw Error(error&&!/^[a-z0-9_]+$/.test(error)?error:'Não foi possível concluir. Atualize os dados e confira a conexão do WhatsApp.');}
      return data;
    }catch(error){if(error.name==='AbortError')throw error;throw Error(error instanceof TypeError?'A conexão falhou. Tente novamente; a mesma campanha não será duplicada.':error.message);}
    finally{if(controller)requests.delete(controller);}
  }
  function validCampaign(data){const value=data?.campaign||data;if(!value||!idPattern.test(String(value.id||''))||!Array.isArray(value.products)||!Array.isArray(value.groups)||!Object.hasOwn(labels,value.status))throw Error('Não foi possível ler a prévia completa. Atualize o andamento antes de publicar.');return value;}
  function renderCampaign(value){
    campaign=value;ui.Preview.hidden=false;ui.PreviewTitle.textContent=labels[value.status]||'Campanha';
    const count=Number(value.total)||value.products.length*value.groups.length;
    ui.Summary.textContent=value.products.length+' produtos × '+value.groups.length+' grupos = '+count+' envios. Início: '+dateLabel(value.startAt)+'. Intervalo: '+value.intervalMinutes+' minutos.';
    const counts=value.counts||{};ui.Counts.textContent='Aceitos pelo serviço: '+(Number(counts.sent)||0)+' · Pendentes: '+(Number(counts.pending)||0)+' · Em envio: '+(Number(counts.processing)||0)+' · Conferir envio: '+(Number(counts.unknown)||0)+' · Falhas: '+(Number(counts.failed)||0)+' · Cancelados: '+(Number(counts.cancelled)||0);
    ui.DestinationsTitle.textContent='Conferir os '+value.groups.length+' grupos de destino';ui.Destinations.replaceChildren(...value.groups.map(group=>node('li','',group.name)));
    ui.PreviewProducts.replaceChildren();
    value.products.forEach((item,index)=>{const card=node('article','pc-preview-card');card.append(node('h4','',(index+1)+'. '+item.title),photo(item.image,item.title),node('p','pc-send-time','Horário: '+dateLabel(new Date(value.startAt).getTime()+index*Number(value.intervalMinutes)*60000)),node('p','',item.caption));const href=campaignPage(item.url,origin);if(href){const link=node('a','','Abrir a página divulgada ↗');link.href=href;link.target='_blank';link.rel='noopener';card.append(link);}else card.append(node('p','pc-hint','Link da página indisponível. Atualize a prévia.'));ui.PreviewProducts.append(card);});
    ui.PreviewNote.textContent=stale&&value.status==='draft'?'A seleção ou a mensagem mudou. Prepare uma nova prévia antes de publicar.':value.status==='draft'?'Confira as fotos, as mensagens, os destinos e os horários. Publicar coloca esta campanha na fila de envio.':Number(counts.unknown)>0?'Há envios sem confirmação. Confira as conversas; atualizar não reenvia mensagens. Aceito pelo serviço não significa entregue ou lido.':'Acompanhe os resultados por aqui. Atualizar não reenvia mensagens. Aceito pelo serviço não significa entregue ou lido.';
    store(value.id);controls();schedulePoll();
  }
  function schedulePoll(){stopPolling();if(!destroyed&&!document.hidden&&!busy&&active(campaign))timer=setTimer(()=>{timer=null;refreshCampaign(true);},30000);}
  async function refreshCampaign(silent=false,id=campaign?.id){
    if(destroyed||!id||busy||document.hidden)return;
    stopRead();const version=readVersion;readController=new AbortController();
    try{const data=validCampaign(await request('/'+encodeURIComponent(id),{signal:readController.signal}));if(destroyed||version!==readVersion||(campaign&&campaign.id!==id))return;renderCampaign(data);if(!silent)notice('Andamento atualizado.');}
    catch(error){if(!destroyed&&version===readVersion&&error.name!=='AbortError'&&!silent)notice(error.message,true);}
    finally{if(version===readVersion){readController=null;schedulePoll();}}
  }
  async function loadCatalog(){
    if(busy||destroyed)return;busy=true;controls();notice('Carregando produtos e grupos…');
    try{const data=await request('/catalog');if(destroyed)return;if(!Array.isArray(data.items)||!Array.isArray(data.groups))throw Error('Não foi possível ler o catálogo de produtos e grupos.');
      items=data.items.filter(item=>slugPattern.test(String(item.slug||''))&&item.title);groups=data.groups.filter(group=>groupPattern.test(String(group.jid||''))&&group.name);
      for(const slug of selected)if(!items.some(item=>item.slug===slug))selected.delete(slug);for(const jid of destinations)if(!groups.some(group=>group.jid===jid))destinations.delete(jid);
      ready=true;renderCatalog();notice(items.length+' produtos e '+groups.length+' grupos disponíveis. Selecione os destinos desta campanha.');
    }catch(error){if(!destroyed&&error.name!=='AbortError')notice(error.message,true);}
    finally{busy=false;if(!destroyed){controls();schedulePoll();}}
  }
  async function prepare(event){
    event.preventDefault();if(busy||!ready||destroyed)return;
    let payload;
    try{if(!form.reportValidity())return;payload=campaignPayload({products:items.filter(item=>selected.has(item.slug)).map(item=>({slug:item.slug,message:messages.get(item.slug)})),groupJids:[...destinations],startAt:ui.StartAt.value,intervalMinutes:ui.Interval.value},now());payload.idempotencyKey=requestKey(payload);}catch(error){notice(error.message,true);return;}
    busy=true;stopRead();controls();notice('Preparando as fotos e a prévia. Nenhuma mensagem está sendo enviada…');
    try{const data=validCampaign(await request('/preview',{body:payload}));if(destroyed)return;stale=false;renderCampaign(data);notice('Prévia pronta. Confira abaixo antes de publicar.');ui.PreviewTitle.focus();}
    catch(error){if(!destroyed&&error.name!=='AbortError')notice(error.message,true);}
    finally{busy=false;if(!destroyed){controls();schedulePoll();}}
  }
  async function publish(){
    if(busy||!campaign||campaign.status!=='draft'||stale||destroyed)return;
    busy=true;stopRead();controls();notice('Publicando a campanha e confirmando os horários…');
    try{const data=validCampaign(await request('/'+encodeURIComponent(campaign.id)+'/publish',{body:{}}));if(destroyed)return;renderCampaign(data);notice('Campanha publicada. Os envios seguirão os horários mostrados abaixo.');}
    catch(error){if(!destroyed&&error.name!=='AbortError')notice(error.message+' Use “Atualizar andamento” antes de tentar publicar novamente.',true);}
    finally{busy=false;if(!destroyed){controls();schedulePoll();}}
  }
  ui.StartAt.value=localDateTime(Math.ceil((now()+15*60000)/60000)*60000);ui.Interval.value='120';
  const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;ui.Timezone.textContent='Horários no fuso do seu dispositivo'+(zone?': '+zone:'')+'.';
  listen(form,'submit',prepare);listen(ui.Publish,'click',publish);listen(ui.Reload,'click',loadCatalog);listen(ui.Refresh,'click',()=>refreshCampaign());
  listen(ui.ProductSearch,'input',()=>{const visible=filterRows(ui.ProductSearch.value,productControls);ui.ProductCount.textContent=selected.size+' de 5 selecionados · '+visible+' encontrados';});
  listen(ui.GroupSearch,'input',()=>{const visible=filterRows(ui.GroupSearch.value,groupControls);ui.GroupCount.textContent=destinations.size+' de '+groups.length+' grupos selecionados · '+visible+' encontrados';});
  listen(ui.AllGroups,'change',()=>{destinations.clear();if(ui.AllGroups.checked)groups.forEach(group=>destinations.add(group.jid));for(const [jid,control] of groupControls)control.check.checked=destinations.has(jid);changed();});
  listen(ui.StartAt,'input',changed);listen(ui.Interval,'input',changed);
  listen(document,'visibilitychange',()=>{if(document.hidden)stopRead();else if(campaign)refreshCampaign(true);});
  function destroy(){destroyed=true;stopRead();for(const controller of requests)controller.abort();requests.clear();listeners.forEach(remove=>remove());}
  listen(window,'pagehide',destroy);
  controls();loadCatalog().then(()=>{if(destroyed)return;let id='';try{id=window.localStorage.getItem(STORAGE)||'';}catch{}if(idPattern.test(id))refreshCampaign(true,id);});
  return {destroy};
}

if(typeof document!=='undefined'){const root=document.querySelector('#productCampaigns');if(root)mountProductCampaigns(root);}
