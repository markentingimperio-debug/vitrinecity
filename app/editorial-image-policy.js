// Display policy, not semantic verification: a permitted image still needs
// editorial review for relevance. Never substitute a city/brand cover for news.
const institutionalImages=new Set([
  '/assets/vitriny-city-master.jpg',
  '/assets/vitriny-city-base.jpg',
  '/assets/vitriny-city-norte.jpg',
  '/assets/vitriny-city-leste.jpg',
  '/assets/vitrinecity-realista.jpg',
  '/assets/vitrinecity-avenida-premium.webp',
  '/assets/vitrinecity-logo.png',
  '/assets/pwa-icon-192.png',
  '/assets/pwa-icon-512.png',
  '/logo.png',
]);
const none=()=>({url:'',kind:'none',credit:''});
const archiveCredits={
  '/assets/editorial/vitoria-baia-arionstar-2024.webp':'ArionStar · CC0',
  '/assets/editorial/whitecaps-lafc-bmo-tumford14-2024.webp':'Foto de arquivo · 2024',
};
const archiveCaptions={
  '/assets/editorial/vitoria-baia-arionstar-2024.webp':'Baía de Vitória vista do Convento da Penha, em 12 de fevereiro de 2024. Foto de arquivo: ArionStar / Wikimedia Commons (CC0).',
  '/assets/editorial/whitecaps-lafc-bmo-tumford14-2024.webp':'Los Angeles FC x Vancouver Whitecaps no BMO Stadium, em 27 de outubro de 2024. Foto de arquivo: Tumford14 / Wikimedia Commons (CC0).',
};
// Individually reviewed existing assets. These are contextual illustrations,
// never photographs of the people, casts or specific events in an article.
const reviewedIllustrations={
  '/assets/recipes/salada-grao-de-bico-tomate-pepino.png':{ai:true,caption:'Ilustração de salada de grão-de-bico com tomate e pepino, gerada por IA. Não é uma fotografia de um prato preparado pela VitrineCity.'},
  '/assets/editorial/noite-cinema.jpg':{ai:false,caption:'Imagem ilustrativa de uma sessão de televisão em casa. Não retrata um elenco ou uma cena da obra citada.'},
  '/uploads/generated-videos/criciuma-juventude-editorial-20260909.png':{ai:true,caption:'Ilustração de futebol gerada por IA. Não é uma fotografia de um jogador ou de uma partida específica.'},
  '/uploads/generated-videos/book-chapter-42-1788310312511.png':{ai:true,caption:'Ilustração de colaboração entre pessoas, gerada por IA. Não retrata as pessoas ou instituições citadas no texto.'},
};

function localPath(value,siteUrl){
  if(typeof value!=='string'||!value||value.length>1000||/[\\%\x00-\x20\x7f]/.test(value)||value.split('/').some(part=>part==='.'||part==='..'))return '';
  if(!value.startsWith('/')&&!/^https?:\/\//i.test(value))return '';
  try{
    const origin=new URL(siteUrl).origin,url=new URL(value,origin);
    if(!['http:','https:'].includes(url.protocol)||url.origin!==origin||url.username||url.password||url.search||url.hash||value.startsWith('//'))return '';
    return url.pathname;
  }catch{return '';}
}

export function isGenericEditorialImage(value,{siteUrl='https://vitrinecity.com'}={}){
  return institutionalImages.has(localPath(value,siteUrl).toLowerCase());
}

export function editorialImage(value,{siteUrl='https://vitrinecity.com'}={}){
  const url=localPath(value,siteUrl);
  if(!url||institutionalImages.has(url.toLowerCase())||!/^\/(?:assets|uploads\/(?:generated-videos|store-assets)|story-assets)\/[a-z0-9_./-]+\.(?:jpe?g|png|webp)$/i.test(url))return none();
  // These names are emitted by generateEditorialDraft and the story image
  // provider. Do not label arbitrary uploaded images or recipes as AI/photos.
  const illustration=reviewedIllustrations[url];
  const ai=illustration?.ai||/^\/uploads\/generated-videos\/(?:editorial-\d{13}-[a-f0-9]{8}\.png|(?:story|editorial)-ai-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\.(?:jpe?g|png|webp))$/i.test(url);
  const caption=illustration?.caption||archiveCaptions[url];
  return {url,kind:ai?'ai':'editorial',credit:ai?'Ilustração por IA':illustration?'Imagem ilustrativa':archiveCredits[url]||'',...(caption?{caption}:{})};
}
