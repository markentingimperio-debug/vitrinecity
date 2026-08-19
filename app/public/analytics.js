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
  let activeExperiment = null;
  const send = (eventName, detail = {}) => {
    if (!allowed()) return;
    const metadata = { ...(detail.metadata || {}) };
    if (activeExperiment) {
      metadata.experimentKey = activeExperiment.key;
      metadata.variantKey = activeExperiment.variant;
    }
    fetch('/api/analytics/events', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-VC-Session': sid },
      keepalive: true, body: JSON.stringify({ sessionId: sid, eventName, path: location.pathname,
        landingPath: sessionStorage.getItem('vc_landing') || location.pathname, referrer: document.referrer,
        ...campaign, ...detail, metadata })
    }).catch(() => {});
  };
  const applyExperiment = experiment => {
    for (const change of experiment?.config?.changes || []) {
      if (!change || typeof change.selector !== 'string' || typeof change.text !== 'string') continue;
      const element = document.querySelector(change.selector);
      if (element) element.textContent = change.text.slice(0, 180);
    }
  };
  const loadExperiment = async () => {
    if (!allowed()) return send('page_view');
    try {
      const response = await fetch('/api/experiments/assignment?path=' + encodeURIComponent(location.pathname),
        { headers: { 'X-VC-Session': sid } });
      const data = await response.json();
      activeExperiment = data.experiment || null;
      if (activeExperiment) applyExperiment(activeExperiment);
    } catch {}
    send('page_view');
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
    banner.innerHTML = `<div><strong>Privacidade</strong><p>Dados opcionais nos ajudam a melhorar a cidade.</p></div><div class="vc-consent-actions"><button data-choice="essential">Essenciais</button><button data-choice="accepted">Aceitar</button></div>`;
    const style = document.createElement('style');style.textContent = `#vc-consent{position:fixed;z-index:99999;left:50%;bottom:12px;transform:translateX(-50%);width:min(680px,calc(100% - 24px));padding:11px 13px;border-radius:14px;background:#071b3ff2;color:#fff;box-shadow:0 14px 38px #00132c66;display:flex;gap:14px;align-items:center;justify-content:space-between;font:13px/1.35 system-ui;backdrop-filter:blur(10px)}#vc-consent p{margin:2px 0 0;color:#d7e5ff}.vc-consent-actions{display:flex;gap:7px;flex:none}#vc-consent button{border:1px solid #6f91c6;border-radius:9px;padding:8px 11px;background:transparent;color:#fff;font-weight:800;cursor:pointer}#vc-consent button:last-child{background:#1973ed;border-color:#1973ed}@media(max-width:540px){#vc-consent{left:10px;right:10px;bottom:8px;transform:none;width:auto;padding:9px 10px;gap:8px}#vc-consent p{font-size:11px}.vc-consent-actions{gap:5px}#vc-consent button{padding:7px 8px;font-size:11px}}`;
    document.head.appendChild(style);document.body.appendChild(banner);
    banner.addEventListener('click', event => {
      const choice = event.target.dataset.choice;if (!choice) return;
      localStorage.setItem(CONSENT_KEY, choice);banner.remove();if (choice === 'accepted') loadExperiment();
    });
  } else if (consent === 'accepted') loadExperiment();
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
