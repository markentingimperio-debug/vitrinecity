(() => {
  const peopleSection = document.getElementById('people')?.closest('section');
  const postsSection = document.getElementById('posts')?.closest('section');
  const input = document.getElementById('q');
  if (!peopleSection || !postsSection || !input) return;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
  const makeSection = (title, id, className) => {
    const section = document.createElement('section');
    section.innerHTML = `<h2>${title}</h2><div class="${className}" id="${id}"></div>`;
    return section;
  };

  const citiesSection = makeSection('Cidades', 'cities', 'discover-cards');
  const categoriesSection = makeSection('Categorias', 'categories', 'tags');
  const storesSection = makeSection('Lojas', 'stores', 'discover-cards');
  const suggestionsSection = makeSection('Sugestões para você', 'profile-suggestions', 'discover-cards');
  peopleSection.before(citiesSection, categoriesSection, storesSection, suggestionsSection);
  postsSection.querySelector('h2').textContent = 'Conteúdos populares';
  document.querySelector('#tags')?.closest('section')?.querySelector('h2')?.replaceChildren('Hashtags em alta');

  const style = document.createElement('style');
  style.textContent = '.discover-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.discover-card{display:flex;align-items:center;gap:12px;min-height:78px;padding:14px;background:var(--panel);border:1px solid var(--line);border-radius:16px}.discover-card span{min-width:0}.discover-card b,.discover-card small{display:block;overflow:hidden;text-overflow:ellipsis}.discover-card small{color:var(--muted);margin-top:3px}@media(max-width:720px){.discover-cards{grid-template-columns:1fr}}';
  document.head.append(style);

  async function enhance() {
    const [response, suggestionsResponse] = await Promise.all([
      fetch('/api/social/discover?q=' + encodeURIComponent(input.value.trim())),
      fetch('/api/social/profile-suggestions')
    ]);
    if (!response.ok) return;
    const data = await response.json();
    const suggestionData = suggestionsResponse.ok ? await suggestionsResponse.json() : { suggestions: [] };
    document.getElementById('cities').innerHTML = (data.cities || []).map(item =>
      `<a class="discover-card" href="${escapeHtml(item.url)}"><span class="avatar">⌖</span><span><b>${escapeHtml(item.city)}</b><small>${Number(item.count)} conteúdos e perfis</small></span></a>`
    ).join('') || '<div class="empty">Nenhuma cidade encontrada.</div>';
    document.getElementById('categories').innerHTML = (data.categories || []).map(item =>
      `<button class="tag" type="button" data-discover-query="${escapeHtml(item.category)}">${escapeHtml(item.category)} · ${Number(item.count)}</button>`
    ).join('') || '<span class="empty">Nenhuma categoria encontrada.</span>';
    document.getElementById('stores').innerHTML = (data.stores || []).map(store =>
      `<a class="discover-card" href="${escapeHtml(store.url)}">${store.logoUrl ? `<img class="avatar" src="${escapeHtml(store.logoUrl)}" alt="">` : '<span class="avatar">▣</span>'}<span><b>${escapeHtml(store.name)}</b><small>${escapeHtml(store.category || 'Loja local')}</small></span></a>`
    ).join('') || '<div class="empty">Nenhuma loja encontrada.</div>';
    document.getElementById('profile-suggestions').innerHTML = (suggestionData.suggestions || []).map(profile =>
      `<article class="discover-card" data-suggestion-id="${Number(profile.id)}">${profile.avatarUrl ? `<img class="avatar" src="${escapeHtml(profile.avatarUrl)}" alt="">` : `<span class="avatar">${escapeHtml(profile.name.slice(0, 1))}</span>`}<span><a href="/perfil/${encodeURIComponent(profile.handle)}"><b>${escapeHtml(profile.name)}</b><small>@${escapeHtml(profile.handle)} · ${Number(profile.followers)} seguidores</small></a><button class="tag suggestion-follow" type="button">Seguir</button></span></article>`
    ).join('') || '<div class="empty">Você já acompanha todos os perfis sugeridos.</div>';
    document.querySelectorAll('#posts .post').forEach((post, index) => {
      const record = data.posts?.[index];
      const label = post.querySelector('span');
      if (record && label) label.prepend(`${Number(record.engagement || 0)} interações · `);
    });
  }

  document.getElementById('categories').addEventListener('click', event => {
    const button = event.target.closest('[data-discover-query]');
    if (!button) return;
    input.value = button.dataset.discoverQuery;
    document.getElementById('search').requestSubmit();
  });
  document.getElementById('profile-suggestions').addEventListener('click', async event => {
    const button = event.target.closest('.suggestion-follow');
    const card = event.target.closest('[data-suggestion-id]');
    if (!button || !card) return;
    button.disabled = true;
    const response = await fetch(`/api/social/users/${card.dataset.suggestionId}/follow`, { method: 'POST' });
    if (response.status === 401) {
      location.href = '/entrar.html?returnTo=' + encodeURIComponent('/descobrir');
      return;
    }
    const data = await response.json();
    if (response.ok && data.following) card.remove();
    else button.disabled = false;
  });
  document.getElementById('search').addEventListener('submit', () => setTimeout(enhance, 0));
  document.getElementById('tags').addEventListener('click', () => setTimeout(enhance, 0));
  enhance();
})();
