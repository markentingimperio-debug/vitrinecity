(() => {
  'use strict';
  const $=id=>document.getElementById(id), base='/api/admin/jarvis';
  let items=[], snapshot=null, editing=null, asking=false;
  const date=s=>s?new Date(s.length===10?s+'T23:59:59':s).toLocaleString('pt-BR'):'—';
  const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!=null)el.textContent=text;if(cls)el.className=cls;return el;};
  function announce(text){$('announcement').textContent=text;}
  function error(e){$('error').textContent=e.message||'Falha ao consultar o servidor.';$('error').hidden=false;}
  async function api(path,method='GET',body){
    const response=await fetch(base+path,{method,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(method==='POST'&&path==='/ask'?70000:8000),
      headers:method==='GET'?{}:{'Content-Type':'application/json','X-Jarvis-Request':'1'},...(body?{body:JSON.stringify(body)}:{})});
    if(response.status===401){location.assign('/admin-login.html');throw Error('Sessão expirada.');}
    const data=await response.json();if(!response.ok)throw Error(data.error||'Solicitação não concluída.');return data;
  }
  function reset(){editing=null;$('document-id').value='';$('knowledge-form').reset();$('editing').textContent='Toda edição exige nova aprovação.';$('save').textContent='Salvar rascunho';}
  function edit(doc){editing={id:doc.id,revision:doc.revision};$('title').value=doc.title;$('body').value=doc.body;$('source').value=doc.source;$('expires').value=doc.expires_at||'';$('editing').textContent=`Editando #${doc.id} · versão ${doc.revision}. Salvar retira a aprovação anterior.`;$('title').focus();}
  function documents(){
    const list=$('documents');list.replaceChildren();const filtered=items.filter(d=>$('filter').value==='all'||d.status===$('filter').value);
    if(!filtered.length){list.append(node('p','Nenhum conhecimento neste filtro.','muted'));return;}
    for(const doc of filtered){
      const card=node('article',null,'document'),top=node('div',null,'document-top'),states={draft:'RASCUNHO',approved:'APROVADO',archived:'ARQUIVADO'};
      top.append(node('h3',doc.title),node('span',states[doc.status],'tag '+doc.status));card.append(top,node('p',`#${doc.id} · versão ${doc.revision} · atualizado ${date(doc.updated_at)}`,'fine'));
      card.append(node('p','Fonte: '+doc.source,'fine'));if(doc.expires_at)card.append(node('p','Validade: '+doc.expires_at+(doc.expires_at<new Date().toISOString().slice(0,10)?' · VENCIDO, fora das consultas':''),'fine'));
      const detail=node('details');detail.append(node('summary','Ler conhecimento'),node('pre',doc.body));card.append(detail);
      const actions=node('div',null,'doc-actions'),editButton=node('button','Editar');editButton.type='button';editButton.onclick=()=>edit(doc);actions.append(editButton);
      if(doc.status!=='approved'){
        const check=document.createElement('input');check.type='checkbox';check.id='confirm-'+doc.id;
        const label=node('label');label.htmlFor=check.id;label.append(check,node('span','Revisei o conteúdo e tenho autorização para usá-lo.'));
        const approve=node('button','Aprovar');approve.type='button';approve.disabled=true;check.onchange=()=>approve.disabled=!check.checked;
        approve.onclick=()=>transition(doc,'approved',check.checked);actions.append(label,approve);
      }
      if(doc.status!=='archived'){const archive=node('button','Arquivar');archive.type='button';archive.onclick=()=>transition(doc,'archived',false);actions.append(archive);}
      card.append(actions);list.append(card);
    }
  }
  async function transition(doc,status,confirmed){
    try{await api('/knowledge/'+doc.id+'/status','POST',{status,revision:doc.revision,confirmed});announce(status==='approved'?'Conhecimento aprovado.':'Conhecimento arquivado.');await load();}catch(e){error(e);}
  }
  function displayStatus(){
    const s=snapshot;$('core-state').textContent=s.enabled?'Disponível':'Pausado';$('core-detail').textContent=s.active?'Consulta em processamento':'Assistente administrativo · v1';
    const labels={ready:'Pronto',unchecked:'A verificar',unconfigured:'Não configurado',unavailable:'Indisponível'};
    $('model-state').textContent=labels[s.model.state]||'A verificar';$('model-detail').textContent=s.modelName||'Consulta de trechos disponível, sem geração';
    $('memory-count').textContent=String(s.approvedAvailable);$('pause').disabled=false;$('pause').textContent=s.enabled?'Pausar consultas':'Retomar consultas';
    $('ask').disabled=asking||!s.enabled;$('core').classList.toggle('working',asking||Boolean(s.active));$('status-line').textContent='Leitura do servidor: '+new Date().toLocaleTimeString('pt-BR');
    const history=$('activity');history.replaceChildren();
    const statuses={running:'Em processamento',completed:'Concluída',no_sources:'Sem fontes suficientes',failed:'Interrompida ou não concluída',interrupted:'Interrompida por reinício'};
    for(const run of s.runs){const row=node('div',null,'run');row.append(node('strong',statuses[run.status]||run.status),node('span',`${run.mode==='local_model'?'Modelo local':'Consulta da memória'} · ${(run.duration_ms/1000).toFixed(1)} s · ${date(run.created_at)}`));history.append(row);}
    if(!s.runs.length)history.append(node('p','Nenhuma consulta registrada.','muted'));
  }
  async function load(){try{const [status,knowledge]=await Promise.all([api('/status'),api('/knowledge')]);snapshot=status;items=knowledge.items;displayStatus();documents();}catch(e){error(e);}}
  $('ask-form').onsubmit=async e=>{
    e.preventDefault();if(asking)return;asking=true;$('error').hidden=true;$('ask').disabled=true;$('response').setAttribute('aria-busy','true');$('core').classList.add('working');$('answer-mode').textContent='CONSULTANDO';$('answer').textContent='Buscando conhecimentos aprovados… O modelo local pode levar até um minuto.';$('sources').replaceChildren();announce('Consulta iniciada.');
    try{const r=await api('/ask','POST',{question:$('question').value});$('answer').textContent=r.answer;$('answer-mode').textContent=r.mode==='local_model'?'RESPOSTA DO MODELO LOCAL':r.status==='no_sources'?'SEM CONHECIMENTO SUFICIENTE':'TRECHOS DA MEMÓRIA · SEM GERAÇÃO';$('answer-notice').textContent=r.notice;
      for(const source of r.sources){const li=node('li',`${source.title} · versão ${source.revision}. Fonte: ${source.source}. Atualizado ${date(source.updatedAt)}.`);$('sources').append(li);}announce('Consulta concluída.');
    }catch(e){error(e);$('answer-mode').textContent='CONSULTA NÃO CONCLUÍDA';$('answer').textContent='Não há resposta confirmada para esta consulta. Você pode tentar novamente.';}
    finally{asking=false;$('response').setAttribute('aria-busy','false');$('core').classList.remove('working');await load();}
  };
  $('knowledge-form').onsubmit=async e=>{e.preventDefault();$('save').disabled=true;$('error').hidden=true;try{const body={title:$('title').value,body:$('body').value,source:$('source').value,expiresAt:$('expires').value};if(editing)body.revision=editing.revision;await api('/knowledge'+(editing?'/'+editing.id:''),editing?'PUT':'POST',body);reset();announce('Rascunho salvo. Revise e aprove na base de conhecimento.');await load();}catch(e){error(e);}finally{$('save').disabled=false;}};
  $('pause').onclick=async()=>{if(!snapshot)return;try{await api('/settings','POST',{enabled:!snapshot.enabled});await load();announce(snapshot.enabled?'Jarvis retomado.':'Consultas pausadas.');}catch(e){error(e);}};
  $('clear').onclick=reset;$('filter').onchange=documents;$('refresh').onclick=load;
  for(const b of document.querySelectorAll('[data-question]'))b.onclick=()=>{$('question').value=b.dataset.question;$('question').focus();};
  load();setInterval(()=>{if(!document.hidden&&!asking)load();},30000);
})();
