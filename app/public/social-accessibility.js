(() => {
  const main = document.querySelector('main');
  if (main) {
    main.id ||= 'conteudo-principal';
    main.tabIndex = -1;
    const skip = document.createElement('a');
    skip.className = 'skip-link';
    skip.href = `#${main.id}`;
    skip.textContent = 'Pular para o conteúdo principal';
    document.body.prepend(skip);
  }

  const style = document.createElement('style');
  style.textContent = `.skip-link{position:fixed;z-index:9999;left:12px;top:10px;transform:translateY(-160%);padding:11px 15px;border-radius:9px;background:#fff;color:#071f4b;font-weight:900}.skip-link:focus{transform:none}:focus-visible{outline:3px solid #ffc628!important;outline-offset:3px!important}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}`;
  document.head.append(style);

  const label = (selector, text) => document.querySelector(selector)?.setAttribute('aria-label', text);
  label('#notifications-button', 'Abrir notificações');
  label('#publish-mobile', 'Criar publicação');
  label('#chat-back', 'Voltar para a lista de conversas');
  label('#attach', 'Anexar arquivo');
  label('#record', 'Gravar mensagem de áudio');
  label('#media-close', 'Fechar publicação de mídia');
  label('#notifications-close', 'Fechar notificações');
  label('#story-close', 'Fechar Story');
  label('#close-comments', 'Fechar comentários');

  document.querySelectorAll('.status,.upload-status').forEach(node => {
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
  });
  document.getElementById('notification-count')?.setAttribute('aria-live', 'polite');
  const messages = document.getElementById('messages');
  if (messages) {
    messages.setAttribute('role', 'log');
    messages.setAttribute('aria-live', 'polite');
    messages.setAttribute('aria-relevant', 'additions text');
    messages.setAttribute('aria-label', 'Mensagens da conversa');
  }
  document.querySelector('.sidebar')?.setAttribute('aria-label', 'Lista de conversas');
  const composer = document.querySelector('#composer textarea');
  if (composer) composer.setAttribute('aria-label', 'Escrever mensagem');
  document.getElementById('file')?.setAttribute('aria-label', 'Arquivo para enviar');
  const discoverFrame = document.getElementById('frame');
  if (discoverFrame && !discoverFrame.title) discoverFrame.title = 'Publicação selecionada';
  const discoverViewer = document.getElementById('viewer');
  if (discoverViewer) {
    discoverViewer.setAttribute('role', 'dialog');
    discoverViewer.setAttribute('aria-modal', 'true');
    discoverViewer.setAttribute('aria-label', 'Visualizador de publicação');
  }

  const tabs = document.querySelector('.tabs');
  if (tabs) {
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Escolher tipo de feed');
    tabs.querySelectorAll('.tab').forEach((tab, index) => {
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(tab.classList.contains('active')));
      tab.tabIndex = index === 0 ? 0 : -1;
    });
    tabs.addEventListener('click', event => {
      const selected = event.target.closest('.tab');
      if (!selected) return;
      tabs.querySelectorAll('.tab').forEach(tab => {
        tab.setAttribute('aria-selected', String(tab === selected));
        tab.tabIndex = tab === selected ? 0 : -1;
      });
    });
    tabs.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      const items = [...tabs.querySelectorAll('.tab')];
      const current = items.indexOf(document.activeElement);
      if (current < 0) return;
      event.preventDefault();
      items[(current + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length].focus();
    });
  }
  document.getElementById('filters')?.setAttribute('aria-label', 'Filtrar publicações por categoria');

  function nameDynamicControls(root = document) {
    const within = selector => [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)];
    within('.post').forEach(post => {
      const count = button => button?.querySelector('span')?.textContent?.trim() || '0';
      const names = [
        ['.like', button => `Curtir publicação, ${count(button)} curtidas`],
        ['.comment', button => `Abrir comentários, ${count(button)} comentários`],
        ['.repost', button => `Republicar, ${count(button)} republicações`],
        ['.save', button => `Salvar publicação, ${count(button)} salvamentos`],
        ['.share', button => `Compartilhar publicação, ${count(button)} compartilhamentos`],
        ['.not-interested', () => 'Não tenho interesse nesta publicação'],
        ['.report', () => 'Denunciar publicação']
      ];
      names.forEach(([selector, makeName]) => post.querySelectorAll(selector).forEach(button => button.setAttribute('aria-label', makeName(button))));
      post.querySelector('.follow')?.setAttribute('aria-label', 'Seguir ou deixar de seguir este perfil');
    });
    within('.conversation').forEach(button => button.setAttribute('aria-label', button.textContent.trim().replace(/\s+/g, ' ')));
    within('.story-bubble').forEach(button => button.setAttribute('aria-label', `Abrir Story de ${button.textContent.trim()}`));
    within('img:not([alt])').forEach(image => image.alt = '');
  }
  nameDynamicControls();
  new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
    if (node.nodeType === Node.ELEMENT_NODE) nameDynamicControls(node);
  }))).observe(document.body, { childList: true, subtree: true });
})();
