(() => {
  if (window.__vcOpenAIProductsLoaded) return;
  const match = location.pathname.match(/^\/produto\/(\d+)(?:\/|$)/);
  if (!match && !/^\/loja(?:\/|$)/.test(location.pathname)) return;
  window.__vcOpenAIProductsLoaded = true;
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const consent = () => read('vc_analytics_consent') === 'accepted' && read('vc_openai_ads_consent_v1') === 'accepted';
  let initialized = false, viewed = false;
  const product = () => {
    if (!match) return null;
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { const data = JSON.parse(script.textContent); if (data['@type'] === 'Product') return data; } catch {}
    }
    return null;
  };
  const contents = () => {
    const p = product();
    return p ? [{ id:`product-${match[1]}`, name:p.name, content_type:'product', quantity:1 }] : [];
  };
  const measure = (event, data, options = {}) => {
    if (consent() && initialized) window.oaiq('measure',event,data,{opt_out:true,...options});
  };
  const sync = () => {
    if (!consent()) { if (initialized) window.oaiq('consent',false); return; }
    if (!initialized) {
      if (!window.oaiq) {
        const q = function(){q.q.push(arguments);}; q.q = []; window.oaiq = q;
        const script = document.createElement('script'); script.async = true;
        script.src = 'https://bzrcdn.openai.com/sdk/oaiq.min.js'; document.head.appendChild(script);
      }
      window.oaiq('consent',true);
      window.oaiq('init',{pixelId:'7eEP1tzo8GR7Jsz62QMrtb'});
      initialized = true;
    } else window.oaiq('consent',true);
    if (viewed) return;
    viewed = true;
    measure('page_viewed',{type:'contents'});
    const items = contents();
    if (items.length) measure('contents_viewed',{type:'contents',contents:items});
  };
  document.addEventListener('vc:measurement-consent',sync);
  document.addEventListener('click',event => {
    if (!consent() || !match) return;
    const link = event.target.closest('a[href]');
    if (!link || link.textContent.trim() !== 'Comprar') return;
    // A handoff to the merchant is a click, never a completed purchase.
    measure('custom',{type:'custom',contents:contents()},{custom_event_name:'product_buy_clicked'});
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',sync); else sync();
})();
