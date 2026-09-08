(() => {
  'use strict';
  const cityHref = '/multiverso?city=vitrine-city';
  const preferenceKey = 'vc-city-direct-entry-v1';
  const preference = document.getElementById('direct-city-entry');
  const preferenceStatus = document.getElementById('direct-city-status');
  let savedPreference = false;
  try { savedPreference = localStorage.getItem(preferenceKey) === 'true'; } catch {}
  let historyVisit = false;
  try {
    historyVisit = performance.getEntriesByType('navigation')[0]?.type === 'back_forward' || performance.navigation?.type === 2;
  } catch {}
  // A preference never consumes campaigns, anchor links, explicit home links, or Back.
  if (savedPreference && ['/', '/index.html'].includes(location.pathname) && !location.search && !location.hash && !historyVisit) {
    location.replace(cityHref);
    return;
  }
  if (preference) {
    preference.checked = savedPreference;
    if (savedPreference && new URLSearchParams(location.search).has('inicio')) {
      preferenceStatus.textContent = 'A entrada direta está ativada. Desmarque para começar sempre por esta página.';
    }
    preference.addEventListener('change', () => {
      const enabled = preference.checked;
      try {
        if (enabled) localStorage.setItem(preferenceKey, 'true');
        else localStorage.removeItem(preferenceKey);
        savedPreference = enabled;
        preferenceStatus.textContent = enabled
          ? 'Pronto. Nas próximas visitas ao início, você entrará diretamente na cidade para explorar livremente.'
          : 'Pronto. Suas próximas visitas começarão por esta página.';
      } catch {
        preference.checked = savedPreference;
        preferenceStatus.textContent = 'Este navegador não permitiu salvar a preferência. Você pode entrar pelo botão Explorar a cidade.';
      }
    });
    window.addEventListener('pageshow', event => {
      if (!event.persisted) return;
      try { savedPreference = localStorage.getItem(preferenceKey) === 'true'; preference.checked = savedPreference; } catch {}
    });
  }

  const search = document.getElementById('home-search');
  if (search) import('/search-autocomplete.js').then(({setupSearchAutocomplete}) => {
    setupSearchAutocomplete({query:search.elements.q, suggestions:document.getElementById('home-search-suggestions')});
  }).catch(() => { /* Native search remains available when suggestions cannot load. */ });

  const leadForm = document.getElementById('lead-form');
  leadForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = leadForm.querySelector('button[type="submit"]');
    if (button.disabled) return;
    const message = document.getElementById('message');
    const body = Object.fromEntries(new FormData(leadForm));
    body.consent = Boolean(body.consent);
    button.disabled = true;
    message.style.color = '';
    message.textContent = 'Enviando…';
    try {
      const response = await fetch('/api/leads', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
      if (!response.ok) throw new Error('lead-unavailable');
      document.dispatchEvent(new CustomEvent('vc:analytics', {detail:{eventName:'lead_submit', payload:{assetType:'lead',assetId:'home_lead_form',metadata:{interest:String(body.interest || '').slice(0,80)}}}}));
      leadForm.reset();
      message.style.color = '#17623e';
      message.textContent = body.consent ? 'Cadastro realizado! Você autorizou o recebimento de novidades.' : 'Cadastro realizado! Seu interesse foi registrado.';
    } catch {
      message.style.color = '#a62821';
      message.textContent = 'Não foi possível cadastrar agora. Tente novamente.';
    } finally { button.disabled = false; }
  });

})();
