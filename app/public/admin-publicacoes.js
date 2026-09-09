import {publicCopyHasLinks,removePublicLinks} from './social-public-copy.js';

const API='/api/admin/facebook-photo-publications',STORAGE='vc-facebook-publication-pending-v1';
const STATES={draft:['Prévia preparada','neutral'],submitting:['Em envio','warn'],confirming:['Confirmando','warn'],published:['Publicação confirmada','good'],failed:['Não publicado','bad'],unknown:['Sem confirmação','warn'],held:['Precisa de ajuste','warn']};
const ID=/^[a-zA-Z0-9_-]{1,100}$/;
const text=value=>typeof value==='string'?value:'';
const normalized=value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const messages={pages_manage_posts:'Falta a permissão para publicar nesta Página.',pages_read_engagement:'Falta a permissão de leitura da Página.',pages_show_list:'Falta acesso à lista de Páginas da empresa.',CREATE_CONTENT:'O acesso à Página precisa permitir criar conteúdo.',paused:'As publicações estão pausadas na Central de Operações.',ecosystem_paused:'As publicações estão pausadas na Central de Operações.',source_changed:'O conteúdo original mudou. Prepare uma nova prévia.',source_unavailable:'O conteúdo original não está mais disponível para publicação.',permission_denied:'A Página ainda não autorizou esta publicação.',invalid_token:'A conexão da Página precisa ser renovada.',caption_links:'Retire os links e endereços de sites da descrição.',caption_invalid:'Revise a descrição: use de 10 a 1.500 caracteres, sem links ou HTML.',publication_unknown:'O Facebook não confirmou o resultado. Consulte o histórico antes de qualquer nova ação.'};
Object.assign(messages,{approved_content_unavailable:'Este conteúdo não está mais aprovado e disponível para publicação.',approved_source_changed:'A fonte ou a imagem mudou. Atualize o catálogo e prepare outra prévia.',approved_poster_required:'É necessária uma capa aprovada da Web Story.',invalid_approved_image:'A imagem aprovada precisa ser revista antes de publicar.',invalid_public_caption:'Revise a descrição: use de 10 a 1.500 caracteres, sem links ou HTML.',commercial_disclosure_required:'Comece este conteúdo comercial com “Publicidade”.',preview_confirmation_mismatch:'A confirmação não corresponde à prévia. Prepare outra prévia antes de publicar.',meta_token_expired:'A conexão expirou. Renove a autorização da Página.',page_token_unavailable:'A conexão desta Página precisa ser renovada.',page_not_authorized:'A Página escolhida não está autorizada para esta conta.',meta_permission_denied:'A Meta não confirmou a permissão para publicar.',meta_inspection_unavailable:'Não foi possível verificar as permissões agora. Consulte novamente em instantes.',meta_publish_unknown:'O resultado do envio não foi confirmado. Não publique novamente.',publication_not_confirmed:'Ainda não foi possível confirmar esta publicação.',stale_attempt_unknown:'A confirmação demorou além do esperado. Consulte a tentativa sem reenviar.',meta_publish_rejected:'A Meta recusou esta publicação. Confira a conexão e o conteúdo.',content_already_attempted_on_page:'Este conteúdo já tem uma tentativa nesta Página. Consulte o histórico.',receipt_unavailable_for_reconciliation:'Não há recibo suficiente para verificar esta tentativa.',receipt_does_not_match:'O recibo não corresponde ao conteúdo enviado. Confira a Página.',idempotency_conflict:'O conteúdo mudou desde a preparação. Atualize o catálogo e prepare outra prévia.',publication_service_unavailable:'O serviço de publicações está indisponível. Consulte o histórico antes de tentar outra ação.'});
export function publicationReason(value){return messages[value]||messages[text(value).split(':')[0]]||(!/^[a-zA-Z0-9_.:-]+$/.test(text(value))&&text(value).length<240?value:'Confira a conexão e as permissões da Página antes de publicar.');}
export function publicationState(value){return STATES[value]||['Estado não informado','warn'];}
export function publicationCaptionError(value,commercial=false){
  if(typeof value!=='string'||value.trim().length<10||value.length>1500)return 'Escreva uma descrição de 10 a 1.500 caracteres.';
  if(publicCopyHasLinks(value))return 'Retire os links e endereços de sites. Eles ficam nas mensagens privadas.';
  if(/[<>\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))return 'Use somente texto na descrição, sem marcações HTML.';
  if(commercial&&!/^Publicidade\b/i.test(value.trim()))return 'Comece a descrição deste conteúdo comercial com “Publicidade”.';
  return '';
}
export function publicationImage(value,origin){
  if(typeof value!=='string'||/[\s\\%?#]/.test(value)||value.startsWith('//'))return '';
  try{const url=new URL(value,origin);return url.origin===new URL(origin).origin&&!url.username&&!url.password&&/^\/story-assets\/[a-f0-9]{32}\.jpg$/.test(url.pathname)?url.href:'';}catch{return '';}
}
export function publicationReceiptUrl(value){
  if(typeof value!=='string'||!/^https:\/\//i.test(value)||/[\s\\]/.test(value))return '';
  try{const url=new URL(value);return ['www.facebook.com','facebook.com','m.facebook.com'].includes(url.hostname)&&!url.username&&!url.password&&!url.port?url.href:'';}catch{return '';}
}
export function publicationCanSend(receipt,{dirty=false,busy=false,paused=true,confirmed=false,imageReady=false,locked=false}={}){
  return !!receipt&&receipt.status==='draft'&&receipt.readiness?.ready===true&&Array.isArray(receipt.readiness.missing)&&receipt.readiness.missing.length===0&&!dirty&&!busy&&!paused&&confirmed&&imageReady&&!locked;
}
export function publicationCanReconcile(receipt){return receipt?.status==='unknown'&&/^\d+$/.test(text(receipt.photoId))&&/^\d+(?:_\d+)?$/.test(text(receipt.postId));}
function validReceipt(data){
  const item=data?.publication||data;
  if(!item||!ID.test(text(item.id))||!Object.hasOwn(STATES,item.status)||!item.source||!text(item.source.title)||typeof item.caption!=='string'||!item.readiness||typeof item.readiness.ready!=='boolean'||!Array.isArray(item.readiness.missing)||!item.accountId||!item.socialPostId||!/^[a-f0-9]{64}$/.test(text(item.previewHash)))throw Error('Não foi possível ler a confirmação completa. Atualize o histórico.');
  return item;
}
const stamp=value=>{const raw=text(value),date=new Date(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(raw)?raw.replace(' ','T')+'Z':raw);return Number.isFinite(date.valueOf())?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(date):'Horário não informado';};

export function mountPublications(root,{document=root?.ownerDocument,window=document?.defaultView,fetcher=(...args)=>fetch(...args),randomUUID=()=>crypto.randomUUID()}={}){
  if(!root||!document||!window)throw Error('Painel indisponível.');
  const ui=Object.fromEntries(['Notice','Refresh','Form','Fields','Search','Source','SourceCount','SourceNote','Page','PageNote','Caption','Count','CaptionError','Prepare','Preview','PreviewTitle','PreviewState','Empty','PreviewContent','PreviewPage','PreviewCaption','Cover','Readiness','Missing','PreviewNote','Hash','Confirm','Publish','History','HistoryCount'].map(key=>[key,root.querySelector('#pub'+key)]));
  const origin=window.location.origin,listeners=[],requests=new Set();let items=[],accounts=[],receipts=[],receipt=null,busy=false,loaded=false,paused=true,dirty=true,imageReady=false,destroyed=false,generation=0,requestKey='',requestSignature='';const locks=new Map();
  try{for(const row of JSON.parse(window.localStorage.getItem(STORAGE)||'[]'))if(ID.test(text(row.id))&&row.accountId&&row.socialPostId)locks.set(row.id,{id:row.id,accountId:String(row.accountId),socialPostId:row.socialPostId});}catch{}
  const listen=(element,event,handler)=>{element.addEventListener(event,handler);listeners.push(()=>element.removeEventListener(event,handler));};
  const node=(tag,value,className)=>{const item=document.createElement(tag);if(value!==undefined)item.textContent=String(value);if(className)item.className=className;return item;};
  const source=()=>items.find(item=>item.id===ui.Source.value);
  const page=()=>accounts.find(item=>String(item.id)===ui.Page.value);
  const announce=(value,error=false)=>{ui.Notice.textContent=value;ui.Notice.dataset.error=String(error);};
  const saveLocks=()=>{try{window.localStorage.setItem(STORAGE,JSON.stringify([...locks.values()].slice(-100)));}catch{}};
  const locked=()=>receipt&&locks.has(receipt.id);
  const tupleBlocked=()=>[...receipts.filter(item=>!['draft','failed','held'].includes(item.status)),...locks.values()].some(item=>String(item.accountId)===ui.Page.value&&item.socialPostId===ui.Source.value);
  function releaseUnsent(item){if(['failed','held'].includes(item.status)){locks.delete(item.id);saveLocks();requestSignature='';requestKey='';}}
  function controls(){
    const error=publicationCaptionError(ui.Caption.value,source()?.commercial===true);
    ui.Fields.disabled=busy||!loaded;ui.Refresh.disabled=busy;ui.Count.textContent=ui.Caption.value.length.toLocaleString('pt-BR')+' / 1.500 caracteres';
    ui.CaptionError.hidden=!ui.Caption.value||!error;ui.CaptionError.textContent=error;ui.Caption.setAttribute('aria-invalid',String(!!ui.Caption.value&&!!error));
    ui.Prepare.disabled=busy||!loaded||paused||!source()||!page()||!!error||tupleBlocked();
    const reviewable=!!receipt&&receipt.status==='draft'&&!dirty&&!busy&&!paused&&receipt.readiness.ready===true&&receipt.readiness.missing.length===0&&imageReady&&!locked();
    ui.Confirm.disabled=!reviewable;if(!reviewable)ui.Confirm.checked=false;
    ui.Publish.disabled=!publicationCanSend(receipt,{dirty,busy,paused,confirmed:ui.Confirm.checked,imageReady,locked:locked()});
    ui.Publish.textContent=busy&&receipt&&locked()?'Aguardando confirmação…':'Publicar no Facebook';
    if(tupleBlocked()&&!busy)ui.PageNote.textContent='Este conteúdo já tem uma tentativa nesta Página. Consulte o histórico para acompanhar o resultado.';
    else if(paused&&loaded)ui.PageNote.textContent='Publicações pausadas na Central de Operações.';
    else ui.PageNote.textContent='As permissões serão verificadas ao preparar a prévia.';
  }
  function changed(){dirty=true;ui.Confirm.checked=false;if(receipt)ui.PreviewNote.textContent='A escolha ou a descrição mudou. Prepare outra prévia antes de publicar.';controls();}
  function populateSources(){
    const previous=ui.Source.value,q=normalized(ui.Search.value),matches=items.filter(item=>normalized(item.title+' '+item.caption).includes(q)),blank=node('option','Escolha um conteúdo');blank.value='';ui.Source.replaceChildren(blank);
    for(const item of matches){const option=node('option',item.title);option.value=item.id;ui.Source.append(option);}ui.Source.value=matches.some(item=>item.id===previous)?previous:'';ui.SourceCount.textContent=matches.length+' conteúdos encontrados';if(previous!==ui.Source.value)changed();controls();
  }
  function renderReceipt(data,{fresh=false}={}){
    receipt=validReceipt(data);releaseUnsent(receipt);ui.Empty.hidden=true;ui.PreviewContent.hidden=false;imageReady=false;ui.Confirm.checked=false;
    const account=accounts.find(item=>String(item.id)===String(receipt.accountId)),name=account?.pageName||receipt.pageName||'Página '+receipt.pageId;
    ui.PreviewPage.textContent=name;ui.PreviewCaption.textContent=receipt.caption;const state=publicationState(receipt.status);ui.PreviewState.textContent=state[0];ui.PreviewState.dataset.tone=state[1];
    ui.Cover.replaceChildren();const src=publicationImage(receipt.source.image,origin);if(src){const img=node('img');img.alt='Imagem da publicação: '+receipt.source.title;img.src=src;img.referrerPolicy='no-referrer';const rendered=receipt;img.addEventListener('load',()=>{if(receipt===rendered&&!destroyed){imageReady=true;controls();}},{once:true});img.addEventListener('error',()=>{if(receipt===rendered&&!destroyed){imageReady=false;ui.Cover.replaceChildren(node('p','A foto não carregou. Atualize a prévia para conferir a imagem antes de publicar.'));controls();}},{once:true});ui.Cover.append(img);}else ui.Cover.append(node('p','A foto aprovada não pôde ser exibida. Confira o conteúdo original.'));
    ui.Readiness.textContent=receipt.status==='published'?'O Facebook confirmou esta publicação.':receipt.status==='unknown'?'O resultado ainda não foi confirmado. Não envie novamente.':receipt.readiness.ready?'Permissão de publicação verificada para esta Página.':'Há pendências para publicar nesta Página.';
    ui.Missing.replaceChildren(...receipt.readiness.missing.map(item=>node('li',publicationReason(item))));ui.Missing.hidden=!receipt.readiness.missing.length;
    ui.Hash.textContent=receipt.previewHash;
    ui.PreviewNote.textContent=receipt.status==='draft'?(fresh?'Prévia preparada. Confira a imagem inteira e o texto antes de confirmar.':dirty?'Esta prévia pertence ao histórico. Prepare a seleção atual antes de publicar.':'Confira a imagem e o texto antes de confirmar.'):receipt.status==='unknown'?'Consultar o resultado não cria outra publicação.':receipt.status==='published'?'O link da publicação está disponível no histórico.':'Acompanhe esta tentativa pelo histórico abaixo.';
    if(fresh)dirty=false;receipts=[receipt,...receipts.filter(item=>item.id!==receipt.id)];renderHistory();controls();
  }
  function renderHistory(){
    ui.History.replaceChildren();ui.HistoryCount.textContent=receipts.length+' registros';
    for(const item of receipts){const localUnknown=locks.has(item.id)&&item.status==='draft',row=node('article',undefined,'receipt'),copy=node('div'),aside=node('aside'),state=publicationState(localUnknown?'unknown':item.status),badge=node('span',state[0],'badge');badge.dataset.tone=state[1];aside.append(badge);const account=accounts.find(account=>String(account.id)===String(item.accountId));copy.append(node('h3',item.source.title),node('p',(account?.pageName||item.pageName||'Página '+item.pageId)+' · '+stamp(item.updatedAt||item.createdAt)));if(item.errorCode)copy.append(node('p',publicationReason(item.errorCode)));if(localUnknown)copy.append(node('p','Uma confirmação de envio ficou pendente neste navegador. Consulte o registro; uma nova tentativa está bloqueada.'));if(item.status==='unknown')copy.append(node('p',publicationCanReconcile(item)?'Há um recibo para consultar. Esta verificação não republica.':'Sem recibo suficiente para confirmar pelo painel. Confira a Página no Facebook; uma nova tentativa está bloqueada.'));
      const actions=node('div',undefined,'receipt-actions'),read=node('button','Consultar registro','secondary');read.type='button';read.disabled=busy;read.addEventListener('click',()=>readReceipt(item.id));actions.append(read);
      if(publicationCanReconcile(item)){const reconcile=node('button','Verificar recibo no Facebook','secondary');reconcile.type='button';reconcile.disabled=busy;reconcile.addEventListener('click',()=>reconcileReceipt(item));actions.append(reconcile);}
      const href=publicationReceiptUrl(item.publicationUrl);if(href&&item.status==='published'){const link=node('a','Abrir publicação confirmada ↗');link.href=href;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);}copy.append(actions);row.append(copy,aside);ui.History.append(row);
    }
    if(!receipts.length)ui.History.append(node('p','Nenhuma publicação registrada. Sua primeira prévia aparecerá aqui.','empty'));
  }
  async function request(path,{body}={}){
    const controller=new AbortController();requests.add(controller);const timeout=setTimeout(()=>controller.abort(),30000);
    try{const response=await fetcher(API+path,{credentials:'same-origin',cache:'no-store',signal:controller.signal,...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});let data;try{data=await response.json();}catch{throw Error('A resposta não pôde ser lida. Consulte o registro antes de qualquer nova ação.');}if(!response.ok){const message=response.status===401?'Sua sessão expirou. Entre novamente no painel administrativo.':response.status===403?'Sua conta não tem permissão para esta ação.':publicationReason(data.message||data.error||data.errorCode),error=Error(message);if(response.status===409){try{error.receipt=validReceipt(data);}catch{}}throw error;}return data;}catch(error){if(error.name==='AbortError')throw Error('O serviço demorou a confirmar. Consulte o registro antes de qualquer nova ação.');if(error instanceof TypeError)throw Error('A conexão foi interrompida. Consulte o registro antes de qualquer nova ação.');throw error;}finally{clearTimeout(timeout);requests.delete(controller);}
  }
  async function refresh(){
    if(busy||destroyed)return;busy=true;const version=++generation;controls();announce('Atualizando conteúdos, Páginas e histórico…');
    try{const [catalog,history]=await Promise.all([request('/catalog'),request('')]);if(destroyed||version!==generation)return;if(!Array.isArray(catalog.items)||!Array.isArray(catalog.accounts)||typeof catalog.paused!=='boolean'||!Array.isArray(history.items))throw Error('O catálogo completo não foi confirmado. Atualize o painel.');
      items=catalog.items.filter(item=>ID.test(text(item.id))&&text(item.title)&&publicationImage(item.image,origin));accounts=catalog.accounts.filter(item=>item.id&&/^\d+$/.test(text(item.pageId))&&text(item.pageName));paused=catalog.paused;receipts=history.items.map(validReceipt);receipts.forEach(releaseUnsent);loaded=true;populateSources();const previous=ui.Page.value,blank=node('option','Escolha uma Página');blank.value='';ui.Page.replaceChildren(blank);for(const account of accounts){const option=node('option',account.pageName+' · '+account.pageId);option.value=String(account.id);ui.Page.append(option);}ui.Page.value=accounts.some(account=>String(account.id)===previous)?previous:'';
      renderHistory();if(receipt){const updated=receipts.find(item=>item.id===receipt.id);if(updated)renderReceipt(updated);else{dirty=true;ui.PreviewNote.textContent='Esta prévia não foi localizada no histórico atual. Prepare uma nova prévia.';}}
      announce(paused?'Publicações pausadas na Central de Operações. O histórico continua disponível.':!accounts.length?'Nenhuma Página conectada. Conecte a conta da empresa nas Integrações.':!items.length?'Nenhuma imagem aprovada disponível na Vitrine Social.':'Painel atualizado. Escolha o conteúdo e prepare a prévia.');
    }catch(error){if(!destroyed){loaded=false;dirty=true;announce(error.message,true);}}finally{busy=false;if(!destroyed){controls();renderHistory();}}
  }
  async function prepare(event){
    event.preventDefault();if(busy||destroyed||ui.Prepare.disabled||!ui.Form.reportValidity())return;const selected=source(),account=page();if(!selected||!account)return;const error=publicationCaptionError(ui.Caption.value,selected.commercial===true);if(error){announce(error,true);return;}
    const payload={socialPostId:selected.id,accountId:account.id,caption:ui.Caption.value.normalize('NFKC').trim()},signature=JSON.stringify(payload);if(signature!==requestSignature){requestSignature=signature;requestKey=randomUUID();}payload.idempotencyKey=requestKey;busy=true;controls();announce('Preparando a prévia e verificando a Página…');
    try{const data=validReceipt(await request('/preview',{body:payload}));if(destroyed)return;if(String(data.accountId)!==String(payload.accountId)||data.socialPostId!==payload.socialPostId||data.caption!==payload.caption)throw Error('A prévia não corresponde à seleção atual. Confira os dados antes de continuar.');renderReceipt(data,{fresh:true});announce(data.status==='draft'?'Prévia pronta. Confira a foto, a descrição e a Página.':'Este conteúdo já tem uma tentativa registrada. Confira seu estado no histórico.');ui.PreviewTitle.focus();}catch(error){if(!destroyed){dirty=true;announce(error.message,true);}}finally{busy=false;if(!destroyed){controls();renderHistory();}}
  }
  async function publish(){
    if(destroyed||!publicationCanSend(receipt,{dirty,busy,paused,confirmed:ui.Confirm.checked,imageReady,locked:locked()}))return;const selected=receipt;locks.set(selected.id,{id:selected.id,accountId:String(selected.accountId),socialPostId:selected.socialPostId});saveLocks();busy=true;controls();renderHistory();announce('Enviando ao Facebook. Aguarde a confirmação e não repita a ação…');
    try{const data=validReceipt(await request('/'+encodeURIComponent(selected.id)+'/publish',{body:{previewHash:selected.previewHash}}));if(destroyed)return;renderReceipt(data);announce(data.status==='published'?'Publicação confirmada pelo Facebook. Abra o resultado no histórico.':'Solicitação registrada. Consulte o histórico para conferir o resultado.',data.status==='failed'||data.status==='unknown');}catch(error){if(!destroyed){dirty=true;if(error.receipt?.id===selected.id&&error.receipt.previewHash===selected.previewHash&&error.receipt.status==='draft'&&error.receipt.readiness.ready===false){locks.delete(selected.id);saveLocks();renderReceipt(error.receipt);announce('A verificação impediu o envio. Resolva as permissões e prepare uma nova prévia.',true);}else{ui.PreviewState.textContent='Sem confirmação';ui.PreviewState.dataset.tone='warn';ui.PreviewNote.textContent='A resposta não chegou. Uma nova tentativa está bloqueada. Consulte o registro para acompanhar esta publicação.';announce(error.message,true);}}}finally{busy=false;if(!destroyed){controls();renderHistory();}}
  }
  async function readReceipt(id){
    if(busy||destroyed||!ID.test(text(id)))return;busy=true;controls();renderHistory();announce('Consultando o registro, sem reenviar…');
    try{const data=await request('/'+encodeURIComponent(id));if(destroyed)return;dirty=true;renderReceipt(data);announce('Registro atualizado. Nenhuma publicação foi reenviada.');ui.PreviewTitle.focus();}catch(error){if(!destroyed)announce(error.message,true);}finally{busy=false;if(!destroyed){controls();renderHistory();}}
  }
  async function reconcileReceipt(item){
    if(busy||destroyed||!publicationCanReconcile(item))return;busy=true;controls();renderHistory();announce('Consultando no Facebook o recibo desta tentativa…');
    try{const data=await request('/'+encodeURIComponent(item.id)+'/reconcile',{body:{}});if(destroyed)return;dirty=true;renderReceipt(data);announce(receipt.status==='published'?'O Facebook confirmou a publicação existente.':'O resultado continua sem confirmação. Uma nova tentativa permanece bloqueada.');}catch(error){if(!destroyed)announce(error.message,true);}finally{busy=false;if(!destroyed){controls();renderHistory();}}
  }
  listen(ui.Search,'input',populateSources);listen(ui.Source,'change',()=>{const item=source();ui.Caption.value=item?removePublicLinks(text(item.caption)):'';if(item?.commercial&&!/^Publicidade\b/i.test(ui.Caption.value))ui.Caption.value='Publicidade\n\n'+ui.Caption.value;changed();});listen(ui.Page,'change',changed);listen(ui.Caption,'input',changed);listen(ui.Confirm,'change',controls);listen(ui.Form,'submit',prepare);listen(ui.Publish,'click',publish);listen(ui.Refresh,'click',refresh);controls();refresh();
  return {refresh,destroy(){destroyed=true;generation++;requests.forEach(controller=>controller.abort());listeners.forEach(remove=>remove());}};
}
if(typeof document!=='undefined'){const root=document.getElementById('main');if(root&&document.getElementById('pubForm'))mountPublications(root);}
