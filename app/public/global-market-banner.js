(() => {
  if(window.top !== window.self && new URLSearchParams(location.search).get('lia') === '1') return;
  // The 3D city has its own building billboards; page-wide banners cover its controls.
  // Course payment keeps attention on the selected course and its form.
  if(window.__vcGlobalMarketBannerLoaded || location.pathname.startsWith('/admin') || location.pathname==='/recuperar-acesso-entregador.html' || location.pathname==='/multiverso' || /^\/vitriny-multiverse-(?:explore|district)(?:\.html)?\/?$/.test(location.pathname) || /^\/oracao-do-dia(?:\.html)?\/?$/.test(location.pathname) || /^\/(?:course-checkout|presente)\.html\/?$/.test(location.pathname))return;
  window.__vcGlobalMarketBannerLoaded=true;
  window.__vcMarketStylesReady=new Promise(resolve=>{
    let css=document.querySelector('link[data-vc-market-styles]');
    if(css?.sheet){resolve(true);return;}
    if(!css){
      css=document.createElement('link');css.rel='stylesheet';css.href='/market-outdoor.css?v=4';css.dataset.vcMarketStyles='';
    }
    let settled=false;
    const finish=ready=>{if(settled)return;settled=true;resolve(ready);};
    css.addEventListener('load',()=>finish(true),{once:true});
    css.addEventListener('error',()=>finish(false),{once:true});
    if(!css.isConnected)document.head.append(css);
    else if(css.sheet)finish(true);
  });
  import('/platform-performance.js?v=1').catch(()=>{});
  import('/market-outdoor.js?v=7').catch(()=>{});
  // Preserve the existing paid advertising placement, separately labelled.
  window.__vcMarketStylesReady.then(ready=>ready?fetch('/api/ads/serve?placement=banner'):null).then(r=>r?.ok?r.json():{}).then(data=>{
    if(!data.ads?.length || document.getElementById('vc-paid-sponsor-strip'))return;
    const aside=document.createElement('aside');aside.id='vc-paid-sponsor-strip';aside.setAttribute('aria-label','Publicidade paga');
    const label=document.createElement('b');label.textContent='Publicidade';aside.append(label);
    for(const item of data.ads){try{const url=new URL(item.clickUrl,location.origin);if(url.protocol!=='https:')continue;
      const a=document.createElement('a');a.href=url.href;a.rel='nofollow sponsored';a.textContent='Patrocinado · '+item.title;aside.append(a);}catch{}}
    const slot=document.getElementById('home-promotions');if(slot)slot.append(aside);else document.body.prepend(aside);
  }).catch(()=>{});
})();
