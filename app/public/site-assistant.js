import { classifySiteAssistantPath, siteAssistantContextPath, safeSiteAssistantUrl, siteAssistantDismissed, SITE_ASSISTANT_DISMISS_MS } from './site-assistant-policy.js';

const DISMISS_KEY = 'vc-assistant-dismiss-until-v1';
const PANEL_KEY = 'vc-assistant-panel-until-v1';
const MINIMIZED_KEY = 'vc-assistant-minimized-until-v1';
const PANEL_KEEP_MS = 30 * 60 * 1000;
const SINGLETON = '__vcSiteAssistant';
const COPY = 'Lia · Assistente com IA';
const text = (value, max = 3000) => typeof value === 'string' ? value.slice(0, max) : '';

// Dependency injection also lets the interaction tests run without a network.
export function mountSiteAssistant({ window: win = globalThis.window, document: doc = win?.document, fetch: fetcher = win?.fetch?.bind(win), now = Date.now } = {}) {
  if (!win || !doc || !fetcher) return null;
  const policy = classifySiteAssistantPath(win.location.pathname);
  const contextPath = siteAssistantContextPath(win.location.pathname, win.location.search);
  if (!contextPath || doc.documentElement.hasAttribute('amp') || doc.documentElement.hasAttribute('⚡')) return null;
  if (win[SINGLETON]) return win[SINGLETON];
  if (doc.querySelector('[data-vc-assistant]')) return null;

  const make = (tag, className, content) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (content) node.textContent = content;
    return node;
  };
  const button = (label, className, fn) => {
    const node = make('button', className, label); node.type = 'button';
    node.addEventListener('click', fn); return node;
  };
  const root = make('aside', 'vc-assistant');
  root.dataset.vcAssistant = 'true';
  root.dataset.kind = policy.kind;
  root.setAttribute('aria-label', COPY);
  const launcher = button('Falar com a Lia', 'vc-assistant-launcher', () => open());
  launcher.setAttribute('aria-label', 'Falar com a Lia, assistente com IA da VitrineCity');
  launcher.setAttribute('aria-controls', 'vc-assistant-panel');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.hidden = true;
  const invite = make('section', 'vc-assistant-invite'); invite.hidden = true;
  invite.setAttribute('aria-label', 'Convite do assistente');
  const inviteClose = button('×', 'vc-assistant-close', () => dismiss());
  inviteClose.setAttribute('aria-label', 'Dispensar convite por 24 horas');
  const inviteTitle = make('strong', 'vc-assistant-eyebrow', 'Uma ajuda, no seu tempo');
  const inviteText = make('p', 'vc-assistant-invite-text');
  const inviteOpen = button('Conversar agora', 'vc-assistant-primary', () => open());
  const inviteLater = button('Agora não', 'vc-assistant-quiet', () => dismiss());
  const inviteButtons = make('div', 'vc-assistant-invite-actions'); inviteButtons.append(inviteOpen, inviteLater);
  invite.append(inviteClose, inviteTitle, inviteText, inviteButtons);

  const panel = make('section', 'vc-assistant-panel'); panel.id = 'vc-assistant-panel'; panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'vc-assistant-title');
  const heading = make('header', 'vc-assistant-heading');
  const headingCopy = make('div', 'vc-assistant-heading-copy');
  const title = make('h2', '', 'Como posso ajudar?'); title.id = 'vc-assistant-title';
  headingCopy.append(make('p', 'vc-assistant-eyebrow', COPY), title);
  const panelControls = make('div', 'vc-assistant-window-controls'); panelControls.setAttribute('role', 'group'); panelControls.setAttribute('aria-label', 'Controles da conversa');
  const panelMinimize = button('Minimizar', 'vc-assistant-window-control vc-assistant-minimize', () => minimize());
  panelMinimize.setAttribute('aria-label', 'Minimizar conversa'); panelMinimize.setAttribute('aria-controls', panel.id);
  const panelExpand = button('Ampliar', 'vc-assistant-window-control vc-assistant-expand', () => toggleExpanded());
  panelExpand.setAttribute('aria-label', 'Ampliar conversa'); panelExpand.setAttribute('aria-pressed', 'false'); panelExpand.setAttribute('aria-controls', panel.id);
  const panelClose = button('Fechar', 'vc-assistant-window-control vc-assistant-panel-close', () => close()); panelClose.setAttribute('aria-label', 'Fechar conversa');
  panelControls.append(panelMinimize, panelExpand, panelClose); heading.append(headingCopy, panelControls);
  const scroll = make('div', 'vc-assistant-scroll');
  const intro = make('p', 'vc-assistant-intro');
  const quick = make('div', 'vc-assistant-quick'); quick.setAttribute('aria-label', 'Sugestões para começar');
  const log = make('div', 'vc-assistant-log'); log.setAttribute('role', 'log'); log.setAttribute('aria-live', 'off'); log.setAttribute('aria-relevant', 'additions'); log.setAttribute('aria-label', 'Conversa com o assistente');
  const offers = make('div', 'vc-assistant-offers');
  const actions = make('nav', 'vc-assistant-actions'); actions.setAttribute('aria-label', 'Links úteis');
  const contactBox = make('section', 'vc-assistant-contact'); contactBox.hidden = true;
  const contactTitle = make('h3', '', 'Receber atendimento VIP');
  const contactText = make('p', 'vc-assistant-contact-text');
  const contactForm = make('div', 'vc-assistant-contact-form');
  const contactLabel = make('label', '', 'Seu WhatsApp com DDD');
  const contactInput = make('input'); contactInput.type = 'tel'; contactInput.name = 'phone'; contactInput.inputMode = 'tel'; contactInput.autocomplete = 'tel'; contactInput.required = true; contactInput.maxLength = 20; contactLabel.append(contactInput);
  const contactCheckLabel = make('label', 'vc-assistant-contact-consent');
  const contactCheck = make('input'); contactCheck.type = 'checkbox'; contactCheck.required = true;
  contactCheckLabel.append(contactCheck, make('span', '', 'Autorizo a VitrineCity a guardar meu WhatsApp e enviar somente o convite e os conteúdos/ofertas que eu escolher. Posso cancelar quando quiser.'));
  const contactSubmit = button('Quero receber', 'vc-assistant-primary', () => {}); contactSubmit.type = 'button';
  const contactStatus = make('p', 'vc-assistant-contact-status'); contactStatus.setAttribute('role', 'status');
  contactForm.append(contactLabel, contactCheckLabel, contactSubmit, contactStatus);
  contactBox.append(contactTitle, contactText, contactForm);
  scroll.append(intro, quick, log, offers, contactBox, actions);
  const form = make('form', 'vc-assistant-form');
  const label = make('label', '', 'Como posso ajudar?'); label.htmlFor = 'vc-assistant-message';
  const input = make('textarea'); input.id = 'vc-assistant-message'; input.name = 'message'; input.rows = 2; input.maxLength = 600; input.required = true; input.placeholder = 'Escreva sua dúvida aqui…'; input.autocomplete = 'off';
  const send = make('button', 'vc-assistant-primary', 'Enviar mensagem'); send.type = 'submit';
  const status = make('p', 'vc-assistant-status'); status.setAttribute('role', 'status');
  const privacy = make('p', 'vc-assistant-note', 'Não envie senhas, CPF ou dados de pagamento.');
  form.append(label, input, send, status, privacy); panel.append(heading, scroll, form);
  root.append(launcher, invite, panel); doc.body.append(root);
  if (policy.kind === 'city') {
    const brand = doc.querySelector('.hud .brand');
    if (brand) { brand.append(launcher); launcher.classList.add('vc-assistant-city-launcher'); }
  }

  let context = null, busy = false, disposed = false, timer = null, returnFocus = launcher, shown = false, elapsed = 0, lastTick = now(), wasEligible = false;
  let dismissedUntil = 0;
  try { dismissedUntil = Number(win.localStorage.getItem(DISMISS_KEY)) || 0; } catch {}

  // Only the panel's expiring open/minimized state stays in this tab. Conversation text
  // comes from the server session; it is never copied into browser storage.
  function rememberPanel() {
    try { win.sessionStorage.setItem(PANEL_KEY, String(now() + PANEL_KEEP_MS)); } catch {}
  }
  function forgetPanel() {
    try { win.sessionStorage.removeItem(PANEL_KEY); } catch {}
  }
  function forgetMinimized() {
    try { win.sessionStorage.removeItem(MINIMIZED_KEY); } catch {}
  }
  function uiStateActive(key) {
    try {
      const until = Number(win.sessionStorage.getItem(key));
      return Number.isFinite(until) && until > now() && until <= now() + PANEL_KEEP_MS;
    } catch { return false; }
  }

  async function api(path, body, timeoutMs = 12000) {
    const controller = new AbortController();
    const timeout = win.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher('/api/site-assistant/' + path, {
        method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const data = response.status === 204 ? null : await response.json();
      if (!response.ok) throw new Error('assistant_unavailable');
      return data;
    } finally { win.clearTimeout(timeout); }
  }
  function track(type, offer) {
    if (!context || disposed) return;
    const body = { type };
    if (offer) {
      if (!['product', 'service', 'course', 'affiliate', 'group', 'prayer', 'navigation'].includes(offer.assetType) || !['string', 'number'].includes(typeof offer.assetId)) return;
      body.assetType = offer.assetType; body.assetId = offer.assetId;
    }
    // Analytics is best effort and never retries or gates navigation/chat.
    void api('event', body, 5000).catch(() => {});
  }
  function stopTimer() { if (timer !== null) win.clearInterval(timer); timer = null; }
  function silence() {
    dismissedUntil = now() + SITE_ASSISTANT_DISMISS_MS;
    try { win.localStorage.setItem(DISMISS_KEY, String(dismissedUntil)); } catch {}
    invite.hidden = true; stopTimer();
  }
  function dismiss() {
    const hadFocus = invite.contains(doc.activeElement);
    silence(); track('dismiss');
    if (hadFocus) launcher.focus({ preventScroll: true });
  }
  function open({ restore = false } = {}) {
    if (disposed || !context) return;
    forgetMinimized();
    if (!panel.hidden) { if (!restore) input.focus({ preventScroll: true }); return; }
    returnFocus = doc.activeElement?.isConnected ? doc.activeElement : launcher;
    if (invite.contains(returnFocus)) returnFocus = launcher;
    invite.hidden = true; shown = true; stopTimer();
    panel.hidden = false; launcher.setAttribute('aria-expanded', 'true'); log.setAttribute('aria-live', restore ? 'off' : 'polite'); rememberPanel();
    win.dispatchEvent(new win.CustomEvent('vitriny:assistant-open'));
    if (!restore) { track('open'); input.focus({ preventScroll: true }); }
  }
  function minimize() {
    if (disposed || !context || panel.hidden) return;
    const hadFocus = panel.contains(doc.activeElement);
    forgetPanel();
    try { win.sessionStorage.setItem(MINIMIZED_KEY, String(now() + PANEL_KEEP_MS)); } catch {}
    panel.hidden = true; invite.hidden = true; shown = true; stopTimer();
    launcher.setAttribute('aria-expanded', 'false'); launcher.textContent = 'Continuar conversa';
    launcher.setAttribute('aria-label', 'Continuar conversa com a Lia'); log.setAttribute('aria-live', 'off');
    if (hadFocus) launcher.focus({ preventScroll: true });
  }
  function toggleExpanded() {
    if (disposed || !context || panel.hidden) return;
    const expanded = panel.dataset.expanded !== 'true';
    panel.dataset.expanded = String(expanded);
    panelExpand.textContent = expanded ? 'Restaurar' : 'Ampliar';
    panelExpand.setAttribute('aria-label', expanded ? 'Restaurar tamanho' : 'Ampliar conversa');
    panelExpand.setAttribute('aria-pressed', String(expanded));
  }
  function close() {
    forgetPanel(); forgetMinimized();
    if (panel.hidden) return;
    panel.hidden = true; launcher.setAttribute('aria-expanded', 'false'); log.setAttribute('aria-live', 'off'); silence();
    track('dismiss');
    (returnFocus?.isConnected ? returnFocus : launcher).focus({ preventScroll: true });
  }
  function blockedByActivity() {
    if (doc.hidden || doc.querySelector('dialog[open], [aria-modal="true"], #checkout.open, #cart.open, [data-checkout-open="true"], [data-city-chat] details[open]')) return true;
    const active = doc.activeElement;
    if (active && !root.contains(active) && active.matches?.('input, textarea, select, [contenteditable="true"]')) return true;
    if (policy.kind === 'city' && doc.documentElement.dataset.cityGuideReady !== 'true') return true;
    return false;
  }
  function tick() {
    const current = now(); const eligible = !blockedByActivity();
    if (eligible && wasEligible) elapsed += Math.min(1500, Math.max(0, current - lastTick));
    lastTick = current; wasEligible = eligible;
    if (disposed || !policy.proactive || siteAssistantDismissed(dismissedUntil, current)) { invite.hidden = true; stopTimer(); return; }
    if (shown) { invite.hidden = !eligible || !panel.hidden; return; }
    if (elapsed < 10000 || !eligible || !panel.hidden) return;
    shown = true; invite.hidden = false; track('invitation');
  }
  function messageBubble(role, body) {
    const row = make('div', 'vc-assistant-message vc-assistant-message-' + role);
    row.append(make('strong', '', role === 'user' ? 'Você' : 'Lia'), make('p', '', text(body)));
    log.append(row);
    while (log.children.length > 20) log.firstElementChild.remove();
    scroll.scrollTop = scroll.scrollHeight;
  }
  function link(label, rawUrl, className, offer) {
    const url = safeSiteAssistantUrl(rawUrl, win.location.origin);
    if (!url) return null;
    const node = make('a', className, label); node.href = url;
    if (new URL(url).origin !== win.location.origin) { node.target = '_blank'; node.rel = 'noopener noreferrer'; node.setAttribute('aria-label', label + ' (abre em nova aba)'); }
    if (offer) node.addEventListener('click', () => track('offer_click', offer));
    return node;
  }
  function renderOffers(list) {
    offers.replaceChildren();
    if (!policy.commercial) return;
    for (const offer of (Array.isArray(list) ? list : []).slice(0, 3)) {
      if (!offer || !text(offer.title, 160)) continue;
      const cta = link('Conhecer ' + text(offer.title, 160), offer.url, 'vc-assistant-offer-link', offer);
      if (!cta) continue;
      const card = make('article', 'vc-assistant-offer');
      const imageUrl = safeSiteAssistantUrl(offer.imageUrl, win.location.origin, { image: true });
      if (imageUrl) { const image = make('img'); image.src = imageUrl; image.alt = ''; image.loading = 'lazy'; image.width = 84; image.height = 84; image.referrerPolicy = 'no-referrer'; image.addEventListener('error', () => image.remove(), { once: true }); card.append(image); }
      const copy = make('div'); copy.append(make('h3', '', text(offer.title, 160)));
      if (offer.description) copy.append(make('p', '', text(offer.description, 350)));
      if (offer.kind === 'affiliate' || offer.assetType === 'affiliate') copy.append(make('p', 'vc-assistant-disclosure', 'Link de afiliado: a VitrineCity pode receber uma comissão.'));
      copy.append(cta); card.append(copy); offers.append(card);
    }
  }
  function renderActions(list) {
    actions.replaceChildren();
    for (const action of (Array.isArray(list) ? list : []).slice(0, 4)) {
      if (!action || !text(action.label, 120)) continue;
      if (policy.kind === 'course_checkout') {
        const safe = safeSiteAssistantUrl(action.url, win.location.origin);
        if (!safe) continue;
        const target = new URL(safe);
        // Reloading this checkout would discard fields the visitor is filling.
        if (target.origin === win.location.origin && target.pathname === '/course-checkout.html' && siteAssistantContextPath(target.pathname, target.search) === contextPath) continue;
      }
      if (!policy.commercial) {
        const safe = safeSiteAssistantUrl(action.url, win.location.origin);
        if (!safe) continue;
        const target = new URL(safe);
        if (!(target.origin === win.location.origin && ['/oracao-do-dia', '/oracao-do-dia.html', '/contato', '/contato.html'].includes(target.pathname)) && target.hostname !== 'chat.whatsapp.com') continue;
      }
      const node = link(text(action.label, 120), action.url, 'vc-assistant-action', action.assetType ? action : null);
      if (node) actions.append(node);
    }
  }
  let contactOfferState = null;
  function renderContact(offer) {
    if (offer && typeof offer === 'object' && ['group_invite', 'offers', 'group_and_offers'].includes(offer.purpose)) {
      contactOfferState = { purpose: offer.purpose, groupId: text(offer.groupId, 160), topic: text(offer.topic, 80) };
      contactText.textContent = text(offer.text, 500) || 'Se quiser, posso enviar conteúdos relacionados pelo WhatsApp. Você decide o que deseja receber.';
      contactBox.hidden = false; contactStatus.textContent = ''; contactSubmit.disabled = false;
      return;
    }
    if (!contactOfferState) contactBox.hidden = true;
  }
  async function revokeContact() {
    contactStatus.textContent = 'Atualizando sua preferência…';
    try { const data = await api('contact/revoke', {}, 12000); contactStatus.textContent = text(data.message, 300) || 'Preferência atualizada.'; contactOfferState = null; contactForm.hidden = true; }
    catch { contactStatus.textContent = 'Não consegui atualizar agora. Tente novamente em instantes.'; }
  }
  contactSubmit.addEventListener('click', async event => {
    event.preventDefault();
    if (busy || !contactOfferState || !contactInput.value.trim() || !contactCheck.checked) return;
    contactSubmit.disabled = true; contactStatus.textContent = 'Registrando seu consentimento…';
    try {
      const data = await api('contact', { phone: contactInput.value.trim(), consent: true, purpose: contactOfferState.purpose, groupId: contactOfferState.groupId, contextPath }, 15000);
      contactInput.value = ''; contactCheck.checked = false; contactForm.hidden = true;
      contactStatus.textContent = text(data.message, 500) || 'Seu atendimento VIP foi registrado.';
      if (data.group?.url) {
        const join = link('Abrir convite do grupo', data.group.url, 'vc-assistant-action');
        if (join) { join.target = '_blank'; join.rel = 'noopener noreferrer'; contactBox.append(join); }
      }
      const revoke = button('Não quero mais receber', 'vc-assistant-quiet', () => { void revokeContact(); });
      contactBox.append(revoke); contactOfferState = null;
    } catch (error) {
      contactStatus.textContent = error?.message === 'assistant_unavailable' ? 'Não consegui registrar agora. Confira o número e tente novamente.' : 'Não consegui registrar agora. Confira o número e tente novamente.';
      contactSubmit.disabled = false;
    }
  });
  async function submit(message) {
    const value = text(message, 600).trim();
    if (disposed || busy || !context || !value) return;
    busy = true; send.disabled = true; quick.querySelectorAll('button').forEach(node => { node.disabled = true; });
    intro.hidden = true; quick.hidden = true; log.setAttribute('aria-live', 'polite');
    if (!panel.hidden) rememberPanel();
    status.textContent = 'Preparando sua resposta…'; panel.setAttribute('aria-busy', 'true');
    messageBubble('user', value); input.value = '';
    try {
      const data = await api('chat', { message: value, contextPath }, 65000);
      if (disposed) return;
      if (!text(data.reply).trim()) throw new Error('assistant_invalid_reply');
      messageBubble('assistant', data.reply); renderOffers(data.offers); renderActions(data.actions); renderContact(data.contactOffer);
      quick.hidden = true; status.textContent = '';
    } catch {
      if (!disposed) { input.value = value; status.textContent = 'Não consegui confirmar a resposta. Sua mensagem ficou no campo; se quiser, envie novamente.'; }
    } finally {
      busy = false; send.disabled = false; quick.querySelectorAll('button').forEach(node => { node.disabled = false; }); panel.removeAttribute('aria-busy');
    }
  }
  form.addEventListener('submit', event => { event.preventDefault(); void submit(input.value); });
  // Stop the city movement shortcuts only while interacting with this panel.
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } event.stopPropagation(); });
  invite.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); dismiss(); } event.stopPropagation(); });
  const onVisibility = () => { lastTick = now(); wasEligible = false; if (doc.hidden) invite.hidden = true; else if (context && policy.proactive && timer !== null) tick(); };
  doc.addEventListener('visibilitychange', onVisibility);
  const onStorage = event => { if (event.key === DISMISS_KEY) { dismissedUntil = Number(event.newValue) || 0; if (siteAssistantDismissed(dismissedUntil, now())) { invite.hidden = true; stopTimer(); } } };
  win.addEventListener('storage', onStorage);
  const onPageHide = () => { invite.hidden = true; if (!panel.hidden) rememberPanel(); };
  win.addEventListener('pagehide', onPageHide);
  const controller = { open, close, minimize, toggleExpanded, dismiss, root, launcher, destroy() {
    disposed = true; stopTimer(); root.remove(); launcher.remove();
    doc.removeEventListener('visibilitychange', onVisibility); win.removeEventListener('storage', onStorage); win.removeEventListener('pagehide', onPageHide);
    delete win[SINGLETON];
  } };
  win[SINGLETON] = controller;
  controller.ready = api('context?path=' + encodeURIComponent(contextPath)).then(data => {
    if (disposed) return;
    if (!data?.enabled || !data.context || data.context.path !== contextPath) { controller.destroy(); return; }
    context = data.context;
    // Personalization belongs to the backend; never derive a name from the DOM.
    const history = (Array.isArray(data.history) ? data.history : []).filter(item =>
      item && ['user', 'assistant'].includes(item.role) && text(item.content).trim()).slice(-8);
    if (history.length) {
      for (const item of history) messageBubble(item.role, item.content);
      intro.hidden = true; quick.hidden = true;
      inviteTitle.textContent = 'Sua conversa continua aqui';
      inviteText.textContent = 'Podemos continuar de onde paramos. Como posso ajudar agora?';
      inviteOpen.textContent = 'Continuar conversa'; launcher.textContent = 'Continuar conversa';
      launcher.setAttribute('aria-label', 'Continuar conversa com a Lia');
    } else {
      forgetPanel();
      const greeting = text(data.greeting, 700) || 'Oi! Eu sou a Lia 😊 Estou aqui para ajudar você. O que está procurando?';
      intro.textContent = greeting; inviteText.textContent = greeting;
      for (const item of (Array.isArray(data.quickActions) ? data.quickActions : []).slice(0, 3)) {
        if (text(item?.label, 100) && text(item?.message, 1200)) quick.append(button(text(item.label, 100), 'vc-assistant-suggestion', () => { input.value = text(item.message, 1200); input.focus({ preventScroll: true }); }));
      }
    }
    renderOffers(data.offers); renderActions(data.actions); launcher.hidden = false;
    if (uiStateActive(MINIMIZED_KEY)) {
      forgetPanel(); shown = true; invite.hidden = true;
      launcher.textContent = 'Continuar conversa'; launcher.setAttribute('aria-label', 'Continuar conversa com a Lia');
    } else if (policy.kind !== 'course_checkout' && history.length && uiStateActive(PANEL_KEY)) open({ restore: true });
    else {
      forgetPanel(); forgetMinimized();
      if (policy.proactive && !siteAssistantDismissed(dismissedUntil, now())) { lastTick = now(); wasEligible = !blockedByActivity(); timer = win.setInterval(tick, 1000); }
    }
  }).catch(() => { controller.destroy(); });
  return controller;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') mountSiteAssistant();
