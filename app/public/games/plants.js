import {PLANTS_STORAGE_KEY,MAX_PLANTS,emptyPlants,readPlants,writePlants,changePlants,localPlantDay,pendingPlantCare,plantCareLabel} from './plants-core.js';

export function mountPlants({document:doc=globalThis.document,window:win=globalThis.window,now=()=>new Date()}={}) {
  if(!doc?.getElementById('plant-list')||!win)return null;
  const $=id=>doc.getElementById(id),listeners=[];
  const storage=()=>{try{return win.localStorage;}catch{return undefined;}};
  let loaded=readPlants(storage()),state=loaded.state,status=loaded.status,volatile=status==='unavailable',active=null,baseRevision=0,serial=0,disposed=false;
  function listen(node,type,callback){node.addEventListener(type,callback);listeners.push(()=>node.removeEventListener(type,callback));}
  function el(tag,className,text){const node=doc.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;return node;}
  const today=()=>localPlantDay(now());
  const format=date=>{const [year,month,day]=date.split('-');return `${day}/${month}/${year}`;};
  function say(message){$('plants-status').textContent=message;}
  function returnToPlant(id){
    const target=id?doc.querySelector(`.plant-card[data-plant-id="${id}"] .plant-card-actions button`):null;
    (target||$('add-plant')).focus({preventScroll:true});
  }
  function warning(){
    $('plants-storage-warning').hidden=status!=='corrupt'&&!volatile;
    $('plants-storage-message').textContent=status==='corrupt'?'Não conseguimos ler a lista salva. Ela foi preservada. Você pode tentar recarregar ou escolher recomeçar a lista neste aparelho.':'O navegador não permitiu salvar. As alterações ficam somente nesta página e podem se perder ao fechar ou recarregar.';
    $('plants-reset').hidden=status!=='corrupt';
    $('plants-save-note').textContent=volatile?'As alterações desta sessão estão somente na memória desta página. Fechar ou recarregar pode perdê-las.':'Esta lista fica apenas neste navegador e aparelho. Limpar os dados do navegador remove as plantas salvas; ela não é sincronizada com sua conta.';
    $('add-plant').disabled=status==='corrupt'||state.plants.length>=MAX_PLANTS;
  }
  function button(label,action,className='plants-button'){
    const node=el('button',className,label);node.type='button';node.addEventListener('click',action);return node;
  }
  function show(dialog,focus){dialog.showModal();if(focus)focus.focus({preventScroll:true});}
  function customField(){const custom=$('plant-care-type').value==='outro';$('plant-custom-wrap').hidden=!custom;$('plant-care-custom').required=custom&&Boolean($('plant-care-date').value);}
  function edit(id=null){
    const plant=state.plants.find(item=>item.id===id);if(id&&!plant){say('Esta planta não está mais na lista.');return;}
    active=id;baseRevision=state.revision;$('plant-form').reset();$('plant-form-error').textContent='';$('plant-editor-title').textContent=plant?'Editar planta':'Adicionar planta';
    $('plant-name').value=plant?.name||'';$('plant-location').value=plant?.location||'';$('plant-note').value=plant?.note||'';$('plant-care-type').value=plant?.care?.type||'revisar';$('plant-care-date').value=plant?.care?.date||'';$('plant-care-custom').value=plant?.care?.custom||'';customField();show($('plant-editor'),$('plant-name'));
  }
  function complete(id){
    const plant=state.plants.find(item=>item.id===id);if(!plant?.care){say('Este cuidado já foi atualizado.');return;}
    active=id;baseRevision=state.revision;$('plant-next-date').value='';$('plant-next-date').min=today();$('plant-complete-copy').textContent=`${plantCareLabel(plant.care)} · ${plant.name}. Confirme apenas se você já realizou esse cuidado.`;$('plant-complete-error').textContent='';show($('plant-complete'));
  }
  function remove(id){
    const plant=state.plants.find(item=>item.id===id);if(!plant)return;
    active=id;baseRevision=state.revision;$('plant-delete-title').textContent='Remover planta?';$('plant-delete-copy').textContent=`${plant.name} e suas anotações serão removidas deste aparelho. Esta ação não pode ser desfeita.`;$('plant-delete-confirm').textContent='Remover planta';$('plant-delete-error').textContent='';show($('plant-delete'));
  }
  function render(){
    if(disposed)return;
    const day=today(),pending=pendingPlantCare(state,day);$('plant-count').textContent=state.plants.length?`${state.plants.length} ${state.plants.length===1?'planta na sua lista':'plantas na sua lista'}`:'Sua lista está começando.';$('pending-count').textContent=pending.length?`${pending.length} ${pending.length===1?'cuidado':'cuidados'}`:'';
    $('pending-list').replaceChildren();$('plant-list').replaceChildren();$('pending-empty').hidden=pending.length>0;$('plants-empty').hidden=state.plants.length>0;
    for(const plant of pending){
      const row=el('article','plants-pending-item'),copy=el('div','');copy.append(el('strong','',plant.name),el('p','',`${plantCareLabel(plant.care)} · ${plant.care.date===day?'Hoje':`Data escolhida: ${format(plant.care.date)}`}`));
      const done=button('Marcar como feito',()=>complete(plant.id),'plants-button primary');done.setAttribute('aria-label',`Marcar ${plantCareLabel(plant.care).toLowerCase()} como feito para ${plant.name}`);row.append(copy,done);$('pending-list').append(row);
    }
    for(const plant of state.plants){
      const card=el('article','plant-card');card.dataset.plantId=plant.id;card.append(el('h3','',plant.name));if(plant.location)card.append(el('p','plant-location',plant.location));if(plant.note)card.append(el('p','plant-note',plant.note));
      const schedule=el('div','plant-schedule');schedule.append(el('strong','',plant.care?plantCareLabel(plant.care):'Sem cuidado agendado'),el('p','',plant.care?`Data escolhida: ${format(plant.care.date)}`:'Escolha um cuidado e uma data quando quiser.'));
      if(plant.care)schedule.append(button('Registrar cuidado feito',()=>complete(plant.id)));card.append(schedule);
      const actions=el('div','plant-card-actions');actions.append(button('Editar planta',()=>edit(plant.id)),button('Remover',()=>remove(plant.id)));card.append(actions);
      if(plant.history.length){const history=el('details','plant-history'),list=el('ul','');history.append(el('summary','',`Últimos cuidados · ${plant.history.length}`));for(const care of plant.history)list.append(el('li','',`${plantCareLabel(care)} · feito em ${format(care.completedOn)}`));history.append(list);card.append(history);}
      $('plant-list').append(card);
    }
    warning();
  }
  function commit(action){
    let latest=state;
    if(!volatile){
      const disk=readPlants(storage());
      if(disk.status==='corrupt'){status='corrupt';warning();throw Error('A lista salva não pôde ser lida. A alteração não foi gravada.');}
      if(disk.status==='unavailable')volatile=true;
      else latest=disk.state;
    }
    if(latest.revision!==baseRevision){state=latest;render();throw Error('Sua lista mudou em outra aba. Cancele e abra a planta novamente para conferir as mudanças.');}
    const next=changePlants(latest,action,today());
    if(!volatile&&!writePlants(storage(),next))volatile=true;
    state=next;status=volatile?'unavailable':'ok';render();
  }
  listen($('add-plant'),'click',()=>edit());
  listen($('plant-care-type'),'change',customField);listen($('plant-care-date'),'input',customField);
  for(const node of doc.querySelectorAll('[data-close]'))listen(node,'click',()=>$(node.dataset.close).close());
  listen($('plant-form'),'submit',event=>{
    event.preventDefault();if(!$('plant-form').reportValidity())return;
    const fields={name:$('plant-name').value,location:$('plant-location').value,note:$('plant-note').value,type:$('plant-care-type').value,date:$('plant-care-date').value,custom:$('plant-care-custom').value};
    try{const id=active||win.crypto?.randomUUID?.()||`plant-${Date.now()}-${++serial}`;commit({type:active?'edit':'add',id,fields});$('plant-editor').close();returnToPlant(id);say(volatile?'Planta atualizada nesta página. O navegador não permitiu salvar.':'Planta salva neste aparelho.');}
    catch(error){$('plant-form-error').textContent=error.message;}
  });
  listen($('plant-complete-form'),'submit',event=>{
    event.preventDefault();if(!$('plant-complete-form').reportValidity())return;
    try{commit({type:'complete',id:active,nextDate:$('plant-next-date').value});$('plant-complete').close();returnToPlant(active);say(volatile?'Cuidado registrado somente nesta página.':'Cuidado registrado. A próxima data só é definida quando você escolhe.');}
    catch(error){$('plant-complete-error').textContent=error.message;}
  });
  listen($('plants-reset'),'click',()=>{active='reset-corrupt';baseRevision=state.revision;$('plant-delete-title').textContent='Recomeçar esta lista?';$('plant-delete-copy').textContent='Os dados de plantas que não puderam ser lidos serão substituídos por uma lista vazia. Esta ação não pode ser desfeita.';$('plant-delete-confirm').textContent='Recomeçar lista';$('plant-delete-error').textContent='';show($('plant-delete'));});
  listen($('plant-delete-form'),'submit',event=>{
    event.preventDefault();
    try{
      if(active==='reset-corrupt'){
        if(readPlants(storage()).status!=='corrupt')throw Error('O armazenamento mudou. Recarregue a página antes de recomeçar.');
        const next=emptyPlants();if(!writePlants(storage(),next))throw Error('O navegador não permitiu salvar. A lista anterior foi preservada.');state=next;status='ok';volatile=false;render();
      }else commit({type:'delete',id:active});
      $('plant-delete').close();returnToPlant();say(volatile?'Lista atualizada somente nesta página.':'Lista atualizada neste aparelho.');
    }catch(error){$('plant-delete-error').textContent=error.message;}
  });
  listen(win,'storage',event=>{
    if(event.key!==PLANTS_STORAGE_KEY||volatile)return;const disk=readPlants(storage());
    if(disk.status==='corrupt'){status='corrupt';warning();return;}
    if(disk.status==='ok'||disk.status==='empty'){state=disk.state;status=disk.status;render();say('Sua lista foi atualizada em outra aba.');}
  });
  listen(doc,'visibilitychange',()=>{if(!doc.hidden)render();});listen(win,'pageshow',render);
  // Dates are local calendar days. Refresh a long-open page without scheduling a
  // push, changing the user's selected dates or completing any care automatically.
  let lastDay=today();const timer=win.setInterval(()=>{if(!doc.hidden&&today()!==lastDay){lastDay=today();render();}},60000);
  function dispose(){if(disposed)return;disposed=true;win.clearInterval(timer);for(const remove of listeners)remove();}
  listen(win,'pagehide',event=>{if(!event.persisted)dispose();});render();
  return {dispose};
}
if(typeof document!=='undefined'&&typeof window!=='undefined')mountPlants();
