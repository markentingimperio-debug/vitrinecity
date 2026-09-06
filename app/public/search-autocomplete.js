const officialCategory = 'Loja oficial · Prioridade da plataforma';

export function mergeSuggestions(groups) {
  const seen = new Set();
  const rows = groups.flatMap(group => Array.isArray(group) ? group : []).filter(item => item && typeof item.label === 'string' && item.label.trim())
    .map(item => ({label:item.label.trim().slice(0,300),type:item.type,category:typeof item.category === 'string' ? item.category.slice(0,160) : ''}));
  const official = rows.filter(item => item.category === officialCategory);
  const web = rows.filter(item => item.type === 'web' && item.category !== officialCategory);
  const local = rows.filter(item => item.type !== 'web' && item.category !== officialCategory);
  // Show the official store first, while keeping general search phrases near the top.
  return [...official.slice(0,1),...web.slice(0,4),...official.slice(1),...local,...web.slice(4)]
    .filter(item => {const key=item.label.toLocaleLowerCase('pt-BR');if(seen.has(key))return false;seen.add(key);return true;}).slice(0,10);
}

export async function loadSuggestions({value,city='',signal,fetcher=fetch,onUpdate}) {
  const groups = [[],[]], params = new URLSearchParams({q:value.slice(0,120),city:city.slice(0,100)});
  await Promise.all(['/api/search/autocomplete?','/api/discovery/search/suggestions?'].map(async (path,index) => {
    try {
      const response = await fetcher(path+params,{signal});
      const data = response.ok ? await response.json() : {};
      if(signal.aborted)return;
      groups[index] = Array.isArray(data?.suggestions) ? data.suggestions.slice(0,20) : [];
      onUpdate(mergeSuggestions(groups));
    } catch { /* Each source is independent; failure must not hide the other source. */ }
  }));
}

export function setupSearchAutocomplete({query,suggestions,city=()=>'',onSelect}) {
  const document = query.ownerDocument, view = document.defaultView;
  let generation=0,timer,deadline,controller,options=[],active=-1;
  query.classList.add('vc-autocomplete-input');
  suggestions.classList.add('vc-autocomplete');
  function close() {
    generation++;clearTimeout(timer);clearTimeout(deadline);controller?.abort();
    options=[];active=-1;suggestions.hidden=true;suggestions.replaceChildren();
    query.setAttribute('aria-expanded','false');query.removeAttribute('aria-activedescendant');
  }
  function position(keepFieldVisible=false) {
    if(suggestions.hidden)return;
    const viewport=view.visualViewport,top=viewport?.offsetTop || 0,height=viewport?.height || view.innerHeight;
    let rect=query.form.getBoundingClientRect();
    if(keepFieldVisible && height>180 && (rect.top<top+8 || rect.bottom>top+height-8 || Math.max(top+height-rect.bottom,rect.top-top)<96)) {
      query.scrollIntoView({block:'center',inline:'nearest'});rect=query.form.getBoundingClientRect();
    }
    const below=top+height-rect.bottom-12,above=rect.top-top-12;
    const useAbove=below<160 && above>below;
    suggestions.dataset.placement=useAbove?'above':'below';
    suggestions.style.setProperty('--suggestions-max-height',Math.max(0,Math.min(320,useAbove?above:below))+'px');
  }
  function select(item) {
    query.value=item.label;close();
    if(onSelect)onSelect(item.label);else query.form.requestSubmit();
  }
  function markActive() {
    [...suggestions.children].forEach((el,index)=>el.setAttribute('aria-selected',String(index===active)));
    const chosen=suggestions.children[active];
    if(!chosen){query.removeAttribute('aria-activedescendant');return;}
    query.setAttribute('aria-activedescendant',chosen.id);
    if(chosen.offsetTop<suggestions.scrollTop)suggestions.scrollTop=chosen.offsetTop;
    else if(chosen.offsetTop+chosen.offsetHeight>suggestions.scrollTop+suggestions.clientHeight)suggestions.scrollTop=chosen.offsetTop+chosen.offsetHeight-suggestions.clientHeight;
  }
  function schedule() {
    close();const value=query.value.trim(),own=generation;
    if(value.length<2 || document.activeElement!==query)return;
    timer=setTimeout(async()=>{
      const current=new AbortController();controller=current;
      deadline=setTimeout(()=>current.abort(),5000);
      try {
        await loadSuggestions({value,city:city(),signal:current.signal,onUpdate:items=>{
          if(current.signal.aborted || own!==generation || document.activeElement!==query || query.value.trim()!==value)return;
          const selected=options[active]?.label;options=items;active=selected?options.findIndex(item=>item.label===selected):-1;
          suggestions.replaceChildren(...options.map((item,index)=>{
            const row=document.createElement('li'),label=document.createElement('span'),detail=document.createElement('small');
            row.id=suggestions.id+'-'+index;row.role='option';label.className='vc-autocomplete-label';label.textContent=item.label;
            detail.textContent=[item.type==='web'?'Sugestão de pesquisa':item.type==='store'?'Loja da Vitrine':item.type==='content'?'Conteúdo da Vitrine':'Produto da Vitrine',item.category].filter(Boolean).join(' · ');
            row.append(label,detail);row.addEventListener('pointerdown',event=>event.preventDefault());row.addEventListener('click',()=>select(item));return row;
          }));
          suggestions.hidden=!options.length;query.setAttribute('aria-expanded',String(Boolean(options.length)));position(true);markActive();
        }});
      } finally {if(own===generation)clearTimeout(deadline);}
    },220);
  }
  query.addEventListener('input',event=>{if(!event.isComposing)schedule();});
  query.addEventListener('compositionstart',close);query.addEventListener('compositionend',schedule);
  query.addEventListener('focus',schedule);query.addEventListener('blur',close);
  query.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    if(event.key==='Escape'){close();return;}
    if(suggestions.hidden)return;
    if(['ArrowDown','ArrowUp'].includes(event.key)){
      event.preventDefault();active=active<0?(event.key==='ArrowDown'?0:options.length-1):(active+(event.key==='ArrowDown'?1:options.length-1))%options.length;markActive();
    }else if(event.key==='Enter'&&active>=0){event.preventDefault();select(options[active]);}
  });
  query.form.addEventListener('submit',close);
  const resize=()=>position(true),scroll=()=>position();
  view.addEventListener('resize',resize);view.addEventListener('scroll',scroll,{passive:true});
  view.visualViewport?.addEventListener('resize',resize);view.visualViewport?.addEventListener('scroll',scroll,{passive:true});
  return {close};
}
