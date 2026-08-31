(() => {
  const peopleSection = document.getElementById('people')?.closest('section');
  const postsSection = document.getElementById('posts')?.closest('section');
  const input = document.getElementById('q');
  if (!peopleSection || !postsSection || !input) return;

  const { element, empty, safeInternalPath, safeImageUrl } = window.VitrineDiscoverRenderer;
  const makeSection = (title, id, className) => {
    const section = document.createElement('section');
    section.append(
      element('h2', { text: title }),
      element('div', { className, attributes: { id } })
    );
    return section;
  };

  const citiesSection = makeSection('Cidades', 'cities', 'discover-cards');
  const categoriesSection = makeSection('Categorias', 'categories', 'tags');
  const storesSection = makeSection('Lojas', 'stores', 'discover-cards');
  const suggestionsSection = makeSection('Sugestões para você', 'profile-suggestions', 'discover-cards');
  peopleSection.before(citiesSection, categoriesSection, storesSection, suggestionsSection);
  const resultState = document.createElement('div');
  resultState.id = 'discover-result-state';
  resultState.setAttribute('aria-live', 'polite');
  document.getElementById('search').after(resultState);
  postsSection.querySelector('h2').textContent = 'Conteúdos populares';
  document.querySelector('#tags')?.closest('section')?.querySelector('h2')?.replaceChildren('Hashtags em alta');

  const style = document.createElement('style');
  style.textContent = '.discover-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.discover-card{display:flex;align-items:center;gap:12px;min-height:78px;padding:14px;background:var(--panel);border:1px solid var(--line);border-radius:16px}.discover-card span{min-width:0}.discover-card b,.discover-card small{display:block;overflow:hidden;text-overflow:ellipsis}.discover-card small{color:var(--muted);margin-top:3px}#discover-result-state{margin-top:12px;color:var(--muted)}#discover-result-state .no-results{padding:20px;border:1px dashed var(--line);border-radius:15px;text-align:center}#discover-result-state button{margin-top:10px}@media(max-width:720px){.discover-cards{grid-template-columns:1fr}}';
  document.head.append(style);

  let enhanceController;
  async function enhance() {
    enhanceController?.abort();
    const controller = new AbortController();
    enhanceController = controller;
    const query = input.value.trim();
    let response;
    let suggestionsResponse;
    try {
      [response, suggestionsResponse] = await Promise.all([
        fetch('/api/social/discover?q=' + encodeURIComponent(query), { signal: controller.signal }),
        fetch('/api/social/profile-suggestions', { signal: controller.signal })
      ]);
    } catch (error) {
      if (error.name === 'AbortError') return;
      throw error;
    }
    if (controller.signal.aborted) return;
    if (!response.ok) return;
    const data = await response.json();
    const suggestionData = suggestionsResponse.ok ? await suggestionsResponse.json() : { suggestions: [] };
    if (controller.signal.aborted) return;
    const resultCount = ['profiles', 'hashtags', 'cities', 'categories', 'stores', 'posts']
      .reduce((total, key) => total + (data[key]?.length || 0), 0);
    if (query && resultCount === 0) {
      const noResults = element('div', { className: 'no-results' }, [
        element('b', { text: `Nenhum resultado para “${query}”` }),
        document.createElement('br'),
        document.createTextNode('Tente outro nome, cidade, categoria ou hashtag.'),
        document.createElement('br'),
        element('button', { className: 'btn', text: 'Limpar busca', attributes: { id: 'clear-discover-search', type: 'button' } })
      ]);
      resultState.replaceChildren(noResults);
    } else {
      resultState.textContent = query ? `${resultCount} resultados encontrados para “${query}”.` : '';
    }

    const cityCards = (data.cities || []).map(item => {
      const href = safeInternalPath(item.url);
      const details = element('span', {}, [
        element('b', { text: item.city }),
        element('small', { text: `${Number(item.count)} conteúdos e perfis` })
      ]);
      return element('a', { className: 'discover-card', attributes: { href: href || '#' } }, [
        element('span', { className: 'avatar', text: '⌖' }), details
      ]);
    });
    document.getElementById('cities').replaceChildren(...(cityCards.length ? cityCards : [empty('div', 'empty', 'Nenhuma cidade encontrada.')]));

    const categoryCards = (data.categories || []).map(item => element('button', {
      className: 'tag', text: `${item.category} · ${Number(item.count)}`,
      attributes: { type: 'button', 'data-discover-query': item.category }
    }));
    document.getElementById('categories').replaceChildren(...(categoryCards.length ? categoryCards : [empty('span', 'empty', 'Nenhuma categoria encontrada.')]));

    const storeCards = (data.stores || []).map(store => {
      const logoUrl = safeImageUrl(store.logoUrl);
      const avatar = logoUrl
        ? element('img', { className: 'avatar', attributes: { src: logoUrl, alt: '' } })
        : element('span', { className: 'avatar', text: '▣' });
      return element('a', { className: 'discover-card', attributes: { href: safeInternalPath(store.url) || '#' } }, [
        avatar,
        element('span', {}, [
          element('b', { text: store.name }),
          element('small', { text: store.category || 'Loja local' })
        ])
      ]);
    });
    document.getElementById('stores').replaceChildren(...(storeCards.length ? storeCards : [empty('div', 'empty', 'Nenhuma loja encontrada.')]));

    const suggestionCards = (suggestionData.suggestions || []).map(profile => {
      const avatarUrl = safeImageUrl(profile.avatarUrl);
      const avatar = avatarUrl
        ? element('img', { className: 'avatar', attributes: { src: avatarUrl, alt: '' } })
        : element('span', { className: 'avatar', text: String(profile.name || '').slice(0, 1) });
      return element('article', { className: 'discover-card', attributes: { 'data-suggestion-id': Number(profile.id) } }, [
        avatar,
        element('span', {}, [
          element('a', { attributes: { href: `/perfil/${encodeURIComponent(profile.handle)}` } }, [
            element('b', { text: profile.name }),
            element('small', { text: `@${profile.handle} · ${Number(profile.followers)} seguidores` })
          ]),
          element('button', { className: 'tag suggestion-follow', text: 'Seguir', attributes: { type: 'button' } })
        ])
      ]);
    });
    document.getElementById('profile-suggestions').replaceChildren(...(suggestionCards.length ? suggestionCards : [empty('div', 'empty', 'Você já acompanha todos os perfis sugeridos.')]));
    const postsById = new Map((data.posts || []).map(record => [String(record.id), record]));
    document.querySelectorAll('#posts .post').forEach(post => {
      const record = postsById.get(post.dataset.postId);
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
  resultState.addEventListener('click', event => {
    if (!event.target.closest('#clear-discover-search')) return;
    input.value = '';
    history.replaceState(null, '', location.pathname);
    document.getElementById('search').requestSubmit();
    input.focus();
  });
  document.getElementById('search').addEventListener('submit', () => setTimeout(enhance, 0));
  document.getElementById('tags').addEventListener('click', () => setTimeout(enhance, 0));
  enhance();
})();
