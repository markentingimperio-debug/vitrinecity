import { CHAT_MESSAGE_STATES, CHAT_QUEUE_LANES, isChatActive, assertChatReceipt, assertChatQueueStatus } from './neural-chat-contract.js';

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const TEXT_MIMES = { txt: 'text/plain', md: 'text/markdown', csv: 'text/csv' };
const MESSAGE_STATES = new Set(CHAT_MESSAGE_STATES);
export function validateNeuralAttachment(file) {
  const extension = String(file?.name || '').split('.').pop().toLowerCase();
  const mimeType = IMAGE_MIMES.has(file?.type) ? file.type : TEXT_MIMES[extension];
  const isImage = IMAGE_MIMES.has(mimeType);
  if (!mimeType || (isImage && !['png', 'jpg', 'jpeg', 'webp'].includes(extension))) throw new Error('attachment_type');
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > (isImage ? 2097152 : 65536)) throw new Error('attachment_size');
  return { mimeType, kind: isImage ? 'image' : 'text' };
}
export function mountNeuralWorkspace(environment = globalThis) {
  const { document, window, location, URLSearchParams, URL, Blob, AbortController, crypto, FileReader } = environment;
  const fetch = environment.fetch.bind(environment);
  const setTimeout = environment.setTimeout.bind(environment), clearTimeout = environment.clearTimeout.bind(environment);
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search), storeReference = params.get('store') || '';
  const base = storeReference ? '/api/store-portal/' + encodeURIComponent(storeReference) + '/neural/chat' : '/api/admin/vitriny-neural/chat';
  const state = { token: '', status: null, conversations: [], selected: null, messages: [], attachments: [], busy: false, loading: false, historyUnverified: false, epoch: 0, selectionEpoch: 0, timer: null, pollFailures: 0, activeConversation: null, activeRequest: null, activeStatus: null, pending: null, uncertain: false, retryAllowed: false };
  const requests = new Set(), previewCache = new Map(), downloadUrls = new Set();
  const errorText = {
    attachment_type: 'Formato não aceito. Use PNG, JPEG, WebP, TXT, MD ou CSV. PDF e DOCX ainda não são suportados.',
    attachment_size: 'Arquivo vazio ou muito grande. Imagens: até 2 MB; documentos de texto: até 64 KB.',
    attachment_count: 'Você pode enviar até três arquivos por mensagem.',
    attachment_read: 'Não foi possível ler este arquivo. Remova-o e selecione novamente.',
    unavailable: 'Não foi possível acessar o chat. Seu texto foi preservado. Tente conferir novamente em instantes.',
    unauthorized: 'Entre novamente para acessar seu histórico privado.',
    forbidden: 'Este acesso não tem permissão para usar o chat.',
    mfa: 'Conclua a verificação de segundo fator no portal da loja e conecte novamente.',
    quota: 'O limite deste acesso foi atingido. O histórico continua disponível.',
    disabled: 'O chat não está habilitado para este acesso.',
    invalid: 'O pedido não foi aceito. Revise a mensagem e os arquivos.',
    notFound: 'O registro ainda não foi encontrado. Não houve reenvio automático.',
    conflict: 'Existe um pedido em andamento ou o estado mudou. Confira o histórico antes de continuar.',
    timeout: 'A conexão demorou mais que o esperado. O pedido pode já ter sido recebido.',
    invalidResponse: 'Não foi possível confirmar a resposta do servidor. Confira o registro antes de continuar.'
  };
  function failure(key, status) { return Object.assign(new Error(key), { key, status }); }
  function node(tag, text, className) { const element = document.createElement(tag); if (text != null) element.textContent = String(text); if (className) element.className = className; return element; }
  function announce(text) { $('announcement').textContent = text; }
  function clearError() { $('error').textContent = ''; $('error').hidden = true; }
  function showError(error) {
    if (error?.key === 'stale') return;
    $('error').textContent = errorText[error?.key || error?.message] || errorText.unavailable;
    $('error').hidden = false;
    if (error?.status === 401 && !storeReference) $('admin-login').hidden = false;
  }
  async function api(path, method = 'GET', body, binary = false) {
    const epoch = state.epoch, controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30000);
    requests.add(controller);
    try {
      const headers = { Accept: binary ? 'application/octet-stream' : 'application/json' };
      if (storeReference && state.token) headers['x-store-token'] = state.token;
      if (method !== 'GET') { headers['content-type'] = 'application/json'; headers['x-neural-request'] = '1'; }
      const response = await fetch(base + path, { method, headers, credentials: 'same-origin', cache: 'no-store', signal: controller.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (epoch !== state.epoch) throw failure('stale');
      if (!response.ok) {
        const key = ({ 400: 'invalid', 401: 'unauthorized', 402: 'quota', 403: 'forbidden', 404: 'notFound', 409: 'conflict', 413: 'attachment_size', 415: 'attachment_type', 422: 'invalid', 428: 'mfa', 429: 'quota', 503: 'disabled' })[response.status] || 'unavailable';
        throw failure(key, response.status);
      }
      const data = binary ? await response.blob() : await response.json().catch(() => { throw failure('invalidResponse'); });
      if (epoch !== state.epoch) throw failure('stale');
      if (!binary && (!data || data.ok !== true)) throw failure('invalidResponse');
      return data;
    } catch (error) { if (epoch !== state.epoch) throw failure('stale'); if (error?.name === 'AbortError') throw failure('timeout'); throw error; }
    finally { clearTimeout(timeout); requests.delete(controller); }
  }
  const canSend = () => !!state.status?.enabled && (!storeReference || !!state.token) && !state.loading && !state.busy && !state.historyUnverified && !state.status?.queue?.requiresReview && !state.activeRequest && !state.uncertain;
  function controls() {
    $('send').disabled = !canSend() || !$('command').value.trim();
    $('attach').disabled = !canSend() || state.attachments.length >= 3;
    $('command').disabled = state.busy || state.uncertain;
    $('send').textContent = state.busy ? '…' : '↑';
    $('command-form').setAttribute('aria-busy', String(state.busy));
    $('refresh').disabled = state.loading || state.busy || (!!storeReference && !state.token);
    $('new-conversation').disabled = state.busy || state.uncertain || state.historyUnverified || !!state.activeRequest || !!state.status?.queue?.requiresReview;
    $('connect').disabled = state.loading || state.busy;
    $('recover-request').disabled = state.busy;
    $('recovery').hidden = !state.uncertain;
    $('retry-request').hidden = !state.uncertain || !state.retryAllowed;
    $('retry-note').hidden = !state.uncertain || !state.retryAllowed;
    $('retry-request').disabled = state.busy;
    $('cancel-request').hidden = !state.activeRequest;
    $('cancel-request').disabled = state.busy;
    $('cancel-request').textContent = state.activeStatus === 'queued' ? 'Cancelar pedido' : 'Parar';
    for (const button of document.querySelectorAll('[data-example]')) button.disabled = state.busy || state.uncertain;
  }
  function setHistoryOpen(open, restoreFocus = false) {
    $('history-panel').classList.toggle('is-open', open);
    $('history-toggle').setAttribute('aria-expanded', String(open));
    $('history-toggle').setAttribute('aria-label', open ? 'Ocultar conversas' : 'Mostrar conversas');
    if (restoreFocus) $('history-toggle').focus();
  }
  function renderStatus() {
    const preparing = state.status?.enabled === true && state.status.capabilities?.text === false;
    $('service-status').textContent = state.status ? (state.status.enabled ? (preparing ? 'Histórico conectado · respostas ainda indisponíveis' : 'Chat conectado') : 'Chat não habilitado') : (storeReference ? 'Conecte sua loja para conversar' : 'Disponibilidade não confirmada');
    $('mode-label').textContent = state.status?.enabled ? (preparing ? 'Em preparação' : 'Conectado') : 'Chat';
    $('capability-notice').hidden = !preparing;
    $('queue-review-notice').textContent = state.status?.queue?.requiresReview ? 'Há um pedido interrompido aguardando conferência. Não reenvie para evitar duplicação. Novos envios estão pausados até a confirmação do estado anterior.' : '';
    $('queue-review-notice').hidden = !state.status?.queue?.requiresReview;
    $('billing-status').textContent = state.status?.paidGenerationEnabled === true ? 'Consulte seu saldo e os limites de Créditos IA.' : 'Gerações pagas não estão ativas neste chat.';
    controls();
  }
  function renderHistory() {
    $('conversation-list').replaceChildren();
    $('history-empty').hidden = state.conversations.length > 0;
    for (const conversation of state.conversations) {
      const li = node('li'), button = node('button'); button.type = 'button';
      button.setAttribute('aria-current', String(state.selected === conversation.id));
      button.append(node('span', conversation.title || 'Conversa', 'conversation-label'));
      button.disabled = state.busy;
      button.addEventListener('click', () => { selectConversation(conversation.id); setHistoryOpen(false); });
      li.append(button); $('conversation-list').append(li);
    }
  }
  function scrollLatest(force = false) {
    const scroller = $('conversation-scroll');
    if (force || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 180) scroller.scrollTop = scroller.scrollHeight;
  }
  async function attachmentPreview(attachment, image) {
    if (previewCache.has(attachment.id)) { const cached = previewCache.get(attachment.id); if (cached) image.src = cached; else image.hidden = true; return; }
    previewCache.set(attachment.id, null);
    try {
      const blob = await api('/attachments/' + encodeURIComponent(attachment.id), 'GET', undefined, true);
      if (!IMAGE_MIMES.has(blob.type)) { image.hidden = true; return; }
      const url = URL.createObjectURL(blob); previewCache.set(attachment.id, url); image.src = url;
    } catch { image.hidden = true; }
  }
  async function downloadAttachment(attachment, button) {
    button.disabled = true;
    try {
      const blob = await api('/attachments/' + encodeURIComponent(attachment.id), 'GET', undefined, true);
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' })), link = node('a');
      downloadUrls.add(url); link.href = url; link.download = String(attachment.name || 'arquivo').replace(/[\\/\x00-\x1f]/g, '_');
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); }, 1000);
    } catch (error) { showError(error); } finally { button.disabled = false; }
  }
  function renderMessages(forceScroll = false) {
    const conversation = state.conversations.find(item => item.id === state.selected);
    $('conversation-title').textContent = conversation?.title || 'Lia';
    $('welcome').hidden = !!state.messages.length;
    const list = $('messages'); list.replaceChildren();
    for (const message of state.messages) {
      const li = node('li', null, 'message ' + (message.role === 'user' ? 'user-message' : 'assistant-message'));
      li.append(node('p', message.role === 'user' ? 'Você' : 'Lia', 'message-label'));
      li.append(node('p', message.text || ({ queued: 'Pedido recebido. Aguardando sua vez na fila.', running: 'Preparando sua resposta…' })[message.status] || '', 'message-content'));
      if (isChatActive(message.status)) li.setAttribute('aria-busy', 'true');
      const queuePosition = message.queue && CHAT_QUEUE_LANES.includes(message.queue.lane) && Number.isSafeInteger(message.queue.position) && message.queue.position >= 1 ? message.queue.position : null;
      const labels = { queued: 'Na fila' + (queuePosition === null ? '' : ' · posição ' + queuePosition), running: 'Em andamento', unavailable: 'Recurso ainda indisponível · nenhuma geração realizada', failed: 'Não concluído', cancelled: 'Cancelado', interrupted: 'Interrompido · confira antes de pedir novamente' };
      if (labels[message.status] && message.role !== 'user') li.append(node('p', labels[message.status], 'message-state'));
      if (message.attachments?.length) {
        const files = node('ul', null, 'message-attachments');
        for (const attachment of message.attachments) {
          const card = node('li', null, 'message-file');
          if (attachment.kind === 'image' && IMAGE_MIMES.has(attachment.mimeType)) {
            const img = node('img'); img.alt = 'Imagem anexada: ' + attachment.name; img.width = 60; img.height = 60; card.append(img); attachmentPreview(attachment, img);
          }
          card.append(node('span', attachment.name || 'Arquivo anexado'));
          const download = node('button', 'Baixar'); download.type = 'button'; download.setAttribute('aria-label', 'Baixar ' + attachment.name);
          download.addEventListener('click', () => downloadAttachment(attachment, download)); card.append(download); files.append(card);
        }
        li.append(files);
      }
      list.append(li);
    }
    controls(); scrollLatest(forceScroll);
  }
  function validStatus(data) {
    if (!data || typeof data.enabled !== 'boolean') throw failure('invalidResponse');
    if (data.queue !== undefined) { try { assertChatQueueStatus(data.queue); } catch { throw failure('invalidResponse'); } }
    return data;
  }
  function validMessages(data, expectedConversationId) {
    if (!data?.conversation || data.conversation.id !== expectedConversationId || !Array.isArray(data.messages)) throw failure('invalidResponse');
    const ids = new Set();
    for (const item of data.messages) {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || !['user', 'assistant'].includes(item.role) || !MESSAGE_STATES.has(item.status) || typeof item.text !== 'string') throw failure('invalidResponse');
      if (isChatActive(item.status) && (item.role !== 'assistant' || typeof item.requestId !== 'string' || !item.requestId)) throw failure('invalidResponse');
      if (item.attachments !== undefined && (!Array.isArray(item.attachments) || item.attachments.some(file => !file || typeof file.id !== 'string' || !file.id || typeof file.name !== 'string' || !['image', 'text'].includes(file.kind)))) throw failure('invalidResponse');
      if (item.queue !== undefined && (!item.queue || !CHAT_QUEUE_LANES.includes(item.queue.lane) || !(item.queue.position === null || Number.isSafeInteger(item.queue.position) && item.queue.position >= 1))) throw failure('invalidResponse');
      ids.add(item.id);
    }
    return data.messages;
  }
  function rememberConversation(conversation) {
    state.conversations = [conversation, ...state.conversations.filter(item => item.id !== conversation.id)];
  }
  async function updateActive(messages, conversationId) {
    // A partial or truncated history is not proof that a known request finished.
    if (state.activeConversation === conversationId && state.activeRequest && !messages.some(message => message.role === 'assistant' && message.requestId === state.activeRequest)) {
      const requestId = state.activeRequest;
      const data = await api('/requests/' + encodeURIComponent(requestId));
      if (state.activeRequest !== requestId || state.activeConversation !== conversationId) return;
      const receipt = acceptReceipt(data.request, conversationId, requestId);
      if (isChatActive(receipt.status)) return;
    }
    const active = messages.find(message => message.role === 'assistant' && isChatActive(message.status));
    if (active) { state.activeRequest = active.requestId; state.activeConversation = conversationId; state.activeStatus = active.status; }
    else if (state.activeConversation === conversationId) { state.activeRequest = null; state.activeConversation = null; state.activeStatus = null; }
  }
  function acceptReceipt(value, expectedConversationId, expectedRequestId) {
    let receipt;
    try { receipt = assertChatReceipt(value); } catch { throw failure('invalidResponse'); }
    if (expectedConversationId && receipt.conversationId !== expectedConversationId) throw failure('invalidResponse');
    if (expectedRequestId && receipt.requestId !== expectedRequestId) throw failure('invalidResponse');
    if (isChatActive(receipt.status)) { state.activeRequest = receipt.requestId; state.activeConversation = receipt.conversationId; state.activeStatus = receipt.status; }
    else if (state.activeConversation === receipt.conversationId) { state.activeRequest = null; state.activeConversation = null; state.activeStatus = null; }
    schedulePoll();
    return receipt;
  }
  function schedulePoll() {
    clearTimeout(state.timer);
    if (state.activeConversation) state.timer = setTimeout(poll, Math.min(10000, 2000 * (state.pollFailures + 1)));
  }
  async function poll() {
    const id = state.activeConversation, requestId = state.activeRequest, epoch = state.epoch; if (!id) return;
    try {
      const [data, status] = await Promise.all([api('/conversations/' + encodeURIComponent(id)), api('/status')]);
      const messages = validMessages(data, id), nextStatus = validStatus(status);
      if (state.activeRequest !== requestId || state.activeConversation !== id) return;
      const before = state.activeRequest, beforeStatus = state.activeStatus; await updateActive(messages, id);
      state.status = nextStatus; rememberConversation(data.conversation); renderStatus();
      if (state.selected === id) { state.messages = messages; state.historyUnverified = false; renderMessages(); }
      renderHistory(); state.pollFailures = 0;
      if (before && !state.activeRequest) announce('O estado do pedido foi atualizado. Confira a resposta na conversa.');
      else if (beforeStatus !== state.activeStatus && state.activeStatus === 'running') announce('Seu pedido saiu da fila. A resposta está sendo preparada.');
    } catch (error) { if (error?.key !== 'stale') { state.pollFailures += 1; showError(error); } }
    if (epoch === state.epoch) { controls(); schedulePoll(); }
  }
  async function selectConversation(id, forceScroll = true) {
    const selectionEpoch = ++state.selectionEpoch;
    clearError(); state.selected = id; state.messages = []; state.historyUnverified = true; renderHistory(); renderMessages();
    try {
      const [data, status] = await Promise.all([api('/conversations/' + encodeURIComponent(id)), api('/status')]);
      const messages = validMessages(data, id), nextStatus = validStatus(status);
      if (selectionEpoch !== state.selectionEpoch) return;
      await updateActive(messages, id);
      if (selectionEpoch !== state.selectionEpoch) return;
      state.status = nextStatus; rememberConversation(data.conversation); state.messages = messages; state.historyUnverified = false;
      renderStatus(); renderHistory(); renderMessages(forceScroll); schedulePoll();
    } catch (error) { if (selectionEpoch === state.selectionEpoch) showError(error); }
  }
  async function loadConversations(initial = false) {
    if (state.loading || (storeReference && !state.token)) return;
    const epoch = state.epoch; state.loading = true; clearError(); controls();
    try {
      const [status, data] = await Promise.all([api('/status'), api('/conversations')]);
      state.status = validStatus(status); state.conversations = (Array.isArray(data.items) ? data.items : []).filter(item => typeof item.id === 'string');
      renderStatus(); renderHistory();
      if (initial && state.conversations[0]) await selectConversation(state.conversations[0].id);
      else if (state.selected) await selectConversation(state.selected, false);
      if (storeReference) $('access-status').textContent = 'Loja conectada. Histórico privado deste acesso.';
    } catch (error) { if (epoch === state.epoch) { state.status = null; renderStatus(); showError(error); } }
    finally { if (epoch === state.epoch) { state.loading = false; controls(); } }
  }
  function clearAttachments() {
    for (const attachment of state.attachments) if (attachment.preview) URL.revokeObjectURL(attachment.preview);
    state.attachments = []; $('attachment-input').value = ''; renderAttachments();
  }
  function renderAttachments() {
    $('attachment-previews').replaceChildren();
    state.attachments.forEach((attachment, index) => {
      const li = node('li', null, 'attachment-preview');
      if (attachment.preview) { const img = node('img'); img.src = attachment.preview; img.alt = 'Prévia de ' + attachment.file.name; li.append(img); }
      const details = node('span', null, 'attachment-description');
      details.append(node('span', attachment.file.name, 'attachment-name'), node('span', Math.max(1, Math.ceil(attachment.file.size / 1024)) + ' KB · ' + (attachment.id ? 'Enviado' : 'Pronto')));
      const remove = node('button', '×'); remove.type = 'button'; remove.disabled = state.busy || state.uncertain;
      remove.setAttribute('aria-label', 'Remover ' + attachment.file.name);
      remove.addEventListener('click', () => { if (state.busy || state.uncertain) return; if (attachment.preview) URL.revokeObjectURL(attachment.preview); state.attachments.splice(index, 1); renderAttachments(); controls(); announce('Arquivo removido do próximo envio.'); });
      li.append(details, remove); $('attachment-previews').append(li);
    });
  }
  function addFiles(files) {
    clearError();
    if (!canSend()) return;
    for (const file of Array.from(files || [])) {
      try {
        if (state.attachments.length >= 3) throw new Error('attachment_count');
        const meta = validateNeuralAttachment(file);
        state.attachments.push({ file, ...meta, preview: meta.kind === 'image' ? URL.createObjectURL(file) : null, id: null });
      } catch (error) { showError(error); }
    }
    $('attachment-input').value = ''; renderAttachments(); controls();
  }
  function base64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(failure('attachment_read'));
      reader.onload = () => { const result = String(reader.result || ''), comma = result.indexOf(','); if (comma < 0) reject(failure('attachment_read')); else resolve(result.slice(comma + 1)); };
      reader.readAsDataURL(file);
    });
  }
  async function recoverRequest() {
    if (!state.pending || state.busy) return;
    const epoch = state.epoch;
    state.busy = true; state.retryAllowed = false; clearError(); controls();
    try {
      const data = await api('/requests/by-key/' + encodeURIComponent(state.pending.idempotencyKey));
      const receipt = acceptReceipt(data.request, state.pending.conversationId);
      state.uncertain = false; state.pending = null; $('command').value = ''; clearAttachments();
      await selectConversation(receipt.conversationId);
      announce(receipt.status === 'queued' ? 'Envio encontrado. Seu pedido está na fila e não foi repetido.' : 'Envio encontrado. O pedido não foi repetido.');
    } catch (error) { if (epoch === state.epoch) { state.retryAllowed = error?.status === 404; showError(error); } }
    finally { if (epoch === state.epoch) { state.busy = false; controls(); renderAttachments(); } }
  }
  async function retrySameRequest() {
    if (!state.pending || !state.uncertain || !state.retryAllowed || state.busy) return;
    // An explicit click may retry the immutable receipt identity after a GET 404.
    // Do not reconstruct this payload from the current composer or upload again.
    const pending = state.pending, epoch = state.epoch;
    state.busy = true; state.retryAllowed = false; clearError(); controls();
    try {
      const data = await api('/messages', 'POST', pending);
      const receipt = acceptReceipt(data, pending.conversationId);
      state.pending = null; state.uncertain = false; $('command').value = ''; clearAttachments(); resizeComposer();
      await selectConversation(receipt.conversationId);
      announce(receipt.status === 'queued' ? 'O mesmo envio foi confirmado e está na fila.' : 'O mesmo envio foi confirmado. Acompanhe o registro na conversa.');
    } catch (error) {
      if (epoch === state.epoch) { state.uncertain = true; showError(error); announce('Recebimento ainda não confirmado. Confira o registro antes de tentar novamente.'); }
    } finally { if (epoch === state.epoch) { state.busy = false; controls(); renderAttachments(); } }
  }
  async function submit(event) {
    event.preventDefault();
    if (!canSend()) return;
    const message = $('command').value.trim(); if (!message || message.length > 6000) return;
    const epoch = state.epoch; state.busy = true; clearError(); controls(); renderAttachments();
    let submitted = false;
    try {
      for (const attachment of state.attachments) {
        if (attachment.id) continue;
        const dataBase64 = await base64(attachment.file);
        if (epoch !== state.epoch) throw failure('stale');
        const result = await api('/attachments', 'POST', { name: attachment.file.name, mimeType: attachment.mimeType, dataBase64 });
        if (!result.attachment?.id) throw failure('invalidResponse');
        attachment.id = result.attachment.id; renderAttachments();
      }
      state.pending = Object.freeze({ message, ...(state.selected ? { conversationId: state.selected } : {}), attachmentIds: Object.freeze(state.attachments.map(item => item.id)), idempotencyKey: crypto.randomUUID() });
      state.retryAllowed = false;
      submitted = true;
      const data = await api('/messages', 'POST', state.pending);
      const receipt = acceptReceipt(data, state.pending.conversationId);
      state.pending = null; state.uncertain = false; $('command').value = ''; clearAttachments(); resizeComposer();
      await selectConversation(receipt.conversationId);
      announce(receipt.status === 'queued' ? 'Mensagem recebida. Seu pedido está na fila.' : 'Mensagem recebida. Acompanhe a resposta nesta conversa.');
    } catch (error) {
      if (epoch !== state.epoch) return;
      if (submitted && state.pending && (!error.status || error.status >= 500)) { state.uncertain = true; announce('Recebimento não confirmado. Confira o envio sem reenviar.'); }
      else if (submitted) state.pending = null;
      showError(error);
    } finally { if (epoch === state.epoch) { state.busy = false; controls(); renderAttachments(); } }
  }
  async function cancelRequest() {
    if (!state.activeRequest || state.busy) return;
    const requestId = state.activeRequest, conversationId = state.activeConversation, epoch = state.epoch; state.busy = true; clearError(); controls();
    try {
      const data = await api('/requests/' + encodeURIComponent(requestId) + '/cancel', 'POST', {});
      const receipt = acceptReceipt(data, conversationId, requestId);
      await selectConversation(conversationId, false);
      if (epoch !== state.epoch) return;
      announce(receipt.status === 'cancelled' ? 'Cancelamento confirmado.' : 'Pedido de cancelamento registrado. Confira o estado na conversa.');
    } catch (error) { showError(error); }
    finally { if (epoch === state.epoch) { state.busy = false; controls(); } }
  }
  function resizeComposer() { const textarea = $('command'); textarea.style.height = 'auto'; textarea.style.height = Math.min(170, Math.max(57, textarea.scrollHeight)) + 'px'; controls(); }
  function newConversation() {
    if (state.busy || state.uncertain || state.historyUnverified || state.activeRequest || state.status?.queue?.requiresReview) return;
    state.selectionEpoch += 1; state.selected = null; state.messages = []; state.pending = null;
    $('command').value = ''; clearAttachments(); clearError(); renderHistory(); renderMessages(); resizeComposer(); setHistoryOpen(false); $('command').focus();
    announce('Nova conversa. As anteriores continuam no histórico.');
  }
  function forgetAccess() {
    state.epoch += 1; state.selectionEpoch += 1; clearTimeout(state.timer); for (const request of requests) request.abort();
    for (const url of previewCache.values()) if (url) URL.revokeObjectURL(url);
    for (const url of downloadUrls) URL.revokeObjectURL(url); previewCache.clear(); downloadUrls.clear();
    clearAttachments();
    Object.assign(state, { token: '', status: null, conversations: [], messages: [], selected: null, activeRequest: null, activeConversation: null, activeStatus: null, pending: null, uncertain: false, retryAllowed: false, busy: false, loading: false, historyUnverified: false });
    $('access-token').value = ''; $('command').value = ''; $('disconnect').hidden = true;
    $('access-status').textContent = 'Acesso esquecido nesta página. Mensagens já enviadas permanecem no histórico privado.';
    clearError(); renderStatus(); renderHistory(); renderMessages(); renderAttachments();
  }
  $('billing-link').href = '/neural-billing.html' + (storeReference ? '?store=' + encodeURIComponent(storeReference) : '');
  $('tasks-link').href = '/neural-tasks.html' + (storeReference ? '?store=' + encodeURIComponent(storeReference) : '');
  $('advanced-link').hidden = !!storeReference;
  $('command-form').addEventListener('submit', submit);
  $('command').addEventListener('input', resizeComposer);
  $('command').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); submit(event); }
  });
  $('attach').addEventListener('click', () => $('attachment-input').click());
  $('attachment-input').addEventListener('change', event => addFiles(event.target.files));
  $('new-conversation').addEventListener('click', newConversation);
  $('history-toggle').addEventListener('click', () => setHistoryOpen($('history-toggle').getAttribute('aria-expanded') !== 'true'));
  $('refresh').addEventListener('click', () => loadConversations());
  $('recover-request').addEventListener('click', recoverRequest);
  $('retry-request').addEventListener('click', retrySameRequest);
  $('cancel-request').addEventListener('click', cancelRequest);
  $('disconnect').addEventListener('click', forgetAccess);
  $('access-form').addEventListener('submit', event => {
    event.preventDefault(); if (state.busy || state.loading) return;
    const token = $('access-token').value.trim(); if (!token) return;
    forgetAccess(); state.token = token; $('disconnect').hidden = false; loadConversations(true);
  });
  for (const button of document.querySelectorAll('[data-example]')) button.addEventListener('click', () => { if (state.busy || state.uncertain) return; $('command').value = button.dataset.example; resizeComposer(); $('command').focus(); });
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && $('history-toggle').getAttribute('aria-expanded') === 'true') setHistoryOpen(false, true); });
  window.addEventListener('pagehide', forgetAccess);
  window.addEventListener('pageshow', event => { if (event.persisted && !storeReference) loadConversations(true); });
  if (storeReference) { $('store-access').hidden = false; $('account-label').textContent = 'Chat privado da sua loja'; renderStatus(); controls(); }
  else loadConversations(true);
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') mountNeuralWorkspace();
