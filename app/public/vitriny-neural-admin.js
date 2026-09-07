(()=>{
  'use strict';
  const $=id=>document.getElementById(id),base='/api/admin/vitriny-neural';
  let snapshot=null,skillsSnapshot=null,qualifications=[],benchmarkTimer=null,runningTest=false;
  const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!=null)el.textContent=text;if(cls)el.className=cls;return el;};
  const pct=v=>`${Math.round((Number(v)||0)*100)}%`;
  const date=v=>v?new Date(v).toLocaleString('pt-BR'):'—';
  function announce(text){$('announcement').textContent=text;}
  function showError(error){$('error').textContent=error?.message||'Não foi possível consultar a Vitriny Neural.';$('error').hidden=false;}
  function clearError(){$('error').hidden=true;}
  async function api(path,method='GET',body,timeout=15000){
    const response=await fetch(base+path,{method,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(timeout),headers:method==='GET'?{}:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    if(response.status===401){location.assign('/admin-login.html');throw Error('Sessão expirada.');}
    let data={};try{data=await response.json();}catch{}
    if(!response.ok)throw Error(data.error||`Falha HTTP ${response.status}.`);return data;
  }
  function modeLabel(value){return({disabled:'DESLIGADA',shadow:'SHADOW',advisory:'ADVISORY',low_risk_auto:'LOW-RISK AUTO'})[value]||String(value||'—').toUpperCase();}
  function scoreClass(v){return Number(v)>=.9?'ok':Number(v)>=.75?'warn':'danger';}
  function renderSummary(){
    const s=snapshot||{},svc=s.service||{},ready=s.readiness||{},providerRows=s.skills?.providers||skillsSnapshot?.providers||[],primary=providerRows.find(p=>p.id===svc.primaryProviderId)||providerRows[0];
    $('mode').textContent=modeLabel(svc.mode);$('mode').className=svc.mode==='shadow'?'ok':svc.mode==='low_risk_auto'?'warn':'';
    $('mode-detail').textContent=svc.enabled?'Neural habilitada na VPS':'Neural desabilitada';
    $('provider').textContent=primary?.id||'SEM PROVIDER';
    $('provider-detail').textContent=primary?`${primary.local?'local':'remoto'} · circuito ${primary.stats?.circuit||'—'}`:'Configure um modelo para testar skills';
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
  function inputFor(area,prompt){switch(area){
    case'code':return['code.engineer',{action:'analyze',task:prompt,repository:'vitrinecity',constraints:['sem deploy automático','mudança reversível'],dryRun:true,requireTests:true}];
    case'growth':return['growth.optimizer',{action:'diagnose',objective:prompt,businessContext:'VitrineCity · marketplace e rede social local',channel:'multi',metrics:{}}];
    case'research':return['research.supervised',{action:'verify',question:prompt,sourcePolicy:'authoritative-first',maxSources:8,freshnessDays:30}];
    case'commerce':return['commerce.advisor',{action:'seller-diagnose',objective:prompt,catalog:[],metrics:{},constraints:['não inventar valores ausentes']}];
    case'ranking':return['ranking.optimizer',{action:'evaluate',objective:prompt,features:{},metrics:{},sampleSize:0,maxWeightChange:.02,offlineOnly:true}];
    case'media':return['media.generate',{type:'image',prompt,aspectRatio:'1:1',count:1,quality:'standard'}];
    default:return['support.assistant',{action:'draft-reply',message:prompt,businessContext:'VitrineCity',tone:'cordial',channel:'admin-test',confirmedFacts:{}}];
  }}
  function outputText(data){const r=data?.result||{},o=r.output??r.asset??r;if(typeof o==='string')return o;if(typeof o?.text==='string')return o.text;if(typeof o?.output?.text==='string')return o.output.text;try{return JSON.stringify(o,null,2);}catch{return String(o);}}
  async function runTest(event){event.preventDefault();if(runningTest)return;clearError();const prompt=$('prompt').value.trim(),area=$('area').value;if(prompt.length<3)return;const [skill,input]=inputFor(area,prompt),started=performance.now();runningTest=true;$('run-test').disabled=true;$('test-response').setAttribute('aria-busy','true');$('test-provider').textContent='PROCESSANDO';$('test-output').textContent='Consultando a Vitriny Neural…';try{const data=await api('/skills/'+encodeURIComponent(skill)+'/run','POST',input,360000);$('test-provider').textContent=data.result?.provider||'CONCLUÍDO';$('test-time').textContent=`${((performance.now()-started)/1000).toFixed(1)} s`;$('test-output').textContent=outputText(data)||'Resposta vazia.';announce('Teste da Vitriny Neural concluído.');await loadAll(false);}catch(e){$('test-provider').textContent='FALHOU';$('test-time').textContent=`${((performance.now()-started)/1000).toFixed(1)} s`;$('test-output').textContent=e.message;showError(e);}finally{runningTest=false;$('run-test').disabled=false;$('test-response').setAttribute('aria-busy','false');}}
  async function startBenchmark(){clearError();$('benchmark-start').disabled=true;try{const data=await api('/benchmark/start','POST',{},15000);$('benchmark-state').textContent='RUNNING';$('benchmark-score').textContent='…';$('benchmark-grade').textContent='Benchmark iniciado';$('benchmark-meta').textContent=`Execução ${data.item.id}. O painel acompanhará sem bloquear esta página.`;announce('Benchmark real iniciado.');scheduleBenchmark();}catch(e){showError(e);$('benchmark-start').disabled=false;}}
  async function loadAll(withBenchmark=true){clearError();try{const [status,skills,qs]=await Promise.all([api('/status'),api('/skills'),api('/models/qualifications')]);snapshot=status;skillsSnapshot=skills;qualifications=qs.items||[];renderSummary();renderShadow();renderSkills();renderLearning();renderQualifications();if(withBenchmark)await loadBenchmark();}catch(e){showError(e);}}
  $('refresh').onclick=()=>loadAll();$('test-form').onsubmit=runTest;$('benchmark-start').onclick=startBenchmark;$('area').onchange=()=>{$('test-hint').textContent=$('area').value==='media'?'Este teste exige um provider de imagem; o Qwen de texto pode não suportar esta capacidade.':'A resposta é apenas para avaliação administrativa.';};
  loadAll();setInterval(()=>loadAll(false),30000);
})();
