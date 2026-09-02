(() => {
  if (window.__vcGlobalMarketBannerLoaded) return;
  window.__vcGlobalMarketBannerLoaded = true;
  if (
    document.querySelector("#vc-global-market-banner") ||
    location.pathname === "/" ||
    location.pathname === "/index.html" ||
    location.pathname.startsWith("/admin")
  )
    return;
  const escapeHtml = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character],
    );
  Promise.all([fetch("/api/promotions"), fetch("/api/ads/serve?placement=banner"),fetch('/api/marketplace/platform-promotions?slot=platform_header'),fetch('/api/marketplace/platform-promotions?slot=platform_footer')])
    .then(async ([promotions, ads,headerPromotions,footerPromotions]) => ({
      promotions: promotions.ok ? await promotions.json() : { items: [] },
      ads: ads.ok ? await ads.json() : { ads: [] },
      header:headerPromotions.ok?await headerPromotions.json():{items:[]},
      footer:footerPromotions.ok?await footerPromotions.json():{items:[]},
    }))
    .then((data) => {
      const sponsored = (data.ads.ads || []).map((item) => ({
        label: "PATROCINADO",
        title: item.title,
        url: item.clickUrl,
        sponsored: true,
      }));
      const fallbackInstitutional=(data.promotions.items||[]).filter(item=>item.kind==='service'||item.kind==='course');
      const normalizeInstitutional=item=>({...item,institutional:true,label:item.label||'VITRINECITY OFICIAL',url:item.ctaUrl||item.url||'/',amountCents:item.amountCents||0});
      const headerInstitutional=(data.header.items?.length?data.header.items:fallbackInstitutional).map(normalizeInstitutional);
      const footerInstitutional=(data.footer.items?.length?data.footer.items:fallbackInstitutional).map(normalizeInstitutional);
      const items = headerInstitutional.slice(0, 32);
      if (!items.length) return;
      const aside = document.createElement("aside");
      aside.id = "vc-global-market-banner";
      aside.setAttribute(
        "aria-label",
        "Produtos e serviços oficiais da VitrineCity",
      );
      const content = items
        .concat(items)
        .map((item) => {
          const price = item.amountCents
            ? (item.amountCents / 100).toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              })
            : item.label;
          return `<a href="${escapeHtml(item.url || "/")}"${item.sponsored ? ' rel="nofollow sponsored"' : ""}><small>${escapeHtml(item.label)}</small><b>${escapeHtml(item.title)}</b><span>${escapeHtml(price)}</span></a>`;
        })
        .join("");
      aside.innerHTML = `<strong>VitrineCity oficial</strong><div><nav>${content}</nav></div><a class="announce" href="/servicos-digitais.html">Ver produtos oficiais</a><button type="button" aria-label="Fechar vitrine institucional">×</button>`;
      const paid = sponsored.length ? document.createElement('aside') : null;
      if(paid){paid.id='vc-paid-sponsor-strip';paid.setAttribute('aria-label','Publicidade paga');paid.innerHTML=`<b>Publicidade</b>${sponsored.map(item=>`<a href="${escapeHtml(item.url)}" rel="nofollow sponsored"><small>Patrocinado</small>${escapeHtml(item.title)}</a>`).join('')}`;}
      const footer=document.createElement('section');footer.id='vc-institutional-footer';footer.setAttribute('aria-label','Vitrine oficial da VitrineCity');footer.innerHTML=`<h2>VitrineCity oficial</h2><p>Produtos, cursos e serviços oferecidos pela própria plataforma.</p><div>${footerInstitutional.slice(0,8).map(item=>`<a href="${escapeHtml(item.url||'/')}"><small>OFICIAL</small><b>${escapeHtml(item.title)}</b></a>`).join('')}</div>`;
      const style = document.createElement("style");
      style.textContent =
        "#vc-global-market-banner{position:relative;z-index:9000;min-height:50px;padding:7px 52px 7px 16px;display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:center;background:#071f4b;color:#fff;font-family:Inter,Arial,sans-serif;border-bottom:2px solid #ffc628}#vc-global-market-banner>strong{color:#ffc628;font-size:12px;white-space:nowrap}#vc-global-market-banner>div{overflow:hidden}#vc-global-market-banner nav{display:flex;width:max-content;gap:30px;animation:vcBannerMove 145s linear infinite}#vc-global-market-banner nav:hover{animation-play-state:paused}#vc-global-market-banner nav a{display:grid;grid-template-columns:auto auto;column-gap:8px;color:#fff;text-decoration:none;font-size:13px;white-space:nowrap}#vc-global-market-banner nav small{grid-column:1/-1;color:#ffc628;font-size:8px;font-weight:900;letter-spacing:.08em}#vc-global-market-banner nav span{color:#8fc1ff;font-weight:900}.announce{padding:8px 11px;border-radius:8px;background:#1768e6;color:#fff;text-decoration:none;font-size:12px;font-weight:900;white-space:nowrap}#vc-global-market-banner button{position:absolute;right:10px;top:7px;border:0;background:transparent;color:#fff;font-size:23px;cursor:pointer}#vc-paid-sponsor-strip{display:flex;gap:14px;align-items:center;padding:8px 5vw;background:#fff9e8;color:#45370f;border-bottom:1px solid #ead58d;font:12px Inter,Arial,sans-serif;overflow:auto}#vc-paid-sponsor-strip a{color:#45370f;white-space:nowrap;text-decoration:none}#vc-paid-sponsor-strip small{margin-right:6px;font-size:9px;font-weight:900;text-transform:uppercase}#vc-institutional-footer{padding:30px max(18px,5vw);background:#071f4b;color:#fff;font-family:Inter,Arial,sans-serif}#vc-institutional-footer h2{margin:0}#vc-institutional-footer p{color:#bfd1ec}#vc-institutional-footer>div{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}#vc-institutional-footer a{display:grid;gap:4px;padding:13px;border:1px solid #2b4a75;border-radius:12px;color:#fff;text-decoration:none}#vc-institutional-footer small{color:#ffc628;font-weight:900}@keyframes vcBannerMove{to{transform:translateX(-50%)}}@media(max-width:700px){#vc-global-market-banner{grid-template-columns:1fr;padding:8px 42px 8px 12px;gap:5px}#vc-global-market-banner>strong,.announce{display:none}#vc-global-market-banner nav{animation-duration:180s}#vc-institutional-footer>div{grid-template-columns:1fr 1fr}}@media(max-width:420px){#vc-institutional-footer>div{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){#vc-global-market-banner nav{animation:none}}";
      document.head.appendChild(style);
      document.body.prepend(aside);
      if(paid)aside.after(paid);
      document.body.append(footer);
      aside.querySelector("button").onclick = () => {
        aside.remove();
      };
    })
    .catch(() => {});
})();
