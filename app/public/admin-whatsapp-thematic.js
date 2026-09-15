const API='/api/admin/whatsapp-qr/thematic-plan';
const reasons={already_scheduled:'Já reservado hoje; atualizar não repete o envio.',prior_result_needs_review:'Há um envio sem confirmação. Confira a conversa antes de continuar.',group_permission_or_name:'Nome ou permissão do grupo precisam de revisão.',no_published_source:'Ainda não há conteúdo publicado disponível para este tema.',outside_window:'A rotina segue a próxima janela de envio, das 10h às 18h, no horário de Brasília.'};
const delivery={pending:'Programado',processing:'Em envio',sent:'Aceito pelo serviço',failed:'Falha; revisar',cancelled:'Cancelado'};
export function thematicPublicPage(value,origin){try{const url=new URL(value,origin);return url.origin===origin&&!url.username&&!url.password&&/^\/(?:artigo\/[a-z0-9-]+|loja|centro-educacional\.html|servicos-digitais\.html|como-funciona\.html)?$/.test(url.pathname)?url.href:'';}catch{return '';}}
export function mountThematicGroups(root,{document=root?.ownerDocument,fetcher=(...args)=>fetch(...args),origin=document?.defaultView?.location.origin}={}){
  if(!root||!document)return {destroy(){}};
  const ui=Object.fromEntries(['Notice','Groups','Preview','PreviewButton','Activate','Pause','Reload','State'].map(id=>[id,root.querySelector('#tg'+id)]));
  const selected=new Set(),checks=new Map(),listeners=[];let state=null,preview=[],busy=false,uncertain=false,destroyed=false;
  const node=(tag,content,className)=>{const el=document.createElement(tag);if(content!==undefined)el.textContent=content;if(className)el.className=className;return el;};
  const listen=(el,event,fn)=>{el.addEventListener(event,fn);listeners.push(()=>el.removeEventListener(event,fn));};
  const notice=(message,error=false)=>{ui.Notice.textContent=message;ui.Notice.dataset.error=String(error);};
  function controls(){
    ui.Reload.disabled=busy;ui.PreviewButton.disabled=busy||!state;ui.Pause.disabled=busy||!state||uncertain;
    ui.Activate.disabled=busy||uncertain||!state||!selected.size||[...selected].some(id=>state.groups.find(group=>group.jid===id)?.needsReview||!preview.some(item=>item.groupJid===id&&!['group_permission_or_name','no_published_source','prior_result_needs_review'].includes(item.reason)));
    for(const check of checks.values())check.disabled=busy||uncertain;root.setAttribute('aria-busy',String(busy));
  }
  async function request(path='',body){const r=await fetcher(API+path,{...(body?{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),credentials:'same-origin'});let data;try{data=await r.json();}catch{throw Error('Não foi possível confirmar a resposta. Atualize o estado antes de continuar.');}if(!r.ok)throw Error(r.status===401?'Entre no painel administrativo para gerenciar os grupos.':data.error||'Não foi possível confirmar a programação.');return data;}
  function renderState(value){
    if(typeof value?.enabled!=='boolean'||!Array.isArray(value.groups)||value.groups.length!==4||!Array.isArray(value.groupJids))throw Error('Não foi possível conferir os quatro grupos desta rotina.');
    state=value;selected.clear();checks.clear();ui.Groups.replaceChildren();
    ui.State.textContent=value.enabled?'Ativa · '+value.groupJids.length+' grupos selecionados':'Pausada · nenhum novo envio será programado';
    for(const group of value.groups){
      const label=node('label',undefined,'pc-check'),check=node('input');check.type='checkbox';check.value=group.jid;check.checked=value.groupJids.includes(group.jid);if(check.checked)selected.add(group.jid);
      check.addEventListener('change',()=>{check.checked?selected.add(group.jid):selected.delete(group.jid);controls();});
      label.append(check,node('span',group.name+(group.needsReview?' · conferir envio anterior':'')));ui.Groups.append(label);checks.set(group.jid,check);
    }
  }
  function renderPreview(items){
    if(!Array.isArray(items)||items.length!==4||items.some(item=>!state.groups.some(group=>group.jid===item.groupJid)))throw Error('Não foi possível conferir a prévia dos quatro grupos.');
    preview=items;ui.Preview.replaceChildren();
    for(const item of items){
      const card=node('article',undefined,'pc-preview-card');card.append(node('h3',item.groupName));
      const status=item.confirmationState==='unknown'?'Sem confirmação; conferir conversa':delivery[item.status];
      card.append(node('p',status||reasons[item.reason]||'Prévia disponível. A ativação reserva este conteúdo no próximo horário da rotina.'));
      if(item.scheduledAt){const at=new Date(item.scheduledAt);if(Number.isFinite(at.getTime()))card.append(node('small',(item.reason==='already_scheduled'?'Horário reservado: ':'Horário previsto se ativada agora: ')+at.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' · Brasília'));}
      if(item.message)card.append(node('p',item.message));
      const href=thematicPublicPage(item.url,origin);if(href){const link=node('a','Abrir conteúdo da prévia');link.href=href;link.target='_blank';link.rel='noopener';card.append(link);}
      ui.Preview.append(card);
    }
  }
  async function refresh(withPreview=false){
    if(busy||destroyed)return;const chosen=[...selected];busy=true;controls();notice('Conferindo a rotina dos grupos…');
    try{const data=await request(withPreview?'/preview':'');if(destroyed)return;renderState(withPreview?data.settings:data);preview=[];ui.Preview.replaceChildren();if(withPreview){selected.clear();for(const [id,check] of checks){check.checked=chosen.includes(id);if(check.checked)selected.add(id);}renderPreview(data.groups);}uncertain=false;notice(withPreview?'Prévia atualizada. Conferir a prévia não envia mensagens.':'Estado atualizado. Confira a prévia antes de ativar os grupos.');}
    catch(error){if(!destroyed)notice(error.message,true);}finally{busy=false;if(!destroyed)controls();}
  }
  async function configure(enabled){
    if(busy||destroyed||uncertain||!state||(enabled&&ui.Activate.disabled))return;
    const payload={enabled,groupJids:enabled?[...selected]:[]};busy=true;controls();notice(enabled?'Confirmando a ativação dos grupos selecionados…':'Pausando a programação dos quatro grupos…');
    try{const data=await request('',payload);if(destroyed)return;renderState(data);preview=[];ui.Preview.replaceChildren();notice(enabled?'Rotina ativada para os grupos selecionados. Os envios seguem os horários informados.':'Rotina pausada. Envios pendentes foram cancelados; confira no histórico os que já estavam em andamento.');}
    catch(error){uncertain=true;if(!destroyed)notice(error.message+' Use “Atualizar estado” para conferir o resultado; a ação não será repetida automaticamente.',true);}finally{busy=false;if(!destroyed)controls();}
  }
  listen(ui.Reload,'click',()=>refresh());listen(ui.PreviewButton,'click',()=>refresh(true));listen(ui.Activate,'click',()=>configure(true));listen(ui.Pause,'click',()=>configure(false));
  controls();refresh();return {destroy(){destroyed=true;listeners.forEach(remove=>remove());}};
}
if(typeof document!=='undefined'){const root=document.querySelector('#thematicGroups');if(root)mountThematicGroups(root);}
