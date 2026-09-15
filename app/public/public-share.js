import { toCleanPublicHref, toLegacyPublicPath } from './vitriny-public-routes.js';

const FIXED = new Set(['/', '/index.html', '/loja', '/loja.html', '/conteudo', '/noticias', '/receitas',
  '/plantas-e-jardinagem', '/esportes', '/tecnologia', '/inteligencia-artificial', '/entretenimento', '/livros',
  '/cursos', '/ofertas', '/social', '/social.html', '/stories', '/oracao-do-dia', '/oracao-do-dia.html',
  '/cidade', '/cidade/bairro-premium', '/cidade/avenida-premium', '/cidade-premium', '/mapa-real.html',
  '/cidade-exploravel.html', '/cidade-25d-demo.html', '/passeio-virtual.html', '/centro-educacional.html',
  '/sobre.html', '/contato.html', '/como-funciona.html', '/porque-vitrinecity.html', '/solucoes.html',
  '/para-empresas.html', '/afiliados.html', '/servicos-digitais', '/servicos-digitais.html',
  '/emissora.html', '/vitriny-multiverse-explore.html', '/vitriny-games.html', '/vitriny-blocks.html',
  '/vitriny-merge.html', '/vitriny-mini-fazenda.html', '/vitriny-music-arena.html', '/vitriny-cinema.html',
  '/descobrir', '/descobrir.html', '/grupos-whatsapp.html', '/portfolio', '/portfolio.html', '/musicas', '/cinema',
  '/privacy.html', '/termos-predio-digital.html', '/termos-afiliados.html', '/termos-marketplace.html',
  '/politica-vendedor-marketplace.html', '/politica-comprador-marketplace.html', '/politica-devolucao-marketplace.html',
  '/politica-cancelamento-marketplace.html', '/politica-disputas-marketplace.html',
  '/games', '/games/blocos', '/games/jardim', '/games/fazenda', '/games/cuidados', '/games/plantas']);
const SLUG = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/;
const ALIASES = {'/index.html':'/', '/social.html':'/social', '/mapa-real.html':'/cidade-premium',
  '/cidade-exploravel.html':'/cidade', '/cidade-25d-demo.html':'/cidade/bairro-premium',
  '/passeio-virtual.html':'/cidade/avenida-premium', '/oracao-do-dia.html':'/oracao-do-dia', '/games':'/games/'};

export function publicSharePath(value) {
  if (typeof value !== 'string' || value.length > 450 || !value.startsWith('/') || /[%\\?#\s\u0000-\u001f\u007f]/u.test(value) || value.includes('//') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(value)) return false;
  const path = value.length > 1 ? value.replace(/\/$/, '') : value;
  if (FIXED.has(toLegacyPublicPath(path))) return true;
  return /^\/(?:produto\/[1-9]\d*(?:\/[a-z0-9-]+)?|loja\/[a-zA-Z0-9_-]+(?:\/[a-z0-9-]+)?|(?:artigo|artigos|cursos|livro|ofertas|categoria|centros|guias|stories|cidade|musicas|cinema)\/[a-z0-9-]+(?:\.html)?|social\/post\/[a-zA-Z0-9_-]{1,100}|v\/br\/[a-z]{2}\/[a-z0-9-]+)$/.test(path);
}

function one(params, name, validate) {
  const values = params.getAll(name);
  return values.length === 1 && validate(values[0]) ? values[0] : '';
}
function validDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Only the page's public identity survives. No form values, fragments, campaign
// tokens, customer queries, referral identities or browser storage are inspected.
export function publicShareUrl(value, { origin, canonical = '', editionDay = '' } = {}) {
  if (typeof value !== 'string' || /[\\\u0000-\u0020\u007f]/u.test(value)) return '';
  try {
    const base = new URL(origin), source = new URL(value, base);
    if (!['https:', 'http:'].includes(base.protocol) || source.origin !== base.origin || source.username || source.password || !publicSharePath(source.pathname)) return '';
    let path = source.pathname.length > 1 ? source.pathname.replace(/\/$/, '') : '/';
    const legacy = toLegacyPublicPath(path), params = source.searchParams;
    let chosen;
    try {
      const candidate = new URL(canonical, base);
      if (canonical && candidate.origin === base.origin && !candidate.username && !candidate.password && publicSharePath(candidate.pathname)) chosen = candidate.pathname;
    } catch { /* A missing or invalid canonical cannot introduce a destination. */ }
    path = chosen || ALIASES[path] || toCleanPublicHref(path);
    const result = new URL(path, base); result.search = ''; result.hash = '';
    if (['/social', '/social.html'].includes(legacy)) {
      const post = one(params, 'post', value => /^[a-zA-Z0-9_-]{1,100}$/.test(value));
      if (post) result.pathname = '/social/post/' + post;
    }
    if (['/oracao-do-dia', '/oracao-do-dia.html'].includes(legacy)) {
      const day = validDay(editionDay) ? editionDay : one(params, 'dia', validDay);
      if (day) result.searchParams.set('dia', day);
    }
    if (legacy === '/vitriny-multiverse-explore.html') {
      const city = one(params, 'city', value => SLUG.test(value));
      if (city) result.searchParams.set('city', city);
    }
    if (['/loja', '/loja.html'].includes(legacy)) {
      const store = one(params, 'store', value => SLUG.test(value));
      if (store) result.searchParams.set('store', store);
    }
    if (legacy === '/centro-educacional.html') {
      const course = one(params, 'curso', value => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 101);
      if (course) result.pathname = '/cursos/' + course;
    }
    return result.href;
  } catch { return ''; }
}

function publicCity(pathname) { return ['/multiverso','/vitriny-multiverse-explore.html'].includes(pathname); }
function excludedDocument(doc, pathname = '') {
  const root = doc.documentElement;
  if (!root || root.hasAttribute('amp') || root.hasAttribute('⚡') || doc.querySelector('amp-story')) return true;
  if (/^(?:404|403|500)\b|página não encontrada|acesso negado/i.test(doc.title || '')) return true;
  // These exact interactive city routes are public despite their crawler policy.
  return !publicCity(pathname) && [...doc.querySelectorAll('meta[name]')].some(node => /^(?:robots|googlebot)$/i.test(node.getAttribute('name') || '') && /(?:^|[,\s])(?:noindex|none)(?:$|[,\s])/i.test(node.getAttribute('content') || ''));
}

export function mountPublicShare({ document: doc = globalThis.document, window: win = globalThis.window } = {}) {
  if (!doc?.body || !win || excludedDocument(doc, win.location.pathname) || doc.getElementById('vc-public-share')) return null;
  try { if (win.top !== win.self) return null; } catch { return null; }
  function current() {
    if (excludedDocument(doc, win.location.pathname)) return '';
    const canonicals = doc.querySelectorAll('link[rel="canonical"]');
    return publicShareUrl(win.location.href, { origin: win.location.origin,
      canonical: canonicals.length === 1 ? canonicals[0].getAttribute('href') : '',
      editionDay: doc.getElementById('prayerEdition')?.getAttribute('datetime') || '' });
  }
  if (!current()) return null;
  const city = toLegacyPublicPath(win.location.pathname.replace(/\/$/, '')) === '/vitriny-multiverse-explore.html';
  // This existing details element moves into the mobile Menu with its handlers.
  const citySlot = city ? doc.querySelector('#cityTools .view-controls') : null;
  if (city && !citySlot) return null; // Never invent another overlay on the city.
  const node = (tag, className, text = '') => {
    const element = doc.createElement(tag); element.className = className; element.textContent = text; return element;
  };
  const panel = node('section', 'vc-public-share' + (city ? ' vc-public-share-city' : ''));
  panel.id = 'vc-public-share'; panel.setAttribute('aria-label', 'Compartilhar e participar');
  if (city) panel.setAttribute('data-city-menu-inline', '');
  const controls = node('div', 'vc-public-share-controls');
  const share = node('button', 'vc-public-share-primary', 'Compartilhar página'); share.type = 'button';
  const options = node('details', 'vc-public-share-options');
  const summary = node('summary', '', 'Copiar link ou usar WhatsApp');
  const choices = node('div', 'vc-public-share-choices');
  const copy = node('button', '', 'Copiar link'); copy.type = 'button';
  const copyInvitation = node('button', '', 'Copiar convite para cadastro'); copyInvitation.type = 'button';
  const whatsapp = node('a', '', 'Abrir no WhatsApp'); whatsapp.target = '_blank'; whatsapp.rel = 'noopener noreferrer';
  options.append(summary, choices);
  const status = node('p', 'vc-public-share-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const manual = node('label', 'vc-public-share-manual', 'Selecione e copie:'); manual.hidden = true;
  const input = node('textarea', ''); input.readOnly = true; input.rows = 2; input.setAttribute('aria-label', 'Texto público para copiar'); manual.append(input);
  const account = node('a', 'vc-public-share-account', 'Criar conta ou entrar');
  const invitation = node('p', 'vc-public-share-invitation', 'Cadastro opcional. Use sua conta VitrineCity no app e na plataforma.');
  // Preserve the richer sharing already offered by prayer, guide and music pages.
  const alreadySharing = doc.getElementById('sharePrayer') || doc.getElementById('shareGuide') || doc.getElementById('shareSelection');
  if (!alreadySharing) { choices.append(copy, whatsapp); controls.append(share); }
  else summary.textContent = 'Convidar para a VitrineCity';
  choices.append(copyInvitation); controls.append(options);
  controls.append(account); panel.append(controls, invitation, status, manual);
  if (citySlot) citySlot.append(panel);
  else {
    const main = doc.querySelector('main');
    if (main) main.insertAdjacentElement('afterend', panel); else doc.body.append(panel);
  }
  if (!doc.getElementById('vc-public-share-style')) {
    const css = doc.createElement('link'); css.id = 'vc-public-share-style'; css.rel = 'stylesheet'; css.href = '/public-share.css?v=20260913-1'; doc.head.append(css);
  }
  let busy = false, disposed = false;
  function sync() {
    const url = current(); panel.hidden = !url;
    if (!url) return '';
    whatsapp.href = 'https://wa.me/?text=' + encodeURIComponent(url);
    const target = new URL(url);
    account.href = '/entrar-cidade.html?returnTo=' + encodeURIComponent(target.pathname + target.search);
    input.value = url;
    return url;
  }
  function manualCopy(url) {
    input.value = url; manual.hidden = false; options.open = true;
    status.textContent = 'A cópia automática não está disponível. Selecione o texto abaixo e copie.';
    input.focus({ preventScroll: true }); input.select(); input.scrollIntoView?.({block:'nearest',inline:'nearest'});
  }
  async function copyLink({invitation = false} = {}) {
    if (busy || disposed) return;
    const url = sync(); if (!url) return;
    const text = invitation ? 'Venha conhecer a VitrineCity! Crie sua conta, se quiser, para participar do app e da plataforma: ' + new URL(account.href, win.location.origin).href : url;
    busy = true; copy.disabled = copyInvitation.disabled = true;
    try {
      if (typeof win.navigator.clipboard?.writeText !== 'function') throw new Error('unavailable');
      await win.navigator.clipboard.writeText(text);
      if (!disposed) { manual.hidden = true; status.textContent = invitation ? 'Convite copiado. Você escolhe para quem enviar.' : 'Link copiado. Você escolhe onde compartilhar.'; }
    } catch { if (!disposed) manualCopy(text); }
    finally { busy = false; copy.disabled = copyInvitation.disabled = false; }
  }
  async function shareLink() {
    if (busy || disposed) return;
    const url = sync(); if (!url) return;
    if (typeof win.navigator.share !== 'function') { options.open = true; status.textContent = 'Escolha copiar o link ou abrir o WhatsApp.'; return; }
    busy = true; share.disabled = true; status.textContent = '';
    try {
      // Called directly in the click's transient activation. No provider request.
      await win.navigator.share({ title: 'VitrineCity', url });
      if (!disposed) status.textContent = 'Opções de compartilhamento abertas no seu aparelho.';
    } catch (error) {
      if (!disposed) {
        status.textContent = error?.name === 'AbortError' ? 'Compartilhamento cancelado.' : 'Não foi possível abrir o compartilhamento. Escolha uma opção abaixo.';
        if (error?.name !== 'AbortError') options.open = true;
      }
    } finally { busy = false; share.disabled = false; }
  }
  function navigate(event) { if (!sync() || disposed) event.preventDefault(); }
  share.addEventListener('click', shareLink); copy.addEventListener('click', () => copyLink());
  copyInvitation.addEventListener('click', () => copyLink({invitation:true}));
  whatsapp.addEventListener('click', navigate); account.addEventListener('click', navigate);
  // A direct click on these nonmodal controls must not be treated as city travel.
  panel.addEventListener('pointerdown', event => event.stopPropagation());
  function dispose() { if (disposed) return; disposed = true; panel.remove(); win.removeEventListener('popstate', sync); win.removeEventListener('pagehide', leave); }
  function leave(event) { if (!event.persisted) dispose(); }
  win.addEventListener('popstate', sync); win.addEventListener('pagehide', leave);
  sync();
  return { panel, share, options, copy, copyInvitation, whatsapp, account, status, input, manual, dispose };
}
