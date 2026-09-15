// Navigation only: the homepage never submits a prompt or starts a paid task.
export const HOME_NEURAL_PATH = '/neural-workspace.html?personal=1';
export const HOME_NEURAL_LOGIN = '/entrar.html?returnTo=' + encodeURIComponent(HOME_NEURAL_PATH);

export async function mountHomeNeuralLinks({document=globalThis.document,fetch=globalThis.fetch,AbortController=globalThis.AbortController,setTimeout=globalThis.setTimeout,clearTimeout=globalThis.clearTimeout}={}) {
  const links=Array.from(document?.querySelectorAll('[data-home-neural]')||[]);
  if(!links.length)return;
  for(const link of links)link.setAttribute('href',HOME_NEURAL_LOGIN);
  if(typeof fetch!=='function')return;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);
  try{
    const response=await fetch('/api/auth/me',{method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});
    if(!response.ok||controller.signal.aborted)return;
    const session=await response.json();
    if(controller.signal.aborted||session?.authenticated!==true)return;
    for(const link of links)link.setAttribute('href',HOME_NEURAL_PATH);
  }catch{/* Ordinary sign-in remains usable when session lookup is unavailable. */}
  finally{clearTimeout(timer);}
}

if(typeof document!=='undefined')void mountHomeNeuralLinks();
