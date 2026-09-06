// No proxy, external scraping or arbitrary iframe URLs. Read only our public pages.
const readablePaths = new Set([
  '/guias/plantas-em-vasos.html', '/artigos/escolher-parafusadeira.html',
  '/artigos/organizar-petiscos.html', '/artigos/tiktok-ads.html'
]);
export function classifyResult(value, origin) {
  try {
    const raw = String(value || '');
    if (!raw || raw.length > 2048 || /[\\\x00-\x20]/.test(raw)) return null;
    const url = new URL(raw, origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const own = url.origin === origin || url.origin === 'https://vitrinecity.com';
    if (own && !url.search && (readablePaths.has(url.pathname) || /^\/ofertas\/[a-z0-9][a-z0-9-]{0,139}$/.test(url.pathname))) {
      return {kind:'local', url:new URL(url.pathname + url.hash, origin).href, label:'VitrineCity'};
    }
    const host = url.hostname;
    if (url.protocol === 'https:' && !url.port && ['www.tiktok.com','tiktok.com'].includes(host)) {
      const match = url.pathname.match(/^\/@[a-zA-Z0-9._]{1,40}\/video\/(\d{15,22})\/?$/);
      if (match) return {kind:'tiktok',url:url.href,label:'TikTok'};
    }
    let label = host, mediaLink;
    if (['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(host)) {
      label = 'YouTube / Shorts';
      const id = host === 'youtu.be' ? url.pathname.replace(/^\/|\/$/g,'') : url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})\/?$/)?.[1];
      if(url.protocol==='https:' && !url.port && /^[A-Za-z0-9_-]{11}$/.test(id || '')) return {kind:'youtube',url:url.href,label,id};
    }
    if (['instagram.com','www.instagram.com'].includes(host)) label = 'Instagram';
    if (['kwai.com','www.kwai.com','k.kwai.com'].includes(host)) label = 'Kwai';
    if (['tiktok.com','www.tiktok.com','vm.tiktok.com','vt.tiktok.com'].includes(host)) label = 'TikTok';
    if(url.protocol==='https:' && !url.port) {
      if(label==='Instagram' && /^\/(?:reel|reels)\/[A-Za-z0-9_-]{1,128}\/?$/.test(url.pathname))mediaLink='video';
      if(label==='Kwai' && /^\/short-video\/[A-Za-z0-9_-]{1,128}\/?$/.test(url.pathname))mediaLink='video';
      if(['vm.tiktok.com','vt.tiktok.com','k.kwai.com'].includes(host) && /^\/(?:p\/)?[A-Za-z0-9_-]{1,128}\/?$/.test(url.pathname))mediaLink='share';
      if(['tiktok.com','www.tiktok.com'].includes(host) && /^\/t\/[A-Za-z0-9_-]{1,128}\/?$/.test(url.pathname))mediaLink='share';
    }
    return {kind:'external',url:url.href,label,...(mediaLink?{mediaLink}:{})};
  } catch { return null; }
}

// Media and unverified share links get one outbound action; this is not eligibility.
export function isVideoResult(item, origin) {
  const info=classifyResult(item?.url,origin);
  return !!info && (['youtube','tiktok'].includes(info.kind) || info.mediaLink==='video' || info.mediaLink==='share' || (info.kind==='external' && item?.type==='video'));
}

export async function readPublicPage(href, {origin, signal, fetcher = fetch}) {
  const result = classifyResult(href, origin);
  if (result?.kind !== 'local') throw Error('not_readable');
  const response = await fetcher(result.url, {signal, redirect:'error', credentials:'omit', headers:{Accept:'text/html'}});
  if (!response.ok || !/text\/html/i.test(response.headers.get('content-type') || '') || Number(response.headers.get('content-length')) > 500000) throw Error('unavailable');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let html = '', size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 500000) throw Error('too_large');
      html += decoder.decode(value, {stream:true});
    }
    return html + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

// Parse inside an inert template: no images/scripts/iframes are loaded or copied.
// Build a fresh, small text-only reading tree; never attach the parsed subtree.
export function readingFragment(document, html, sourceUrl) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const main = template.content.querySelector('main');
  if (!main) throw Error('no_reading_content');
  // Related cards can use <article>; keep the selected page's whole main content.
  const root = main;
  const allowed = new Set(['P','H1','H2','H3','H4','UL','OL','LI','STRONG','EM','B','I','BLOCKQUOTE','BR','SMALL','A','DL','DT','DD','TABLE','THEAD','TBODY','TR','TH','TD']);
  const drop = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','IFRAME','OBJECT','EMBED','SVG','MATH','FORM','BUTTON','INPUT','SELECT','TEXTAREA','NAV','HEADER','FOOTER']);
  let nodes = 0, chars = 0;
  function copy(input, depth = 0) {
    if (++nodes > 2500 || chars >= 50000 || depth > 40) return document.createTextNode('');
    if (input.nodeType === 3) { const text = input.textContent.slice(0,50000-chars); chars += text.length; return document.createTextNode(text); }
    if (input.nodeType !== 1 || drop.has(input.tagName) || input.hasAttribute('hidden') || input.getAttribute('aria-hidden') === 'true') return document.createTextNode('');
    const tag = input.tagName;
    const output = document.createElement(allowed.has(tag) ? (tag === 'H1' ? 'h2' : tag.toLowerCase()) : 'div');
    if (tag === 'A') {
      try {
        const destination = classifyResult(new URL(input.getAttribute('href') || '', sourceUrl).href, new URL(sourceUrl).origin);
        if (destination) { output.href=destination.url; output.target='_blank'; output.rel='noopener noreferrer'; if ((input.getAttribute('rel') || '').split(/\s+/).includes('sponsored')) output.rel+=' sponsored'; }
      } catch { /* A malformed link must not prevent reading the rest of the page. */ }
    }
    for (const child of input.childNodes) { if(nodes>=2500 || chars>=50000)break; output.append(copy(child,depth+1)); }
    return output;
  }
  const fragment = document.createDocumentFragment();
  for (const child of root.childNodes) { if(nodes>=2500 || chars>=50000)break; fragment.append(copy(child)); }
  if (fragment.textContent.trim().length < 60) throw Error('no_reading_content');
  if (nodes >= 2500 || chars >= 50000) { const note=document.createElement('p'); note.textContent='Leitura abreviada. Consulte o conteúdo completo na página original.'; fragment.append(note); }
  return fragment;
}

export function createSearchReader({document, origin, getRecommendations}) {
  const el = (tag, text, cls) => { const n=document.createElement(tag); if(text!==undefined)n.textContent=text; if(cls)n.className=cls; return n; };
  function attachVideo(container,item) {
    if(!isVideoResult(item,origin))return false;
    const info=classifyResult(item.url,origin);
    const provider=info.kind==='youtube'?'YouTube':['TikTok','Instagram','Kwai'].includes(info.label)?info.label:null;
    const verb=info.mediaLink==='share' && item.type!=='video'?'Abrir':'Assistir';
    const action=el('a',verb+' '+(provider?'no '+provider:'na fonte')+' · nova aba ↗','reader-action');
    action.href=info.url;action.target='_blank';action.rel='noopener noreferrer'+(item.affiliate?' sponsored':'');
    action.setAttribute('aria-label',action.textContent+': '+String(item.title || info.label).slice(0,300)+'. A VitrineCity continua aberta.');
    container.append(action);return true;
  }
  const dialog = el('dialog',undefined,'search-reader');
  if (typeof dialog.showModal !== 'function') return {attach:attachVideo,close(){}};
  dialog.setAttribute('aria-labelledby','reader-title');
  const top=el('div',undefined,'reader-top'), close=el('button','← Voltar à busca','reader-back'); close.type='button';
  const brand=el('div',undefined,'reader-brand'),logo=el('img');logo.src='/assets/vitrinecity-logo.png';logo.alt='VitrineCity';logo.width=70;logo.height=70;
  brand.append(logo,el('span','Explorar'));top.append(brand,close);
  const heading=el('h2'); heading.id='reader-title';
  const source=el('p',undefined,'reader-source'), original=el('a','Abrir original em outra aba ↗','reader-original');
  original.target='_blank'; original.rel='noopener noreferrer';
  const summary=el('div',undefined,'reader-heading'); summary.append(source,heading,original);
  const body=el('div',undefined,'reader-body'), content=el('section',undefined,'reader-content'), recommendations=el('aside',undefined,'reader-recommendations');
  content.setAttribute('aria-label','Visualização do resultado'); recommendations.setAttribute('aria-label','Continue na Vitrine');
  const progress=el('p',undefined,'reader-note'); progress.role='status'; summary.append(progress);
  body.append(content,recommendations); dialog.append(top,summary,body); document.body.append(dialog);
  let active=0, pending, returnFocus;
  function cleanup() { active++; pending?.abort(); content.replaceChildren(); document.body.classList.remove('reader-open'); if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true}); }
  dialog.addEventListener('close',cleanup); close.onclick=()=>dialog.close();
  function link(label, href, affiliate=false) {
    const info=classifyResult(href,origin); if(!info)return el('span',label);
    const a=el('a',label);a.href=info.url; a.target='_blank';a.rel='noopener noreferrer'+(affiliate?' sponsored':'');return a;
  }
  function renderRecommendations(current) {
    recommendations.replaceChildren(el('h3','Continue na Vitrine'),el('p','Sugestões desta busca, sem personalização.','reader-note'));
    const seen=new Set([current.url]); let count=0;
    for(const item of getRecommendations()) {
      const info=classifyResult(item.url,origin);
      if(!info || seen.has(info.url) || ++count>4)continue; seen.add(info.url);
      const row=el('div',undefined,'reader-recommendation');
      row.append(link(item.title,item.url,item.affiliate),el('small',item.official?'Loja oficial · Prioridade da plataforma':item.affiliate?'Oferta de afiliado · Podemos receber comissão':'Conteúdo ou negócio da Vitrine'));
      if(info.kind==='local')attach(row,item);
      recommendations.append(row);
    }
    if(!count)recommendations.append(el('p','Ainda não há outro resultado local para este assunto.','reader-note'));
    const paths=el('div',undefined,'reader-explore');
    paths.append(link('Visitar nossa loja oficial · Agrotécnica','/loja/official_agrotecnica/agrotecnica'),link('Conhecer a Vitriny Social','/social'),link('Explorar lojas e pessoas','/descobrir'),link('Ver seleção de produtos afiliados','/ofertas'));
    recommendations.append(paths);
    const channel=el('section',undefined,'reader-channel');
    channel.append(el('h3','Da nossa equipe'),link('Agrotécnica no YouTube ↗','https://www.youtube.com/@agrotecnica362'),link('@agrotecniica no Instagram ↗','https://www.instagram.com/agrotecniica/'),link('@agrotecnica5 no TikTok ↗','https://www.tiktok.com/@agrotecnica5'),el('p','Canais indicados pela equipe VitrineCity. Abrem na plataforma original, em outra aba.','reader-note'));
    recommendations.append(channel);
    const partner=el('section',undefined,'reader-channel');partner.append(el('h3','Nosso ecossistema'),link('Adubo NPK para Plantas ↗','https://adubonpkparaplantas.com.br/'),link('Nossa loja na Shopee ↗','https://shopee.com.br/agrotecnicavendas#product_list',true),el('p','Links da nossa equipe, em outra aba. Na Shopee, confira preços, estoque e condições antes de comprar.','reader-note'));recommendations.append(partner);
  }
  async function open(item, trigger) {
    const info=classifyResult(item.url,origin); if(!info)return;
    pending?.abort(); pending=new AbortController(); const request=pending, own=++active;
    if(!dialog.open)returnFocus=trigger;
    source.textContent=info.label+' · '+(info.kind==='local'?'Conteúdo próprio':'Fonte externa');
    heading.textContent=String(item.title || info.label).slice(0,300); original.href=info.url;
    original.rel='noopener noreferrer'+(item.affiliate?' sponsored':'');
    renderRecommendations(info); content.replaceChildren(); progress.textContent='';
    document.body.classList.add('reader-open'); if(!dialog.open)dialog.showModal(); dialog.scrollTop=0; close.focus({preventScroll:true});
    if(info.kind==='local') {
      progress.textContent='Preparando leitura…';
      const timeout=setTimeout(()=>request.abort(),10000);
      try {
        const html=await readPublicPage(info.url,{origin,signal:request.signal});
        if(own!==active || !dialog.open)return;
        const reading=el('div',undefined,'reader-article');reading.append(readingFragment(document,html,info.url));
        content.replaceChildren(el('p','Modo leitura, sem imagens e recursos interativos. Use a página original para comprar, preencher formulários ou compartilhar.','reader-note'),reading);
        progress.textContent='Leitura carregada.';
      }catch { if(own===active && dialog.open)progress.textContent='Não foi possível preparar esta leitura. O link da página original continua disponível.'; }
      finally {clearTimeout(timeout);}
    } else {
      content.append(el('h3','Prévia do resultado'),el('p',String(item.description || 'Consulte o conteúdo na fonte original.').slice(0,1000)),el('p','Este é um trecho fornecido pela busca, não a página completa. A reprodução ou leitura interna desta fonte não está habilitada. Abra o original sem fechar sua pesquisa.','reader-note'));
    }
  }
  function attach(container,item) {
    if(attachVideo(container,item))return;
    const info=classifyResult(item.url,origin);if(!info)return;
    const button=el('button',info.kind==='local'?'Ler na Vitrine':'Prévia e relacionados','reader-action');button.type='button';
    button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-label',button.textContent+': '+String(item.title || info.label).slice(0,300));
    button.onclick=()=>open(item,button);container.append(button);
  }
  return {attach,close(){if(dialog.open)dialog.close();}};
}
