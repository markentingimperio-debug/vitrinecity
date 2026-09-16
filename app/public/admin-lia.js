(()=>{
  'use strict';
  const $=id=>document.getElementById(id),base='/api/admin/lia';
  let timer=null,submitting=false;
  const esc=value=>String(value??'');
  const when=value=>value?new Date(value).toLocaleString('pt-BR'):'—';
  function showError(message){$('error').textContent=message;$('error').hidden=false;}
  function clearError(){$('error').hidden=true;$('error').textContent='';}
  async function api(path,method='GET',body){
    const response=await fetch(base+path,{method,credentials:'same-origin',cache:'no-store',headers:method==='GET'?{}:{'content-type':'application/json','x-lia-request':'1'},...(body?{body:JSON.stringify(body)}:{})});
    if(response.status===401){location.assign('/admin-login.html');throw Error('Sessão administrativa expirada.');}
    let data={};try{data=await response.json();}catch{}
    if(!response.ok)throw Error(data.error||`Falha HTTP ${response.status}`);return data;
  }
  function badge(status){const span=document.createElement('span');span.className='tag '+(['completed'].includes(status)?'ok':['failed','cancelled','interrupted'].includes(status)?'bad':['running'].includes(status)?'run':'');span.textContent=String(status||'—').toUpperCase();return span;}
  function renderTask(item){
    const article=document.createElement('article');article.className='task';
    const top=document.createElement('div');top.className='task-top';const title=document.createElement('strong');title.textContent=esc(item.instruction).slice(0,180);top.append(title,badge(item.status));article.append(top);
    const meta=document.createElement('p');meta.className='meta';meta.textContent=`${when(item.createdAt)} · passo ${item.step||0} · ${Number(item.usage?.totalTokens||0).toLocaleString('pt-BR')} tokens · ${item.provider||'aguardando'}${item.model?` / ${item.model}`:''}`;article.append(meta);
    if(item.result){const pre=document.createElement('pre');pre.textContent=item.result;article.append(pre);}
    if(item.error){const p=document.createElement('p');p.className='failure';p.textContent='Falha: '+item.error;article.append(p);}
    const events=Array.isArray(item.events)?item.events:[];if(events.length){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`Ferramentas (${events.length})`;details.append(summary);const list=document.createElement('ul');for(const event of events){const li=document.createElement('li');li.textContent=`passo ${event.step}: ${event.tool} · ${event.ok?'ok':'falhou'}`;list.append(li);}details.append(list);article.append(details);}
    if(['queued','running'].includes(item.status)){const button=document.createElement('button');button.type='button';button.className='secondary small';button.textContent='Cancelar';button.onclick=()=>cancelTask(item.id,button);article.append(button);}
    return article;
  }
  async function loadStatus(){
    try{const data=await api('/status');$('state').textContent=data.enabled?'ONLINE':'DESLIGADA';$('state').className=data.enabled?'ok-text':'warn-text';$('state-detail').textContent=data.enabled?'executor interno disponível':'configure LIA_ENABLED e LIA_EXECUTOR_TOKEN na VPS';$('model').textContent=data.model?.name||'—';$('model-detail').textContent=data.fallback?.configured?'local + fallback opcional':'modelo local';$('limits').textContent=data.limits?`${data.limits.maxSteps} / ${Number(data.limits.maxTotalTokens).toLocaleString('pt-BR')}`:'—';$('active').textContent=data.activeTaskId?data.activeTaskId.slice(0,8):'NENHUMA';return data.enabled;}catch(error){$('state').textContent='INDISPONÍVEL';$('state-detail').textContent='executor não respondeu';showError(error.message);return false;}
  }
  async function loadTasks(){
    try{const data=await api('/tasks'),items=data.items||[];$('task-count').textContent=String(items.length);const target=$('tasks');target.replaceChildren();if(!items.length){const p=document.createElement('p');p.className='muted';p.textContent='Nenhuma tarefa executada.';target.append(p);}else for(const item of items)target.append(renderTask(item));
      const busy=items.some(item=>item.status==='running'||item.status==='queued');clearTimeout(timer);if(busy)timer=setTimeout(loadAll,3000);
    }catch(error){showError(error.message);}
  }
  async function loadAll(){clearError();const enabled=await loadStatus();if(enabled)await loadTasks();else{$('tasks').innerHTML='<p class="muted">Habilite a LIA na VPS para iniciar tarefas.</p>';}}
  async function submitTask(event){event.preventDefault();if(submitting)return;const instruction=$('instruction').value.trim();if(instruction.length<3)return;submitting=true;$('submit').disabled=true;clearError();try{const data=await api('/tasks','POST',{instruction});$('instruction').value='';$('announce').textContent=`Tarefa ${data.item?.id||''} enviada para a LIA.`;await loadAll();}catch(error){showError(error.message);}finally{submitting=false;$('submit').disabled=false;}}
  async function cancelTask(id,button){button.disabled=true;clearError();try{await api('/tasks/'+encodeURIComponent(id)+'/cancel','POST',{});await loadAll();}catch(error){showError(error.message);button.disabled=false;}}
  $('task-form').addEventListener('submit',submitTask);$('refresh').addEventListener('click',loadAll);loadAll();
})();
