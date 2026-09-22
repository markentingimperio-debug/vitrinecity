const EXPLICIT=/https:\/\/[^\s<>"']+/i;
const BARE_DOMAIN=/\b((?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,})+)(?:\/[^\s<>"']*)?/i;
const SITES=Object.freeze({
  youtube:'https://www.youtube.com',google:'https://www.google.com',bing:'https://www.bing.com',
  tiktok:'https://www.tiktok.com',kwai:'https://www.kwai.com',instagram:'https://www.instagram.com',
  facebook:'https://www.facebook.com',gmail:'https://mail.google.com',hostinger:'https://hpanel.hostinger.com'
});
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

function youtubeQuery(text){
  const n=normalize(text);
  const match=n.match(/\b(?:coloque|colocar|toque|tocar|busque|buscar|pesquise|pesquisar|procure|procurar)\b\s+(.+)/);
  if(!match)return'';
  return match[1].replace(/\b(?:no|na|pelo|pela|youtube|para|pra|tocar|reproduzir|agora|uma|um)\b/g,' ')
    .replace(/\s+/g,' ').trim().slice(0,120);
}

/** Resolve only a public destination. The browser worker still validates DNS,
 * protocol, permissions and redirects before opening it.
 */
export function resolveRequestedBrowserUrl(value){
  const text=String(value||'');
  const explicit=text.match(EXPLICIT)?.[0];
  if(explicit)return explicit;
  const domain=text.match(BARE_DOMAIN)?.[0];
  if(domain)return'https://'+domain.replace(/[),.;!?]+$/,'');
  const n=normalize(text);
  const site=Object.keys(SITES).find(name=>new RegExp(`\\b${name}\\b`).test(n));
  if(!site)return'';
  if(site==='youtube'){
    const query=youtubeQuery(text);
    if(query)return SITES.youtube+'/results?search_query='+encodeURIComponent(query);
  }
  return SITES[site];
}

export function isRequestedBrowserInstruction(value){
  const n=normalize(value);
  return Boolean(resolveRequestedBrowserUrl(value))&&/\b(?:abra|abrir|acesse|acessar|entre|entrar|navegue|navegar|visite|va|ir|toque|tocar|coloque|colocar|pagina|site|clique|clicar|preencha|captura|screenshot|print|leia|verifique|veja)\b/.test(n);
}
