(() => {
  const viewport = document.getElementById('cityViewport');
  const world = document.getElementById('cityWorld');
  const panel = document.getElementById('detailPanel');
  const interactive = [...world.querySelectorAll('[data-category]')];
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;
  let moved = false;
  let start = { x: 0, y: 0 };
  let initial = { x: 0, y: 0 };
  let pinchDistance = 0;
  let tourEnabled = true;
  let tourFrame = 0;
  let tourIndex = 0;
  let tourStartedAt = 0;
  const tourButton = document.getElementById('cityTour');
  const billboard = document.querySelector('.billboard');
  const billboardCopy = document.getElementById('billboardCopy');
  const adCampaigns = [
    'ANUNCIE<br><b>SUA MARCA</b><small>na avenida mais vista</small>',
    'SERTANEJA<br><b>ATÉ 50% OFF</b><small>moda country em destaque</small>',
    'AGROTÉCNICA<br><b>JARDIM VIVO</b><small>adubos e soluções para plantas</small>',
    'PRÉDIO PRONTO<br><b>R$ 15</b><small>sua fachada dentro da cidade</small>'
  ];
  const tourStops = [
    { x: 360, y: 360, scale: .78 }, { x: 650, y: 315, scale: .82 },
    { x: 1170, y: 660, scale: .8 }, { x: 1010, y: 780, scale: .77 },
    { x: 300, y: 760, scale: .76 }
  ];

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function bounds() {
    const rect = viewport.getBoundingClientRect();
    return {
      minX: Math.min(28, rect.width - world.offsetWidth * scale - 28),
      maxX: Math.max(28, rect.width - world.offsetWidth * scale - 28),
      minY: Math.min(28, rect.height - world.offsetHeight * scale - 28),
      maxY: Math.max(28, rect.height - world.offsetHeight * scale - 28)
    };
  }
  function draw() {
    const limit = bounds();
    offsetX = clamp(offsetX, limit.minX, limit.maxX);
    offsetY = clamp(offsetY, limit.minY, limit.maxY);
    world.style.transform = `translate3d(${offsetX}px,${offsetY}px,0) scale(${scale})`;
  }
  function reset() {
    const rect = viewport.getBoundingClientRect();
    const fit = Math.min(rect.width / world.offsetWidth, rect.height / world.offsetHeight);
    scale = clamp(fit * (rect.width < 760 ? 1.85 : 1.08), .48, 1.35);
    offsetX = (rect.width - world.offsetWidth * scale) / 2;
    offsetY = (rect.height - world.offsetHeight * scale) / 2;
    draw();
  }
  function stopTour() {
    if (!tourEnabled) return;
    tourEnabled = false;
    cancelAnimationFrame(tourFrame);
    world.classList.remove('tour-mode');
    tourButton.setAttribute('aria-pressed', 'false');
    tourButton.textContent = '▶ Iniciar passeio';
  }
  function changeAd(index) {
    if (!billboardCopy) return;
    billboard.classList.remove('is-changing');
    window.requestAnimationFrame(() => {
      billboardCopy.innerHTML = adCampaigns[index % adCampaigns.length];
      billboard.classList.add('is-changing');
    });
  }
  function runTour(now) {
    if (!tourEnabled) return;
    if (!tourStartedAt) tourStartedAt = now;
    const progress = Math.min((now - tourStartedAt) / 6200, 1);
    const eased = progress < .5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
    const from = tourStops[tourIndex];
    const to = tourStops[(tourIndex + 1) % tourStops.length];
    const rect = viewport.getBoundingClientRect();
    scale = from.scale + (to.scale - from.scale) * eased;
    const targetX = from.x + (to.x - from.x) * eased;
    const targetY = from.y + (to.y - from.y) * eased;
    offsetX = rect.width / 2 - targetX * scale;
    offsetY = rect.height * .58 - targetY * scale;
    draw();
    if (progress === 1) {
      tourIndex = (tourIndex + 1) % tourStops.length;
      tourStartedAt = now;
      changeAd(tourIndex);
    }
    tourFrame = requestAnimationFrame(runTour);
  }
  function startTour() {
    tourEnabled = true;
    tourStartedAt = 0;
    world.classList.add('tour-mode');
    tourButton.setAttribute('aria-pressed', 'true');
    tourButton.textContent = '❚❚ Pausar passeio';
    cancelAnimationFrame(tourFrame);
    tourFrame = requestAnimationFrame(runTour);
  }
  function zoom(delta, anchorX = viewport.clientWidth / 2, anchorY = viewport.clientHeight / 2) {
    const oldScale = scale;
    scale = clamp(scale + delta, .48, 1.7);
    const ratio = scale / oldScale;
    offsetX = anchorX - (anchorX - offsetX) * ratio;
    offsetY = anchorY - (anchorY - offsetY) * ratio;
    draw();
  }
  function setLink(id, href, visible, label) {
    const element = document.getElementById(id);
    element.style.display = visible ? 'block' : 'none';
    if (visible) element.href = href;
    if (label) element.textContent = label;
  }
  function focusOn(target) {
    const rect = viewport.getBoundingClientRect();
    const centerX = (target.offsetLeft + target.offsetWidth / 2) * scale;
    const centerY = (target.offsetTop + target.offsetHeight * .72) * scale;
    const panelReserve = rect.width > 920 ? 175 : 0;

    offsetX = rect.width / 2 - panelReserve - centerX;
    offsetY = rect.height * .56 - centerY;
    world.style.transition = 'transform .55s cubic-bezier(.2,.75,.2,1)';
    draw();
    window.setTimeout(() => { world.style.transition = ''; }, 580);
    interactive.forEach(item => item.classList.toggle('is-selected', item === target));
  }
  function showDetails(target) {
    focusOn(target);
    const isProperty = target.dataset.category === 'property';
    const image = document.getElementById('detailImage');
    image.style.display = target.dataset.image ? 'block' : 'none';
    if (target.dataset.image) image.src = target.dataset.image;
    document.getElementById('detailType').textContent = isProperty ? 'PRÉDIO PRONTO DISPONÍVEL' : target.dataset.category === 'store' ? 'VITRINE DO BAIRRO' : 'ATRAÇÃO';
    document.getElementById('detailName').textContent = target.dataset.name || 'Centro Vitrine';
    document.getElementById('detailDesc').textContent = target.dataset.desc || '';
    setLink('detailPrimary', isProperty ? `/comprar-lote.html?lote=${encodeURIComponent(target.dataset.lot || '')}` : target.dataset.page || '#', isProperty || Boolean(target.dataset.page), isProperty ? 'Comprar este prédio' : 'Entrar neste espaço');
    setLink('detailSite', target.dataset.site, Boolean(target.dataset.site));
    setLink('detailInstagram', target.dataset.instagram, Boolean(target.dataset.instagram));
    setLink('detailMaps', target.dataset.maps, Boolean(target.dataset.maps));
    panel.classList.add('show');
  }

  viewport.addEventListener('pointerdown', event => {
    if (event.target.closest('[data-category]')) return;
    stopTour();
    dragging = true; moved = false;
    start = { x: event.clientX, y: event.clientY };
    initial = { x: offsetX, y: offsetY };
    viewport.classList.add('dragging');
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener('pointermove', event => {
    if (!dragging) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
    offsetX = initial.x + dx;
    offsetY = initial.y + dy;
    draw();
  });
  viewport.addEventListener('pointerup', () => { dragging = false; viewport.classList.remove('dragging'); });
  viewport.addEventListener('wheel', event => {
    stopTour();
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    zoom(event.deltaY > 0 ? -.08 : .08, event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });
  viewport.addEventListener('touchstart', event => {
    if (event.touches.length === 2) pinchDistance = Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY);
  }, { passive: true });
  viewport.addEventListener('touchmove', event => {
    if (event.touches.length !== 2) return;
    event.preventDefault();
    const distance = Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY);
    zoom((distance - pinchDistance) / 280);
    pinchDistance = distance;
  }, { passive: false });

  interactive.forEach(item => item.addEventListener('click', event => { event.stopPropagation(); stopTour(); showDetails(item); }));
  document.getElementById('closePanel').onclick = () => {
    panel.classList.remove('show');
    interactive.forEach(item => item.classList.remove('is-selected'));
  };
  document.getElementById('closeWelcome').onclick = () => document.getElementById('welcome').remove();
  document.getElementById('zoomIn').onclick = () => { stopTour(); zoom(.13); };
  document.getElementById('zoomOut').onclick = () => { stopTour(); zoom(-.13); };
  document.getElementById('resetView').onclick = () => { stopTour(); reset(); };
  tourButton.onclick = () => tourEnabled ? stopTour() : startTour();

  const search = document.getElementById('citySearch');
  const filters = [...document.querySelectorAll('#cityFilters button')];
  let activeFilter = 'all';
  function filterCity() {
    const query = search.value.trim().toLocaleLowerCase('pt-BR');
    interactive.forEach(item => {
      const text = `${item.dataset.name || ''} ${item.dataset.desc || ''}`.toLocaleLowerCase('pt-BR');
      const show = (activeFilter === 'all' || item.dataset.category === activeFilter) && (!query || text.includes(query));
      item.classList.toggle('is-hidden', !show);
    });
  }
  search.addEventListener('input', filterCity);
  filters.forEach(button => button.onclick = () => {
    filters.forEach(item => item.classList.toggle('active', item === button));
    activeFilter = button.dataset.filter;
    filterCity();
  });

  window.addEventListener('resize', reset);
  reset();
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) startTour();
})();
