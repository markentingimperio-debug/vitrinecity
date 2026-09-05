(() => {
  if(window.__vcGlobalMarketBannerLoaded || location.pathname.startsWith('/admin'))return;
  window.__vcGlobalMarketBannerLoaded=true;
  import('/market-outdoor.js?v=3').catch(()=>{});
  // Preserve the existing paid advertising placement, separately labelled.
  fetch('/api/ads/serve?placement=banner').then(r=>r.ok?r.json():{}).then(data=>{
    if(!data.ads?.length || document.getElementById('vc-paid-sponsor-strip'))return;
    const aside=document.createElement('aside');aside.id='vc-paid-sponsor-strip';aside.setAttribute('aria-label','Publicidade paga');
    const label=document.createElement('b');label.textContent='Publicidade';aside.append(label);
    for(const item of data.ads){try{const url=new URL(item.clickUrl,location.origin);if(url.protocol!=='https:')continue;
      const a=document.createElement('a');a.href=url.href;a.rel='nofollow sponsored';a.textContent='Patrocinado · '+item.title;aside.append(a);}catch{}}
    document.body.prepend(aside);
  }).catch(()=>{});
})();
