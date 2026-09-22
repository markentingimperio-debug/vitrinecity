const EXPLICIT=/https:\/\/[^\s<>"']+/i;
const BARE_DOMAIN=/\b((?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,})+)(?:\/[^\s<>"']*)?/i;
const SITES=Object.freeze({
  youtube:'https://www.youtube.com',google:'https://www.google.com',bing:'https://www.bing.com',
  tiktok:'https://www.tiktok.com',kwai:'https://www.kwai.com',instagram:'https://www.instagram.com',
  facebook:'https://www.facebook.com',gmail:'https://mail.google.com',hostinger:'https://hpanel.hostinger.com'
});
const SITE_ALIASES=Object.freeze({youtube:['youtube','youtub','yutub','iu tube'],tiktok:['tiktok','tik tok'],kwai:['kwai','kuai'],instagram:['instagram','insta'],facebook:['facebook','face'],google:['google'],bing:['bing'],gmail:['gmail'],hostinger:['hostinger']});
const INTENTS=Object.freeze({
  navigate:['abra','abrir','acessa','acesse','acessar','entre','entrar','navegue','navegar','visite','visitar','va','ir','pagina','site','clique','clicar','preencha','captura','screenshot','print','leia','ler','verifique','ver','veja','confira'],
  search:['busca','busque','buscar','pesquisa','pesquise','pesquisar','procura','procure','procurar','encontre','encontrar','acha','ache','achar'],
  playback:['toca','toque','tocar','coloca','coloque','colocar','bota','bote','botar','ponha','poe','reproduza','reproduzir','ouca','ouvir']
});
const STOP=new Set(['a','ao','agora','as','de','do','e','em','la','no','na','o','os','para','pra','pelo','pela','por','primeiro','reproduzivel','um','uma','video']);
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const words=value=>normalize(value).match(/[a-z0-9]+/g)||[];

function editDistance(a,b){
  if(a===b)return 0;
  const row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    let previous=row[0];row[0]=i;
    for(let j=1;j<=b.length;j++){
      const saved=row[j],cost=a[i-1]===b[j-1]?0:1;
      row[j]=Math.min(row[j]+1,row[j-1]+1,previous+cost);
      previous=saved;
    }
  }
  return row[b.length];
}
function closeWord(token,expected){
  if(token===expected)return true;
  if(Math.min(token.length,expected.length)<4)return false;
  return editDistance(token,expected)<=(Math.max(token.length,expected.length)>=8?2:1);
}
function phrasePresent(text,phrase){
  const n=normalize(text);
  if(phrase.includes(' '))return n.includes(phrase);
  if(phrase.length<6){
    const tokens=words(n),index=tokens.indexOf(phrase);
    if(index<0)return false;
    const previous=tokens[index-1]||'';
    return ['a','ao','da','do','na','no','o'].includes(previous)||INTENTS.navigate.some(expected=>!['pagina','site'].includes(expected)&&closeWord(previous,expected));
  }
  return words(n).some(token=>closeWord(token,phrase));
}
function hasIntent(value,kind){return words(value).some(token=>!(kind==='playback'&&/(?:cao|mento)$/.test(token))&&INTENTS[kind].some(expected=>closeWord(token,expected)));}
export function isPlaybackRequest(value){return hasIntent(value,'playback');}
export function isSearchRequest(value){return hasIntent(value,'search');}

function requestedSite(value){
  for(const [site,aliases] of Object.entries(SITE_ALIASES))if(aliases.some(alias=>phrasePresent(value,alias)))return site;
  return'';
}
function youtubeQuery(text){
  const line=normalize(text).split(/\r?\n/).find(value=>requestedSite(value)==='youtube')||normalize(text);
  const tokens=words(line),siteIndex=tokens.findIndex(token=>SITE_ALIASES.youtube.some(alias=>!alias.includes(' ')&&closeWord(token,alias)));
  const actionIndex=tokens.findIndex(token=>[...INTENTS.search,...INTENTS.playback].some(expected=>closeWord(token,expected)));
  if(actionIndex<0)return'';
  const clean=list=>list.filter(token=>!STOP.has(token)&&!SITE_ALIASES.youtube.some(alias=>!alias.includes(' ')&&closeWord(token,alias))&&
    !Object.values(INTENTS).flat().some(expected=>closeWord(token,expected)));
  let query=clean(tokens.slice(actionIndex+1));
  if(!query.length&&siteIndex>=0&&actionIndex>siteIndex)query=clean(tokens.slice(siteIndex+1,actionIndex));
  return query.join(' ').slice(0,120);
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
  const site=requestedSite(text);
  if(!site)return'';
  if(site==='youtube'){
    const query=youtubeQuery(text);
    if(query)return SITES.youtube+'/results?search_query='+encodeURIComponent(query);
  }
  return SITES[site];
}

export function isRequestedBrowserInstruction(value){
  return Boolean(resolveRequestedBrowserUrl(value))&&(hasIntent(value,'navigate')||hasIntent(value,'search')||hasIntent(value,'playback'));
}

export function contextualBrowserInstruction(instruction,previousInstructions=[]){
  const current=String(instruction||'').trim(),n=normalize(current);
  const continuation=isPlaybackRequest(current)||/\b(?:a|essa|esta)\s+musica\b|\b(?:o|esse|este|primeiro|proximo)\s+video\b|\b(?:continue|continuar|mesmo site|nisso|nele)\b/.test(n);
  if(resolveRequestedBrowserUrl(current)||!continuation)return current;
  const prior=previousInstructions.map(value=>String(value||'').trim()).find(value=>isRequestedBrowserInstruction(value));
  if(prior&&new URL(resolveRequestedBrowserUrl(prior)).hostname==='www.youtube.com'&&isPlaybackRequest(current)){
    const nextQuery=youtubeQuery(current);
    if(nextQuery&&nextQuery.split(' ').some(token=>!['musica','audio','som','faixa','video','outra','nova'].includes(token)))
      return `Abra o YouTube e coloque ${nextQuery} para tocar`;
  }
  return prior?`${prior}\nContinue a tarefa no mesmo site: ${current}`.slice(0,6000):current;
}
