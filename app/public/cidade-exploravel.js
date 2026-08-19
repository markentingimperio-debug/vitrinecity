(() => {
  const viewport = document.getElementById('viewport');
  const world = document.getElementById('world');
  const panel = document.getElementById('panel');
  const avatar = document.getElementById('avatar');
  const hint = document.getElementById('hint');
  const pins = [...document.querySelectorAll('.pin')];
  const favoriteAction = document.getElementById('favoriteAction');
  const favoriteFilterCount = document.getElementById('favoriteFilterCount');
  const dockFavoriteCount = document.getElementById('dockFavoriteCount');
  const favoriteStorageKey = 'vitrinecity-favorites';
  const WORLD_WIDTH = 5000, WORLD_HEIGHT = 2250;
  let favorites = new Set();
  let currentPin = null;
  let scale = .72, offsetX = 0, offsetY = 0, dragging = false, moved = false, start, initial, pinchDistance = 0;

  try {
    favorites = new Set(JSON.parse(localStorage.getItem(favoriteStorageKey) || '[]'));
  } catch (_) {
    favorites = new Set();
  }

  function constrain() {
    const width = WORLD_WIDTH * scale, height = WORLD_HEIGHT * scale;
    offsetX = Math.min(34, Math.max(viewport.clientWidth - width - 34, offsetX));
    offsetY = Math.min(34, Math.max(viewport.clientHeight - height - 34, offsetY));
  }
  function draw() {
    constrain();
    world.style.transform = `translate(${offsetX}px,${offsetY}px) scale(${scale})`;
  }
  function center() {
    scale = Math.max(.22, Math.min(.62, Math.min(viewport.clientWidth / WORLD_WIDTH, viewport.clientHeight / WORLD_HEIGHT) * 1.25));
    offsetX = (viewport.clientWidth - WORLD_WIDTH * scale) / 2;
    offsetY = (viewport.clientHeight - WORLD_HEIGHT * scale) / 2;
    draw();
  }
  function zoom(delta, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) {
    const previous = scale;
    scale = Math.max(.18, Math.min(1.65, scale + delta));
    offsetX = x - (x - offsetX) * scale / previous;
    offsetY = y - (y - offsetY) * scale / previous;
    draw();
  }
  function moveAvatar(clientX, clientY) {
    const rect = viewport.getBoundingClientRect();
    avatar.style.left = `${(clientX - rect.left - offsetX) / scale}px`;
    avatar.style.top = `${(clientY - rect.top - offsetY) / scale}px`;
  }
  function moveAvatarTo(pin) {
    avatar.style.left = `${pin.offsetLeft}px`;
    avatar.style.top = `${pin.offsetTop + 24}px`;
  }
  function pinKey(pin) {
    return pin.dataset.key || (pin.dataset.name || pin.textContent.trim()).toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '-');
  }
  function updateFavoriteUi() {
    const count = favorites.size;
    favoriteFilterCount.textContent = count;
    dockFavoriteCount.textContent = count;
    if (!currentPin) return;
    const saved = favorites.has(pinKey(currentPin));
    favoriteAction.classList.toggle('saved', saved);
    favoriteAction.textContent = saved ? '♥ Salvo nos favoritos' : '♡ Salvar nos favoritos';
    favoriteAction.setAttribute('aria-pressed', String(saved));
  }
  function persistFavorites() {
    try {
      localStorage.setItem(favoriteStorageKey, JSON.stringify([...favorites]));
    } catch (_) {
      // A experiência continua funcionando quando o navegador bloqueia armazenamento local.
    }
    updateFavoriteUi();
  }
  function focusOnPin(pin, openPanel = true) {
    if (!pin) return;
    scale = Math.max(scale, viewport.clientWidth < 760 ? .62 : .78);
    offsetX = viewport.clientWidth / 2 - pin.offsetLeft * scale;
    offsetY = viewport.clientHeight / 2 - pin.offsetTop * scale;
    draw();
    if (openPanel) showPanel(pin);
  }
  function setAction(id, href, visible, label) {
    const action = document.getElementById(id);
    action.style.display = visible ? 'block' : 'none';
    if (href) action.href = href;
    if (label) action.textContent = label;
  }
  function showPanel(pin) {
    currentPin = pin;
    moveAvatarTo(pin);
    document.getElementById('tag').textContent = pin.dataset.tag || '';
    document.getElementById('name').textContent = pin.dataset.name || pin.textContent.trim();
    document.getElementById('desc').textContent = pin.dataset.desc || '';
    const image = document.getElementById('shopImage');
    image.style.display = pin.dataset.image ? 'block' : 'none';
    image.src = pin.dataset.image || '';
    image.alt = pin.dataset.image ? `Fachada de ${pin.dataset.name}` : '';
    const isLot = Boolean(pin.dataset.lot);
    const lotAvailable = isLot && (!pin.dataset.lotStatus || pin.dataset.lotStatus === 'available');
    setAction('primaryAction', lotAvailable ? `/comprar-lote.html?lote=${encodeURIComponent(pin.dataset.lot)}` : '', lotAvailable, 'Escolher este prédio');
    setAction('pageAction', pin.dataset.page, Boolean(pin.dataset.page), pin.dataset.category === 'store' ? '🏪 Entrar na loja' : 'Visitar este espaço');
    setAction('walkAction', pin.dataset.walk, Boolean(pin.dataset.walk));
    setAction('siteAction', pin.dataset.site, Boolean(pin.dataset.site));
    setAction('mapsAction', pin.dataset.maps, Boolean(pin.dataset.maps));
    setAction('instagramAction', pin.dataset.instagram, Boolean(pin.dataset.instagram));
    updateFavoriteUi();
    panel.classList.add('show');
  }

  viewport.addEventListener('pointerdown', event => {
    if (event.target.closest('.pin')) return;
    dragging = true; moved = false;
    viewport.classList.add('drag');
    start = { x: event.clientX, y: event.clientY };
    initial = { x: offsetX, y: offsetY };
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener('pointermove', event => {
    if (!dragging) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
    offsetX = initial.x + dx; offsetY = initial.y + dy; draw();
  });
  viewport.addEventListener('pointerup', event => {
    if (!dragging) return;
    dragging = false; viewport.classList.remove('drag');
    if (!moved) moveAvatar(event.clientX, event.clientY);
  });
  viewport.addEventListener('wheel', event => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    zoom(event.deltaY > 0 ? -.09 : .09, event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });
  viewport.addEventListener('touchstart', event => {
    if (event.touches.length === 2) pinchDistance = Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY);
  }, { passive: true });
  viewport.addEventListener('touchmove', event => {
    if (event.touches.length !== 2) return;
    event.preventDefault();
    const distance = Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY);
    zoom((distance - pinchDistance) / 260); pinchDistance = distance;
  }, { passive: false });

  pins.forEach(pin => pin.addEventListener('click', event => { event.stopPropagation(); showPanel(pin); }));
  document.getElementById('zoomIn').onclick = () => zoom(.14);
  document.getElementById('zoomOut').onclick = () => zoom(-.14);
  document.getElementById('home').onclick = center;
  document.getElementById('closePanel').onclick = () => panel.classList.remove('show');
  document.getElementById('closeHint').onclick = () => hint.remove();
  window.addEventListener('resize', center);

  const search = document.getElementById('search');
  const filterButtons = [...document.querySelectorAll('#filters button')];
  let activeFilter = 'all';
  function filterPins() {
    const query = search.value.trim().toLocaleLowerCase('pt-BR');
    let visible = 0;
    pins.forEach(pin => {
      const text = `${pin.dataset.name || ''} ${pin.dataset.desc || ''} ${pin.dataset.tag || ''}`.toLocaleLowerCase('pt-BR');
      const matchesFilter = activeFilter === 'all' || pin.dataset.category === activeFilter || (activeFilter === 'favorites' && favorites.has(pinKey(pin)));
      const show = matchesFilter && (!query || text.includes(query));
      pin.classList.toggle('hidden', !show);
      if (show) visible += 1;
    });
    document.getElementById('empty').style.display = visible ? 'none' : 'block';
  }
  search.addEventListener('input', filterPins);
  filterButtons.forEach(button => button.onclick = () => {
    filterButtons.forEach(item => item.classList.remove('active'));
    button.classList.add('active'); activeFilter = button.dataset.filter; filterPins();
  });

  favoriteAction.onclick = () => {
    if (!currentPin) return;
    const key = pinKey(currentPin);
    if (favorites.has(key)) favorites.delete(key); else favorites.add(key);
    persistFavorites();
    if (activeFilter === 'favorites') filterPins();
  };

  function selectFilter(filter) {
    const button = filterButtons.find(item => item.dataset.filter === filter);
    if (!button) return;
    filterButtons.forEach(item => item.classList.toggle('active', item === button));
    activeFilter = filter;
    search.value = '';
    filterPins();
  }

  document.querySelectorAll('[data-focus]').forEach(button => button.onclick = () => {
    const pin = pins.find(item => pinKey(item) === button.dataset.focus);
    focusOnPin(pin);
  });

  const cityPulse = document.getElementById('cityPulse');
  const pulseToggle = document.getElementById('pulseToggle');
  if (window.matchMedia('(max-width: 760px)').matches) cityPulse.classList.add('collapsed');
  pulseToggle.setAttribute('aria-expanded', String(!cityPulse.classList.contains('collapsed')));
  pulseToggle.onclick = () => {
    cityPulse.classList.toggle('collapsed');
    pulseToggle.setAttribute('aria-expanded', String(!cityPulse.classList.contains('collapsed')));
  };

  const dockButtons = [...document.querySelectorAll('[data-city-action]')];
  dockButtons.forEach(button => button.onclick = () => {
    dockButtons.forEach(item => item.classList.toggle('active', item === button));
    const action = button.dataset.cityAction;
    if (action === 'city') { selectFilter('all'); center(); panel.classList.remove('show'); }
    if (action === 'stores') selectFilter('store');
    if (action === 'courses') focusOnPin(pins.find(item => pinKey(item) === 'centro-educacional'));
    if (action === 'favorites') selectFilter('favorites');
  });

  const avatarShop = document.getElementById('avatarShop');
  document.getElementById('avatarBtn').onclick = () => avatarShop.classList.add('show');
  document.getElementById('closeAvatar').onclick = () => avatarShop.classList.remove('show');
  avatarShop.addEventListener('click', event => { if (event.target === avatarShop) avatarShop.classList.remove('show'); });
  async function syncLots() {
    try {
      const response = await fetch('/api/lots', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      for (const lot of data.lots || []) {
        const pin = pins.find(item => item.dataset.lot === lot.code);
        if (!pin) continue;
        pin.dataset.lotStatus = lot.status;
        pin.classList.toggle('reserved', lot.status === 'reserved');
        pin.classList.toggle('occupied', lot.status === 'occupied');
        if (lot.status === 'reserved') {
          pin.dataset.tag = 'RESERVA EM ANDAMENTO';
          pin.dataset.desc = `${lot.label} está temporariamente reservado enquanto o pagamento é confirmado.`;
          pin.textContent = 'Reservado';
        }
        if (lot.status === 'occupied') {
          pin.dataset.category = 'store';
          pin.dataset.tag = 'LOJA EM IMPLANTAÇÃO';
          pin.dataset.name = lot.businessName || lot.label;
          pin.dataset.desc = `${lot.place}. Esta vitrine foi adquirida e está sendo preparada para publicação.`;
          pin.textContent = lot.businessName || 'Loja em implantação';
        }
      }
      filterPins();
    } catch (_) {
      // O mapa continua disponível quando a situação dos lotes não puder ser consultada.
    }
  }

  updateFavoriteUi();
  center();
  syncLots().finally(() => {
    const requestedLot = new URLSearchParams(location.search).get('lote');
    if (requestedLot) requestAnimationFrame(() => focusOnPin(pins.find(item => item.dataset.lot === requestedLot)));
  });
})();
