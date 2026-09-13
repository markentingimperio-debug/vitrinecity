// App navigation is separate from the site's city and commercial navigation.
const APP_PAGES=new Set(['/games/','/games/blocos','/games/jardim','/games/fazenda','/games/plantas','/games/offline.html']);
export function mountGamesApp({document=globalThis.document,window=globalThis.window}={}){
  if(!document||!window)return()=>{};
  let sharing,disposed=false;
  if(document.documentElement)import('../public-share.js?v=20260913-1').then(module=>{if(!disposed)sharing=module.mountPublicShare({document,window});}).catch(()=>{});
  if(!APP_PAGES.has(window.location.pathname))return()=>{disposed=true;sharing?.dispose();};
  const back=document.getElementById('backCity');let observer;
  function keepGamesReturn(){if(back&&back.getAttribute('href')!=='/games/')back.setAttribute('href','/games/');}
  keepGamesReturn();if(back&&window.MutationObserver){observer=new window.MutationObserver(keepGamesReturn);observer.observe(back,{attributes:true,attributeFilter:['href']});}
  function register(){if('serviceWorker' in window.navigator)window.navigator.serviceWorker.register('/games/sw.js',{scope:'/games/',updateViaCache:'none'}).catch(()=>{});}
  if(document.readyState==='complete')register();else window.addEventListener('load',register,{once:true});
  const dispose=()=>{disposed=true;sharing?.dispose();observer?.disconnect();window.removeEventListener('load',register);window.removeEventListener('pagehide',onPageHide);};
  const onPageHide=event=>{if(!event.persisted)dispose();};window.addEventListener('pagehide',onPageHide);return dispose;
}
if(typeof document!=='undefined'&&typeof window!=='undefined')mountGamesApp();
