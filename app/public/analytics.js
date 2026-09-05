(() => {
  if (location.pathname.startsWith('/admin') || window.__vcAnalyticsLoaded) return;
  window.__vcAnalyticsLoaded = true;
  const CONSENT_KEY = 'vc_analytics_consent';
  const GOOGLE_KEY = 'vc_google_analytics_consent_v1';
  const googleEnabled = !!document.querySelector('script[data-vc-google-analytics="enabled"]');
  const SESSION_KEY = 'vc_analytics_session';
  const TOUCH_KEY = 'vc_analytics_first_touch_v1';
  const read = (area, key) => { try { return window[area].getItem(key); } catch { return null; } };
  const write = (area, key, value) => { try { window[area].setItem(key, value); } catch {} };
  const allowed = () => read('localStorage', CONSENT_KEY) === 'accepted';
  const nativeFetch = window.fetch.bind(window);
  let sid = '', campaign = null;
  const context = () => {
    if (!allowed()) return false;
    if (sid && campaign) return true;
    sid = read('sessionStorage', SESSION_KEY) || '';
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(sid)) {
      const bytes = crypto.getRandomValues(new Uint8Array(18));
      sid = `vc_${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
      write('sessionStorage', SESSION_KEY, sid);
    }
    try { campaign = JSON.parse(read('sessionStorage', TOUCH_KEY)); } catch {}
    if (!campaign || campaign.sessionId !== sid) {
      const params = new URLSearchParams(location.search);
      let referrer = '';
      try { referrer = new URL(document.referrer).origin; } catch {}
      campaign = { sessionId: sid, landingPath: location.pathname, referrer };
      for (const [key, query] of Object.entries({ utmSource: 'utm_source', utmMedium: 'utm_medium',
        utmCampaign: 'utm_campaign', utmContent: 'utm_content', utmTerm: 'utm_term',
        gclid: 'gclid', fbclid: 'fbclid', ttclid: 'ttclid' })) {
        campaign[key] = (params.get(query) || '').slice(0, 160);
      }
      write('sessionStorage', TOUCH_KEY, JSON.stringify(campaign));
    }
    return true;
  };
  let activeExperiment = null, pageViewStarted = false, googleRequested = false;
  const loadGoogle = () => {
    if (!googleEnabled || googleRequested || !allowed() || read('localStorage', GOOGLE_KEY) !== 'accepted') return;
    googleRequested = true;
    const script = document.createElement('script');
    script.type = 'module'; script.src = '/google-analytics.js?v=ga4-20260905';
    document.head.appendChild(script);
  };
  const send = (eventName, detail = {}) => {
    if (!context()) return Promise.resolve();
    const metadata = { ...(detail.metadata || {}) };
    if (activeExperiment) {
      metadata.experimentKey = activeExperiment.key;
      metadata.variantKey = activeExperiment.variant;
    }
    return nativeFetch('/api/analytics/events', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-VC-Session': sid, 'X-VC-Analytics-Consent': 'accepted' },
      keepalive: true, body: JSON.stringify({ ...detail, ...campaign, sessionId: sid, eventName, path: location.pathname, metadata })
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
    if (!context() || pageViewStarted) return;
    pageViewStarted = true;
    await send('page_view');
    try {
      const response = await fetch('/api/experiments/assignment?path=' + encodeURIComponent(location.pathname),
        { headers: { 'X-VC-Session': sid } });
      const data = await response.json();
      activeExperiment = data.experiment || null;
      if (activeExperiment) applyExperiment(activeExperiment);
    } catch {}
  };
  window.fetch = (input, init = {}) => {
    try {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (allowed() && url.origin === location.origin && url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/analytics/') && context()) {
        const headers = new Headers(init.headers === undefined && input instanceof Request ? input.headers : init.headers);
        headers.set('X-VC-Session', sid);
        headers.set('X-VC-Analytics-Consent', 'accepted');
        init = { ...init, headers };
      }
    } catch {}
    return nativeFetch(input, init);
  };
  let activeBanner = null;
  const showConsent = () => {
    if (activeBanner) return;
    const banner = document.createElement('aside');banner.id = 'vc-consent';
    activeBanner = banner;
    const message = googleEnabled
      ? 'Com sua permissão, a VitrineCity e o Google Analytics usam cookies e dados de navegação para medir visitas às páginas públicas. Não enviamos campos de formulários ao Google. A medição é opcional.'
      : 'Dados opcionais nos ajudam a melhorar a cidade.';
    banner.innerHTML = `<div><strong>Privacidade</strong><p>${message}</p></div><div class="vc-consent-actions"><button type="button" data-choice="essential">Só essenciais</button><button type="button" data-choice="accepted">Aceitar medição</button></div>`;
    const style = document.createElement('style');style.textContent = `#vc-consent{box-sizing:border-box;position:fixed;z-index:99999;left:50%;bottom:12px;transform:translateX(-50%);width:min(760px,calc(100% - 24px));max-height:85vh;overflow:auto;padding:12px 14px;border-radius:14px;background:#071b3ff2;color:#fff;box-shadow:0 14px 38px #00132c66;display:flex;gap:14px;align-items:center;justify-content:space-between;font:13px/1.4 system-ui;backdrop-filter:blur(10px)}#vc-consent p{margin:3px 0 0;color:#d7e5ff}.vc-consent-actions{display:flex;gap:7px;flex:none}#vc-consent button{min-height:44px;border:1px solid #6f91c6;border-radius:9px;padding:8px 11px;background:transparent;color:#fff;font-weight:700;cursor:pointer}#vc-consent button:last-child{background:#1973ed;border-color:#1973ed}#vc-consent button:focus-visible{outline:3px solid #fff;outline-offset:2px}@media(max-width:600px){#vc-consent{flex-direction:column;align-items:stretch;gap:10px;font-size:12px}.vc-consent-actions button{flex:1}}`;
    document.head.appendChild(style);document.body.appendChild(banner);
    banner.addEventListener('click', event => {
      const choice = event.target.dataset.choice;if (!choice) return;
      if (!['essential', 'accepted'].includes(choice)) return;
      write('localStorage', CONSENT_KEY, choice);
      if (googleEnabled) {
        write('localStorage', GOOGLE_KEY, choice);
        document.dispatchEvent(new Event('vc:measurement-consent'));
      }
      banner.remove(); style.remove(); activeBanner = null;
      if (choice === 'accepted') { loadExperiment(); loadGoogle(); }
    });
  };
  const consent = read('localStorage', CONSENT_KEY);
  if (!consent || (googleEnabled && consent === 'accepted' && !read('localStorage', GOOGLE_KEY))) showConsent();
  if (consent === 'accepted') { loadExperiment(); loadGoogle(); }
  if (googleEnabled) {
    const preferences = document.createElement('button');
    preferences.type = 'button'; preferences.textContent = 'Preferências de privacidade';
    preferences.style.cssText = 'display:block;margin:12px auto;padding:10px 14px;min-height:44px;border:1px solid #6781a5;border-radius:8px;background:#071b3f;color:#fff;font:12px system-ui;cursor:pointer';
    preferences.addEventListener('click', showConsent);
    document.body.appendChild(preferences);
  }
  document.addEventListener('click', event => {
    const link = event.target.closest('a,button');if (!link) return;
    const href = link.getAttribute('href') || '';
    let eventName = 'click';
    if (/wa\.me|whatsapp/i.test(href)) eventName = 'whatsapp_click';
    else if (/loja-|store|sertaneja|agrotecnica/i.test(href)) eventName = 'store_view';
    send(eventName, { assetType: link.dataset.assetType || '', assetId: link.dataset.assetId || href.slice(0, 120),
      metadata: { label: (link.textContent || '').trim().slice(0, 120) } });
  }, { passive: true });
  document.addEventListener('vc:analytics', event => {
    const detail = event.detail || {};
    if (typeof detail.eventName === 'string') send(detail.eventName.slice(0, 80), detail.payload || {});
  });
})();
