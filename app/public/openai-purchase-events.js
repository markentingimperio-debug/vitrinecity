(() => {
  if (window.__vcOpenAIPurchasesLoaded || !['/meus-cursos.html', '/minha-conta.html', '/pagamento.html'].includes(location.pathname)) return;
  window.__vcOpenAIPurchasesLoaded = true;
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const allowed = () => read('vc_analytics_consent') === 'accepted' && read('vc_openai_ads_consent_v1') === 'accepted';
  const sentKey = 'vc_openai_purchases_sent_v1', ttl = 7 * 86400000, memorySent = new Set();
  let sdk, running = false, attempts = 0, timer;
  const sent = () => {
    try { return JSON.parse(read(sentKey) || '[]').filter(item => /^vc_purchase_[a-f0-9]{64}$/.test(item.id) && item.time > Date.now() - ttl).slice(-200); }
    catch { return []; }
  };
  const initialize = () => {
    if (sdk) return sdk;
    sdk = new Promise((resolve, reject) => {
      if (window.oaiq && !window.oaiq.q) return resolve();
      const q = function () { q.q.push(arguments); }; q.q = [];
      window.oaiq = q;
      const script = document.createElement('script'); script.async = true;
      script.src = 'https://bzrcdn.openai.com/sdk/oaiq.min.js';
      const timeout = setTimeout(() => reject(new Error('pixel_timeout')), 10000);
      script.onload = () => { clearTimeout(timeout); resolve(); };
      script.onerror = () => { clearTimeout(timeout); reject(new Error('pixel_unavailable')); };
      document.head.appendChild(script);
    }).catch(error => { sdk = null; throw error; });
    return sdk;
  };
  const valid = receipt => receipt?.event === 'order_created' && /^vc_purchase_[a-f0-9]{64}$/.test(receipt.eventId)
    && receipt.data?.type === 'contents' && receipt.data.currency === 'BRL'
    && Number.isSafeInteger(receipt.data.amount) && receipt.data.amount > 0
    && Array.isArray(receipt.data.contents) && receipt.data.contents.length > 0 && receipt.data.contents.length <= 200
    && receipt.data.contents.every(item => /^(?:course-[a-z0-9-]+|product-[1-9]\d*)$/.test(item.id)
      && item.content_type === 'product' && Number.isSafeInteger(item.quantity) && item.quantity > 0);
  const dispatch = async receipt => {
    if (!allowed() || memorySent.has(receipt.eventId) || sent().some(item => item.id === receipt.eventId)) return;
    await initialize();
    if (!allowed()) { window.oaiq?.('consent', false); return; }
    window.oaiq('consent', true);
    window.oaiq('init', { pixelId: '7eEP1tzo8GR7Jsz62QMrtb' });
    // Server receipts alone prove approval; URL parameters never trigger a purchase.
    const contents = receipt.data.contents.map(item => ({ id: item.id, content_type: 'product', quantity: item.quantity,
      ...(typeof item.name === 'string' ? { name: item.name.slice(0, 160) } : {}) }));
    window.oaiq('measure', 'order_created', { type: 'contents', amount: receipt.data.amount, currency: 'BRL', contents },
      { event_id: receipt.eventId, opt_out: true });
    memorySent.add(receipt.eventId);
    // Dispatch is not a delivery acknowledgment; event_id also deduplicates retries at OpenAI.
    try { localStorage.setItem(sentKey, JSON.stringify([...sent(), { id: receipt.eventId, time: Date.now() }].slice(-200))); } catch {}
  };
  const sync = async () => {
    if (!allowed()) { clearTimeout(timer); window.oaiq?.('consent', false); return; }
    if (running || attempts >= 7) return;
    running = true; attempts++;
    try {
      const response = await fetch('/api/measurement/openai-purchases', { credentials: 'same-origin', cache: 'no-store',
        headers: { 'X-VC-Analytics-Consent': 'accepted', 'X-VC-OpenAI-Ads-Consent': 'accepted' } });
      if (response.ok) {
        const payload = await response.json();
        for (const receipt of (Array.isArray(payload.receipts) ? payload.receipts : []).filter(valid)) {
          if (navigator.locks?.request) await navigator.locks.request('vc-openai-purchases', () => dispatch(receipt));
          else await dispatch(receipt);
        }
      }
    } catch { /* A blocked pixel cannot interrupt the student's access. */ }
    finally { running = false; if (allowed() && attempts < 7) timer = setTimeout(sync, 10000); }
  };
  document.addEventListener('vc:measurement-consent', () => { attempts = 0; sync(); });
  window.addEventListener('storage', event => { if (['vc_analytics_consent', 'vc_openai_ads_consent_v1'].includes(event.key)) { attempts = 0; sync(); } });
  sync();
})();
