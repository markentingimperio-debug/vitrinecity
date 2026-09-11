const BASE='/api/rewards/exploration',KEY='vitrinecity:store-visit:';
const UNAVAILABLE='Não foi possível carregar suas conquistas agora. Tente novamente em instantes.';
async function api(suffix='',body){
  let response;try{response=await fetch(BASE+suffix,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});}catch{throw new Error(UNAVAILABLE);}
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw Object.assign(new Error(typeof data?.error==='string'?data.error:UNAVAILABLE),{status:response.status,code:data?.code});
  if(!data||typeof data!=='object'||Array.isArray(data)||!Object.keys(data).length)throw new Error(UNAVAILABLE);
  return data;
}
function loginLink(){const a=document.createElement('a');a.href='/entrar-cidade.html?returnTo='+encodeURIComponent(location.pathname+location.search);a.textContent='Entrar na conta';return a;}
function style(){if(document.querySelector('link[data-exploration-style]'))return;const link=document.createElement('link');link.rel='stylesheet';link.href='/vitriny-exploration-rewards.css';link.dataset.explorationStyle='true';document.head.append(link);}
function publish(data){dispatchEvent(new CustomEvent('vitrinecity:reward-earned',{detail:data}));}

export function mountStoreReward({storeReference,productId=null,container=null}={}){
  if(!storeReference)return;style();
  const banner=document.createElement('aside');banner.className='exploration-reward';banner.setAttribute('aria-label','Recompensa da visita');
  const icon=document.createElement('span');icon.className='exploration-coin';icon.textContent='V';icon.setAttribute('aria-hidden','true');
  const content=document.createElement('div'),title=document.createElement('strong'),message=document.createElement('p'),actions=document.createElement('div');actions.className='exploration-actions';
  title.textContent='Uma descoberta. Uma moeda.';message.setAttribute('role','status');content.append(title,message,actions);banner.append(icon,content);
  (container||document.querySelector('main')||document.body).prepend(banner);
  const key=KEY+storeReference;let timer=null,stopped=false,observer=null;
  const done=data=>{title.textContent=data.awarded?'+1 Vitrine Coin conquistada':'Você já ganhou a moeda desta loja hoje';message.textContent='Volte amanhã para conquistar outra. Limite de uma moeda por loja por dia, no horário de Brasília.';actions.replaceChildren();const link=document.createElement('a');link.href='/central-creditos.html';link.textContent='Ver minhas moedas e fase';actions.append(link);if(data.awarded)publish(data);};
  async function start(){
    if(!productId){
      const result=await api('/start',{storeReference});if(stopped)return;
      if(!result.eligible){title.textContent='Conheça esta loja';message.textContent=result.message;return;}
      try{sessionStorage.setItem(key,JSON.stringify({token:result.token,day:result.day}));}catch{}
      if(result.alreadyClaimed){done(result);return;}
      message.textContent='Abra um produto e conheça seus detalhes por 10 segundos para liberar 1 moeda. Uma vez por loja, a cada dia.';return;
    }
    let visit;try{visit=JSON.parse(sessionStorage.getItem(key)||'null');}catch{}
    if(!visit?.token){
      title.textContent='Comece sua descoberta pela loja';message.textContent='Entre na loja e depois abra um produto para conquistar 1 moeda.';
      const link=document.createElement('a');link.href='/loja/'+encodeURIComponent(storeReference);link.textContent='Visitar a loja';actions.append(link);return;
    }
    const result=await api('/view',{token:visit.token,productId});if(stopped)return;if(result.alreadyClaimed){done(result);return;}
    const progress=document.createElement('progress');progress.max=result.viewSeconds*1000;progress.value=0;progress.setAttribute('aria-label','Tempo conhecendo o produto');content.append(progress);
    let visibleMs=0,last=performance.now(),pending=false,inView=false;
    const product=document.querySelector('[data-reward-product-content]')||document.querySelector('main');
    if(product&&'IntersectionObserver' in window){observer=new IntersectionObserver(entries=>{inView=entries[0].isIntersecting&&entries[0].intersectionRatio>=.15;},{threshold:[0,.15]});observer.observe(product);}else inView=true;
    timer=setInterval(async()=>{
      const time=performance.now(),elapsed=Math.min(500,time-last);last=time;if(pending||document.visibilityState!=='visible')return;
      if(!inView){const text='Veja os detalhes do produto abaixo para continuar sua descoberta.';if(message.textContent!==text)message.textContent=text;return;}
      visibleMs+=elapsed;progress.value=Math.min(progress.max,visibleMs);const text=`Conhecendo o produto · ${Math.max(0,Math.ceil((progress.max-visibleMs)/1000))} s para liberar sua moeda.`;if(message.textContent!==text)message.textContent=text;
      if(visibleMs<progress.max)return;pending=true;
      try{const reward=await api('/complete',{token:visit.token,productId});if(stopped)return;clearInterval(timer);observer?.disconnect();progress.remove();done(reward);}
      catch(error){if(error.code==='view_incomplete'){visibleMs=Math.max(0,visibleMs-1000);pending=false;return;}clearInterval(timer);progress.remove();message.textContent=error.message;}
    },250);
  }
  start().catch(error=>{if(stopped)return;message.textContent=error.status===401?'Entre na sua conta para guardar as moedas das suas visitas.':error.message;if(error.status===401)actions.append(loginLink());});
  addEventListener('pagehide',()=>{stopped=true;clearInterval(timer);observer?.disconnect();},{once:true});
  return banner;
}

export function mountExplorationProgress(container,{compact=false,checkIn=true,onSummary=()=>{},refreshOn=null}={}){
  if(!container)return;style();const box=document.createElement('section');box.className=compact?'exploration-progress compact':'exploration-progress';
  const heading=document.createElement('strong'),copy=document.createElement('p'),progress=document.createElement('progress'),detail=document.createElement('p'),link=document.createElement('a');
  heading.textContent='Suas conquistas na cidade';copy.setAttribute('role','status');copy.textContent='Conferindo suas moedas…';progress.max=100;progress.value=0;progress.hidden=true;progress.style.display='none';progress.setAttribute('aria-label','Progresso para a próxima fase');
  link.href='/central-creditos.html';link.textContent='Usar moedas e ver benefícios';box.append(heading,copy,progress,detail,link);container.append(box);
  const goal=document.createElement('div'),goalTitle=document.createElement('strong'),goalProgress=document.createElement('progress'),goalCopy=document.createElement('p'),goalRules=document.createElement('p');
  goal.className='exploration-daily-goal';goal.hidden=true;goalProgress.setAttribute('aria-label','Lojas visitadas na meta diária');goalCopy.setAttribute('role','status');goalRules.className='exploration-goal-rules';goal.append(goalTitle,goalProgress,goalCopy,goalRules);box.append(goal);
  const dailyStores=document.createElement('div');dailyStores.className='exploration-daily-stores';goal.append(dailyStores);
  let hasSummary=false,dayTimer=null,active=true;
  const show=data=>{
    // Validate the complete snapshot before changing any visible element. Events
    // and successful HTTP responses can both arrive without a usable summary.
    const summary=progressSummary(data);if(!summary)return false;
    clearTimeout(dayTimer);dayTimer=null;
    const reset=Date.parse(data.dailyRewards?.resetsAt),wait=reset-data.serverNow;
    if(Number.isSafeInteger(data.serverNow)&&wait>0&&wait<=86401000)dayTimer=setTimeout(()=>{
      hasSummary=false;goal.hidden=true;progress.hidden=true;progress.style.display='none';detail.textContent='';copy.textContent='Começou um novo dia. Atualizando suas conquistas…';onSummary(null);
      if(active&&document.visibilityState!=='hidden')refresh();
    },wait+100);
    heading.textContent=`Fase ${summary.level} · ${summary.name}`;copy.textContent=`${summary.balance} ${summary.balance===1?'moeda':'moedas'} · ${summary.visits} ${summary.visits===1?'loja descoberta':'lojas descobertas'} hoje`;
    progress.value=summary.progress;progress.hidden=false;progress.style.display='';detail.textContent=`${summary.streak} ${summary.streak===1?'dia seguido':'dias seguidos'} · ${summary.remainingXp} XP para a próxima fase`;
    const daily=summary.dailyGoal;goal.hidden=!daily;
    if(daily){
      const paused=summary.enabled===false,limited=summary.dailyRewards?.remaining===0;
      goalTitle.textContent=daily.achieved?'Meta de hoje concluída':daily.available?'Sua meta de hoje':'Novas descobertas em breve';
      goalProgress.hidden=!daily.available;goalProgress.max=Math.max(1,daily.target);goalProgress.value=daily.completed;
      goalCopy.textContent=paused?'As recompensas estão pausadas. Suas moedas já conquistadas continuam no saldo.':!daily.available?'Ainda não há lojas com produtos disponíveis para esta meta.':daily.achieved?`${daily.completed} de ${daily.target} lojas. Parabéns pelas descobertas!`:limited?'Você atingiu o limite de moedas de hoje entre visitas e fazenda. Volte amanhã para continuar.':`${daily.completed} de ${daily.target} lojas · ${daily.remaining===1?'falta 1 loja':`faltam ${daily.remaining} lojas`}`;
      goalRules.textContent='Entre na loja e veja um produto por 10 segundos. Ganhe 1 moeda por loja diferente, por dia, dentro do limite diário. A meta não acrescenta moedas extras. Novo dia à meia-noite de Brasília.';
      dailyStores.textContent='';for(const store of summary.dailyStores){const a=document.createElement('a');a.href='/loja/'+encodeURIComponent(store.reference);a.textContent=(store.completed?'✓ ':'Visitar ')+store.name+(store.completed?' · concluída hoje':' →');dailyStores.append(a);}
    }
    onSummary(summary);
    link.href='/central-creditos.html';link.textContent='Usar moedas e ver benefícios';hasSummary=true;return true;
  };
  const unavailable=error=>{
    if(hasSummary&&error?.status!==401)return;
    hasSummary=false;goal.hidden=true;dailyStores.textContent='';clearTimeout(dayTimer);dayTimer=null;onSummary(null);
    heading.textContent='Suas conquistas na cidade';progress.hidden=true;progress.style.display='none';detail.textContent='Visitas completas: +1 moeda e +10 XP. Entrada diária: +5 XP.';
    copy.textContent=error?.status===401?'Entre na sua conta para participar.':UNAVAILABLE;
    if(error?.status===401){const login=loginLink();link.href=login.href;link.textContent=login.textContent;}
  };
  let revision=0,lastRefresh=0;
  const refresh=()=>{if(!active)return;lastRefresh=Date.now();const current=++revision;api(checkIn?'/check-in':'',checkIn?{}:undefined).then(data=>{if(current===revision&&!show(data))unavailable();}).catch(error=>{if(current===revision)unavailable(error);});};
  refresh();
  addEventListener('vitrinecity:reward-earned',event=>{if(show(event.detail))revision++;});
  refreshOn?.addEventListener('click',refresh);
  addEventListener('pagehide',()=>{active=false;revision++;clearTimeout(dayTimer);});
  addEventListener('pageshow',event=>{active=true;if(event.persisted)refresh();});
  document.addEventListener?.('visibilitychange',()=>{if(document.visibilityState==='visible'&&Date.now()-lastRefresh>10000)refresh();});
  return box;
}

function progressSummary(data){
  try{
    if(!data||typeof data!=='object'||Array.isArray(data))return null;
    const {level,name,balance,visitedToday,progress,streak,xp,nextLevelXp}=data;
    if(![level,balance,progress,streak,xp,nextLevelXp].every(Number.isSafeInteger)||level<1||balance<0||streak<0||xp<0||progress<0||progress>=100||nextLevelXp<=xp)return null;
    if(typeof name!=='string'||!name.trim()||name.length>100||!Array.isArray(visitedToday)||!visitedToday.every(reference=>typeof reference==='string'&&reference.length>0&&reference.length<=120))return null;
    if(new Set(visitedToday).size!==visitedToday.length)return null;
    let dailyGoal=null,dailyRewards=null;
    const g=data.dailyGoal,r=data.dailyRewards;
    if(g&&[g.target,g.completed,g.remaining].every(Number.isSafeInteger)&&g.target>=0&&g.target<=3&&g.completed===Math.min(g.target,visitedToday.length)&&g.remaining===g.target-g.completed&&g.available===(g.target>0)&&g.achieved===(g.target>0&&g.completed===g.target)&&g.rewardCoinsPerStore===1&&g.bonusCoins===0)dailyGoal=g;
    if(r&&[r.limit,r.earned,r.remaining].every(Number.isSafeInteger)&&r.limit>=0&&r.earned>=0&&r.remaining===Math.max(0,r.limit-r.earned))dailyRewards=r;
    const dailyStores=Array.isArray(data.dailyStores)?data.dailyStores.filter(s=>s&&typeof s.name==='string'&&s.name.trim()&&s.name.length<=200&&typeof s.reference==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(s.reference)&&s.completed===visitedToday.includes(s.reference)).slice(0,6):[];
    return {level,name:name.trim(),balance,visits:visitedToday.length,progress,streak,remainingXp:nextLevelXp-xp,dailyGoal,dailyRewards,dailyStores,enabled:data.enabled};
  }catch{return null;}
}

const rewardContext=document.querySelector('[data-reward-store]');
if(rewardContext)mountStoreReward({storeReference:rewardContext.dataset.rewardStore,productId:Number(rewardContext.dataset.rewardProduct)||null});
const goalButton=document.getElementById('openExplorationGoal'),goalDialog=document.getElementById('explorationGoalDialog');
if(goalButton&&goalDialog){
  mountExplorationProgress(goalDialog.querySelector('[data-goal-content]'),{refreshOn:goalButton,onSummary:summary=>{
    if(!summary){goalButton.textContent='Moedas e meta diária';return;}
    const daily=summary.dailyGoal;goalButton.textContent=summary.enabled===false?`${summary.balance} moedas · conquistas`:daily?.available?`${daily.achieved?'✓ ':''}Meta ${daily.completed}/${daily.target} · ${summary.balance} moedas`:`${summary.balance} moedas · minhas conquistas`;
  }});
  goalButton.addEventListener('click',()=>goalDialog.showModal());
  goalDialog.querySelector('[data-close]').addEventListener('click',()=>goalDialog.close());
  goalDialog.querySelector('[data-find-stores]').addEventListener('click',()=>{goalDialog.close();document.getElementById('openCityGuide')?.click();});
}else if(document.getElementById('cityTools'))mountExplorationProgress(document.getElementById('cityTools'),{compact:true});
if(document.getElementById('explorationProgress'))mountExplorationProgress(document.getElementById('explorationProgress'));
