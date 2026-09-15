export const GAMES_APP_PAGES=Object.freeze({
  '/games/':'vitriny-games.html',
  '/games/blocos':'vitriny-blocks.html',
  '/games/jardim':'vitriny-merge.html',
  '/games/fazenda':'vitriny-mini-fazenda.html',
  '/games/plantas':'games/plants.html'
});
const LINKS=Object.freeze({'/vitriny-games.html':'/games/','/vitriny-blocks.html':'/games/blocos','/vitriny-merge.html':'/games/jardim','/vitriny-mini-fazenda.html':'/games/fazenda'});
const CHROME_SCRIPTS=/\/(?:vitriny-city-chat|site-assistant|site-assistant-bridge|global-market-banner|pwa-install|analytics|openai-ads|openai-product-events)\.js(?:\?|$)/i;
function stripScripts(html){return html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,(tag,attributes,body)=>{
  const source=attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
  return source?CHROME_SCRIPTS.test(source)?'':tag:/\bexplorerReturnHref\b/.test(body)?'':tag;
});}
export function decorateGamesAppPage(html,{path=''}={}){
  if(!Object.hasOwn(GAMES_APP_PAGES,path)||typeof html!=='string'||!/<head\b/i.test(html)||!/<\/body\s*>/i.test(html))return html;
  let ownManifest=false;
  let page=stripScripts(html)
    .replace(/<aside\b[^>]*\bdata-city-chat\b[^>]*>[\s\S]*?<\/aside\s*>/gi,'')
    .replace(/<p\b[^>]*\bclass=["'][^"']*\bfarm-rewards\b[^"']*["'][^>]*>[\s\S]*?<\/p\s*>/gi,'')
    .replace(/<link\b[^>]*>/gi,tag=>{
      if(/\brel\s*=\s*["']manifest["']/i.test(tag)){if(ownManifest||!/\bhref\s*=\s*["']\/games\/manifest\.webmanifest["']/i.test(tag))return '';ownManifest=true;}
      return /\/(?:vitriny-city-chat|site-assistant|site-assistant-embedded)\.css(?:\?|["'])/i.test(tag)?'':tag;
    })
    .replace(/<a\b([^>]*?)\bhref\s*=\s*(["'])([^"']*)\2([^>]*)>/gi,(tag,before,quote,href,after)=>{
      const pathname=href.split(/[?#]/)[0];let next=LINKS[pathname];if(/\bid\s*=\s*["']backCity["']/i.test(before+after)||pathname==='/vitriny-multiverse-explore.html')next='/games/';
      return next?`<a${before}href=${quote}${next}${quote}${after}>`:tag;
    });
  page=page.replace(/VitrineCity Games/g,'VitrineCity Cultiva').replace(/VITRINECITY GAMES/g,'VITRINECITY CULTIVA').replace(/\/ GAMES<\/span>/g,'/ CULTIVA</span>').replace(/<b>GAMES<\/b>/g,'<b>CULTIVA</b>');
  page=page.replace(/<a\b([^>]*\bid\s*=\s*["']backCity["'][^>]*)>[\s\S]*?<\/a>/i,'<a$1>← Início</a>').replace(/(<a\b[^>]*href="\/games\/"[^>]*>)← Todos os jogos<\/a>/g,'$1← Início</a>');
  if(path==='/games/'&&!/data-cultiva-intro/.test(page)){
    page=page.replace(/<section class="hub-intro">[\s\S]*?<\/section>/,'<section class="hub-intro" data-cultiva-intro><div><p class="eyebrow">PLANTAS, CUIDADO & DIVERSÃO</p><h1>Cultive no<br><em>seu ritmo.</em></h1></div><p>Acompanhe suas plantas, encontre orientações e faça uma pausa para jogar.</p></section><section class="cultiva-tools" aria-label="Cuidar das suas plantas"><a class="cultiva-tool" href="/games/plantas"><span class="eyebrow">SEU CANTINHO VERDE</span><h2>Minhas plantas</h2><p>Guarde nomes, anotações e os próximos cuidados neste aparelho.</p><span class="play-link">Abrir minhas plantas <span aria-hidden="true">→</span></span></a><a class="cultiva-tool cultiva-guides" href="/games/cuidados"><span class="eyebrow">APRENDA A OBSERVAR</span><h2>Guias de cuidados</h2><p>Encontre orientações para cuidar das suas plantas, com conexão à internet.</p><span class="play-link">Explorar os guias <span aria-hidden="true">→</span></span></a></section>');
    page=page.replace(/<title>[\s\S]*?<\/title>/,'<title>VitrineCity Cultiva · Plantas, cuidado e diversão</title>');
  }
  if(!/\bdata-games-app(?:\s|=|>)/i.test(page))page=page.replace(/<body\b/i,'<body data-games-app="true"');
  if(!/data-games-app-links/.test(page))page=page.replace(/<\/body\s*>/i,'<nav class="games-app-links" data-games-app-links aria-label="VitrineCity Cultiva"><a href="/games/">Início</a><a href="/games/plantas">Minhas plantas</a><a href="/games/cuidados">Guias</a><a href="/games/privacidade">Privacidade</a><a href="/games/ajuda">Ajuda</a></nav></body>');
  const assets=[['link','/games/app.css?v=1'],['link','/games/install.css?v=1'],['script','/games/app.js?v=1'],['script','/games/install.js?v=1']];
  const icon=/\brel\s*=\s*["']apple-touch-icon["']/i.test(page)?'':'<link rel="apple-touch-icon" href="/assets/pwa-icon-192.png">';
  page=page.replace(/<\/head\s*>/i,`${ownManifest?'':'<link rel="manifest" href="/games/manifest.webmanifest">'}${icon}</head>`);
  for(const [kind,url] of assets){const pathname=url.split('?')[0];if(page.includes(`"${pathname}`)||page.includes(`'${pathname}`))continue;const element=kind==='link'?`<link rel="stylesheet" href="${url}">`:`<script type="module" src="${url}"></script>`;page=page.replace(kind==='link'?/<\/head\s*>/i:/<\/body\s*>/i,element+(kind==='link'?'</head>':'</body>'));}
  return page;
}
