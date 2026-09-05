(() => {
  const $ = id => document.getElementById(id);
  const query = $('q'), suggestions = $('suggestions'), local = $('local-results');
  let version = 0, controller, suggestController, timer, activeOption = -1, options = [], filter = 'all';
  let searched = '', webVersion = 0, webController, webNext = null, webPending = false;
  const webUrls = new Set();
  const node = (tag, text, className) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  };
  const safeUrl = (value, internal = false) => {
    try {
      const url = new URL(String(value || ''), location.origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (internal && url.origin !== location.origin)) return '';
      return url.href;
    } catch { return ''; }
  };
  const link = (label, value, internal = false) => {
    const href = safeUrl(value, internal);
    if (!href) return node('span', label);
    const a = node('a', label); a.href = href;
    if (!internal) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    return a;
  };
  const closeSuggestions = () => {
    suggestions.hidden = true; suggestions.replaceChildren(); activeOption = -1;
    query.setAttribute('aria-expanded', 'false'); query.removeAttribute('aria-activedescendant');
  };
  function applyFilter() {
    document.querySelectorAll('[data-section]').forEach(section => {
      const matches = filter === 'all' || (section.dataset.section === 'web' ? filter !== 'local' : filter === 'local');
      section.hidden = !searched || !matches || section.id === 'ads-section' && !section.childElementCount;
    });
  }
  function renderWebSearch(value) {
    const panel = node('div', undefined, 'panel');
    panel.append(node('h2', 'Pesquise também na internet'),
      node('p', 'Escolha onde pesquisar “' + value + '”.', 'muted'));
    const providers = [
      ['Google · sites', 'https://www.google.com/search?' + new URLSearchParams({q:value,hl:'pt-BR'})],
      ['Yahoo · sites', 'https://search.yahoo.com/search?' + new URLSearchParams({p:value})],
      ['YouTube · vídeos', 'https://www.youtube.com/results?' + new URLSearchParams({search_query:value})]
    ];
    const links = node('div',undefined,'source-links');
    for(const [label,url] of providers){const a=link(label+' ↗',url);a.className='pill';links.append(a);}
    panel.append(links,node('p', 'Os resultados abrem no serviço escolhido, em outra aba.', 'status'));
    $('web-results').replaceChildren(panel);
  }
  function relatedQueries(values) {
    const box=$('related');box.replaceChildren();
    const suggestions=[...new Set(values || [])].slice(0,8);
    box.hidden=!suggestions.length;
    if(!suggestions.length)return;
    box.append(node('h2','Pesquisas relacionadas'));
    for(const value of suggestions){const button=node('button',value);button.type='button';button.onclick=()=>search(value);box.append(button);}
  }
  async function loadWeb(value, page=1) {
    if(page>1 && webPending)return;
    webController?.abort();webController=new AbortController();const own=++webVersion;
    webPending=true;webNext=null;
    const box=$('web-results');
    if(page===1){webUrls.clear();relatedQueries([]);box.replaceChildren(node('p','Pesquisando sites e vídeos…','panel status'));}
    else box.querySelector('[data-more-web]')?.remove();
    try {
      const response=await fetch('/api/search/web?'+new URLSearchParams({q:value,type:filter==='local'?'all':filter,page:String(page)}),{signal:webController.signal});
      if(!response.ok)throw new Error('unavailable');
      const data=await response.json();if(own!==webVersion)return;
      if(page===1)box.replaceChildren(node('h2',filter==='videos'?'Vídeos relacionados':'Sites e conteúdos relacionados','section-title'));
      if(data.unavailable?.length)box.append(node('p','Algumas fontes não responderam. Exibindo os resultados disponíveis.','status'));
      let added=0;
      for(const result of data.results || []){
        if(webUrls.has(result.url))continue;
        const url=safeUrl(result.url);if(!url)continue;
        webUrls.add(result.url);added++;
        const article=node('article',undefined,'site'),heading=node('h3');heading.append(link(result.title,url));
        article.append(node('small',(result.type==='video'?'Vídeo · ':'')+new URL(url).hostname),heading,node('p',result.description));
        article.append(node('small','Encontrado por: '+(result.providers||[]).join(', ')));box.append(article);
      }
      if(!webUrls.size)box.append(node('p','Nenhum resultado disponível agora. Tente outra palavra ou pesquise diretamente em uma das fontes.','panel status'));
      if(data.suggestions?.length)relatedQueries(data.suggestions);
      webNext=added?data.nextPage:null;
      if(webNext){const more=node('button','Mais resultados','primary');more.type='button';more.dataset.moreWeb='1';more.onclick=()=>loadWeb(value,webNext);box.append(more);}
      if(page===1){const fallback=node('details');fallback.append(node('summary','Pesquisar diretamente em outra fonte'));
        for(const [name,url] of [['Google','https://www.google.com/search?'+new URLSearchParams({q:value})],['Yahoo','https://search.yahoo.com/search?'+new URLSearchParams({p:value})],['YouTube','https://www.youtube.com/results?'+new URLSearchParams({search_query:value})]]){const a=link(name+' ↗',url);a.className='pill';fallback.append(a);}box.append(fallback);}
      $('search-status').textContent='Resultados para “'+value+'”.';
    }catch(error){
      if(error.name==='AbortError'||own!==webVersion)return;
      if(page===1){renderWebSearch(value);box.prepend(node('p','Não foi possível consultar os buscadores neste momento. A busca da Vitrine continua disponível.','panel status'));$('search-status').textContent='Busca concluída com fontes externas indisponíveis.';}
      else {const retry=node('button','Tentar carregar mais resultados','primary');retry.type='button';retry.dataset.moreWeb='1';retry.onclick=()=>loadWeb(value,page);box.append(retry);}
    }finally{if(own===webVersion)webPending=false;}
  }
  function renderLocal(data) {
    local.replaceChildren();
    for (const [key, title] of [['stores', 'Lojas'], ['products', 'Produtos']]) {
      const rows = Array.isArray(data[key]) ? data[key] : [];
      if (!rows.length) continue;
      const grid = node('div', undefined, 'local-grid');
      for (const item of rows) {
        const card = node('article', undefined, 'local-card');
        const heading = node('h3'); heading.append(link(item.name, key === 'stores' ? item.url : item.productUrl, true));
        card.append(heading, node('small', [item.storeName, item.city, item.category || item.segment].filter(Boolean).join(' · ')));
        if (key === 'products' && Number.isFinite(item.priceCents)) card.append(node('p', (item.priceCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})));
        else if (item.description) card.append(node('p', item.description.slice(0,200)));
        if (item.verifiedReviews) card.append(node('small', Number(item.verifiedRating).toFixed(1) + ' / 5 · ' + item.verifiedReviews + ' avaliações de compras verificadas'));
        card.append(node('small', item.rankReason || 'Resultado da Vitrine'));
        grid.append(card);
      }
      local.append(node('h3', title), grid);
    }
    if (!local.childElementCount) local.append(node('p','Nenhuma loja ou produto encontrado para esta busca na Vitrine. Você pode pesquisar na internet ou tentar outro termo.','panel muted'));
  }
  async function search(value) {
    value = String(value).trim().slice(0,300);
    if (value.length < 2) { query.focus(); return; }
    searched = value; query.value = value;
    const run = ++version;
    controller?.abort(); controller = new AbortController();
    suggestController?.abort(); clearTimeout(timer); closeSuggestions();
    const params = new URLSearchParams({q:value});
    if ($('city').value.trim()) params.set('city',$('city').value.trim());
    history.replaceState(null,'','?'+params);
    document.title = value + ' | Vitrine City';
    $('search-status').textContent = 'Buscando na Vitrine…';
    $('examples').hidden = true; $('ads-section').replaceChildren();
    local.replaceChildren(node('p','Buscando lojas e produtos…','status')); applyFilter();
    if(filter!=='local')loadWeb(value);else {webController?.abort();webVersion++;webPending=false;relatedQueries([]);}
    loadAds(value,run,controller.signal);
    try {
      const response = await fetch('/api/discovery/search?'+params,{signal:controller.signal});
      if (!response.ok) throw new Error('search_failed');
      const data = await response.json(); if (run !== version) return;
      renderLocal(data);
      const count = (data.stores?.length || 0) + (data.products?.length || 0);
      if(filter==='local')$('search-status').textContent = count + ' resultados na Vitrine para “' + value + '”.';
    } catch (error) {
      if (error.name === 'AbortError' || run !== version) return;
      local.replaceChildren(node('p','Não foi possível consultar a Vitrine agora. Tente novamente.','panel status'));
      $('search-status').textContent = 'Busca interna temporariamente indisponível.';
    }
  }
  async function loadAds(value,run,signal) {
    try {
      const response=await fetch('/api/ads/serve?'+new URLSearchParams({q:value}),{signal});
      if(!response.ok)return;
      const data=await response.json();if(run!==version)return;
      const rows=Array.isArray(data.ads)?data.ads:[];if(!rows.length)return;
      const grid=node('div',undefined,'local-grid');
      for(const item of rows){
        const card=node('article',undefined,'local-card sponsored');
        const title=node('h3');const a=link(item.title,item.clickUrl,true);
        if(a.tagName==='A')a.rel='nofollow sponsored';title.append(a);
        card.append(node('span','PATROCINADO','tag'),title,node('p',item.text));grid.append(card);
      }
      $('ads-section').replaceChildren(node('h2','Ofertas patrocinadas','section-title'),grid);applyFilter();
    }catch{ /* Ads are independent of organic search availability. */ }
  }
  query.addEventListener('input', () => {
    clearTimeout(timer); suggestController?.abort(); closeSuggestions();
    const value = query.value.trim(); if (value.length < 2) return;
    timer = setTimeout(async () => {
      const current = new AbortController(); suggestController = current;
      try {
        const params=new URLSearchParams({q:value,city:$('city').value.trim()});
        const responses=await Promise.allSettled(['/api/search/autocomplete?','/api/discovery/search/suggestions?'].map(async path=>{
          const response=await fetch(path+params,{signal:current.signal});return response.ok?response.json():{suggestions:[]};
        }));
        if (current.signal.aborted || query.value.trim() !== value) return;
        const seen=new Set();options=responses.flatMap(result=>result.status==='fulfilled'?result.value.suggestions||[]:[])
          .filter(item=>{const key=item.label?.toLocaleLowerCase();if(!key||seen.has(key))return false;seen.add(key);return true;}).slice(0,10);
        suggestions.replaceChildren(...options.map((item,index) => {
          const el = node('li',item.label); el.id='suggestion-'+index;el.role='option';el.setAttribute('aria-selected','false');
          el.append(node('small',[item.type==='web'?'Sugestão de pesquisa':item.type==='store'?'Loja da Vitrine':'Produto da Vitrine',item.category].filter(Boolean).join(' · ')));
          el.addEventListener('pointerdown',e=>e.preventDefault());el.addEventListener('click',()=>search(item.label));return el;
        }));
        suggestions.hidden = !options.length;query.setAttribute('aria-expanded',String(Boolean(options.length)));
      } catch { /* Suggestions never prevent submitting a search. */ }
    },220);
  });
  query.addEventListener('keydown',event=>{
    if(event.key==='Escape'){closeSuggestions();return;}
    if(suggestions.hidden)return;
    if(['ArrowDown','ArrowUp'].includes(event.key)){
      event.preventDefault();activeOption=(activeOption+(event.key==='ArrowDown'?1:options.length-1)+options.length)%options.length;
      [...suggestions.children].forEach((el,i)=>el.setAttribute('aria-selected',String(i===activeOption)));
      query.setAttribute('aria-activedescendant','suggestion-'+activeOption);
    }else if(event.key==='Enter'&&activeOption>=0){event.preventDefault();search(options[activeOption].label);}
  });
  query.addEventListener('blur',closeSuggestions);
  $('search-form').addEventListener('submit',event=>{event.preventDefault();search(query.value);});
  $('city').addEventListener('change',()=>{if(searched)search(searched);});
  document.querySelectorAll('[data-query]').forEach(button=>button.addEventListener('click',()=>search(button.dataset.query)));
  document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{
    filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));applyFilter();
    if(searched){if(filter==='local'){webController?.abort();webVersion++;webPending=false;relatedQueries([]);$('search-status').textContent='Resultados na Vitrine para “'+searched+'”.';}else loadWeb(searched);}
  }));
  const initial=new URLSearchParams(location.search);$('city').value=String(initial.get('city')||'').slice(0,100);
  if(initial.get('q'))search(initial.get('q'));
})();
