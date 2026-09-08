const categories={total:'Todas as matérias',noticias:'Notícias',receitas:'Receitas',esportes:'Esportes',entretenimento:'Entretenimento'};
export function articlePath(value){return typeof value==='string'&&/^\/artigo\/[a-z0-9][a-z0-9-]{0,199}$/.test(value)?value:'';}
export function articleImage(value){return typeof value==='string'&&!value.split('/').includes('..')&&/^\/(?:assets|uploads\/(?:generated-videos|store-assets)|story-assets)\/[a-z0-9_./-]+\.(?:jpe?g|png|webp)$/i.test(value)?value:'';}
export function stationFilters(search=''){
  const params=new URLSearchParams(search),category=params.get('categoria'),page=Number(params.get('page'));
  return {category:Object.hasOwn(categories,category)?category:'total',query:(params.get('q')||'').trim().slice(0,120),page:Number.isSafeInteger(page)&&page>0&&page<=10000?page:1};
}
export function createStationLoader({fetchImpl=globalThis.fetch,onState,timeoutMs=10000}){
  let current=0,controller=null,closed=false;
  async function load(filters){
    if(closed)return;const own=++current;controller?.abort();const request=new AbortController();controller=request;
    const params=new URLSearchParams({categoria:filters.category,q:filters.query,page:String(filters.page)});
    onState({phase:'loading',filters});let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;request.abort();},timeoutMs);
    try{
      const response=await fetchImpl('/api/emissora/conteudos?'+params,{signal:request.signal,headers:{accept:'application/json'}});
      if(!response.ok)throw Error('unavailable');const data=await response.json();
      if(closed||own!==current)return;
      if(!Array.isArray(data.items)||!Number.isSafeInteger(data.total)||data.total<0||!Number.isSafeInteger(data.pages)||data.pages<1||!Number.isSafeInteger(data.page)||data.page!==filters.page)throw Error('invalid');
      const items=data.items.filter(item=>item&&typeof item.title==='string'&&item.title.trim()&&articlePath(item.url)&&Object.hasOwn(categories,item.category)&&item.category!=='total').map(item=>({...item,imageUrl:articleImage(item.imageUrl)}));
      if(data.items.length&&!items.length)throw Error('invalid');
      onState({phase:'ready',filters,data:{...data,items}});
    }catch(error){if(!closed&&own===current)onState({phase:'error',filters,timeout:timedOut});}
    finally{clearTimeout(timer);if(own===current)controller=null;}
  }
  return {load,close(){closed=true;current++;controller?.abort();controller=null;}};
}
export function mountStation(document,window){
  const $=id=>document.getElementById(id);if(!$('station-articles'))return null;
  const make=(tag,text,className)=>{const element=document.createElement(tag);if(text)element.textContent=text;if(className)element.className=className;return element;};
  let filters=stationFilters(window.location.search),lastData=null,focusResults=false;
  const dateFormat=new Intl.DateTimeFormat('pt-BR',{day:'numeric',month:'short',year:'numeric',timeZone:'America/Sao_Paulo'});
  function card(item,index){
    const article=make('article',null,'station-article'),link=make('a',null,'article-link');link.href=articlePath(item.url);
    const art=make('div',null,'article-art');art.dataset.category=item.category;
    const fallback=make('div',null,'graphic-art');fallback.setAttribute('aria-hidden','true');fallback.append(make('span','VITRINECITY · '+categories[item.category].toUpperCase()));art.append(fallback);
    if(item.imageUrl){const image=make('img');image.src=articleImage(item.imageUrl);image.alt='';image.width=960;image.height=540;image.loading=index?'lazy':'eager';image.decoding='async';if(!index)image.setAttribute('fetchpriority','high');image.addEventListener('load',()=>{fallback.hidden=true;});image.addEventListener('error',()=>{image.remove();fallback.hidden=false;},{once:true});art.append(image);}
    const meta=make('p',null,'article-meta');meta.append(make('strong',categories[item.category]));
    const time=Date.parse(item.publishedAt);if(Number.isFinite(time)){const date=make('time',dateFormat.format(time));date.dateTime=new Date(time).toISOString();meta.append(date);}
    const title=make('h3',item.title,'article-title');title.id='article-title-'+index;link.setAttribute('aria-labelledby',title.id);
    link.append(art,meta,title);if(typeof item.summary==='string'&&item.summary)link.append(make('p',item.summary,'article-summary'));
    link.append(make('span',item.category==='receitas'?'Ver receita →':'Ler matéria →','article-read'));article.append(link);return article;
  }
  function show(state){
    const loading=state.phase==='loading',ready=state.phase==='ready';filters=state.filters;
    for(const button of document.querySelectorAll('[data-category]'))if(button.tagName==='BUTTON')button.setAttribute('aria-pressed',String(button.dataset.category===filters.category));
    $('station-query').value=filters.query;$('results-heading').textContent=categories[filters.category];$('station-articles').setAttribute('aria-busy',String(loading));
    $('feed-message').hidden=true;$('retry-feed').hidden=true;$('clear-filters').hidden=true;$('feed-pagination').hidden=true;
    if(loading){$('feed-status').textContent='Carregando matérias…';$('station-articles').replaceChildren(...[0,1,2].map(()=>{const block=make('div',null,'skeleton');block.setAttribute('aria-hidden','true');return block;}));return;}
    $('station-articles').replaceChildren();
    if(!ready){$('feed-status').textContent='Não foi possível carregar.';$('feed-message').hidden=false;$('message-title').textContent='Vamos tentar de novo?';$('message-text').textContent=state.timeout?'O carregamento demorou mais que o esperado. Confira sua conexão e tente novamente.':'As matérias estão indisponíveis no momento. Você pode tentar novamente ou explorar os outros canais acima.';$('retry-feed').hidden=false;return;}
    lastData=state.data;const {items,total,page,pages}=state.data;
    $('feed-status').textContent=total===1?'1 matéria encontrada':total+' matérias encontradas';
    if(!items.length){$('feed-message').hidden=false;$('message-title').textContent=filters.query?'Nenhuma matéria nesta busca.':page>pages?'Esta página não tem matérias.':'Em breve, mais histórias por aqui.';$('message-text').textContent=filters.query?'Experimente outro termo ou escolha um assunto diferente.':'Explore os outros assuntos e os conteúdos já disponíveis na VitrineCity.';$('clear-filters').hidden=filters.category==='total'&&!filters.query&&page===1;}
    else $('station-articles').replaceChildren(...items.map(card));
    $('feed-pagination').hidden=pages<2;$('page-label').textContent='Página '+page+' de '+pages;$('previous-page').disabled=page<=1;$('next-page').disabled=page>=pages;
    if(focusResults){focusResults=false;$('results-heading').focus({preventScroll:true});$('results-heading').scrollIntoView({block:'start',behavior:'auto'});}
  }
  const loader=createStationLoader({fetchImpl:window.fetch.bind(window),onState:show});
  function go(next,{push=true,focus=false}={}){filters=next;focusResults=focus;if(push){const params=new URLSearchParams();if(next.category!=='total')params.set('categoria',next.category);if(next.query)params.set('q',next.query);if(next.page>1)params.set('page',String(next.page));window.history.pushState(null,'','/emissora'+(params.size?'?'+params:''));}void loader.load(filters);}
  for(const button of document.querySelectorAll('button[data-category]'))button.addEventListener('click',()=>go({...filters,category:button.dataset.category,page:1}));
  $('station-search').addEventListener('submit',event=>{event.preventDefault();go({...filters,query:$('station-query').value.trim().slice(0,120),page:1});});
  $('retry-feed').addEventListener('click',()=>void loader.load(filters));$('clear-filters').addEventListener('click',()=>go({category:'total',query:'',page:1}));
  $('previous-page').addEventListener('click',()=>{if(filters.page>1)go({...filters,page:filters.page-1},{focus:true});});$('next-page').addEventListener('click',()=>{if(lastData&&filters.page<lastData.pages)go({...filters,page:filters.page+1},{focus:true});});
  window.addEventListener('popstate',()=>go(stationFilters(window.location.search),{push:false}));window.addEventListener('pagehide',event=>{if(!event.persisted)loader.close();});
  void loader.load(filters);return loader;
}
if(typeof document!=='undefined'&&typeof window!=='undefined')mountStation(document,window);
