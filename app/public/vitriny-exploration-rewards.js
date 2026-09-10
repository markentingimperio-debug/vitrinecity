const BASE='/api/rewards/exploration',KEY='vitrinecity:store-visit:';
async function api(suffix='',body){
  const response=await fetch(BASE+suffix,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(data.error||'Não foi possível conferir suas conquistas agora.'),{status:response.status,code:data.code});return data;
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

export function mountExplorationProgress(container,{compact=false,checkIn=true}={}){
  if(!container)return;style();const box=document.createElement('section');box.className=compact?'exploration-progress compact':'exploration-progress';
  const heading=document.createElement('strong'),copy=document.createElement('p'),progress=document.createElement('progress'),detail=document.createElement('p'),link=document.createElement('a');
  heading.textContent='Suas conquistas na cidade';copy.setAttribute('role','status');copy.textContent='Conferindo suas moedas…';progress.max=100;progress.value=0;progress.setAttribute('aria-label','Progresso para a próxima fase');
  link.href='/central-creditos.html';link.textContent='Usar moedas e ver benefícios';box.append(heading,copy,progress,detail,link);container.append(box);
  const show=data=>{heading.textContent=`Fase ${data.level} · ${data.name}`;copy.textContent=`${data.balance} ${data.balance===1?'moeda':'moedas'} · ${data.visitedToday.length} ${data.visitedToday.length===1?'loja descoberta':'lojas descobertas'} hoje`;progress.value=data.progress;detail.textContent=`${data.streak} ${data.streak===1?'dia seguido':'dias seguidos'} · ${data.nextLevelXp-data.xp} XP para a próxima fase`;};
  api(checkIn?'/check-in':'',checkIn?{}:undefined).then(show).catch(error=>{progress.hidden=true;detail.textContent='Visitas completas: +1 moeda e +10 XP. Entrada diária: +5 XP.';copy.textContent=error.status===401?'Entre na sua conta para participar.':error.message;if(error.status===401){link.replaceWith(loginLink());}});
  addEventListener('vitrinecity:reward-earned',event=>show(event.detail));return box;
}

const rewardContext=document.querySelector('[data-reward-store]');
if(rewardContext)mountStoreReward({storeReference:rewardContext.dataset.rewardStore,productId:Number(rewardContext.dataset.rewardProduct)||null});
if(document.getElementById('cityTools'))mountExplorationProgress(document.getElementById('cityTools'),{compact:true});
if(document.getElementById('explorationProgress'))mountExplorationProgress(document.getElementById('explorationProgress'));
