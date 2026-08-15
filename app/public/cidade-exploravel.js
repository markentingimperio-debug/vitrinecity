(() => {
  const viewport = document.getElementById('viewport');
  const world = document.getElementById('world');
  const panel = document.getElementById('panel');
  const avatar = document.getElementById('avatar');
  const hint = document.getElementById('hint');
  const pins = [...document.querySelectorAll('.pin')];
  let scale = .72, offsetX = 0, offsetY = 0, dragging = false, moved = false, start, initial, pinchDistance = 0;

  function constrain() {
    const width = 2000 * scale, height = 1125 * scale;
    offsetX = Math.min(34, Math.max(viewport.clientWidth - width - 34, offsetX));
    offsetY = Math.min(34, Math.max(viewport.clientHeight - height - 34, offsetY));
  }
  function draw() {
    constrain();
    world.style.transform = `translate(${offsetX}px,${offsetY}px) scale(${scale})`;
  }
  function center() {
    scale = Math.max(.5, Math.min(1, Math.min(viewport.clientWidth / 2000, viewport.clientHeight / 1125) * 1.25));
    offsetX = (viewport.clientWidth - 2000 * scale) / 2;
    offsetY = (viewport.clientHeight - 1125 * scale) / 2;
    draw();
  }
  function zoom(delta, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) {
    const previous = scale;
    scale = Math.max(.45, Math.min(1.65, scale + delta));
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
  function setAction(id, href, visible, label) {
    const action = document.getElementById(id);
    action.style.display = visible ? 'block' : 'none';
    if (href) action.href = href;
    if (label) action.textContent = label;
  }
  function showPanel(pin) {
    moveAvatarTo(pin);
    document.getElementById('tag').textContent = pin.dataset.tag || '';
    document.getElementById('name').textContent = pin.dataset.name || pin.textContent.trim();
    document.getElementById('desc').textContent = pin.dataset.desc || '';
    const image = document.getElementById('shopImage');
    image.style.display = pin.dataset.image ? 'block' : 'none';
    image.src = pin.dataset.image || '';
    image.alt = pin.dataset.image ? `Fachada de ${pin.dataset.name}` : '';
    const isLot = Boolean(pin.dataset.lot);
    setAction('primaryAction', isLot ? `/comprar-lote.html?lote=${encodeURIComponent(pin.dataset.lot)}` : '', isLot, 'Escolher este lote');
    setAction('pageAction', pin.dataset.page, Boolean(pin.dataset.page), pin.dataset.category === 'store' ? '🏪 Entrar na loja' : 'Visitar este espaço');
    setAction('walkAction', pin.dataset.walk, Boolean(pin.dataset.walk));
    setAction('siteAction', pin.dataset.site, Boolean(pin.dataset.site));
    setAction('mapsAction', pin.dataset.maps, Boolean(pin.dataset.maps));
    setAction('instagramAction', pin.dataset.instagram, Boolean(pin.dataset.instagram));
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
      const show = (activeFilter === 'all' || pin.dataset.category === activeFilter) && (!query || text.includes(query));
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

  const avatarShop = document.getElementById('avatarShop');
  document.getElementById('avatarBtn').onclick = () => avatarShop.classList.add('show');
  document.getElementById('closeAvatar').onclick = () => avatarShop.classList.remove('show');
  avatarShop.addEventListener('click', event => { if (event.target === avatarShop) avatarShop.classList.remove('show'); });
  center();
})();
