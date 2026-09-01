(() => {
  if (
    document.querySelector("#vc-global-market-banner") ||
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
  fetch("/api/promotions")
    .then((response) => (response.ok ? response.json() : Promise.reject()))
    .then((data) => {
      const items = (data.items || []).slice(0, 32);
      if (!items.length) return;
      const aside = document.createElement("aside");
      aside.id = "vc-global-market-banner";
      aside.setAttribute(
        "aria-label",
        "Lojas, produtos, cursos e serviços em destaque",
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
          return `<a href="${escapeHtml(item.url || "/")}"><small>${escapeHtml(item.label)}</small><b>${escapeHtml(item.title)}</b><span>${escapeHtml(price)}</span></a>`;
        })
        .join("");
      aside.innerHTML = `<strong>VitrineCity em destaque</strong><div><nav>${content}</nav></div><a class="announce" href="/servicos-digitais.html">Divulgue aqui</a><button type="button" aria-label="Fechar divulgação">×</button>`;
      const style = document.createElement("style");
      style.textContent =
        "#vc-global-market-banner{position:relative;z-index:9000;min-height:50px;padding:7px 52px 7px 16px;display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:center;background:#071f4b;color:#fff;font-family:Inter,Arial,sans-serif;border-bottom:2px solid #ffc628}#vc-global-market-banner>strong{color:#ffc628;font-size:12px;white-space:nowrap}#vc-global-market-banner>div{overflow:hidden}#vc-global-market-banner nav{display:flex;width:max-content;gap:30px;animation:vcBannerMove 145s linear infinite}#vc-global-market-banner nav:hover{animation-play-state:paused}#vc-global-market-banner nav a{display:grid;grid-template-columns:auto auto;column-gap:8px;color:#fff;text-decoration:none;font-size:13px;white-space:nowrap}#vc-global-market-banner nav small{grid-column:1/-1;color:#ffc628;font-size:8px;font-weight:900;letter-spacing:.08em}#vc-global-market-banner nav span{color:#8fc1ff;font-weight:900}.announce{padding:8px 11px;border-radius:8px;background:#1768e6;color:#fff;text-decoration:none;font-size:12px;font-weight:900;white-space:nowrap}#vc-global-market-banner button{position:absolute;right:10px;top:7px;border:0;background:transparent;color:#fff;font-size:23px;cursor:pointer}@keyframes vcBannerMove{to{transform:translateX(-50%)}}@media(max-width:700px){#vc-global-market-banner{grid-template-columns:1fr;padding:8px 42px 8px 12px;gap:5px}#vc-global-market-banner>strong,.announce{display:none}#vc-global-market-banner nav{animation-duration:180s}}@media(prefers-reduced-motion:reduce){#vc-global-market-banner nav{animation:none}}";
      document.head.appendChild(style);
      document.body.prepend(aside);
      aside.querySelector("button").onclick = () => {
        aside.remove();
        sessionStorage.setItem("vc_banner_closed", "1");
      };
      if (sessionStorage.getItem("vc_banner_closed") === "1") aside.remove();
    })
    .catch(() => {});
})();
