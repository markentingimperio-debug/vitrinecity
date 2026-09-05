(() => {
  if(window.__vcGlobalMarketBannerLoaded || location.pathname.startsWith('/admin'))return;
  window.__vcGlobalMarketBannerLoaded=true;
  window.__vcMarketStylesReady=new Promise(resolve=>{
    let css=document.querySelector('link[data-vc-market-styles]');
    if(css?.sheet){resolve(true);return;}
    if(!css){
      css=document.createElement('link');css.rel='stylesheet';css.href='/market-outdoor.css?v=3';css.dataset.vcMarketStyles='';
    }
    let settled=false;
    const finish=ready=>{if(settled)return;settled=true;resolve(ready);};
    css.addEventListener('load',()=>finish(true),{once:true});
    css.addEventListener('error',()=>finish(false),{once:true});
    if(!css.isConnected)document.head.append(css);
    else if(css.sheet)finish(true);
  });
  import('/platform-performance.js?v=1').catch(()=>{});
  import('/market-outdoor.js?v=5').catch(()=>{});
  // Preserve the existing paid advertising placement, separately labelled.
  window.__vcMarketStylesReady.then(ready=>ready?fetch('/api/ads/serve?placement=banner'):null).then(r=>r?.ok?r.json():{}).then(data=>{
    if(!data.ads?.length || document.getElementById('vc-paid-sponsor-strip'))return;
    const aside=document.createElement('aside');aside.id='vc-paid-sponsor-strip';aside.setAttribute('aria-label','Publicidade paga');
    const label=document.createElement('b');label.textContent='Publicidade';aside.append(label);
    for(const item of data.ads){try{const url=new URL(item.clickUrl,location.origin);if(url.protocol!=='https:')continue;
      const a=document.createElement('a');a.href=url.href;a.rel='nofollow sponsored';a.textContent='Patrocinado · '+item.title;aside.append(a);}catch{}}
    document.body.prepend(aside);
  }).catch(()=>{});
})();
