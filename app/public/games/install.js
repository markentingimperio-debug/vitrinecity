export const GAMES_INSTALL_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
export const GAMES_INSTALL_DISMISS_KEY = 'vcgames-install-dismissed-v1';
const APP_PATHS = new Set(['/games/', '/games/blocos', '/games/jardim', '/games/fazenda', '/games/plantas']);
const ORIGINAL_PATHS = new Set(['/jogos', '/vitriny-games', '/vitriny-blocks', '/vitriny-merge', '/vitriny-mini-fazenda', '/mini-fazenda']);

export function gamesInstallContext(pathname) {
  if (APP_PATHS.has(pathname)) return 'app';
  const path = String(pathname || '').replace(/\/$/, '').replace(/\.html$/, '');
  return ORIGINAL_PATHS.has(path) ? 'original' : null;
}

export function gamesInstallDismissed(value, now = Date.now()) {
  const time = Number(value);
  return Number.isFinite(time) && time > 0 && time <= now && now - time < GAMES_INSTALL_DISMISS_MS;
}

// This invitation only handles installation UI. The dedicated Games app owns its
// manifest and service worker; a visit, game action or prompt event never installs.
export function mountGamesInstall({ document: doc = globalThis.document, window: win = globalThis.window,
  now = () => Date.now(), delayMs = 15000 } = {}) {
  if (!doc?.body || !win || !gamesInstallContext(win.location?.pathname)) return null;
  try { if (win.top !== win.self) return null; } catch { return null; }
  if (doc.getElementById('vcgames-install')) return null;
  const context = gamesInstallContext(win.location.pathname);
  const display = win.matchMedia?.('(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)');
  const standalone = () => display?.matches || win.navigator?.standalone === true;
  if (standalone()) return null;
  const explicit = context === 'app' && new URLSearchParams(win.location.search || '').get('install') === '1';
  let dismissed = false;
  try { dismissed = gamesInstallDismissed(win.localStorage.getItem(GAMES_INSTALL_DISMISS_KEY), now()); } catch { /* Private mode still allows playing and dismissal in this page. */ }
  let used = false, elapsed = false, promptEvent = null, busy = false, finished = false, disposed = false;
  let eligible = !dismissed || explicit;
  const listeners = [];
  function listen(target, type, callback, options) {
    target?.addEventListener(type, callback, options);
    listeners.push(() => target?.removeEventListener(type, callback, options));
  }
  function el(tag, className, text) {
    const node = doc.createElement(tag); node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  const panel = el('aside', 'vcgames-install'); panel.id = 'vcgames-install'; panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'vcgames-install-title');
  const copy = el('div', 'vcgames-install-copy');
  const title = el('h2', 'vcgames-install-title', 'Instalar VitrineCity Cultiva'); title.id = 'vcgames-install-title';
  const text = el('p', 'vcgames-install-description', 'Jogos e cuidados com suas plantas, com um atalho na tela inicial. Você também pode continuar pelo site.');
  copy.append(title, text);
  const controls = el('div', 'vcgames-install-controls');
  const action = el(context === 'app' ? 'button' : 'a', 'vcgames-install-action');
  if (context === 'app') action.type = 'button';
  else action.href = '/games/?install=1';
  const close = el('button', 'vcgames-install-dismiss', 'Agora não'); close.type = 'button';
  close.setAttribute('aria-label', 'Dispensar convite de instalação por 7 dias');
  controls.append(action, close);
  const help = el('p', 'vcgames-install-help'); help.id = 'vcgames-install-help'; help.hidden = true;
  help.setAttribute('role', 'status'); help.setAttribute('aria-live', 'polite');
  panel.append(copy, controls, help);
  const main = doc.querySelector('main');
  if (main) main.insertAdjacentElement('afterend', panel); else doc.body.append(panel);
  function render() {
    panel.hidden = disposed || finished || !eligible || standalone() || doc.hidden || !(explicit || (used && elapsed));
    action.textContent = context === 'original' || promptEvent ? 'Instalar VitrineCity Cultiva' : 'Como instalar';
    if (context === 'app') {
      action.disabled = busy;
      action.setAttribute('aria-expanded', String(!help.hidden));
      action.setAttribute('aria-controls', help.id);
    }
  }
  function rememberDismissal() {
    try { win.localStorage.setItem(GAMES_INSTALL_DISMISS_KEY, String(now())); } catch { /* No storage is required to dismiss. */ }
  }
  function dismiss() { eligible = false; promptEvent = null; rememberDismissal(); render(); }
  function showHelp(prefix = '') {
    help.textContent = prefix + 'No menu do navegador, procure “Instalar aplicativo” ou “Adicionar à tela inicial”, se disponível. No iPhone ou iPad, use Compartilhar → Adicionar à Tela de Início. Se a opção não aparecer, continue jogando pelo site.';
    help.hidden = false; render();
  }
  async function install() {
    if (busy || disposed || finished || !eligible) return;
    if (!promptEvent) { showHelp(); return; }
    const event = promptEvent; promptEvent = null; busy = true; render();
    try {
      // Must be called synchronously from this explicit click, before any await.
      const result = await event.prompt();
      const choice = event.userChoice ? await event.userChoice : result;
      if (disposed || finished) return;
      if (choice?.outcome === 'accepted') { finished = true; rememberDismissal(); }
      else if (choice?.outcome === 'dismissed') dismiss();
      else showHelp('A instalação não foi confirmada. ');
    } catch { if (!disposed && !finished) showHelp('Não foi possível abrir a instalação. '); }
    finally { busy = false; if (!disposed) render(); }
  }
  function beforeInstall(event) {
    if (context !== 'app' || typeof event.prompt !== 'function') return;
    event.preventDefault();
    if (!finished && !disposed && eligible && !standalone()) promptEvent = event;
    render();
  }
  function installed() { finished = true; promptEvent = null; rememberDismissal(); render(); }
  function activity(event) {
    if (used || panel.contains(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    used = true; render();
  }
  listen(close, 'click', dismiss);
  if (context === 'app') listen(action, 'click', install);
  listen(win, 'beforeinstallprompt', beforeInstall);
  if (context === 'app') listen(win, 'appinstalled', installed);
  listen(display, 'change', render);
  listen(doc, 'visibilitychange', render);
  listen(doc, 'pointerdown', activity, { passive: true });
  listen(doc, 'keydown', activity);
  listen(win, 'storage', event => {
    if (event.key !== GAMES_INSTALL_DISMISS_KEY) return;
    if (gamesInstallDismissed(event.newValue, now())) { eligible = false; promptEvent = null; render(); }
  });
  const timer = win.setTimeout(() => { elapsed = true; render(); }, Math.max(0, delayMs));
  function dispose() {
    if (disposed) return;
    disposed = true; promptEvent = null; win.clearTimeout(timer);
    for (const remove of listeners) remove();
    panel.remove();
  }
  listen(win, 'pagehide', event => { if (!event.persisted) dispose(); });
  render();
  return { panel, action, close, help, dispose };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') mountGamesInstall();
