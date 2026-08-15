(() => {
  if (location.pathname.startsWith('/admin')) return;
  const CONSENT_KEY = 'vc_analytics_consent';
  const SESSION_KEY = 'vc_analytics_session';
  const params = new URLSearchParams(location.search);
  const campaign = {
    utmSource: params.get('utm_source') || '', utmMedium: params.get('utm_medium') || '',
    utmCampaign: params.get('utm_campaign') || '', utmContent: params.get('utm_content') || '',
    utmTerm: params.get('utm_term') || '', gclid: params.get('gclid') || '',
    fbclid: params.get('fbclid') || '', ttclid: params.get('ttclid') || ''
  };
  let sid = sessionStorage.getItem(SESSION_KEY);
  if (!sid) {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    sid = `vc_${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
    sessionStorage.setItem(SESSION_KEY, sid);
  }
  const allowed = () => localStorage.getItem(CONSENT_KEY) === 'accepted';
  const send = (eventName, detail = {}) => {
    if (!allowed()) return;
    fetch('/api/analytics/events', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-VC-Session': sid },
      keepalive: true, body: JSON.stringify({ sessionId: sid, eventName, path: location.pathname,
        landingPath: sessionStorage.getItem('vc_landing') || location.pathname, referrer: document.referrer, ...campaign, ...detail })
    }).catch(() => {});
  };
  if (!sessionStorage.getItem('vc_landing')) sessionStorage.setItem('vc_landing', `${location.pathname}${location.search}`);
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url?.startsWith('/') && !url.startsWith('/api/analytics/')) {
      init = { ...init, headers: { ...(init.headers || {}), 'X-VC-Session': sid } };
    }
    return nativeFetch(input, init);
  };
  const consent = localStorage.getItem(CONSENT_KEY);
  if (!consent) {
    const banner = document.createElement('aside');banner.id = 'vc-consent';
    banner.innerHTML = `<div><strong>Privacidade e desempenho</strong><p>Usamos dados de navegação e origem da campanha para melhorar a cidade e medir anúncios. Você decide.</p></div><div class="vc-consent-actions"><button data-choice="essential">Somente essenciais</button><button data-choice="accepted">Aceitar análise</button></div>`;
    const style = document.createElement('style');style.textContent = `#vc-consent{position:fixed;z-index:99999;left:18px;right:18px;bottom:18px;max-width:920px;margin:auto;padding:18px 20px;border-radius:18px;background:#071b3f;color:#fff;box-shadow:0 20px 60px #00132c66;display:flex;gap:20px;align-items:center;justify-content:space-between;font:14px/1.45 system-ui}#vc-consent p{margin:4px 0 0;color:#d7e5ff}.vc-consent-actions{display:flex;gap:10px;flex:none}#vc-consent button{border:1px solid #6f91c6;border-radius:12px;padding:10px 14px;background:transparent;color:#fff;font-weight:800;cursor:pointer}#vc-consent button:last-child{background:#1973ed;border-color:#1973ed}@media(max-width:650px){#vc-consent{display:block}.vc-consent-actions{margin-top:14px}#vc-consent button{flex:1}}`;
    document.head.appendChild(style);document.body.appendChild(banner);
    banner.addEventListener('click', event => {
      const choice = event.target.dataset.choice;if (!choice) return;
      localStorage.setItem(CONSENT_KEY, choice);banner.remove();if (choice === 'accepted') send('page_view');
    });
  } else if (consent === 'accepted') send('page_view');
  document.addEventListener('click', event => {
    const link = event.target.closest('a,button');if (!link) return;
    const href = link.getAttribute('href') || '';
    let eventName = 'click';
    if (/wa\.me|whatsapp/i.test(href)) eventName = 'whatsapp_click';
    else if (/loja-|store|sertaneja|agrotecnica/i.test(href)) eventName = 'store_view';
    send(eventName, { assetType: link.dataset.assetType || '', assetId: link.dataset.assetId || href.slice(0, 120),
      metadata: { label: (link.textContent || '').trim().slice(0, 120) } });
  }, { passive: true });
})();
