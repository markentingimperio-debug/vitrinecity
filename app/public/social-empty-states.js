(() => {
  const feed = document.getElementById('feed');
  if (!feed) return;

  function enhanceEmptyFeed() {
    const empty = feed.querySelector('.empty');
    if (!empty || empty.dataset.enhanced === 'true') return;
    empty.dataset.enhanced = 'true';
    const title = empty.querySelector('h2');
    const paragraph = empty.querySelector('p');
    if (title) title.textContent = 'Seu feed está pronto para ganhar movimento';
    if (paragraph) paragraph.textContent = 'Descubra pessoas e assuntos da sua cidade, siga novos perfis ou publique o primeiro conteúdo desta seleção.';
    const actions = document.createElement('div');
    actions.className = 'empty-actions';
    actions.innerHTML = '<a class="btn" href="/descobrir">Descobrir perfis</a><button class="btn alt open-publish" type="button">Publicar agora</button>';
    empty.querySelector('.open-publish')?.remove();
    empty.append(actions);
  }

  const style = document.createElement('style');
  style.textContent = '.empty-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:18px}.empty-actions a{text-decoration:none}';
  document.head.append(style);
  new MutationObserver(enhanceEmptyFeed).observe(feed, { childList: true, subtree: true });
  enhanceEmptyFeed();
})();
