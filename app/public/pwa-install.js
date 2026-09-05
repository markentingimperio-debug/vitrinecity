(() => {
  'use strict';
  const DISMISS_KEY = 'vc_pwa_install_dismissed_at';
  const DISMISS_DAYS = 30;
  let installEvent = null;

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {}));
  }

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (isStandalone) return;

  function recentlyDismissed() {
    const value = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return value && Date.now() - value < DISMISS_DAYS * 86400000;
  }

  function hidePrompt(prompt, remember = false) {
    prompt.remove();
    if (remember) localStorage.setItem(DISMISS_KEY, String(Date.now()));
  }

  function showPrompt() {
    if (document.getElementById('vc-pwa-prompt') || recentlyDismissed()) return;
    const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (!installEvent && !isiOS) return;

    const prompt = document.createElement('aside');
    prompt.id = 'vc-pwa-prompt';
    prompt.setAttribute('role', 'dialog');
    prompt.setAttribute('aria-label', 'Instalar aplicativo VitrineCity');
    prompt.innerHTML = `
      <style>
        #vc-pwa-prompt{position:fixed;z-index:2147483000;left:16px;right:16px;bottom:max(16px,env(safe-area-inset-bottom));max-width:470px;margin:auto;padding:16px;display:grid;grid-template-columns:52px 1fr auto;gap:12px;align-items:center;color:#071f4b;background:#fff;border:1px solid #cfe0f5;border-radius:18px;box-shadow:0 18px 60px #071f4b38;font:14px/1.35 Inter,Arial,sans-serif}#vc-pwa-prompt img{width:52px;height:52px;border-radius:13px}#vc-pwa-prompt strong{display:block;font-size:16px;margin-bottom:3px}#vc-pwa-prompt p{margin:0;color:#536b8c}#vc-pwa-prompt .vc-actions{display:flex;gap:7px;align-items:center}#vc-pwa-prompt button{border:0;border-radius:10px;padding:10px 13px;font:inherit;font-weight:800;cursor:pointer}#vc-pwa-install{background:#1768e6;color:#fff}#vc-pwa-close{background:#edf4fc;color:#203a60}@media(max-width:520px){#vc-pwa-prompt{grid-template-columns:44px 1fr}#vc-pwa-prompt img{width:44px;height:44px}#vc-pwa-prompt .vc-actions{grid-column:1/-1;justify-content:flex-end}}
      </style>
      <img src="/assets/pwa-icon-192.png" alt="">
      <div><strong>Instale a VitrineCity</strong><p>${isiOS && !installEvent ? 'No iPhone, toque em Compartilhar e depois em “Adicionar à Tela de Início”.' : 'Acesse lojas, serviços e sua conta mais rapidamente.'}</p></div>
      <div class="vc-actions"><button id="vc-pwa-close" type="button" aria-label="Agora não">Agora não</button>${installEvent ? '<button id="vc-pwa-install" type="button">Instalar</button>' : ''}</div>`;
    document.body.appendChild(prompt);
    prompt.querySelector('#vc-pwa-close').addEventListener('click', () => hidePrompt(prompt, true));
    prompt.querySelector('#vc-pwa-install')?.addEventListener('click', async () => {
      const event = installEvent;
      installEvent = null;
      hidePrompt(prompt);
      if (!event) return;
      await event.prompt();
      await event.userChoice;
    });
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installEvent = event;
    window.setTimeout(showPrompt, 8000);
  });
  window.addEventListener('appinstalled', () => {
    document.getElementById('vc-pwa-prompt')?.remove();
    installEvent = null;
  });
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) window.setTimeout(showPrompt, 12000);
})();
