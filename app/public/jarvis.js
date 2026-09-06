(() => {
  'use strict';
  const $=id=>document.getElementById(id), base='/api/admin/jarvis';
  let items=[], snapshot=null, editing=null, asking=false;
  let researchSnapshot=null, researchRevision=null, researchTopics=[], researchInitialized=false;
  let researchDirty=false, researchBusy=false, researchLoading=false, researchFresh=false, researchActionError=false, researchVersion=0;
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
  function researchSourceUrl(source){
    if(typeof source!=='string'||!source.startsWith('Pesquisa Jarvis · '))return '';
    const value=source.slice('Pesquisa Jarvis · '.length).split(' · ')[0];
    if(!value||value.length>300||/[\s\\\u0000-\u001f\u007f]/.test(value))return '';
    try{
      const url=new URL(value),path=url.pathname,host=url.hostname;
      if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||value.split('/')[2]?.includes(':')||/%(?:2f|5c|00)/i.test(path))return '';
      const allowed=host==='developers.google.com'&&path.startsWith('/search/docs/')||
        host==='learn.microsoft.com'&&/^\/(?:pt-br|en-us)\//.test(path)||
        ['sebrae.com.br','meuatendimento.sebrae.com.br'].includes(host)&&/^\/sites\/PortalSebrae\/(?:artigos\/|ufs\/[a-z]{2}\/artigos\/)/.test(path);
      return allowed&&!/\.(?:pdf|zip|exe|js|json|mp4|png|jpe?g)$/i.test(path)?url.href:'';
    }catch{return '';}
  }
  function documents(){
    const list=$('documents');list.replaceChildren();const filtered=items.filter(d=>$('filter').value==='all'||d.status===$('filter').value);
    if(!filtered.length){list.append(node('p','Nenhum conhecimento neste filtro.','muted'));return;}
    for(const doc of filtered){
      const card=node('article',null,'document'),top=node('div',null,'document-top'),states={draft:'RASCUNHO',approved:'APROVADO',archived:'ARQUIVADO'};
      top.append(node('h3',doc.title),node('span',states[doc.status],'tag '+doc.status));card.append(top,node('p',`#${doc.id} · versão ${doc.revision} · atualizado ${date(doc.updated_at)}`,'fine'));
      card.append(node('p','Fonte: '+doc.source,'fine'));
      const sourceUrl=researchSourceUrl(doc.source);
      if(sourceUrl){const sourceLink=node('a','Abrir fonte ↗','research-source');sourceLink.href=sourceUrl;sourceLink.target='_blank';sourceLink.rel='noopener noreferrer';sourceLink.setAttribute('aria-label','Abrir fonte em outra aba: '+doc.title);card.append(sourceLink);}
      if(doc.expires_at)card.append(node('p','Validade: '+doc.expires_at+(doc.expires_at<new Date().toISOString().slice(0,10)?' · VENCIDO, fora das consultas':''),'fine'));
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
  async function loadStatus(){try{snapshot=await api('/status');displayStatus();}catch(e){error(e);}}
  function researchError(e,action=false){researchActionError=action;$('research-error').textContent=e.message||'Não foi possível consultar a pesquisa.';$('research-error').hidden=false;}
  function researchNotice(text){$('research-notice').textContent=text;}
  function syncResearchForm(s){
    if(!researchInitialized){
      $('research-topics').replaceChildren();
      researchTopics=s.topics.map((topic,index)=>{
        const label=node('label',null,'research-check'),input=document.createElement('input'),text=node('span');
        input.type='checkbox';input.id='research-topic-'+index;input.value=String(topic.id);label.htmlFor=input.id;
        text.append(node('strong',topic.label),node('small',topic.source));label.append(input,text);$('research-topics').append(label);
        input.onchange=()=>{researchDirty=true;displayResearch();};return input;
      });
      researchInitialized=true;
    }
    $('research-enabled').checked=s.enabled===true;
    for(const input of researchTopics)input.checked=s.topicIds.includes(input.value);
    researchRevision=s.revision;researchDirty=false;
  }
  function displayResearch(){
    const s=researchSnapshot,ready=researchInitialized&&researchFresh,count=value=>Math.max(0,Number(value)||0);
    $('research-fields').disabled=!ready||researchBusy;
    $('research-save').disabled=!ready||researchBusy;
    $('research-reload').disabled=researchBusy;
    $('research-reload').textContent=researchDirty?'Descartar edição e recarregar':'Recarregar configuração';
    const changed=!!s&&researchRevision!==s.revision;
    $('research-editing').textContent=!researchInitialized?'Aguardando configuração do servidor.':changed?
      'A configuração do servidor mudou. Sua edição foi preservada; recarregue antes de salvar.':researchDirty?
      'Há alterações não salvas. A pesquisa continua usando a configuração salva.':'Configuração salva. Atualizações de estado não alteram os campos deste formulário.';
    $('research-save').disabled=$('research-save').disabled||changed;
    if(!s){for(const id of ['research-start','research-pause','research-cancel','research-review'])$(id).disabled=true;return;}
    const limits=s.limits||{},daily=count(limits.dailyAttempts),pending=count(limits.pendingDrafts),total=count(limits.totalSources);
    $('research-state').textContent=!researchFresh?'ESTADO NÃO ATUALIZADO':s.active?'PESQUISA EM ANDAMENTO':!s.configured?'INDISPONÍVEL':s.status==='core_paused'?'AGUARDANDO JARVIS':s.status==='daily_limit'?'LIMITE DIÁRIO ATINGIDO':s.enabled?'PESQUISA AUTOMÁTICA ATIVA':'PESQUISA PAUSADA';
    $('research-pending').textContent=String(count(s.pendingDrafts));$('research-known').textContent=String(count(s.knownSources));
    $('research-attempts').textContent=count(s.dailyAttempts)+' / '+daily;
    $('research-limits').textContent=`Uma busca por rodada; até ${daily} tentativas por dia UTC, incluindo falhas, com intervalo mínimo de ${count(limits.cooldownHours)} horas. Até ${count(limits.perRun)} rascunhos por rodada, ${pending} pendentes e ${total} fontes registradas.`;
    const cooling=!!s.nextAt&&Date.parse(s.nextAt)>Date.now(),full=s.status==='capacity'||count(s.pendingDrafts)>=pending||count(s.knownSources)>=total,quota=count(s.dailyAttempts)>=daily;
    $('research-next').textContent=!researchFresh?'Não foi possível confirmar o estado atual. Recarregue para conferir.':!s.configured?
      'O serviço de pesquisa não está disponível. Nenhuma integração paga será ativada por estes controles.':s.active?
      'Rodada iniciada em '+date(s.active.startedAt)+'.':!s.enabled?'Agendamento pausado. Ative e salve para permitir pesquisas.':s.status==='core_paused'?
      'Aguardando a retomada do Jarvis. As consultas do núcleo estão pausadas; a pesquisa não será iniciada.':full?
      'Limite de rascunhos ou fontes atingido. Revise a base antes de novas pesquisas.':quota?
      'Limite diário de tentativas atingido. O contador usa o dia UTC.':s.nextAt?
      'Próxima oportunidade de pesquisa: '+date(s.nextAt)+'.':'Aguardando a próxima oportunidade de pesquisa na VPS.';
    const statuses={completed:'Concluída',failed:'Falhou',cancelled:'Cancelada',interrupted:'Interrompida',no_results:'Sem resultados',skipped:'Não iniciada',running:'Em andamento'};
    $('research-last').textContent=s.last&&s.last.status!=='never'?`Última rodada: ${statuses[s.last.status]||'Resultado registrado'} · ${date(s.last.at)} · ${count(s.last.created)} rascunho(s). ${String(s.last.summary||'').slice(0,600)}`:'Nenhuma rodada registrada.';
    $('research-start').disabled=!ready||researchBusy||!s.configured||!s.enabled||s.status==='core_paused'||!!s.active||researchDirty||changed||cooling||full||quota;
    $('research-pause').disabled=!ready||researchBusy||(!s.enabled&&!s.active);
    $('research-cancel').disabled=researchBusy||!s.active;
    $('research-review').disabled=researchBusy;
  }
  async function loadResearch(syncForm=false){
    const own=++researchVersion;researchLoading=true;
    try{
      const s=await api('/research/status');if(own!==researchVersion)return;
      if(!s||!Array.isArray(s.topics)||!Array.isArray(s.topicIds)||!Number.isInteger(s.revision))throw Error('Configuração da pesquisa indisponível.');
      researchSnapshot=s;researchFresh=true;if(!researchActionError)$('research-error').hidden=true;
      // Polling never changes checkboxes or rebuilds the memory under review.
      if(!researchInitialized||syncForm)syncResearchForm(s);
      displayResearch();
    }catch(e){if(own===researchVersion){researchFresh=false;researchError(e);displayResearch();}}
    finally{if(own===researchVersion)researchLoading=false;}
  }
  async function researchAction(action,message,syncForm=false){
    if(researchBusy)return;researchBusy=true;researchVersion++;researchActionError=false;$('research-error').hidden=true;displayResearch();
    try{await action();researchNotice(message);await loadResearch(syncForm);}
    catch(e){await loadResearch();researchError(e,true);researchNotice('A operação não foi confirmada. Confira o estado antes de tentar novamente.');}
    finally{researchBusy=false;displayResearch();}
  }
  $('research-enabled').onchange=()=>{researchDirty=true;displayResearch();};
  $('research-form').onsubmit=e=>{
    e.preventDefault();if(!researchSnapshot||!researchFresh||researchBusy||researchRevision!==researchSnapshot.revision)return;
    const body={enabled:$('research-enabled').checked,topicIds:researchTopics.filter(input=>input.checked).map(input=>input.value),revision:researchRevision};
    if(!body.topicIds.length){researchError(Error('Selecione pelo menos um tema antes de salvar a configuração.'),true);researchTopics[0]?.focus();return;}
    researchAction(()=>api('/research/settings','POST',body),'Configuração salva. Novos resultados serão apenas rascunhos.',true);
  };
  $('research-reload').onclick=()=>{if(!researchBusy){researchActionError=false;loadResearch(true);}};
  $('research-start').onclick=()=>{if(!$('research-start').disabled)researchAction(()=>api('/research/start','POST',{}),'Pesquisa iniciada na VPS. Nenhum conhecimento será aprovado automaticamente.');};
  $('research-pause').onclick=()=>{
    const s=researchSnapshot;if(!s||$('research-pause').disabled)return;
    researchAction(()=>api('/research/settings','POST',{enabled:false,topicIds:s.topicIds,revision:s.revision}),'Pesquisa pausada. O cancelamento não apaga rascunhos já salvos.',!researchDirty);
  };
  $('research-cancel').onclick=()=>{
    const id=researchSnapshot?.active?.id;if(!id||$('research-cancel').disabled)return;
    researchAction(()=>api('/research/cancel','POST',{id}),'Rodada cancelada. Rascunhos já salvos foram preservados; o agendamento não foi desligado.');
  };
  $('research-review').onclick=async()=>{$('filter').value='draft';await load();$('memory-title').focus();};
  $('ask-form').onsubmit=async e=>{
    e.preventDefault();if(asking)return;asking=true;$('error').hidden=true;$('ask').disabled=true;$('response').setAttribute('aria-busy','true');$('core').classList.add('working');$('answer-mode').textContent='CONSULTANDO';$('answer').textContent='Buscando conhecimentos aprovados… O modelo local pode levar até um minuto.';$('sources').replaceChildren();announce('Consulta iniciada.');
    try{const r=await api('/ask','POST',{question:$('question').value});$('answer').textContent=r.answer;$('answer-mode').textContent=r.mode==='local_model'?'RESPOSTA DO MODELO LOCAL':r.status==='no_sources'?'SEM CONHECIMENTO SUFICIENTE':'TRECHOS DA MEMÓRIA · SEM GERAÇÃO';$('answer-notice').textContent=r.notice;
      for(const source of r.sources){const li=node('li',`${source.title} · versão ${source.revision}. Fonte: ${source.source}. Atualizado ${date(source.updatedAt)}.`);$('sources').append(li);}announce('Consulta concluída.');
    }catch(e){error(e);$('answer-mode').textContent='CONSULTA NÃO CONCLUÍDA';$('answer').textContent='Não há resposta confirmada para esta consulta. Você pode tentar novamente.';}
    finally{asking=false;$('response').setAttribute('aria-busy','false');$('core').classList.remove('working');await load();}
  };
  $('knowledge-form').onsubmit=async e=>{e.preventDefault();$('save').disabled=true;$('error').hidden=true;try{const body={title:$('title').value,body:$('body').value,source:$('source').value,expiresAt:$('expires').value};if(editing)body.revision=editing.revision;await api('/knowledge'+(editing?'/'+editing.id:''),editing?'PUT':'POST',body);reset();announce('Rascunho salvo. Revise e aprove na base de conhecimento.');await load();}catch(e){error(e);}finally{$('save').disabled=false;}};
  $('pause').onclick=async()=>{if(!snapshot)return;try{await api('/settings','POST',{enabled:!snapshot.enabled});await load();announce(snapshot.enabled?'Jarvis retomado.':'Consultas pausadas.');}catch(e){error(e);}};
  $('clear').onclick=reset;$('filter').onchange=documents;$('refresh').onclick=()=>{load();loadResearch();};
  for(const b of document.querySelectorAll('[data-question]'))b.onclick=()=>{$('question').value=b.dataset.question;$('question').focus();};
  load();loadResearch();
  setInterval(()=>{if(!document.hidden&&!asking)loadStatus();},30000);
  setInterval(()=>{if(!document.hidden&&!researchBusy&&!researchLoading)loadResearch();},5000);
})();
