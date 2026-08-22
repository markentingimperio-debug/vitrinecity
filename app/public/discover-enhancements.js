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
  peopleSection.before(citiesSection, categoriesSection, storesSection);
  postsSection.querySelector('h2').textContent = 'Conteúdos populares';
  document.querySelector('#tags')?.closest('section')?.querySelector('h2')?.replaceChildren('Hashtags em alta');

  const style = document.createElement('style');
  style.textContent = '.discover-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.discover-card{display:flex;align-items:center;gap:12px;min-height:78px;padding:14px;background:var(--panel);border:1px solid var(--line);border-radius:16px}.discover-card span{min-width:0}.discover-card b,.discover-card small{display:block;overflow:hidden;text-overflow:ellipsis}.discover-card small{color:var(--muted);margin-top:3px}@media(max-width:720px){.discover-cards{grid-template-columns:1fr}}';
  document.head.append(style);

  async function enhance() {
    const response = await fetch('/api/social/discover?q=' + encodeURIComponent(input.value.trim()));
    if (!response.ok) return;
    const data = await response.json();
    document.getElementById('cities').innerHTML = (data.cities || []).map(item =>
      `<a class="discover-card" href="${escapeHtml(item.url)}"><span class="avatar">⌖</span><span><b>${escapeHtml(item.city)}</b><small>${Number(item.count)} conteúdos e perfis</small></span></a>`
    ).join('') || '<div class="empty">Nenhuma cidade encontrada.</div>';
    document.getElementById('categories').innerHTML = (data.categories || []).map(item =>
      `<button class="tag" type="button" data-discover-query="${escapeHtml(item.category)}">${escapeHtml(item.category)} · ${Number(item.count)}</button>`
    ).join('') || '<span class="empty">Nenhuma categoria encontrada.</span>';
    document.getElementById('stores').innerHTML = (data.stores || []).map(store =>
      `<a class="discover-card" href="${escapeHtml(store.url)}">${store.logoUrl ? `<img class="avatar" src="${escapeHtml(store.logoUrl)}" alt="">` : '<span class="avatar">▣</span>'}<span><b>${escapeHtml(store.name)}</b><small>${escapeHtml(store.category || 'Loja local')}</small></span></a>`
    ).join('') || '<div class="empty">Nenhuma loja encontrada.</div>';
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
  document.getElementById('search').addEventListener('submit', () => setTimeout(enhance, 0));
  document.getElementById('tags').addEventListener('click', () => setTimeout(enhance, 0));
  enhance();
})();
