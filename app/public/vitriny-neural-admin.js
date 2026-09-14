(()=>{
  'use strict';
  const $=id=>document.getElementById(id),base='/api/admin/vitriny-neural';
  let snapshot=null,skillsSnapshot=null,qualifications=[],benchmarkTimer=null,runningTest=false,researchSnapshot=null,researchCandidates=[],researchRunning=false,trainingSnapshot=null,trainingCandidates=[],trainingSaving=false,preflightRunning=false;
  const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!=null)el.textContent=text;if(cls)el.className=cls;return el;};
  const pct=v=>`${Math.round((Number(v)||0)*100)}%`;
  const date=v=>v?new Date(v).toLocaleString('pt-BR'):'—';
  function announce(text){$('announcement').textContent=text;}
  function showError(error){$('error').textContent=error?.message||'Não foi possível consultar a Vitriny Neural.';$('error').hidden=false;}
  function clearError(){$('error').hidden=true;}
  async function api(path,method='GET',body,timeout=15000){
    const response=await fetch(base+path,{method,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(timeout),headers:method==='GET'?{}:{'content-type':'application/json','x-neural-request':'1'},...(body?{body:JSON.stringify(body)}:{})});
    if(response.status===401){location.assign('/admin-login.html');throw Error('Sessão expirada.');}
    let data={};try{data=await response.json();}catch{}
    if(!response.ok)throw Object.assign(Error(data.error||`Falha HTTP ${response.status}.`),{status:response.status,responseData:data});return data;
  }
  function modeLabel(value){return({disabled:'DESLIGADA',shadow:'SHADOW',advisory:'ADVISORY',low_risk_auto:'LOW-RISK AUTO'})[value]||String(value||'—').toUpperCase();}
  async function verifyLocalModel(){
    if(preflightRunning)return;
    preflightRunning=true;$('model-preflight').disabled=true;
    const target=$('model-preflight-result');target.setAttribute('aria-busy','true');target.replaceChildren(node('p','Consultando o serviço local sem gerar conteúdo…'));
    try{
      const result=await api('/model/preflight','POST',{});
      if(result.ok!==true||!Array.isArray(result.providers))throw Error('Resposta de diagnóstico inválida.');
      target.replaceChildren(node('p',result.readyForTaskAttempt?'Pré-requisitos encontrados para tentar tarefas de rascunho. A qualidade ainda precisa de validação real.':'Ainda faltam pré-requisitos para tentar tarefas no chat.'));
      target.append(node('p',`Chat ${result.tasksEnabled?'habilitado':'desabilitado'} · cota ${result.taskQuotaAvailable?'disponível':'esgotada'} · verificação ${date(result.checkedAt)}${result.cached?' (conectividade em cache)':''}.`));
      if(!result.providers.length)target.append(node('p','Nenhum modelo local configurado.'));
      for(const provider of result.providers){
        const reasons=[];
        if(!provider.enabled)reasons.push('provedor bloqueado pela política');
        if(!provider.circuitClosed)reasons.push('circuito de falhas aberto');
        if(!provider.reachable)reasons.push('serviço sem resposta');
        else if(!provider.modelAvailable)reasons.push('modelo configurado indisponível');
        if(!provider.qualificationPresent)reasons.push('benchmark ainda não registrado');
        else if(!provider.qualificationModelMatches)reasons.push('nome do modelo diferente da qualificação');
        if(provider.blockedCapabilities?.length)reasons.push('faltam capacidades qualificadas: '+provider.blockedCapabilities.join(', '));
        target.append(node('p',`${provider.providerId} · ${provider.modelName||'modelo não informado'}: ${reasons.length?reasons.join('; '):'conectividade e qualificação verificadas'}.`));
      }
      target.append(node('p','Nenhuma inferência realizada. Aceitação de tarefa real ainda não executada por esta verificação.','fine'));
      announce('Diagnóstico do modelo local concluído.');
    }catch{target.replaceChildren(node('p','Não foi possível verificar o modelo local. A disponibilidade continua não confirmada.'));}
    finally{preflightRunning=false;$('model-preflight').disabled=false;target.setAttribute('aria-busy','false');}
  }
  function scoreClass(v){return Number(v)>=.9?'ok':Number(v)>=.75?'warn':'danger';}
  function renderSummary(){
    const s=snapshot||{},svc=s.service||{},ready=s.readiness||{},providerRows=s.skills?.providers||skillsSnapshot?.providers||[],primary=providerRows.find(p=>p.id===svc.primaryProviderId)||providerRows[0];
    $('mode').textContent=modeLabel(svc.mode);$('mode').className=svc.mode==='shadow'?'ok':svc.mode==='low_risk_auto'?'warn':'';
    $('mode-detail').textContent=svc.enabled?'Neural habilitada na VPS':'Neural desabilitada';
    $('provider').textContent=primary?.id||'SEM PROVIDER';
    $('provider-detail').textContent=primary?`${primary.local?'local':'remoto'} · circuito ${primary.stats?.circuit||'—'} · ${primary.policy?.enabled===false?'bloqueado para operação, liberado só para teste':'disponível'}`:'Configure um modelo para testar skills';
    const q=s.qualification;$('precision').textContent=q?pct(q.score):'NÃO MEDIDA';$('precision').className=q?scoreClass(q.score):'';
    $('precision-detail').textContent=q?`segurança ${pct(q.safetyScore)} · ${q.modelName||q.providerId}`:'Execute um benchmark para qualificar';
    $('readiness').textContent=modeLabel(ready.recommendedMode||'disabled');
    $('readiness-detail').textContent=ready.readyForLowRiskAuto?'Qualificado para baixo risco':ready.readyForAdvisory?'Pronto para advisory':ready.readyForShadow?'Pronto para shadow':'Faltam requisitos';
    $('status-line').textContent='Leitura do servidor: '+new Date().toLocaleTimeString('pt-BR');
  }
  function renderShadow(){
    const s=snapshot||{},observer=s.observer||{},store=s.neural?.store||{},budget=s.actionBudget||{};
    $('shadow-state').textContent=s.service?.mode==='shadow'?'SHADOW ATIVO':modeLabel(s.service?.mode);
    $('shadow-state').className='tag '+(s.service?.mode==='shadow'?'ok':'warn');
    $('observer-state').textContent=observer.running?'Ativo':'Parado';$('observer-state').className=observer.running?'ok':'warn';
    $('observer-detail').textContent=observer.lastRunAt?`última leitura ${date(observer.lastRunAt)}`:`intervalo ${Math.round((observer.intervalMs||0)/1000)} s`;
    $('auto-state').textContent=s.service?.mode==='shadow'?'Bloqueadas':`${budget.used||0} usadas`;
    $('budget-detail').textContent=`${budget.used||0} / ${budget.limit??0} ações reservadas hoje`;
    const sig=store.signals||{};$('signals').textContent=String(sig.total??0);$('signals-detail').textContent=sig.lastAt?`último ${date(sig.lastAt)}`:'Métricas agregadas';
    $('deadletters').textContent=String(store.deadLetters??0);
  }
  function renderSkills(){
    const data=skillsSnapshot||snapshot?.skills||{skills:[],providers:[]},target=$('skills'),providers=$('providers');target.replaceChildren();providers.replaceChildren();
    const list=data.skills||[];$('skill-count').textContent=`${list.length} SKILLS`;
    if(!list.length)target.append(node('p','Nenhuma skill registrada.','muted'));
    for(const item of list){const card=node('article',null,'skill'),top=node('div',null,'item-top');top.append(node('strong',item.id),node('span',String(item.risk||'—').toUpperCase(),'tag'));card.append(top,node('small',`v${item.version||'1'}`,'muted'));const caps=node('div',null,'caps');for(const cap of item.capabilities||[])caps.append(node('span',cap));card.append(caps);target.append(card);}
    for(const p of data.providers||[]){const card=node('article',null,'provider-row'),top=node('div',null,'item-top'),enabled=p.policy?.enabled!==false;top.append(node('strong',p.id),node('span',enabled?'ATIVO':'BLOQUEADO','tag '+(enabled?'ok':'danger')));card.append(top,node('small',`${p.local?'local':'remoto'} · prioridade ${p.priority} · confiabilidade ${pct(p.stats?.reliability)} · ${Math.round(p.stats?.avgMs||0)} ms`,'muted'));card.append(node('small',`tokens: ${p.stats?.totalTokens||0} · circuito: ${p.stats?.circuit||'—'} · política: ${p.policy?.source||'não qualificada'}`,'muted'));providers.append(card);}
    if(!(data.providers||[]).length)providers.append(node('p','Nenhum provider configurado no runtime.','muted'));
  }
  function renderLearning(){
    const store=snapshot?.neural?.store||{},target=$('learning');target.replaceChildren();
    const queue=Array.isArray(store.queue)?store.queue:[],lessons=Array.isArray(store.lessons)?store.lessons:[];
    const rows=[['Eventos na fila',queue.reduce((n,x)=>n+Number(x.total||0),0)],['Lições registradas',lessons.reduce((n,x)=>n+Number(x.total||0),0)],['Sinais',Number(store.signals?.total||0)],['Dead letters',Number(store.deadLetters||0)]];
    for(const [label,value] of rows){const r=node('div',null,'learn-row'),top=node('div',null,'item-top');top.append(node('strong',label),node('span',String(value),'tag'));r.append(top);target.append(r);}
    const actions=$('actions');actions.replaceChildren();const b=snapshot?.actionBudget||{};actions.append(node('p',`${b.used||0} de ${b.limit??0} ações autônomas de baixo risco usadas/reservadas hoje.`));actions.append(node('p',snapshot?.service?.mode==='shadow'?'Em shadow, o Policy Gate não executa essas ações.':'A execução continua sujeita ao Policy Gate.','fine'));
  }
  function categoryRows(categories,target){target.replaceChildren();const entries=Object.entries(categories||{});if(!entries.length){target.append(node('p','Sem notas por categoria.','muted'));return;}for(const [name,value] of entries){const score=Number(value?.score||0),row=node('div',null,'category-row'),top=node('div',null,'category-top'),bar=node('div',null,'bar');top.append(node('strong',name),node('span',pct(score),scoreClass(score)));bar.append(Object.assign(node('span'),{style:`width:${Math.round(score*100)}%`}));row.append(top,bar);target.append(row);}}
  function renderQualifications(){
    const target=$('qualifications');target.replaceChildren();if(!qualifications.length){target.append(node('p','Nenhuma qualificação registrada. Execute o benchmark real.','muted'));return;}
    for(const q of qualifications.slice(0,10)){const card=node('article',null,'qualification'),top=node('div',null,'item-top');top.append(node('strong',q.modelName||q.providerId),node('span',`${pct(q.score)} · ${q.productionEligible?'ELEGÍVEL':'BLOQUEADO'}`,'tag '+(q.productionEligible?'ok':'danger')));card.append(top,node('small',`${q.providerId} · segurança ${pct(q.safetyScore)} · ${date(q.createdAt)}`,'muted'));const cats=node('div',null,'caps');for(const [name,v] of Object.entries(q.report?.categories||{}))cats.append(node('span',`${name} ${pct(v.score)}`));card.append(cats);target.append(card);}
  }
  function latestBenchmarkFrom(data){return data.active||(data.recent||[])[0]||null;}
  async function loadBenchmark(){
    try{const data=await api('/benchmark');const item=latestBenchmarkFrom(data);if(!item){$('benchmark-state').textContent='SEM RESULTADO';$('benchmark-start').disabled=false;return;}
      $('benchmark-state').textContent=String(item.status||'—').toUpperCase();$('benchmark-start').disabled=item.status==='running';
      if(item.status==='running'){$('benchmark-score').textContent='…';$('benchmark-grade').textContent='Testando o modelo real';$('benchmark-meta').textContent=`Iniciado ${date(item.startedAt||item.createdAt)}. Pode levar vários minutos no modelo local.`;scheduleBenchmark();return;}
      const full=(await api('/benchmark/'+item.id)).item;$('benchmark-score').textContent=pct(full.score);$('benchmark-score').className=scoreClass(full.score);$('benchmark-grade').textContent=`Nota ${full.grade||'—'} · ${full.passed}/${full.total} casos aprovados`;categoryRows(full.report?.categories||{},$('benchmark-categories'));$('benchmark-meta').textContent=`${full.providerId} · ${full.modelName||'modelo não informado'} · concluído ${date(full.completedAt)}`;
    }catch(e){$('benchmark-state').textContent='INDISPONÍVEL';$('benchmark-start').disabled=false;showError(e);}
  }
  function scheduleBenchmark(){clearTimeout(benchmarkTimer);benchmarkTimer=setTimeout(loadBenchmark,5000);}
  const growthActions=new Set(['diagnose','campaign-plan','content-plan','seo-plan','experiment','metric-review']);
  function updateTestArea(){
    const area=$('area').value,isGrowth=area==='growth';
    $('growth-action-field').hidden=!isGrowth;$('growth-action').disabled=!isGrowth;
    $('test-hint').textContent=area==='media'?'Este teste exige um provider de imagem; o Qwen de texto pode não suportar esta capacidade.':'A resposta é apenas para avaliação administrativa. Providers reprovados em benchmark continuam testáveis aqui, mas bloqueados para operação.';
  }
  function inputFor(area,prompt,growthAction){switch(area){
    case'code':return['code.engineer',{action:'analyze',task:prompt,repository:'vitrinecity',constraints:['sem deploy automático','mudança reversível'],dryRun:true,requireTests:true}];
    case'growth':
      if(!growthActions.has(growthAction))throw Error('Escolha um tipo de pedido de marketing antes de executar o teste.');
      return['growth.optimizer',{action:growthAction,objective:prompt,businessContext:'VitrineCity · marketplace e rede social local',channel:'multi',metrics:{}}];
    case'research':return['research.supervised',{action:'verify',question:prompt,sourcePolicy:'authoritative-first',maxSources:8,freshnessDays:30}];
    case'commerce':return['commerce.advisor',{action:'seller-diagnose',objective:prompt,catalog:[],metrics:{},constraints:['não inventar valores ausentes']}];
    case'ranking':return['ranking.optimizer',{action:'evaluate',objective:prompt,features:{},metrics:{},sampleSize:0,maxWeightChange:.02,offlineOnly:true}];
    case'media':return['media.generate',{type:'image',prompt,aspectRatio:'1:1',count:1,quality:'standard'}];
    default:return['support.assistant',{action:'draft-reply',message:prompt,businessContext:'VitrineCity',tone:'cordial',channel:'admin-test',confirmedFacts:{}}];
  }}
  function outputText(data){const r=data?.result||{},o=r.output??r.asset??r;if(typeof o==='string')return o;if(typeof o?.text==='string')return o.text;if(typeof o?.output?.text==='string')return o.output.text;try{return JSON.stringify(o,null,2);}catch{return String(o);}}
  async function runTest(event){
    event.preventDefault();if(runningTest)return;clearError();
    const prompt=$('prompt').value.trim(),area=$('area').value;if(prompt.length<3)return;
    let skill,input;
    try{[skill,input]=inputFor(area,prompt,$('growth-action').value);}catch(e){showError(e);$('growth-action').focus();return;}
    const started=performance.now();runningTest=true;$('run-test').disabled=true;$('test-response').setAttribute('aria-busy','true');$('test-provider').textContent='PROCESSANDO';$('test-time').textContent='aguarde';$('test-output').textContent='Consultando o modelo local em modo de avaliação. O raciocínio oculto foi desativado para responder mais rápido…';
    try{const data=await api('/skills/'+encodeURIComponent(skill)+'/run','POST',input,150000);$('test-provider').textContent=data.result?.provider||'CONCLUÍDO';$('test-time').textContent=`${((performance.now()-started)/1000).toFixed(1)} s`;$('test-output').textContent=outputText(data)||'Resposta vazia.';announce('Teste da Vitriny Neural concluído.');await loadAll(false);}catch(e){$('test-provider').textContent='FALHOU';$('test-time').textContent=`${((performance.now()-started)/1000).toFixed(1)} s`;$('test-output').textContent=e.message;showError(e);}finally{runningTest=false;$('run-test').disabled=false;$('test-response').setAttribute('aria-busy','false');}
  }
  async function startBenchmark(){clearError();$('benchmark-start').disabled=true;try{const data=await api('/benchmark/start','POST',{},15000);$('benchmark-state').textContent='RUNNING';$('benchmark-score').textContent='…';$('benchmark-grade').textContent='Benchmark iniciado';$('benchmark-meta').textContent=`Execução ${data.item.id}. O painel acompanhará sem bloquear esta página.`;announce('Benchmark real iniciado.');scheduleBenchmark();}catch(e){showError(e);$('benchmark-start').disabled=false;}}
  function renderWebResearch(){
    const s=researchSnapshot||{};$('web-research-state').textContent=s.running?'PESQUISANDO':s.enabled?'AUTÔNOMA ATIVA':'MANUAL / PAUSADA';$('web-research-state').className='tag '+(s.configured?'ok':'danger');
    $('web-research-config').textContent=s.configured?'PRONTA':'SEARXNG PENDENTE';$('web-research-engines').textContent=(s.engines||[]).join(', ')||'sem motores';
    $('web-research-runs').textContent=String(s.runsToday??0);$('web-research-limit').textContent=`limite ${s.dailyRuns??0} por dia`;
    $('web-research-pending').textContent=String(s.pendingCandidates??0);$('web-research-approved').textContent=String(s.approvedCandidates??0);
    $('web-research-start').disabled=researchRunning||s.running||!s.configured;
    $('web-research-last').textContent=s.last?`Última: ${s.last.topic} · ${s.last.status} · ${s.last.results||0} fontes · ${s.last.candidates||0} candidatos`:'Nenhuma rodada registrada.';
    const target=$('web-research-candidates');target.replaceChildren();
    if(!researchCandidates.length){target.append(node('p','Nenhum conhecimento candidato aguardando revisão.','muted'));return;}
    for(const item of researchCandidates.slice(0,30)){
      const card=node('article',null,'qualification'),top=node('div',null,'item-top');top.append(node('strong',item.title||item.host),node('span',pct(item.score),'tag '+scoreClass(item.score)));card.append(top,node('small',`${item.host} · ${item.source_type} · ${(item.providers||[]).join(', ')}`,'muted'),node('p',item.claim,'fine'));
      const actions=node('div',null,'caps'),open=node('a','Abrir fonte ↗');open.href=item.url;open.target='_blank';open.rel='noopener noreferrer';
      const approve=node('button','Aprovar candidato'),reject=node('button','Rejeitar');approve.type=reject.type='button';approve.onclick=()=>reviewResearchCandidate(item.id,'approved');reject.onclick=()=>reviewResearchCandidate(item.id,'rejected');actions.append(open,approve,reject);card.append(actions);target.append(card);
    }
  }
  async function loadWebResearch(){try{const [status,candidates]=await Promise.all([api('/web-research/status'),api('/web-research/candidates?status=candidate&limit=50')]);researchSnapshot=status;researchCandidates=candidates.items||[];renderWebResearch();}catch(e){researchSnapshot={configured:false,enabled:false};researchCandidates=[];renderWebResearch();showError(e);}}
  async function startWebResearch(event){event.preventDefault();if(researchRunning)return;clearError();researchRunning=true;$('web-research-start').disabled=true;$('web-research-last').textContent='Pesquisando motores públicos e pontuando fontes…';try{const topic=$('web-research-topic').value.trim(),query=$('web-research-query').value.trim();const data=await api('/web-research/start','POST',{...(topic?{topic}:{}),...(query?{query}:{})},30000);announce(`Pesquisa concluída com ${data.result.candidates} candidato(s).`);await loadWebResearch();}catch(e){showError(e);$('web-research-last').textContent=e.message;}finally{researchRunning=false;if(researchSnapshot?.configured)$('web-research-start').disabled=false;}}
  async function reviewResearchCandidate(id,status){clearError();try{await api('/web-research/candidates/'+encodeURIComponent(id)+'/review','POST',{status,note:status==='approved'?'Revisado no console administrativo':'Descartado no console administrativo'});announce(status==='approved'?'Candidato aprovado para curadoria futura.':'Candidato rejeitado.');await loadWebResearch();}catch(e){showError(e);}}
  function renderTraining(){
    const s=trainingSnapshot||{},counts=s.counts||{},approved=Number(counts.approved||0),minimum=Number(s.pilotMinimumExamples||50);
    $('training-state').textContent=s.readyForPilot?'PILOTO PRONTO':'EM CURADORIA';$('training-state').className='tag '+(s.readyForPilot?'ok':'warn');
    $('training-candidates-count').textContent=String(counts.candidate||0);$('training-approved-count').textContent=String(approved);$('training-rejected-count').textContent=String(counts.rejected||0);$('training-minimum').textContent=String(minimum);$('training-progress').textContent=`${approved}/${minimum} · ${s.domainCoverage||0}/${s.pilotMinimumDomains||4} áreas · ${s.validationExamples||0}/${s.pilotMinimumValidationExamples||5} validação`;
    const target=$('training-candidates');target.replaceChildren();
    if(!trainingCandidates.length){target.append(node('p','Nenhum exemplo aguardando revisão.','muted'));return;}
    for(const item of trainingCandidates){const card=node('article',null,'qualification training-example'),top=node('div',null,'item-top');top.append(node('strong',item.instruction),node('span',String(item.domain||'—').toUpperCase(),'tag'));card.append(top);if(item.input)card.append(node('p',item.input,'fine'));card.append(node('p',item.expectedOutput,'expected'));const actions=node('div',null,'caps'),approve=node('button','Aprovar para dataset'),reject=node('button','Rejeitar');approve.type=reject.type='button';approve.onclick=()=>reviewTraining(item.id,'approved');reject.onclick=()=>reviewTraining(item.id,'rejected');actions.append(approve,reject);card.append(actions);target.append(card);}
  }
  async function loadTraining(){try{const [status,candidates]=await Promise.all([api('/training/status'),api('/training/examples?status=candidate&limit=100')]);trainingSnapshot=status;trainingCandidates=candidates.items||[];renderTraining();}catch(e){trainingSnapshot={counts:{},readyForPilot:false};trainingCandidates=[];renderTraining();showError(e);}}
  async function saveTraining(event){event.preventDefault();if(trainingSaving)return;clearError();trainingSaving=true;$('training-save').disabled=true;try{const item={domain:$('training-domain').value,source:'manual',instruction:$('training-instruction').value.trim(),input:$('training-context').value.trim(),expectedOutput:$('training-output').value.trim()};await api('/training/examples','POST',item);event.currentTarget.reset();announce('Exemplo salvo como candidato. Revise antes de aprovar.');await loadTraining();}catch(e){showError(e);}finally{trainingSaving=false;$('training-save').disabled=false;}}
  async function reviewTraining(id,status){clearError();let reason='';if(status==='rejected'){reason=window.prompt('Informe o motivo da rejeição:','Exemplo inadequado para treinamento.')||'';if(!reason.trim())return;}try{await api('/training/examples/'+encodeURIComponent(id)+'/review','POST',{status,confirmed:status==='approved',reason});announce(status==='approved'?'Exemplo aprovado para o dataset.':'Exemplo rejeitado.');await loadTraining();}catch(e){showError(e);}}
  function exportTraining(split){location.assign(base+'/training/export?split='+encodeURIComponent(split));}
  // Astra is an explicit advisory action in this console. Never retry a paid POST.
  const supervisorStorageKey='vitriny-neural-supervisor-pending-v1';
  const supervisorReviewStorageKey='vitriny-neural-supervisor-review-pending-v1';
  const supervisorId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
  const supervisorMoney=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?new Intl.NumberFormat('pt-BR',{style:'currency',currency:'USD',maximumFractionDigits:4}).format(value):'Não informado';
  const supervisorStates={prepared:'Preparada',submitting:'Em avaliação',completed:'Concluída · plano candidato',unknown:'Resultado incerto',failed:'Falha · conferir resultado',blocked:'Não enviada',needs_review:'Precisa de revisão'};
  let supervisorSnapshot=null,supervisorOperation='',supervisorLoading=false,supervisorRun=null,supervisorReadback=false,supervisorConfigUncertain=false,supervisorConfigDirty=false,supervisorPending=null,supervisorReviewPending=null;
  try{const saved=JSON.parse(sessionStorage.getItem(supervisorStorageKey)||'null');if(supervisorId(saved?.id))supervisorPending={id:saved.id,createdAt:saved.createdAt};}catch{}
  try{const saved=JSON.parse(sessionStorage.getItem(supervisorReviewStorageKey)||'null');if(supervisorId(saved?.id)){supervisorReviewPending={id:saved.id,createdAt:saved.createdAt};if(!supervisorPending)supervisorPending={...supervisorReviewPending};}}catch{}
  function supervisorNotice(value){$('supervisor-notice').textContent=value;}
  function supervisorErrorText(value){
    const labels={astra_text_invalid:'Revise o objetivo: use texto sem links, dados pessoais ou credenciais.',astra_no_approved_context:'Ainda não há contexto aprovado para este objetivo.',
      astra_daily_budget:'O limite diário disponível não cobre esta avaliação.',astra_hourly_limit:'Aguarde o intervalo entre avaliações e atualize o estado.',
      astra_model_check_required:'Confira o acesso ao modelo antes de avaliar.',astra_paused:'O supervisor ou a pausa geral bloqueou esta avaliação.',
      astra_config_changed:'A configuração mudou. Atualize o estado antes de salvar.',astra_context_unchanged:'O contexto ainda não mudou desde a última avaliação diária.',
      astra_input_limit:'O contexto excede o limite desta avaliação.',astra_model_check_failed:'Não foi possível conferir o acesso ao modelo.',
      astra_model_access_denied:'O modelo ainda não está autorizado nesta conexão.',astra_model_unavailable:'O modelo está indisponível nesta conexão.',
      astra_result_uncertain:'O resultado está incerto. Confira o registro existente sem repetir a avaliação.',astra_response_invalid:'A resposta recebida precisa de revisão; ela não foi aplicada.',
      astra_context_or_config_changed:'O contexto ou a configuração mudou durante a avaliação. O resultado precisa de revisão.',
      astra_usage_limit_exceeded:'O uso recebido excedeu o limite previsto. O supervisor foi pausado para revisão.',astra_paused_before_submit:'A pausa impediu o envio desta avaliação.',
      astra_request_conflict:'O identificador já pertence a uma avaliação. Confira o registro existente.',astra_run_not_found:'O registro ainda não foi encontrado.'};
    return labels[value]||(/^astra_/.test(String(value||''))?'Não foi possível concluir esta operação. Confira o estado antes de tentar novamente.':value);
  }
  function supervisorError(value){$('supervisor-error').textContent=supervisorErrorText(value)||'';$('supervisor-error').hidden=!value;}
  function supervisorRemember(pending){
    try{
      if(pending){const text=JSON.stringify({id:pending.id,createdAt:pending.createdAt});sessionStorage.setItem(supervisorStorageKey,text);if(sessionStorage.getItem(supervisorStorageKey)!==text)throw Error('storage');}
      else sessionStorage.removeItem(supervisorStorageKey);
      supervisorPending=pending;return true;
    }catch{return false;}
  }
  function supervisorRememberReview(pending){
    try{if(pending){const text=JSON.stringify({id:pending.id,createdAt:pending.createdAt});sessionStorage.setItem(supervisorReviewStorageKey,text);if(sessionStorage.getItem(supervisorReviewStorageKey)!==text)throw Error('storage');}else sessionStorage.removeItem(supervisorReviewStorageKey);supervisorReviewPending=pending;return true;}catch{return false;}
  }
  const supervisorReviewable=run=>run?.state==='failed'&&run.failureReviewable===true&&run.applied===false&&run.notSubmitted!==true&&typeof run.actualUsd==='number'&&Number.isFinite(run.actualUsd)&&run.actualUsd>0;
  const supervisorFailureReviewed=run=>supervisorReviewable(run)&&run.reviewed===true&&typeof run.reviewedAt==='string'&&Number.isFinite(Date.parse(run.reviewedAt));
  const supervisorCanAcknowledge=run=>supervisorReviewable(run)&&run.reviewed===false;
  const supervisorRunLabel=run=>supervisorFailureReviewed(run)?'Falha · revisão encerrada':supervisorStates[run.state];
  function supervisorConfirmed(run){return run?.state==='completed'||supervisorFailureReviewed(run)||(run?.notSubmitted===true&&run?.retrySafe===true&&['blocked','failed'].includes(run.state));}
  function supervisorValidRun(run){return run&&supervisorId(run.id)&&Object.hasOwn(supervisorStates,run.state)&&run.applied===false;}
  function supervisorAccept(run,readback=false){
    if(!supervisorValidRun(run))throw Error('O registro da avaliação não pôde ser confirmado. Confira o histórico sem repetir o envio.');
    supervisorRun=run;supervisorReadback=readback;
    if(supervisorReviewPending?.id===run.id&&supervisorFailureReviewed(run))supervisorRememberReview(null);
    if(supervisorPending?.id===run.id&&supervisorConfirmed(run)){
      if(supervisorRemember(null))supervisorNotice(run.state==='completed'?'Plano candidato disponível para revisão. Nenhuma mudança foi aplicada.':supervisorFailureReviewed(run)?'Revisão encerrada. A falha, o custo e o intervalo continuam registrados; nenhuma avaliação foi repetida.':'O servidor confirmou que esta avaliação não foi enviada.');
      else supervisorNotice('Resultado conferido. Atualize o estado antes de iniciar outra avaliação.');
    }
    renderSupervisorRun();
  }
  function supervisorReason(){
    const s=supervisorSnapshot,quote=s?.quote?.maximumUsd;
    if(supervisorOperation||supervisorLoading)return 'Aguarde a operação atual.';
    if(supervisorReviewPending)return 'Confira o encerramento da revisão existente. Nenhuma avaliação será repetida.';
    if(supervisorPending)return 'Confira a avaliação existente antes de iniciar outra. O envio não será repetido.';
    if(supervisorConfigUncertain)return 'Atualize o estado para confirmar a configuração salva.';
    if(!s)return 'Estado do supervisor indisponível.';
    if(!s.configured)return 'A conexão com o provedor ainda não está configurada.';
    if(s.paused)return 'A pausa geral está ativa.';
    if(!s.enabled)return 'Habilite o supervisor para solicitar uma avaliação manual.';
    if(s.availability?.state!=='available')return 'Confira o acesso ao modelo antes de solicitar uma avaliação.';
    if(typeof quote!=='number'||!Number.isFinite(quote)||quote<=0)return 'A estimativa de custo ainda não está disponível.';
    if(typeof s.budget?.remainingUsd!=='number'||s.budget.remainingUsd<quote)return 'O saldo do limite diário não cobre esta avaliação.';
    if(s.budget?.nextEvaluationAt&&new Date(s.budget.nextEvaluationAt).getTime()>Date.now())return 'Próxima avaliação disponível em '+date(s.budget.nextEvaluationAt)+'.';
    return '';
  }
  function supervisorControls(){
    const s=supervisorSnapshot,busy=Boolean(supervisorOperation||supervisorLoading),reason=supervisorReason();
    $('supervisor-evaluate').disabled=Boolean(reason);$('supervisor-objective').disabled=busy||Boolean(supervisorPending)||!s;
    $('supervisor-evaluate').textContent=supervisorOperation==='evaluate'?'Avaliando…':typeof s?.quote?.maximumUsd==='number'?'Avaliar com Astra · até '+supervisorMoney(s.quote.maximumUsd):'Avaliar com Astra';
    $('supervisor-evaluation-detail').textContent=reason||'Consulta paga iniciada apenas por este botão. O plano é candidato e não executa mudanças.';
    $('supervisor-enabled').disabled=busy||!s||supervisorConfigUncertain;
    $('supervisor-automatic').disabled=busy||!s||supervisorConfigUncertain;
    $('supervisor-daily-cap').disabled=busy||!s||supervisorConfigUncertain;
    $('supervisor-save').disabled=busy||!s||supervisorConfigUncertain;
    $('supervisor-check').disabled=busy||!s?.configured;
    $('supervisor-refresh').disabled=busy;
    $('supervisor-reconcile').hidden=!supervisorPending&&!supervisorReviewPending;$('supervisor-reconcile').disabled=busy;
    const reviewable=supervisorCanAcknowledge(supervisorRun);
    $('supervisor-acknowledge').hidden=!reviewable;$('supervisor-acknowledge').disabled=busy||Boolean(supervisorReviewPending)||!reviewable;
    $('supervisor-review-detail').hidden=!reviewable;$('supervisor-acknowledge').textContent=supervisorOperation==='acknowledge'?'Encerrando revisão…':'Encerrar revisão desta falha';
    $('supervisor-active').setAttribute('aria-busy',supervisorOperation==='evaluate'?'true':'false');
  }
  function renderSupervisorRun(){
    const r=supervisorRun,pending=supervisorPending;$('supervisor-active').hidden=!r&&!pending;
    $('supervisor-run-state').textContent=r?(supervisorReadback?'Avaliação existente · ':'')+supervisorRunLabel(r):'Aguardando confirmação do envio';
    $('supervisor-run-id').textContent='Registro: '+(r?.id||pending?.id||'—');
    $('supervisor-run-cost').textContent=r?`Custo calculado: ${supervisorMoney(r.actualUsd)} · máximo reservado: ${supervisorMoney(r.maximumUsd)}`:'O custo será calculado a partir do uso registrado no servidor.';
    $('supervisor-run-detail').textContent=r?.state==='completed'?'Proposta candidata, não aplicada. Reaproveite a estrutura existente e revise as recomendações.':
      supervisorFailureReviewed(r)?'Esta falha teve a revisão encerrada. O custo calculado continua no orçamento e o intervalo para uma nova avaliação não foi alterado.':
      supervisorReviewable(r)?'A resposta chegou, mas não passou na validação. O servidor registrou o recibo e o uso; você pode encerrar a revisão desta falha sem repetir a avaliação.':
      r?.notSubmitted===true?'O servidor informa que não houve envio ao modelo.':
      'Aguarde ou confira esta avaliação existente. Uma falha de conexão não confirma que o modelo deixou de receber o pedido.';
    const target=$('supervisor-result');target.replaceChildren();
    if(r?.state==='completed'&&r.result){
      if(typeof r.result.summary==='string')target.append(node('p',r.result.summary.slice(0,5000),'supervisor-summary'));
      for(const [field,title] of [['findings','Estrutura e pontos observados'],['recommendations','Melhorias candidatas'],['evidenceIds','Referências da avaliação']]){
        const list=Array.isArray(r.result[field])?r.result[field].filter(value=>typeof value==='string').slice(0,15):[];
        if(!list.length)continue;const block=node('div'),items=node('ul');block.append(node('h4',title));for(const value of list)items.append(node('li',value.slice(0,3000)));block.append(items);target.append(block);
      }
      if(r.candidateId)target.append(node('p','Candidato registrado na Neural: '+String(r.candidateId).slice(0,160),'fine'));
    }
    supervisorControls();
  }
  function renderSupervisor(){
    const s=supervisorSnapshot;if(!s){$('supervisor-state').textContent='INDISPONÍVEL';supervisorControls();return;}
    $('supervisor-state').textContent=s.paused?'PAUSA GERAL':s.enabled?(s.automaticDaily?'SUPERVISÃO CONSULTIVA DIÁRIA':'AVALIAÇÃO MANUAL HABILITADA'):'DESABILITADO';
    $('supervisor-state').className='tag '+(s.enabled&&!s.paused?'ok':'warn');
    $('supervisor-model').textContent=s.model||'Não informado';$('supervisor-connection').textContent=s.configured?'Conexão configurada · modelo principal preservado':'Conexão pendente';
    $('supervisor-access').textContent=({available:'Disponível',unavailable:'Indisponível',unknown:'Não conferido'})[s.availability?.state]||'Não conferido';
    $('supervisor-checked').textContent=s.availability?.checkedAt?'Conferido em '+date(s.availability.checkedAt):'Use “Conferir acesso ao modelo”.';
    $('supervisor-budget').textContent=supervisorMoney(s.budget?.reservedOrSpentUsd)+' / '+supervisorMoney(s.dailyUsdLimit);
    $('supervisor-day').textContent=`${s.budget?.day||'Dia não informado'} · saldo ${supervisorMoney(s.budget?.remainingUsd)} · inclui reservas ainda não concluídas`;
    $('supervisor-quote').textContent=supervisorMoney(s.quote?.maximumUsd);
    $('supervisor-limits').textContent=s.limits?.minIntervalSeconds?`Intervalo mínimo: ${Math.ceil(s.limits.minIntervalSeconds/60)} min · custo final depende do uso confirmado`:'O custo final depende do uso confirmado.';
    if(!supervisorConfigDirty){$('supervisor-enabled').checked=s.enabled;$('supervisor-automatic').checked=s.automaticDaily===true;$('supervisor-daily-cap').value=typeof s.dailyUsdLimit==='number'?s.dailyUsdLimit.toFixed(2):'';}
    $('supervisor-automatic-detail').textContent=(s.automaticDaily?`Rotina consultiva habilitada. Próxima: ${date(s.automatic?.nextAt)} · última tentativa: ${date(s.automatic?.lastAttemptAt)}. Nenhuma recomendação é aplicada automaticamente.`:'Avaliação diária desativada. Habilitar pode consumir o limite diário e produz somente planos candidatos.')+(s.automatic?.error?' Última tentativa: '+supervisorErrorText(s.automatic.error):'');
    $('supervisor-daily-cap').max=typeof s.limits?.maxDailyUsd==='number'?String(s.limits.maxDailyUsd):'0';
    $('supervisor-cap-detail').textContent=`Limite permitido: até ${supervisorMoney(s.limits?.maxDailyUsd)} por dia. Reservas incertas continuam no orçamento. A rotina diária habilitada pode consultar a IA no próximo ciclo.`;
    const history=$('supervisor-history');history.replaceChildren();
    const recent=Array.isArray(s.recent)?s.recent.filter(supervisorValidRun).slice(0,20):[];
    if(!recent.length)history.append(node('p','Nenhuma avaliação registrada.','muted'));
    for(const run of recent){
      const card=node('article',null,'qualification supervisor-history-item'),top=node('div',null,'item-top');
      top.append(node('strong',supervisorRunLabel(run)),node('span','NÃO APLICADO','tag'));card.append(top,
        node('p',typeof run.objective==='string'?run.objective.slice(0,2000):'Avaliação da estrutura atual.'),
        node('small',`${date(run.createdAt)} · custo calculado: ${supervisorMoney(run.actualUsd)} · máximo: ${supervisorMoney(run.maximumUsd)}`,'muted'));
      const open=node('button',run.state==='completed'?'Ver plano existente':'Conferir registro');open.type='button';open.disabled=Boolean(supervisorOperation||supervisorLoading)||(supervisorPending&&supervisorPending.id!==run.id);
      open.onclick=()=>readSupervisorRun(run.id);card.append(open);history.append(card);
    }
    renderSupervisorRun();
  }
  function acceptSupervisorStatus(data){
    if(!data||typeof data.enabled!=='boolean'||typeof data.configured!=='boolean'||data.model!=='gpt-6-astra'||!Number.isSafeInteger(data.revision))throw Error('O estado do supervisor não pôde ser confirmado.');
    supervisorSnapshot=data;
    if(!supervisorPending){
      const outstanding=(Array.isArray(data.recent)?data.recent:[]).find(run=>supervisorValidRun(run)&&!supervisorConfirmed(run));
      if(outstanding){const pending={id:outstanding.id,createdAt:outstanding.createdAt};if(!supervisorRemember(pending))supervisorPending=pending;}
    }
    renderSupervisor();
  }
  async function loadSupervisor(restore=false){
    if(supervisorLoading)return;supervisorLoading=true;supervisorControls();
    try{const data=await api('/supervisor/status');acceptSupervisorStatus(data);if(supervisorConfigUncertain){supervisorConfigUncertain=false;supervisorConfigDirty=false;supervisorNotice('Configuração conferida no servidor. Nenhuma avaliação foi repetida.');}
      else if(!supervisorPending&&!supervisorRun)supervisorNotice('Estado carregado. Abrir este painel não solicita uma avaliação. A rotina diária depende da configuração salva.');
      supervisorError('');
    }catch(error){supervisorSnapshot=null;supervisorError(error.message);}
    finally{supervisorLoading=false;renderSupervisor();}
    if(restore&&supervisorPending&&!supervisorOperation)await readSupervisorRun(supervisorPending.id);
  }
  async function saveSupervisor(event){
    event.preventDefault();if(supervisorOperation||supervisorLoading||supervisorConfigUncertain||!supervisorSnapshot)return;
    const cap=Number($('supervisor-daily-cap').value),maximum=supervisorSnapshot.limits?.maxDailyUsd;
    if(!$('supervisor-daily-cap').value.trim()||!Number.isFinite(cap)||cap<0||typeof maximum!=='number'||cap>maximum){supervisorError('Informe um limite diário dentro do máximo exibido.');return;}
    supervisorOperation='config';supervisorControls();supervisorError('');
    try{const data=await api('/supervisor/config','PUT',{enabled:$('supervisor-enabled').checked,automaticDaily:$('supervisor-automatic').checked,dailyUsdLimit:cap,revision:supervisorSnapshot.revision});
      supervisorConfigDirty=false;acceptSupervisorStatus(data);supervisorNotice(data.enabled&&data.automaticDaily?'Configuração salva e conferida. A rotina diária pode solicitar uma avaliação paga no próximo ciclo, dentro do limite.':'Configuração salva e conferida. Esta ação não solicitou uma avaliação.');
    }catch(error){supervisorConfigUncertain=true;supervisorError(error.message);supervisorNotice('Não foi possível confirmar a configuração. Use “Atualizar estado” antes de tentar outra alteração.');}
    finally{supervisorOperation='';renderSupervisor();}
  }
  async function checkSupervisor(){
    if(supervisorOperation||supervisorLoading||!supervisorSnapshot?.configured)return;supervisorOperation='check';supervisorControls();supervisorError('');
    try{acceptSupervisorStatus(await api('/supervisor/check','POST',{},25000));supervisorNotice('Acesso ao modelo conferido. Nenhuma avaliação paga foi solicitada.');}
    catch(error){if(supervisorSnapshot)supervisorSnapshot={...supervisorSnapshot,availability:{state:'unknown'}};supervisorError(error.message);supervisorNotice('Conferência de acesso não confirmada. Atualize o estado para consultar o resultado.');}
    finally{supervisorOperation='';renderSupervisor();}
  }
  async function readSupervisorRun(id){
    if(!supervisorId(id)||supervisorOperation||supervisorLoading)return;supervisorOperation='read';supervisorControls();supervisorError('');
    try{const data=await api('/supervisor/runs/'+encodeURIComponent(id));if(data.run?.id!==id)throw Error('A resposta não corresponde à avaliação solicitada.');supervisorAccept(data.run,true);await loadSupervisor();}
    catch(error){supervisorError(error.status===404?'O registro ainda não foi encontrado. O envio não será repetido; confira novamente mais tarde.':error.message);}
    finally{supervisorOperation='';renderSupervisor();}
  }
  async function acknowledgeSupervisorFailure(){
    const run=supervisorRun;
    if(supervisorOperation||supervisorLoading||supervisorReviewPending||!supervisorCanAcknowledge(run))return;
    if(!supervisorRememberReview({id:run.id,createdAt:new Date().toISOString()})){supervisorError('Não foi possível guardar a confirmação nesta aba. A revisão não foi enviada.');return;}
    supervisorOperation='acknowledge';supervisorControls();supervisorError('');
    try{
      const data=await api('/supervisor/runs/'+encodeURIComponent(run.id)+'/acknowledge-failure','POST',{confirmed:true});
      if(data.run?.id!==run.id||!supervisorValidRun(data.run)||!supervisorFailureReviewed(data.run))throw Error('O encerramento desta revisão não pôde ser confirmado.');
      supervisorAccept(data.run,true);await loadSupervisor();
    }catch(error){supervisorError(error.message);supervisorNotice('O encerramento ainda não foi confirmado. Use “Conferir avaliação existente”; esta ação não será repetida automaticamente.');}
    finally{supervisorOperation='';renderSupervisor();}
  }
  async function evaluateSupervisor(event){
    event.preventDefault();if(supervisorReason())return;
    const objective=$('supervisor-objective').value.trim();if(objective.length<12||objective.length>1000){supervisorError('Descreva o objetivo da avaliação, de 12 a 1.000 caracteres.');return;}
    let requestId;try{requestId=crypto.randomUUID();}catch{supervisorError('Não foi possível criar o registro seguro desta avaliação.');return;}
    if(!supervisorId(requestId)||!supervisorRemember({id:requestId,createdAt:new Date().toISOString()})){supervisorError('Não foi possível guardar o identificador nesta aba. Nenhuma avaliação foi enviada.');return;}
    supervisorOperation='evaluate';supervisorReadback=false;supervisorRun=null;supervisorControls();renderSupervisorRun();supervisorError('');
    supervisorNotice('Avaliação solicitada uma vez. O resultado será um plano candidato, sem aplicar mudanças.');
    try{const data=await api('/supervisor/evaluate','POST',{requestId,objective},70000);if(data.run?.id!==requestId)throw Error('O servidor não confirmou o identificador da avaliação.');supervisorAccept(data.run);await loadSupervisor();}
    catch(error){
      const run=error.responseData?.run;
      if(run?.id===requestId&&supervisorValidRun(run))supervisorAccept(run);
      const proof=error.responseData;
      if(proof?.requestId===requestId&&proof.notSubmitted===true&&proof.retrySafe===true&&(!run||(run.id===requestId&&supervisorValidRun(run)&&supervisorConfirmed(run)&&run.notSubmitted===true))){
        if(supervisorRemember(null)){await loadSupervisor();supervisorNotice('O servidor confirmou que nenhuma consulta foi enviada. Corrija o motivo indicado antes de avaliar novamente.');}
      }
      supervisorError(error.message);if(supervisorPending)supervisorNotice('Resultado ainda não confirmado. Use “Conferir avaliação existente”; não faremos outro envio.');
    }finally{supervisorOperation='';renderSupervisor();}
  }
  if($('supervisor-panel')){
    $('supervisor-config-form').onsubmit=saveSupervisor;$('supervisor-evaluate-form').onsubmit=evaluateSupervisor;
    $('supervisor-check').onclick=checkSupervisor;$('supervisor-refresh').onclick=()=>loadSupervisor(true);
    $('supervisor-reconcile').onclick=()=>{const pending=supervisorReviewPending||supervisorPending;if(pending)readSupervisorRun(pending.id);};
    $('supervisor-acknowledge').onclick=acknowledgeSupervisorFailure;
    $('supervisor-enabled').onchange=$('supervisor-automatic').onchange=$('supervisor-daily-cap').oninput=()=>{supervisorConfigDirty=true;};
    loadSupervisor(true);
  }
  async function loadAll(withBenchmark=true){clearError();try{const [status,skills,qs]=await Promise.all([api('/status'),api('/skills'),api('/models/qualifications')]);snapshot=status;skillsSnapshot=skills;qualifications=qs.items||[];renderSummary();renderShadow();renderSkills();renderLearning();renderQualifications();await Promise.all([loadWebResearch(),loadTraining()]);if(withBenchmark)await loadBenchmark();}catch(e){showError(e);}}
  $('refresh').onclick=()=>loadAll();$('test-form').onsubmit=runTest;$('benchmark-start').onclick=startBenchmark;$('web-research-form').onsubmit=startWebResearch;$('training-form').onsubmit=saveTraining;$('training-export-all').onclick=()=>exportTraining('all');$('training-export-train').onclick=()=>exportTraining('train');$('training-export-validation').onclick=()=>exportTraining('validation');$('area').onchange=updateTestArea;
  $('refresh').onclick=()=>{loadAll();if($('supervisor-panel'))loadSupervisor(true);};
  $('model-preflight').onclick=verifyLocalModel;
  updateTestArea();loadAll();setInterval(()=>loadAll(false),30000);
})();
