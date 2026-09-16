import { siteAssistantContextPath, siteAssistantEmbeddedPath, safeSiteAssistantContentUrl } from './site-assistant-policy.js';
import { safeCoursePaymentUrl } from './course-checkout.js';

// Public first-party pages and the designated customer forms enter the viewer.
// Other allowed destinations remain explicit links outside the conversation.
export function siteAssistantDestination(value, origin) {
  const safe = safeSiteAssistantContentUrl(value, origin);
  if (!safe) return null;
  const url = new URL(safe);
  const contextPath = url.origin === origin ? siteAssistantContextPath(url.pathname, url.search) : '';
  if (url.origin === origin && siteAssistantEmbeddedPath(url.pathname)) {
    if (url.pathname === '/course-checkout.html' && !contextPath) return null;
    url.searchParams.set('lia', '1');
    return { kind: 'embedded', url: url.href, contextPath };
  }
  return { kind: 'external', url: safe, payment: Boolean(safeCoursePaymentUrl(safe)), partner: url.origin !== origin || /^\/ir\//.test(url.pathname) };
}

export function createSiteAssistantContent({ window: win, document: doc, onContext = () => {}, onView = () => {} }) {
  const make = (tag, className, label = '') => {
    const node = doc.createElement(tag); node.className = className; node.textContent = label; return node;
  };
  const button = (label, className, action) => {
    const node = make('button', className, label); node.type = 'button'; node.addEventListener('click', action); return node;
  };
  const root = make('section', 'vc-assistant-content'); root.hidden = true;
  root.setAttribute('aria-label', 'Conteúdo aberto na conversa');
  const back = button('Voltar à conversa', 'vc-assistant-content-back', () => showConversation());
  const resume = button('Continuar conteúdo', 'vc-assistant-content-resume', () => show()); resume.hidden = true;
  const toolbar = make('div', 'vc-assistant-content-toolbar'); toolbar.append(back);
  const status = make('p', 'vc-assistant-content-status'); status.setAttribute('role', 'status');
  const confirmation = make('div', 'vc-assistant-content-confirm'); confirmation.hidden = true;
  confirmation.setAttribute('role', 'group'); confirmation.setAttribute('aria-label', 'Confirmar troca de conteúdo');
  const confirmText = make('p', '', 'Abrir outro conteúdo? Os dados preenchidos no conteúdo atual podem ser perdidos.');
  const keep = button('Continuar aqui', 'vc-assistant-content-keep', () => { pending = null; confirmation.hidden = true; });
  const replace = button('Abrir outro conteúdo', 'vc-assistant-content-replace', () => { if (pending) load(pending); });
  confirmation.append(confirmText, keep, replace);
  const external = make('div', 'vc-assistant-content-external'); external.hidden = true;
  const frame = make('iframe', 'vc-assistant-content-frame'); frame.hidden = true;
  frame.title = 'Conteúdo na conversa com a Lia'; frame.referrerPolicy = 'same-origin';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
  root.append(toolbar, status, confirmation, external, frame);
  let current = null, pending = null, destroyed = false;
  function show() { root.hidden = false; resume.hidden = true; onView(true); }
  function showConversation() { root.hidden = true; resume.hidden = !current && external.hidden; onView(false); }
  function load(target) {
    pending = null; confirmation.hidden = true; external.hidden = true;
    current = target; frame.src = target.url; frame.hidden = false;
    status.textContent = 'Abrindo conteúdo…'; show();
  }
  function presentExternal(target) {
    const note = target.payment ? 'O pagamento continua no Mercado Pago. Sua conversa e o conteúdo ficam abertos aqui.'
      : target.partner ? 'A compra ou o acesso continua no site parceiro, em outra aba. Sua conversa fica aberta aqui.'
      : 'Esta etapa abre em outra aba. Sua conversa e o conteúdo ficam abertos aqui.';
    const link = make('a', 'vc-assistant-content-external-link', target.payment ? 'Continuar pagamento' : target.partner ? 'Continuar no site parceiro' : 'Abrir em outra aba');
    link.href = target.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', link.textContent + ' (abre em nova aba)');
    external.replaceChildren(make('p', '', note), link); external.hidden = false; status.textContent = ''; show();
  }
  function open(value) {
    if (destroyed) return false;
    const target = siteAssistantDestination(value, win.location.origin);
    if (!target) return false;
    if (target.kind === 'external') { presentExternal(target); return true; }
    if (current?.url === target.url) { pending = null; confirmation.hidden = true; show(); return true; }
    if (current) { pending = target; confirmation.hidden = false; show(); return true; }
    load(target); return true;
  }
  const onMessage = event => {
    if (destroyed || event.origin !== win.location.origin || !frame.contentWindow || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || data.type !== 'vc-lia-viewer' || !['ready', 'navigate', 'external'].includes(data.action)) return;
    const target = siteAssistantDestination(data.url, win.location.origin);
    if (!target) {
      if (data.action !== 'ready') status.textContent = 'Não consegui abrir este link aqui. Volte à conversa e me conte o que deseja fazer.';
      return;
    }
    if (data.action === 'external') { if (target.kind === 'external') presentExternal(target); return; }
    if (target.kind !== 'embedded') return;
    if (data.action === 'navigate') {
      // The visitor already selected a link or purchase step in the document.
      // Confirmation is reserved for replacing it with a different chat result.
      if (current?.url === target.url) show(); else load(target);
      return;
    }
    // A ready message is accepted only for the requested public document. The
    // payload contributes no form data, title, visitor name or transcript.
    if (current?.url !== target.url) return;
    status.textContent = ''; if (target.contextPath) onContext(target.contextPath);
  };
  win.addEventListener('message', onMessage);
  return { root, resume, frame, open, showConversation, get hasContent() { return Boolean(current); }, destroy() { destroyed = true; win.removeEventListener('message', onMessage); root.remove(); resume.remove(); } };
}
