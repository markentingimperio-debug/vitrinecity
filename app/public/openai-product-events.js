(() => {
  if (window.__vcOpenAIProductsLoaded) return;
  const match = location.pathname.match(/^\/produto\/(\d+)(?:\/|$)/);
  const affiliate = location.pathname.match(/^\/ofertas\/([a-z0-9-]+)\/?$/);
  const course = location.pathname.match(/^\/cursos\/([a-z0-9-]+)\/?$/);
  if (!match && !affiliate && !course && !/^\/(?:loja|cursos)\/?$/.test(location.pathname)) return;
  window.__vcOpenAIProductsLoaded = true;
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const consent = () => read('vc_analytics_consent') === 'accepted' && read('vc_openai_ads_consent_v1') === 'accepted';
  let initialized = false, viewed = false;
  const product = () => {
    if (!match && !course) return null;
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { const data = JSON.parse(script.textContent); if (data['@type'] === (course ? 'Course' : 'Product')) return data; } catch {}
    }
    return null;
  };
  const contents = () => {
    if (affiliate) {
      const link = document.querySelector('a.purchase-link[data-affiliate-id]');
      const title = document.querySelector('h1')?.textContent?.trim();
      if (link?.dataset.affiliateId === affiliate[1] && title) return [{id:`affiliate-${affiliate[1]}`,name:title,content_type:'product',quantity:1}];
      return [];
    }
    const p = product();
    return p ? [{ id:course ? `course-${course[1]}` : `product-${match[1]}`, name:p.name, content_type:'product', quantity:1 }] : [];
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
    if (!consent()) return;
    const link = event.target?.closest?.('a[href]');
    if (affiliate) {
      if (!link?.matches('a.purchase-link[data-affiliate-id]') || link.dataset.affiliateId !== affiliate[1]) return;
      const items = contents();
      if (items.length) measure('custom',{type:'custom',contents:items},{custom_event_name:'affiliate_offer_clicked'});
      return;
    }
    if (!match) return;
    if (!link || link.textContent.trim() !== 'Comprar') return;
    // A handoff to the merchant is a click, never a completed purchase.
    measure('custom',{type:'custom',contents:contents()},{custom_event_name:'product_buy_clicked'});
  });
  document.addEventListener('vc:course-checkout', event => {
    if (!course || event.detail?.slug !== course[1]) return;
    const amount = event.detail.amount;
    if (!Number.isInteger(amount) || amount <= 0) return;
    // Dispatched only after the server successfully creates a checkout preference.
    measure('checkout_started',{type:'contents',amount,currency:'BRL',contents:contents()});
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',sync); else sync();
})();
