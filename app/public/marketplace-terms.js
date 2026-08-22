(() => {
  const checkoutButton = document.getElementById('checkout');
  const status = document.getElementById('status');
  if (!checkoutButton) return;

  const label = document.createElement('label');
  label.style.cssText = 'display:flex;gap:9px;align-items:flex-start;margin:14px 0;font-size:14px;line-height:1.45';
  label.innerHTML = '<input id="marketplaceTerms" type="checkbox" style="margin-top:4px">' +
    '<span>Li e aceito os <a href="/termos-marketplace.html" target="_blank" rel="noopener" style="text-decoration:underline">Termos do Marketplace</a>, incluindo as políticas de compra, devolução, cancelamento e disputa.</span>';
  checkoutButton.before(label);

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, options = {}) => {
    const url = typeof input === 'string' ? input : input?.url;
    if (url === '/api/marketplace/checkout') {
      const accepted = document.getElementById('marketplaceTerms')?.checked === true;
      if (!accepted) {
        status.textContent = 'Aceite os Termos do Marketplace para continuar.';
        document.getElementById('marketplaceTerms')?.focus();
        return Promise.resolve(new Response(JSON.stringify({ error: 'Aceite os Termos do Marketplace para continuar.' }), {
          status: 400, headers: { 'Content-Type': 'application/json' }
        }));
      }
      const body = JSON.parse(options.body || '{}');
      options = { ...options, body: JSON.stringify({ ...body, termsAccepted: true }) };
    }
    return originalFetch(input, options);
  };
})();
