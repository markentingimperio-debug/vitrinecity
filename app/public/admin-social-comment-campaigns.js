import {safeResultImageUrl} from './search-result-image.js';

const API='/api/admin/social-comment-campaigns',STORAGE='vc-social-comment-campaign-v1';
const statuses={draft:'Prévia preparada',active:'Respostas ativas',paused:'Respostas pausadas'};
const surfaces={facebook_page:'Página do Facebook',facebook_group:'Grupo do Facebook · como Página',instagram:'Instagram profissional'};
const keywords=['EU QUERO','QUERO RECEITA','QUERO GUIA'];
const triggerModes={keyword:'Somente a frase escolhida',any_comment:'Qualquer novo comentário elegível'};
const idPattern=/^[A-Za-z0-9_-]{1,100}$/;
const compact=(value,max=2000)=>String(value??'').trim().slice(0,max);
const normalized=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

export function suggestedCaption(source,keyword='EU QUERO',triggerMode='keyword') {
  const title=compact(source?.title,220).replace(/(?:https?:\/\/|www\.)\S+/gi,'').trim();
  const summary=compact(source?.summary,300).replace(/(?:https?:\/\/|www\.)\S+/gi,'').trim();
  const term=keywords.includes(keyword)?keyword:'EU QUERO';
  const invitation=triggerMode==='any_comment'
    ?source?.commercial?'Deixe seu comentário para receber por mensagem privada o link com os detalhes e as condições.':'Deixe seu comentário para receber por mensagem privada este conteúdo relacionado à publicação.'
    :`Quer acessar o conteúdo completo? Comente ${term} para receber o link por mensagem privada.`;
  return [title,summary,invitation,source?.commercial?'Publicidade.':''].filter(Boolean).join('\n\n');
}

export function socialCampaignPayload(values) {
  const {sourceKey,accountId,surface,postId='',groupId='',keyword,caption,invite='none',triggerMode='keyword',publicReplyEnabled=false,reactEnabled=false}=values;
  if(typeof sourceKey!=='string'||!sourceKey||sourceKey.length>300)throw Error('Escolha um conteúdo publicado na VitrineCity.');
  if(typeof accountId!=='string'||!accountId||accountId.length>100)throw Error('Selecione a conta da empresa.');
  if(!Object.hasOwn(surfaces,surface)||!keywords.includes(keyword)||!['none','city','vip'].includes(invite))throw Error('Confira o canal, a frase de pedido e o convite.');
  if(!Object.hasOwn(triggerModes,triggerMode)||typeof publicReplyEnabled!=='boolean'||typeof reactEnabled!=='boolean')throw Error('Confira quando responder e as ações escolhidas.');
  if(reactEnabled&&surface==='instagram')throw Error('Curtir comentários pelo painel está disponível apenas no Facebook, quando a conexão permitir.');
  if(postId&&!/^[0-9]+(?:_[0-9]+)?$/.test(postId))throw Error('Informe o ID numérico da publicação, não o endereço da página.');
  if(groupId&&!/^\d+$/.test(groupId))throw Error('Informe somente os números do ID do grupo.');
  if(surface==='facebook_group'&&postId&&!groupId)throw Error('Informe também o ID do grupo da publicação.');
  if(typeof caption!=='string'||!caption.trim()||caption.length>1800)throw Error('Escreva uma descrição com até 1.800 caracteres.');
  if(/(?:https?:\/\/|www\.|\b(?:meli\.la|bit\.ly|t\.co)\/)/i.test(caption))throw Error('Retire os links da descrição. O link será mostrado na resposta privada.');
  if(triggerMode==='keyword'&&!caption.toUpperCase().includes(keyword))throw Error('Inclua na descrição a frase que a pessoa deve comentar: '+keyword+'.');
  return {sourceKey,accountId,surface,postId,groupId:surface==='facebook_group'?groupId:'',keyword,caption:caption.trim(),invite,triggerMode,publicReplyEnabled,reactEnabled};
}

export function socialRequestKey(randomUUID=()=>crypto.randomUUID()) {
  let previous='',key='';return payload=>{const serialized=JSON.stringify(payload);if(serialized!==previous){previous=serialized;key=randomUUID();}return key;};
}

export function socialPageUrl(value,origin) {
  try{const raw=String(value||''),url=new URL(raw,origin);if(!/[\\\s\u0000-\u001f]/.test(raw)&&!raw.startsWith('//')&&!url.username&&!url.password&&url.origin===origin&&!/^\/(?:admin|api|auth|login|logout)(?:[-/.?]|$)/i.test(url.pathname))return url.href;}catch{}return '';
}

export function socialImageUrl(value,origin) {
  return safeResultImageUrl(value,origin);
}

export function mountSocialCampaigns(root,{document=root?.ownerDocument,window=document?.defaultView,fetcher=(...args)=>fetch(...args),randomUUID=()=>crypto.randomUUID(),setTimer=setTimeout,clearTimer=clearTimeout}={}) {
  if(!root||!document||!window)return {destroy(){}};
  const ids=['Form','Notice','Reload','Search','SearchCatalog','Source','SourceCount','SourceCard','Account','Surface','CheckConnection','ConnectionState','ConnectionTitle','ConnectionMissing','ConnectionChecks','PostId','GroupId','GroupField','TriggerMode','TriggerHint','KeywordField','Keyword','PublicReplyEnabled','ReactEnabled','ReactionHint','Caption','Suggest','Invite','Prepare','Preview','PreviewTitle','Summary','Readiness','Missing','Cover','PublicCaption','PrivateReply','PublicReplyCard','PublicReply','ReactionPreview','Copy','Counts','PublicCounts','ReactionCounts','PreviewNote','Activate','Pause','Refresh','History'];
  const ui=Object.fromEntries(ids.map(id=>[id,root.querySelector('#sc'+id)])),origin=window.location.origin,keyFor=socialRequestKey(randomUUID),listeners=[],requests=new Set();
  let items=[],accounts=[],catalogQuery='',campaign=null,ready=false,busy=false,stale=false,destroyed=false,timer=null,readController=null,readVersion=0;
  const node=(tag,klass='',content)=>{const element=document.createElement(tag);if(klass)element.className=klass;if(content!==undefined)element.textContent=content;return element;};
  const listen=(target,event,fn)=>{target.addEventListener(event,fn);listeners.push(()=>target.removeEventListener(event,fn));};
  const notice=(value,error=false)=>{ui.Notice.textContent=value;ui.Notice.dataset.error=String(error);};
  const stopPoll=()=>{if(timer!==null)clearTimer(timer);timer=null;};
  const stopRead=()=>{readVersion++;readController?.abort();readController=null;stopPoll();};
  const selectedSource=()=>items.find(item=>item.key===ui.Source.value);
  function controls(){
    for(const element of ui.Form.querySelectorAll('input,textarea,select,button'))element.disabled=busy||!ready;
    ui.Reload.disabled=busy;ui.Prepare.disabled=busy||!ready||!items.length||!accounts.length;ui.Suggest.disabled=busy||!selectedSource();ui.Refresh.disabled=busy||!campaign;
    ui.Activate.disabled=busy||!campaign||campaign.status==='active'||stale||campaign.readiness?.ready!==true||!campaign.postId;
    ui.Pause.disabled=busy||campaign?.status!=='active';ui.Copy.disabled=busy||!campaign;ui.GroupField.hidden=ui.Surface.value!=='facebook_group';
    ui.CheckConnection.disabled=busy||!ready||!ui.Account.value;
    const anyComment=ui.TriggerMode.value==='any_comment',instagram=ui.Surface.value==='instagram';
    ui.KeywordField.hidden=anyComment;ui.Keyword.disabled=busy||!ready||anyComment;
    ui.TriggerHint.textContent=anyComment?'Vale somente para novos comentários nesta publicação, após a ativação. Comentários repetidos, da própria conta ou não elegíveis não geram outro envio.':'O link será enviado somente quando a pessoa comentar a frase escolhida nesta publicação.';
    ui.ReactEnabled.disabled=busy||!ready||instagram;
    ui.ReactionHint.textContent=instagram?'O Instagram não oferece a ação de curtir comentários por esta integração.':'A curtida depende da permissão da Página no Facebook. A prévia verificará a conexão para as ações selecionadas.';
    ui.Form.setAttribute('aria-busy',String(busy));
  }
  function changed(){if(campaign){stale=true;ui.PreviewNote.textContent='O formulário mudou. Prepare uma nova prévia antes de ativar respostas.';}controls();}
  function imageLink(value,title){
    const src=socialImageUrl(value,origin);if(!src)return node('p','sc-hint','Capa indisponível para exibição. Abra a página do conteúdo para conferir a imagem.');
    const wrap=node('div','sc-image-wrap'),image=node('img','sc-photo');image.src=src;image.alt='Capa: '+title;image.loading='lazy';image.referrerPolicy='no-referrer';
    image.addEventListener('error',()=>image.replaceWith(node('p','sc-hint','Não foi possível carregar a capa.')),{once:true});
    const link=node('a','','Abrir foto de capa ↗');link.href=src;link.target='_blank';link.rel='noopener noreferrer';wrap.append(image,link);return wrap;
  }
  function sourceCard(){
    ui.SourceCard.replaceChildren();const item=selectedSource();if(!item){controls();return;}
    ui.SourceCard.append(imageLink(item.image,item.title),node('strong','',item.title),node('p','sc-hint',item.summary||''));
    const url=socialPageUrl(item.url,origin);if(url){const link=node('a','','Conferir conteúdo publicado ↗');link.href=url;link.target='_blank';link.rel='noopener';ui.SourceCard.append(link);}
    controls();
  }
  function populateSources(){
    const previous=ui.Source.value,query=normalized(ui.Search.value).trim(),matches=query===catalogQuery?items:items.filter(item=>normalized(item.title+' '+(item.summary||'')).includes(query));
    const placeholder=node('option','','Escolha um conteúdo');placeholder.value='';ui.Source.replaceChildren(placeholder);
    for(const item of matches){const option=node('option','',item.title);option.value=item.key;ui.Source.append(option);}
    ui.Source.value=matches.some(item=>item.key===previous)?previous:'';ui.SourceCount.textContent=matches.length+' conteúdos encontrados';
    if(previous!==ui.Source.value)changed();sourceCard();
  }
  async function request(path,{body,signal}={}){
    const controller=signal?null:new AbortController();if(controller)requests.add(controller);
    try{const response=await fetcher(API+path,{credentials:'same-origin',cache:'no-store',signal:signal||controller.signal,...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
      let data;try{data=await response.json();}catch{throw Error('A central não respondeu como esperado. Atualize em instantes.');}
      if(!response.ok){const message=compact(data.message||data.error,300);throw Error(response.status===401?'Sua sessão expirou. Entre novamente no painel.':response.status===403?'Sua conta não tem permissão para esta ação.':message&&!/^[a-z0-9_]+$/.test(message)?message:'Não foi possível concluir. Confira os dados e a conexão Meta.');}return data;
    }catch(error){if(error.name==='AbortError')throw error;throw Error(error instanceof TypeError?'A conexão falhou. Atualize o andamento antes de tentar novamente.':error.message);}
    finally{if(controller)requests.delete(controller);}
  }
  function validCampaign(value){
    const data=value?.campaign||value;
    if(!data||!idPattern.test(String(data.id||''))||!Object.hasOwn(statuses,data.status)||!data.source?.title||!data.account||!Object.hasOwn(surfaces,data.surface)||!data.readiness||!Array.isArray(data.readiness.missing)||typeof data.caption!=='string'||typeof data.privateReply!=='string')throw Error('Não foi possível ler a prévia completa. Atualize o andamento.');
    const result={...data,triggerMode:data.triggerMode??'keyword',publicReplyEnabled:data.publicReplyEnabled??false,reactEnabled:data.reactEnabled??false};
    if(!Object.hasOwn(triggerModes,result.triggerMode)||typeof result.publicReplyEnabled!=='boolean'||typeof result.reactEnabled!=='boolean'||(result.publicReplyEnabled&&(typeof result.publicReplyPreview!=='string'||!result.publicReplyPreview.trim()))||(result.reactEnabled&&result.surface==='instagram'))throw Error('A prévia das ações não está completa. Atualize o andamento antes de ativar.');
    return result;
  }
  function actionCounts(label,counts={}){return label+': '+(Number(counts.sent)||0)+' · Pendentes: '+(Number(counts.pending)||0)+' · Em envio: '+(Number(counts.processing)||0)+' · Falhas: '+(Number(counts.failed)||0)+' · Sem confirmação: '+(Number(counts.unknown)||0)+' · Canceladas: '+(Number(counts.cancelled)||0);}
  function renderCampaign(data){
    campaign=data;ui.Preview.hidden=false;ui.PreviewTitle.textContent=statuses[data.status];
    ui.Summary.textContent=[data.source.title,surfaces[data.surface],data.account.pageName||data.account.instagramUsername||'Conta da empresa',data.postId?'Publicação: '+data.postId:'Publicação ainda não vinculada',data.triggerMode==='any_comment'?triggerModes.any_comment:'Pedido: '+data.keyword,data.publicReplyEnabled?'Agradecimento público selecionado':'Sem agradecimento público',data.reactEnabled?'Curtir comentário':'Sem curtida automática'].join(' · ');
    ui.Readiness.textContent=data.readiness.ready?'Configuração verificada; alcance público depende da aprovação Meta.':'Há etapas pendentes para ativar esta resposta.';
    ui.Missing.replaceChildren(...data.readiness.missing.map(item=>node('li','',String(item))));ui.Missing.hidden=!data.readiness.missing.length;
    ui.Cover.replaceChildren(imageLink(data.source.image,data.source.title));ui.PublicCaption.value=data.caption;ui.PrivateReply.textContent=data.privateReply;
    ui.PublicReplyCard.hidden=!data.publicReplyEnabled;ui.PublicReply.textContent=data.publicReplyEnabled?data.publicReplyPreview:'';
    ui.ReactionPreview.textContent=data.reactEnabled?'Curtir o comentário no Facebook: somente depois da confirmação da mensagem privada.':'A curtida automática não foi selecionada.';
    ui.Counts.textContent=actionCounts('Aceitas pelo serviço',data.counts);
    ui.PublicCounts.hidden=!data.publicReplyEnabled;ui.PublicCounts.textContent=data.publicReplyEnabled?actionCounts('Agradecimentos públicos confirmados',data.publicReplyCounts):'';
    ui.ReactionCounts.hidden=!data.reactEnabled;ui.ReactionCounts.textContent=data.reactEnabled?actionCounts('Curtidas confirmadas',data.reactionCounts):'';
    ui.PreviewNote.textContent=stale?'O formulário mudou. Prepare uma nova prévia antes de ativar respostas.':data.status==='active'?(data.triggerMode==='any_comment'?'Respostas ativas para qualquer novo comentário elegível nesta publicação.':'Respostas ativas apenas para novos comentários que peçam o link desta publicação.')+' As contagens não comprovam leitura ou compra.':data.status==='paused'?'Respostas pausadas. Uma ação já em envio pode concluir.':'Copie a descrição e publique a foto no canal escolhido. Depois informe o ID da publicação e prepare uma nova prévia. Ativar autoriza a mensagem privada e os complementos selecionados nesta prévia.';
    try{window.localStorage.setItem(STORAGE,data.id);}catch{}controls();schedulePoll();
  }
  function schedulePoll(){stopPoll();if(!destroyed&&!document.hidden&&!busy&&campaign?.status==='active')timer=setTimer(()=>{timer=null;refreshCampaign(true);},30000);}
  async function refreshCampaign(silent=false,id=campaign?.id){
    if(destroyed||busy||!id||document.hidden)return;stopRead();const version=readVersion;readController=new AbortController();
    try{const data=validCampaign(await request('/'+encodeURIComponent(id),{signal:readController.signal}));if(destroyed||version!==readVersion)return;renderCampaign(data);if(!silent)notice('Andamento atualizado. Nenhuma resposta foi reenviada.');}
    catch(error){if(!destroyed&&version===readVersion&&error.name!=='AbortError'&&!silent)notice(error.message,true);}
    finally{if(version===readVersion){readController=null;schedulePoll();}}
  }
  async function loadCatalog(){
    if(busy||destroyed)return;busy=true;controls();notice('Verificando conteúdos e contas da empresa…');
    try{const query=compact(ui.Search.value,200),data=await request('/catalog'+(query?'?q='+encodeURIComponent(query):''));if(destroyed)return;if(!Array.isArray(data.items)||!Array.isArray(data.accounts))throw Error('Não foi possível ler o catálogo e as contas.');
      catalogQuery=normalized(query);
      items=data.items.filter(item=>typeof item.key==='string'&&item.title&&socialPageUrl(item.url,origin));accounts=data.accounts.filter(item=>item.id!==undefined);
      const previous=ui.Account.value,option=node('option','','Escolha uma conta');option.value='';ui.Account.replaceChildren(option);
      for(const account of accounts){const option=node('option','',(account.pageName||'Página '+account.pageId)+(account.instagramUsername?' · @'+account.instagramUsername:''));option.value=String(account.id);ui.Account.append(option);}
      ui.Account.value=accounts.some(item=>String(item.id)===previous)?previous:'';ready=true;populateSources();
      notice(accounts.length?items.length+' conteúdos disponíveis. Confira a conta e prepare a descrição.':'Nenhuma conta Meta conectada. Conecte a Página nas Integrações para preparar a automação.');
      const history=await request('');if(destroyed)return;ui.History.replaceChildren();for(const entry of history.campaigns||[]){if(!idPattern.test(String(entry.id||'')))continue;const button=node('button','btn secondary',(entry.source?.title||'Campanha')+' · '+(statuses[entry.status]||'Consultar'));button.type='button';button.addEventListener('click',()=>{if(!busy){stale=true;refreshCampaign(false,entry.id);}});ui.History.append(button);}
    }catch(error){if(!destroyed&&error.name!=='AbortError')notice(error.message,true);}
    finally{busy=false;if(!destroyed){controls();schedulePoll();}}
  }
  async function prepare(event){
    event.preventDefault();if(busy||!ready||destroyed)return;let payload;
    try{if(!ui.Form.reportValidity())return;payload=socialCampaignPayload({sourceKey:ui.Source.value,accountId:ui.Account.value,surface:ui.Surface.value,postId:ui.PostId.value.trim(),groupId:ui.GroupId.value.trim(),keyword:ui.Keyword.value,caption:ui.Caption.value,invite:ui.Invite.value,triggerMode:ui.TriggerMode.value,publicReplyEnabled:ui.PublicReplyEnabled.checked,reactEnabled:ui.ReactEnabled.checked});payload.idempotencyKey=keyFor(payload);}catch(error){notice(error.message,true);return;}
    busy=true;stopRead();controls();notice('Preparando a prévia. A publicação e as respostas continuam sob seu controle…');
    try{const data=validCampaign(await request('/preview',{body:payload}));if(destroyed)return;stale=false;renderCampaign(data);notice('Prévia pronta. Confira a foto, a descrição, a mensagem privada e os complementos selecionados.');ui.PreviewTitle.focus();}
    catch(error){if(!destroyed&&error.name!=='AbortError')notice(error.message,true);}
    finally{busy=false;if(!destroyed){controls();schedulePoll();}}
  }
  async function checkConnection(){
    if(busy||destroyed||!ui.Account.value)return;busy=true;stopRead();controls();notice('Verificando as permissões e a assinatura da conta selecionada…');
    try{const query='?accountId='+encodeURIComponent(ui.Account.value)+'&surface='+encodeURIComponent(ui.Surface.value)+(ui.PublicReplyEnabled.checked?'&publicReplyEnabled=true':'')+(ui.ReactEnabled.checked?'&reactEnabled=true':''),data=await request('/connection'+query);if(destroyed)return;
      if(!data.account||!data.readiness||!Array.isArray(data.readiness.missing))throw Error('Não foi possível ler o resultado da conexão.');
      ui.ConnectionState.hidden=false;ui.ConnectionTitle.textContent=(data.account.pageName||'Conta selecionada')+' · '+(surfaces[data.surface]||'Conexão Meta');
      ui.ConnectionMissing.replaceChildren(...data.readiness.missing.map(value=>node('li','',String(value))));
      const detail=data.readiness.details||{};ui.ConnectionChecks.textContent='Permissões: '+(detail.permissionCheck?'verificadas':'não confirmadas')+' · Assinatura de comentários: '+(detail.subscriptionCheck?'verificada':'não confirmada')+'. O alcance público depende da aprovação Meta.';
      notice('Conexão consultada. Confira as pendências abaixo; esta verificação não ativa respostas.');
    }catch(error){if(!destroyed&&error.name!=='AbortError')notice(error.message,true);}
    finally{busy=false;if(!destroyed){controls();schedulePoll();}}
  }
  async function changeStatus(action){
    if(busy||destroyed||!campaign||(action==='activate'&&(stale||campaign.status==='active'||campaign.readiness.ready!==true||!campaign.postId))||(action==='pause'&&campaign.status!=='active'))return;
    busy=true;stopRead();controls();notice(action==='activate'?'Ativando as respostas desta publicação…':'Pausando as respostas desta publicação…');
    try{const data=validCampaign(await request('/'+encodeURIComponent(campaign.id)+'/'+action,{body:{}}));if(destroyed)return;renderCampaign(data);notice(action==='activate'?'Respostas ativadas para os pedidos desta publicação.':'Respostas pausadas.');}
    catch(error){if(!destroyed&&error.name!=='AbortError')notice(error.message+' Atualize o andamento antes de tentar novamente.',true);}
    finally{busy=false;if(!destroyed){controls();schedulePoll();}}
  }
  listen(ui.Form,'submit',prepare);listen(ui.Reload,'click',loadCatalog);listen(ui.SearchCatalog,'click',loadCatalog);listen(ui.Search,'input',populateSources);
  listen(ui.Source,'change',()=>{sourceCard();changed();});listen(ui.Suggest,'click',()=>{const source=selectedSource();if(source){ui.Caption.value=suggestedCaption(source,ui.Keyword.value,ui.TriggerMode.value);changed();notice('Sugestão aplicada. Revise o texto antes de preparar a prévia.');}});
  for(const id of ['Account','Surface'])listen(ui[id],'change',()=>{if(ui.Surface.value==='instagram')ui.ReactEnabled.checked=false;ui.ConnectionState.hidden=true;changed();});
  listen(ui.TriggerMode,'change',()=>{changed();notice('Regra alterada. Revise a descrição ou use uma nova sugestão antes de preparar a prévia.');});
  for(const id of ['PublicReplyEnabled','ReactEnabled'])listen(ui[id],'change',()=>{ui.ConnectionState.hidden=true;changed();});
  for(const id of ['Keyword','Invite'])listen(ui[id],'change',changed);for(const id of ['PostId','GroupId','Caption'])listen(ui[id],'input',changed);
  listen(ui.CheckConnection,'click',checkConnection);
  listen(ui.Activate,'click',()=>changeStatus('activate'));listen(ui.Pause,'click',()=>changeStatus('pause'));listen(ui.Refresh,'click',()=>refreshCampaign());
  listen(ui.Copy,'click',async()=>{if(!campaign||busy)return;try{await window.navigator.clipboard.writeText(campaign.caption);notice('Descrição copiada. Anexe a foto de capa ao publicar na rede.');}catch{ui.PublicCaption.focus();ui.PublicCaption.select();notice('Selecione e copie a descrição no campo acima.');}});
  listen(document,'visibilitychange',()=>{if(document.hidden)stopRead();else if(campaign)refreshCampaign(true);});
  function destroy(){destroyed=true;stopRead();for(const controller of requests)controller.abort();requests.clear();listeners.forEach(remove=>remove());}
  listen(window,'pagehide',destroy);controls();loadCatalog().then(()=>{if(destroyed)return;let id='';try{id=window.localStorage.getItem(STORAGE)||'';}catch{}if(idPattern.test(id)){stale=true;refreshCampaign(true,id);}});
  return {destroy};
}

if(typeof document!=='undefined'){const root=document.querySelector('#socialCommentCampaigns');if(root)mountSocialCampaigns(root);}
