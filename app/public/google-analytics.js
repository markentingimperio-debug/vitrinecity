import { measurementContext } from './measurement-policy.js';
import { flushReceipts, clearPendingReceipts } from './measurement-receipts.js';

// Public measurement ID, verified in the Vitrine City web stream (not an API secret).
const id = 'G-0V9KJQMH0V';
const context = measurementContext(location, document.referrer);
const allowed = () => {
  try { return localStorage.getItem('vc_analytics_consent') === 'accepted' && localStorage.getItem('vc_google_analytics_consent_v1') === 'accepted'; }
  catch { return false; }
};
function syncConsent() {
  window[`ga-disable-${id}`] = !allowed();
  if (!allowed()) clearPendingReceipts();
}
if (context && ['vitrinecity.com', 'www.vitrinecity.com'].includes(location.hostname) && allowed() && !window.__vcGoogleAnalyticsLoaded) {
  window.__vcGoogleAnalyticsLoaded = true;
  syncConsent();
  document.addEventListener('vc:measurement-consent', syncConsent);
  window.addEventListener('storage', syncConsent);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  const gtag = window.gtag;
  // Basic consent mode: this module and the Google tag load only after fresh opt-in.
  gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  gtag('consent', 'update', { analytics_storage: 'granted' });
  gtag('set', 'ads_data_redaction', true);
  gtag('set', 'url_passthrough', false);
  gtag('set', context);
  gtag('js', new Date());
  gtag('config', id, { ...context, send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
  gtag('event', 'page_view', { ...context, send_to: id });
  const flush = () => flushReceipts(gtag, context, id);
  document.addEventListener('vc:measurement-receipts', flush);
  flush();
  const script = document.createElement('script');
  script.async = true;
  script.referrerPolicy = 'strict-origin';
  script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.appendChild(script);
}
