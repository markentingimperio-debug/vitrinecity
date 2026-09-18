import { CHAT_MESSAGE_STATES, CHAT_QUEUE_LANES, CHAT_ARTIFACT_MAX_BYTES, isChatActive, isChatPending, assertChatReceipt, assertChatQueueStatus, assertChatPayment, assertChatWallet, assertChatArtifact, assertAiPurchaseStatus, assertAiPurchaseOrder } from './neural-chat-contract.js';
import {assertCoinStatus,atomsFromMicroBRL,quoteCoinTopup,VITRINE_COINS_POLICY} from './vitrine-coins-contract.js';
import {formatCoins,formatCoinBRL,coinSummary,formatConsumedCoins} from './vitrine-coins-ui.js';

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const OPERATION_MEDIA_MIMES = new Set(['video/mp4','video/webm','video/quicktime','audio/mpeg','audio/mp4','audio/wav','audio/ogg']);
const TEXT_MIMES = { txt: 'text/plain', md: 'text/markdown', csv: 'text/csv' };
const MESSAGE_STATES = new Set(CHAT_MESSAGE_STATES);
export function validateNeuralAttachment(file) {
  const extension = String(file?.name || '').split('.').pop().toLowerCase();
  const rawType = String(file?.type || '').toLowerCase();
  const mimeType = IMAGE_MIMES.has(rawType) || OPERATION_MEDIA_MIMES.has(rawType) ? rawType : TEXT_MIMES[extension];
  const isImage = IMAGE_MIMES.has(mimeType), isOperationMedia = OPERATION_MEDIA_MIMES.has(mimeType);
  if (!mimeType || (isImage && !['png', 'jpg', 'jpeg', 'webp'].includes(extension))) throw new Error('attachment_type');
  const max = isOperationMedia ? 50 * 1024 * 1024 : isImage ? 2097152 : 65536;
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > max) throw new Error('attachment_size');
  return { mimeType, kind: isOperationMedia ? 'operation-media' : isImage ? 'image' : 'text' };
}
export function mountNeuralWorkspace(environment = globalThis) {
  const { document, window, location, URLSearchParams, URL, Blob, AbortController, crypto, FileReader } = environment;
  const fetch = environment.fetch.bind(environment);
  const setTimeout = environment.setTimeout.bind(environment), clearTimeout = environment.clearTimeout.bind(environment);
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search), storeReference = params.get('store') || '', personal = !storeReference && params.get('personal') === '1';
  const base = storeReference ? '/api/store-portal/' + encodeURIComponent(storeReference) + '/neural/chat' : personal ? '/api/neural/chat' : '/api/admin/vitriny-neural/chat';
  const state = { token: '', status: null, conversations: [], selected: null, messages: [], attachments: [], busy: false, loading: false, historyUnverified: false, epoch: 0, selectionEpoch: 0, timer: null, pollFailures: 0, activeConversation: null, activeRequest: null, activeStatus: null, pending: null, pendingConfirmation: null, uncertain: false, retryAllowed: false };
  const requests = new Set(), previewCache = new Map(), artifactCache = new Map(), messageNodes = new Map(), downloadUrls = new Set();
  const credit = { status: null, busy: false, pending: null, uncertain: false, open: false };
  let coinWallet = null, coinsChecked = false;
  const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(value / 1000000);
  const usagePrice = value => coinWallet ? coinSummary(atomsFromMicroBRL(value)) : money(value);
  const purchaseReady = () => !!coinWallet && credit.status?.canPurchase === true && credit.status?.terms?.version === VITRINE_COINS_POLICY.version;
  const errorText = {
    attachment_type: 'Formato não aceito. Use PNG, JPEG, WebP, TXT, MD ou CSV. PDF e DOCX ainda não são suportados.',
    attachment_size: 'Arquivo vazio ou muito grande. Imagens: até 2 MB; vídeo/áudio para edição: até 50 MB; documentos de texto: até 64 KB.',
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
    if (error?.status === 401) forgetAccess();
    $('error').textContent = errorText[error?.key || error?.message] || errorText.unavailable;
    $('error').hidden = false;
    if (error?.status === 401 && !storeReference) $('admin-login').hidden = false;
  }
  async function api(path, method = 'GET', body, binary = false, absolute = false) {
    const epoch = state.epoch, controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30000);
    requests.add(controller);
    try {
      const headers = { Accept: binary ? 'application/octet-stream' : 'application/json' };
      if (storeReference && state.token) headers['x-store-token'] = state.token;
      if (method !== 'GET') { headers['content-type'] = 'application/json'; headers['x-neural-request'] = '1'; }
      const response = await fetch(absolute ? path : base + path, { method, headers, credentials: 'same-origin', cache: 'no-store', signal: controller.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (epoch !== state.epoch) throw failure('stale');
      if (!response.ok) {
        const key = ({ 400: 'invalid', 401: 'unauthorized', 402: 'quota', 403: 'forbidden', 404: 'notFound', 409: 'conflict', 413: 'attachment_size', 415: 'attachment_type', 422: 'invalid', 428: 'mfa', 429: 'quota', 503: 'disabled' })[response.status] || 'unavailable';
        throw failure(key, response.status);
      }
      let data;
      if (binary && typeof binary === 'object') {
        const mime = (response.headers?.get('content-type') || '').split(';')[0].trim();
        const length = response.headers?.get('content-length');
        if (mime !== binary.mimeType || length && (!/^\d+$/.test(length) || Number(length) > CHAT_ARTIFACT_MAX_BYTES)) throw failure('invalidResponse');
        if (response.body?.getReader) {
          const reader = response.body.getReader(), chunks = []; let bytes = 0;
          try { while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > CHAT_ARTIFACT_MAX_BYTES || bytes > binary.bytes) { await reader.cancel(); throw failure('invalidResponse'); } chunks.push(chunk.value); } }
          finally { reader.releaseLock(); }
          data = new Blob(chunks, { type: mime });
        } else data = await response.blob();
        if (data.type !== binary.mimeType || data.size !== binary.bytes || data.size > CHAT_ARTIFACT_MAX_BYTES) throw failure('invalidResponse');
      } else data = binary ? await response.blob() : await response.json().catch(() => { throw failure('invalidResponse'); });
      if (epoch !== state.epoch) throw failure('stale');
      if (!binary && (!data || data.ok !== true)) throw failure('invalidResponse');
      return data;
    } catch (error) { if (epoch !== state.epoch) throw failure('stale'); if (error?.name === 'AbortError') throw failure('timeout'); throw error; }
    finally { clearTimeout(timeout); requests.delete(controller); }
  }
  async function operationJson(path, method = 'POST', body, headers = {}, timeoutMs = 30000) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch('/api/neural/chat/operations' + path, {
        method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { ...(body instanceof Blob ? {} : {'content-type':'application/json'}), ...headers },
        ...(body === undefined ? {} : {body: body instanceof Blob ? body : JSON.stringify(body)})
      });
      let data = {}; try { data = await response.json(); } catch {}
      if (!response.ok) throw failure(({400:'invalid',401:'unauthorized',402:'quota',403:'forbidden',404:'notFound',409:'conflict',413:'attachment_size',422:'invalid',429:'quota',503:'disabled'})[response.status] || 'unavailable', response.status);
      if (!data || data.ok !== true) throw failure('invalidResponse');
      return data;
    } catch (error) { if (error?.name === 'AbortError') throw failure('timeout'); throw error; }
    finally { clearTimeout(timeout); }
  }
  async function operationUpload(attachment) {
    const response = await fetch('/api/neural/chat/operations/upload', {
      method:'POST', credentials:'same-origin', cache:'no-store',
      headers:{'content-type':attachment.mimeType}, body:attachment.file
    });
    let data={};try{data=await response.json();}catch{}
    if(!response.ok||!data?.upload?.id)throw failure(response.status===413?'attachment_size':'unavailable',response.status);
    return data.upload.id;
  }
  function operationArtifacts(text) {
    const artifacts=[];const cleanText=String(text||'').replace(/\n?\[\[LIA_ARTIFACT\|([a-f0-9-]{36})\|([^|\]]+)\|([^|\]]+)\]\]/gi,(_all,operation,pathValue,nameValue)=>{
      try{artifacts.push({operation,path:decodeURIComponent(pathValue),name:decodeURIComponent(nameValue)});}catch{}
      return '';
    }).trim();
    return {text:cleanText,artifacts};
  }
  async function tryOperationalCommand(message) {
    if (!personal) return false;
    const media = state.attachments.find(item => item.kind === 'operation-media') || state.attachments.find(item => item.kind === 'image');
    const quoted = await operationJson('/quote','POST',{instruction:message,mimeType:media?.mimeType||''});
    const quote = quoted.item;
    if (!quote?.supported) {
      if (state.attachments.some(item => item.kind === 'operation-media')) throw failure('invalid');
      return false;
    }
    if (quote.needsUpload && !media) throw failure('invalid');
    const price = String(quote.priceCoins || '—');
    if (!window.confirm(`A LIA pode executar esta tarefa por até ${price} Vitrine Coins. Confirmar e executar?`)) return true;
    let uploadId='';
    if (quote.needsUpload) uploadId=await operationUpload(media);
    const result=await operationJson('/run','POST',{
      instruction:message,
      ...(state.selected?{conversationId:state.selected}:{}),
      idempotencyKey:crypto.randomUUID(),
      confirmCharge:true,
      ...(uploadId?{uploadId}:{})
    },{'x-lia-operations-request':'1'},16*60*1000);
    $('command').value='';clearAttachments();resizeComposer();
    await selectConversation(result.conversationId);
    await loadCoinWallet();renderStatus();
    announce('Tarefa operacional concluída pela LIA.');
    return true;
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
    $('cancel-request').textContent = ['queued', 'awaiting_confirmation'].includes(state.activeStatus) ? 'Cancelar pedido' : 'Parar';
    for (const button of document.querySelectorAll('[data-confirm-payment]')) button.disabled = state.busy || state.uncertain || state.historyUnverified || button.dataset.blocked === 'true' || Date.now() >= Number(button.dataset.expiresAt);
    for (const button of document.querySelectorAll('[data-example]')) button.disabled = state.busy || state.uncertain;
    $('credits-toggle').disabled = state.loading || credit.busy || (!!storeReference && !state.token);
    $('credits-refresh').disabled = credit.busy;
    $('credits-retry').disabled = credit.busy;
    for (const button of document.querySelectorAll('[data-credit-amount]')) button.disabled = credit.busy || credit.uncertain || !purchaseReady() || !$('credits-terms').checked;
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
    $('billing-status').textContent = coinWallet ? 'Disponível: ' + coinSummary(coinWallet.availableAtoms) + ' · Reservado: ' + coinSummary(coinWallet.reservedAtoms) + '.' : state.status?.paidGenerationEnabled === true ? (state.status.wallet ? 'Saldo anterior de IA: ' + money(state.status.wallet.availableMicro) + ' disponíveis · ' + money(state.status.wallet.reservedMicro) + ' reservados. Carteira unificada não confirmada.' : 'Saldo ainda não confirmado.') : 'Gerações pagas não estão ativas neste chat.';
    $('coin-wallet-notice').textContent = coinWallet ? (coinWallet.frozen ? 'Sua carteira está em conferência. Novos usos estão pausados.' : 'Vitrine Coins compradas e conquistadas têm os mesmos usos. Taxa de 15% só na recarga; sem repetir a taxa no uso da IA.') : coinsChecked ? 'A carteira unificada ainda não está disponível para este acesso. Nenhum saldo anterior foi convertido por esta página.' : 'Conferindo Vitrine Coins…';
    $('media-capability-note').textContent = state.status?.capabilities?.image || state.status?.capabilities?.video ? 'Quando um recurso pago estiver disponível, o valor será mostrado antes da confirmação. Imagens e vídeos concluídos aparecem nesta conversa, com opção de baixar. Anexar uma imagem não garante que todos os modelos interpretem seu conteúdo.' : 'Imagens podem ser anexadas, mas a geração de imagens e vídeos ainda não está disponível neste acesso. Para contextualizar uma imagem, descreva-a na mensagem.';
    controls();
  }
  function renderCredits() {
    $('credits-panel').hidden = !credit.open;
    $('credits-toggle').setAttribute('aria-expanded', String(credit.open));
    $('credits-retry').hidden = !credit.uncertain || !credit.pending;
    $('credits-summary').textContent = credit.status ? (credit.status.frozen ? 'Saldo em conferência. Novas utilizações estão pausadas.' : coinWallet ? 'Disponível: ' + coinSummary(coinWallet.availableAtoms) + '. Reservado: ' + coinSummary(coinWallet.reservedAtoms) + '.' : 'Carteira unificada ainda não confirmada.') : 'Conferindo suas Vitrine Coins…';
    $('credits-terms-text').textContent = credit.status ? credit.status.terms.summary + ' ' + credit.status.terms.refunds : '';
    $('credits-options').replaceChildren(); $('credits-orders').replaceChildren();
    if (credit.status) {
      for (const amount of credit.status.presetsCents) {
        const button = node('button', 'Recarregar ' + money(amount * 10000)); button.type = 'button'; button.dataset.creditAmount = String(amount);
        button.addEventListener('click', () => startCheckout(amount)); $('credits-options').append(button);
        if (credit.status.terms.version === VITRINE_COINS_POLICY.version) { const q = quoteCoinTopup(amount); $('credits-options').append(node('p', 'Pagamento: ' + money(q.amountCents * 10000) + ' · taxa de 15%: ' + money(q.feeCents * 10000) + ' · líquido: ' + coinSummary(q.netAtoms) + '.', 'small')); }
      }
      if (!purchaseReady()) $('credits-summary').textContent += ' A recarga de Vitrine Coins ainda não está disponível para este acesso.';
      const labels = { creating: 'Preparando pagamento', pending: 'Aguardando pagamento', payment_unknown: 'Pagamento em conferência', authorized: 'Pagamento autorizado', in_process: 'Pagamento em processamento', in_mediation: 'Pagamento em análise', approved: 'Pagamento confirmado', rejected: 'Pagamento recusado', cancelled: 'Pagamento cancelado', refunded: 'Pagamento devolvido', charged_back: 'Pagamento contestado', review_required: 'Compra em conferência' };
      for (const order of credit.status.orders) {
        const item = node('li'); item.append(node('p', money(order.amountCents * 10000) + ' · ' + labels[order.status], 'small'));
        if (order.netAtoms !== undefined) item.append(node('p', 'Taxa: ' + money(order.feeCents * 10000) + ' · saldo líquido: ' + coinSummary(order.netAtoms), 'small'));
        if (order.checkoutUrl && Date.now() < order.expiresAt) {
          const link = node('a', 'Pagar no Mercado Pago'); link.href = order.checkoutUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; item.append(link);
        }
        if (!['approved','rejected','cancelled','refunded','charged_back'].includes(order.status)) {
          const check = node('button', 'Conferir pagamento'); check.type = 'button'; check.disabled = credit.busy; check.addEventListener('click', () => refreshPayment(order.reference)); item.append(check);
        }
        $('credits-orders').append(item);
      }
    }
    controls();
  }
  async function loadCredits() {
    if (credit.busy || (!!storeReference && !state.token)) return;
    const epoch = state.epoch; credit.busy = true; clearError(); renderCredits();
    try { credit.status = assertAiPurchaseStatus(await api('/credits/status')); if (!storeReference && credit.status.coinWallet) { coinWallet = assertCoinStatus(credit.status.coinWallet); coinsChecked = true; renderStatus(); } }
    catch (error) { showError(error); }
    finally { if (epoch === state.epoch) { credit.busy = false; renderCredits(); } }
  }
  async function startCheckout(amount, retry = false) {
    if (credit.busy || !purchaseReady() || (!retry && (credit.uncertain || !$('credits-terms').checked))) return;
    const pending = retry ? credit.pending : Object.freeze({ amountCents: amount, key: crypto.randomUUID(), termsAccepted: true, termsVersion: credit.status.terms.version });
    if (!pending) return;
    const epoch = state.epoch; credit.pending = pending; credit.busy = true; clearError(); renderCredits();
    try {
      const result = await api('/credits/checkout', 'POST', pending), order = assertAiPurchaseOrder(result.order);
      credit.status = { ...credit.status, orders: [order, ...credit.status.orders.filter(item => item.reference !== order.reference)] };
      credit.pending = null; credit.uncertain = false;
      announce('Recarga de Vitrine Coins preparada. Use o link do Mercado Pago para pagar; o saldo líquido só será adicionado após a confirmação.');
    } catch (error) {
      if (epoch !== state.epoch) return;
      if (!error.status || error.status >= 500) credit.uncertain = true; else credit.pending = null;
      showError(error);
    } finally { if (epoch === state.epoch) { credit.busy = false; renderCredits(); } }
  }
  async function refreshPayment(reference) {
    if (credit.busy) return;
    const epoch = state.epoch; credit.busy = true; clearError(); renderCredits();
    try { const result = await api('/credits/orders/' + encodeURIComponent(reference) + '/refresh', 'POST', {}); assertAiPurchaseOrder(result.order); credit.status = assertAiPurchaseStatus(await api('/credits/status')); }
    catch (error) { showError(error); }
    finally { if (epoch === state.epoch) { credit.busy = false; renderCredits(); loadConversations(); } }
  }
  async function loadCoinWallet() {
    if (storeReference) { coinWallet = null; coinsChecked = true; return; }
    try { coinWallet = assertCoinStatus(await api('/api/coins/status', 'GET', undefined, false, true)); }
    catch (error) { if (error?.key === 'stale') return; coinWallet = null; }
    coinsChecked = true;
  }
  function renderHistory() {
    $('conversation-list').replaceChildren();
    $('history-empty').hidden = state.conversations.length > 0;
    for (const conversation of state.conversations) {
      const li = node('li', null, 'conversation-entry'), button = node('button'), remove = node('button', 'Excluir', 'conversation-delete');
      button.type = remove.type = 'button'; button.className = 'conversation-open';
      button.setAttribute('aria-current', String(state.selected === conversation.id));
      button.append(node('span', conversation.title || 'Conversa', 'conversation-label'));
      button.disabled = state.busy; remove.disabled = state.busy || state.activeConversation === conversation.id;
      button.addEventListener('click', () => { selectConversation(conversation.id); setHistoryOpen(false); });
      remove.setAttribute('aria-label', 'Excluir conversa ' + (conversation.title || 'Conversa'));
      remove.title = state.activeConversation === conversation.id ? 'Conclua ou cancele o pedido antes de excluir.' : 'Excluir esta conversa';
      remove.addEventListener('click', event => { event.stopPropagation(); deleteConversation(conversation.id); });
      li.append(button, remove); $('conversation-list').append(li);
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
  async function artifactPreview(artifact, media, notice) {
    try {
      let entry = artifactCache.get(artifact.id);
      if (!entry) {
        const epoch = state.epoch;
        entry = { url: null, promise: api('/artifacts/' + encodeURIComponent(artifact.id) + '/content', 'GET', undefined, artifact).then(blob => {
          if (epoch !== state.epoch) throw failure('stale');
          entry.url = URL.createObjectURL(blob); return entry.url;
        }) };
        artifactCache.set(artifact.id, entry);
      }
      media.src = await entry.promise; media.hidden = false; notice.hidden = true;
    } catch { media.hidden = true; notice.textContent = 'Não foi possível carregar a prévia. O arquivo não será gerado novamente.'; }
  }
  async function downloadArtifact(artifact, button) {
    button.disabled = true;
    try {
      const blob = await api('/artifacts/' + encodeURIComponent(artifact.id) + '/download', 'GET', undefined, artifact);
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' })), link = node('a');
      downloadUrls.add(url); link.href = url; link.download = artifact.name;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); }, 1000);
    } catch (error) { showError(error); } finally { button.disabled = false; }
  }
  function paymentCard(message) {
    if (coinWallet && message.payment.state === 'settled') {
      const amount = atomsFromMicroBRL(message.payment.chargedMicro ?? 0);
      const details = node('details', null, 'payment-card payment-consumption');
      details.setAttribute('aria-label', 'Consumo de Vitrine Coins deste pedido');
      const summary = node('summary', 'Usou ' + formatConsumedCoins(amount) + ' Vitrine Coins');
      summary.append(node('span', 'Detalhes', 'consumption-details-label'));
      details.append(summary, node('p', 'Consumo exato: ' + coinSummary(amount) + '.', 'small'), node('p', message.payment.summary, 'small'));
      return details;
    }
    const payment = message.payment, card = node('section', null, 'payment-card');
    card.setAttribute('aria-label', 'Vitrine Coins deste pedido');
    card.append(node('p', payment.summary, 'payment-summary'));
    const descriptions = {
      quoted: 'Valor máximo autorizado: ' + usagePrice(payment.amountMicro) + '. Nenhuma moeda foi consumida.',
      reserved: 'Reservado: ' + usagePrice(payment.amountMicro) + '. O consumo será confirmado após a execução.',
      settled: 'Consumo confirmado: ' + usagePrice(payment.chargedMicro ?? 0) + '.',
      held: 'Reserva em conferência: ' + usagePrice(payment.amountMicro) + '. Não repita o pedido enquanto verificamos o consumo.',
      released: 'Reserva liberada. Nenhum crédito foi consumido por este pedido.'
    };
    card.append(node('p', descriptions[payment.state], 'small'));
    if (payment.state === 'quoted' && message.status === 'awaiting_confirmation') {
      const expired = Date.now() >= payment.expiresAt;
      const insufficient = !!state.status?.wallet && state.status.wallet.availableMicro < payment.amountMicro;
      const button = node('button', 'Confirmar até ' + usagePrice(payment.amountMicro), 'primary'); button.type = 'button';
      button.dataset.confirmPayment = 'true'; button.dataset.expiresAt = String(payment.expiresAt); button.dataset.blocked = String(expired || insufficient || state.status?.paidGenerationEnabled !== true || !state.status?.wallet);
      button.disabled = button.dataset.blocked === 'true' || state.busy || state.uncertain;
      button.addEventListener('click', () => confirmPayment(message)); card.append(button);
      if (expired) card.append(node('p', 'Este orçamento expirou. Cancele o pedido e solicite outro orçamento.', 'small'));
      else if (insufficient) card.append(node('p', 'Saldo insuficiente. Adicione Vitrine Coins antes de confirmar.', 'small'));
      else card.append(node('p', 'A execução só começa após esta confirmação. A sobra da reserva será liberada após a conferência.', 'small'));
    }
    return card;
  }
  function renderMessages(forceScroll = false) {
    const conversation = state.conversations.find(item => item.id === state.selected);
    $('conversation-title').textContent = conversation?.title || 'Lia';
    $('welcome').hidden = !!state.messages.length;
    const list = $('messages'), wanted = new Set(state.messages.map(message => message.id));
    for (const [id, entry] of messageNodes) if (!wanted.has(id)) { entry.node.remove(); messageNodes.delete(id); }
    let index = 0;
    for (const message of state.messages) {
      const signature = JSON.stringify([message, message.payment?.state === 'quoted' ? state.status?.wallet : null, !!coinWallet]);
      const cached = messageNodes.get(message.id);
      if (cached?.signature === signature) { if (list.children[index] !== cached.node) list.insertBefore(cached.node, list.children[index] || null); index++; continue; }
      const li = node('li', null, 'message ' + (message.role === 'user' ? 'user-message' : 'assistant-message'));
      li.append(node('p', message.role === 'user' ? 'Você' : 'Lia', 'message-label'));
      const operationContent = operationArtifacts(message.text);
      li.append(node('p', operationContent.text || ({ queued: 'Pedido recebido. Aguardando sua vez na fila.', running: 'Preparando sua resposta…' })[message.status] || '', 'message-content'));
      if (operationContent.artifacts.length) {
        const operationFiles=node('div',null,'operation-artifacts');
        for (const artifact of operationContent.artifacts) {
          const link=node('a','Baixar '+artifact.name,'operation-artifact-link');
          link.href='/api/neural/chat/operations/artifact?operation='+encodeURIComponent(artifact.operation)+'&path='+encodeURIComponent(artifact.path);
          link.setAttribute('download',artifact.name);operationFiles.append(link);
        }
        li.append(operationFiles);
      }
      if (isChatActive(message.status)) li.setAttribute('aria-busy', 'true');
      const queuePosition = message.queue && CHAT_QUEUE_LANES.includes(message.queue.lane) && Number.isSafeInteger(message.queue.position) && message.queue.position >= 1 ? message.queue.position : null;
      const labels = { awaiting_confirmation: 'Aguardando sua confirmação · execução não iniciada', queued: 'Na fila' + (queuePosition === null ? '' : ' · posição ' + queuePosition), running: 'Em andamento', unavailable: 'Recurso ainda indisponível · nenhuma geração realizada', failed: 'Não concluído', cancelled: 'Cancelado', interrupted: 'Interrompido · confira antes de pedir novamente' };
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
      if (message.payment) li.append(paymentCard(message));
      if (message.artifacts?.length) {
        const artifacts = node('ul', null, 'generated-artifacts');
        for (const artifact of message.artifacts) {
          const card = node('li', null, 'generated-artifact'); card.append(node('p', artifact.name, 'small'));
          if (artifact.availability === 'ready') {
            const media = node(artifact.kind === 'video' ? 'video' : 'img'); media.hidden = true;
            if (artifact.kind === 'video') { media.controls = true; media.preload = 'metadata'; media.playsInline = true; media.setAttribute('aria-label', 'Vídeo gerado: ' + artifact.name); }
            else { media.alt = 'Imagem gerada: ' + artifact.name; media.loading = 'lazy'; }
            const notice = node('p', 'Carregando prévia privada…', 'small'); notice.setAttribute('role', 'status');
            const download = node('button', 'Baixar ' + (artifact.kind === 'video' ? 'vídeo' : 'imagem')); download.type = 'button'; download.addEventListener('click', () => downloadArtifact(artifact, download));
            card.append(media, notice, download); artifactPreview(artifact, media, notice);
          } else card.append(node('p', 'Arquivo indisponível para download. Consulte o estado do pedido; não houve uma nova geração.', 'small'));
          artifacts.append(card);
        }
        li.append(artifacts);
      }
      if (cached) cached.node.remove();
      list.insertBefore(li, list.children[index] || null); messageNodes.set(message.id, { signature, node: li }); index++;
    }
    controls(); scrollLatest(forceScroll);
  }
  function validStatus(data) {
    if (!data || typeof data.enabled !== 'boolean') throw failure('invalidResponse');
    if (data.queue !== undefined) { try { assertChatQueueStatus(data.queue); } catch { throw failure('invalidResponse'); } }
    if (data.wallet !== undefined) { try { assertChatWallet(data.wallet); } catch { throw failure('invalidResponse'); } }
    return data;
  }
  function validMessages(data, expectedConversationId) {
    if (!data?.conversation || data.conversation.id !== expectedConversationId || !Array.isArray(data.messages)) throw failure('invalidResponse');
    const ids = new Set();
    for (const item of data.messages) {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || !['user', 'assistant'].includes(item.role) || !MESSAGE_STATES.has(item.status) || typeof item.text !== 'string') throw failure('invalidResponse');
      if (isChatPending(item.status) && (item.role !== 'assistant' || typeof item.requestId !== 'string' || !item.requestId)) throw failure('invalidResponse');
      if (item.attachments !== undefined && (!Array.isArray(item.attachments) || item.attachments.some(file => !file || typeof file.id !== 'string' || !file.id || typeof file.name !== 'string' || !['image', 'text'].includes(file.kind)))) throw failure('invalidResponse');
      if (item.queue !== undefined && (!item.queue || !CHAT_QUEUE_LANES.includes(item.queue.lane) || !(item.queue.position === null || Number.isSafeInteger(item.queue.position) && item.queue.position >= 1))) throw failure('invalidResponse');
      try {
        if (item.payment !== undefined) assertChatPayment(item.payment);
        if (item.status === 'awaiting_confirmation' && item.payment?.state !== 'quoted') throw Error('quote');
        if (item.artifacts !== undefined && (!Array.isArray(item.artifacts) || item.artifacts.length > 4 || item.artifacts.some(artifact => { assertChatArtifact(artifact); return artifact.requestId !== item.requestId || item.role !== 'assistant' || item.status !== 'completed'; }))) throw Error('artifacts');
      } catch { throw failure('invalidResponse'); }
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
      if (isChatPending(receipt.status)) return;
    }
    const active = messages.find(message => message.role === 'assistant' && isChatPending(message.status));
    if (active) { state.activeRequest = active.requestId; state.activeConversation = conversationId; state.activeStatus = active.status; }
    else if (state.activeConversation === conversationId) { state.activeRequest = null; state.activeConversation = null; state.activeStatus = null; }
  }
  function acceptReceipt(value, expectedConversationId, expectedRequestId) {
    let receipt;
    try { receipt = assertChatReceipt(value); } catch { throw failure('invalidResponse'); }
    if (expectedConversationId && receipt.conversationId !== expectedConversationId) throw failure('invalidResponse');
    if (expectedRequestId && receipt.requestId !== expectedRequestId) throw failure('invalidResponse');
    if (isChatPending(receipt.status)) { state.activeRequest = receipt.requestId; state.activeConversation = receipt.conversationId; state.activeStatus = receipt.status; }
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
      const [data, status] = await Promise.all([api('/conversations/' + encodeURIComponent(id)), api('/status'), loadCoinWallet()]);
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
    clearError(); if (state.selected !== id) state.messages = []; state.selected = id; state.historyUnverified = true; renderHistory(); renderMessages();
    try {
      const [data, status] = await Promise.all([api('/conversations/' + encodeURIComponent(id)), api('/status'), loadCoinWallet()]);
      const messages = validMessages(data, id), nextStatus = validStatus(status);
      if (selectionEpoch !== state.selectionEpoch) return;
      await updateActive(messages, id);
      if (selectionEpoch !== state.selectionEpoch) return;
      state.status = nextStatus; rememberConversation(data.conversation); state.messages = messages; state.historyUnverified = false;
      renderStatus(); renderHistory(); renderMessages(forceScroll); schedulePoll();
    } catch (error) { if (selectionEpoch === state.selectionEpoch) showError(error); }
  }
  async function deleteConversation(id) {
    if (state.busy || state.uncertain || state.historyUnverified || state.activeConversation === id) return;
    const conversation = state.conversations.find(item => item.id === id);
    const title = conversation?.title || 'esta conversa';
    if (!window.confirm(`Excluir "${title}" e suas mensagens? Esta ação não pode ser desfeita. Registros financeiros permanecem no extrato.`)) return;
    const epoch = state.epoch; state.busy = true; clearError(); controls();
    try {
      await api('/conversations/' + encodeURIComponent(id) + '/delete', 'POST', {});
      if (epoch !== state.epoch) return;
      const selected = state.selected === id;
      state.conversations = state.conversations.filter(item => item.id !== id);
      if (selected) {
        state.selectionEpoch += 1; state.selected = null; state.messages = []; state.activeConversation = null; state.activeRequest = null; state.activeStatus = null;
        state.pending = null; state.pendingConfirmation = null; state.historyUnverified = false; clearAttachments();
        for (const url of previewCache.values()) if (url) URL.revokeObjectURL(url); previewCache.clear();
        for (const entry of artifactCache.values()) if (entry.url) URL.revokeObjectURL(entry.url); artifactCache.clear(); messageNodes.clear();
      }
      renderHistory(); renderMessages(); announce('Conversa excluída do histórico privado.');
      await loadConversations(false);
    } catch (error) { if (epoch === state.epoch) showError(error); }
    finally { if (epoch === state.epoch) { state.busy = false; controls(); } }
  }
  async function loadConversations(initial = false) {
    if (state.loading || (storeReference && !state.token)) return;
    const epoch = state.epoch; state.loading = true; clearError(); controls();
    try {
      const [status, data] = await Promise.all([api('/status'), api('/conversations'), loadCoinWallet()]);
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
    if (state.pendingConfirmation) return recoverConfirmation();
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
  async function confirmPayment(message) {
    if (state.busy || state.uncertain || state.historyUnverified || state.activeRequest !== message.requestId || state.status?.paidGenerationEnabled !== true || !state.status?.wallet) return;
    const payment = assertChatPayment(message.payment);
    if (payment.state !== 'quoted' || Date.now() >= payment.expiresAt || state.status.wallet.availableMicro < payment.amountMicro) return;
    const epoch = state.epoch;
    state.pendingConfirmation = Object.freeze({ requestId: message.requestId, conversationId: state.selected, quoteId: payment.quoteId, idempotencyKey: crypto.randomUUID() });
    state.busy = true; clearError(); controls();
    try {
      const pending = state.pendingConfirmation;
      const data = await api('/requests/' + encodeURIComponent(pending.requestId) + '/confirm', 'POST', { quoteId: pending.quoteId, idempotencyKey: pending.idempotencyKey });
      acceptReceipt(data, pending.conversationId, pending.requestId);
      state.pendingConfirmation = null;
      await selectConversation(pending.conversationId, false);
      announce('Confirmação registrada. Acompanhe o pedido e os créditos nesta conversa.');
    } catch (error) {
      if (epoch !== state.epoch) return;
      if (!error.status || error.status >= 500) { state.uncertain = true; state.retryAllowed = false; announce('A confirmação pode ter sido recebida. Confira o pedido sem reenviar nem gerar outra vez.'); }
      else state.pendingConfirmation = null;
      showError(error);
    } finally { if (epoch === state.epoch) { state.busy = false; controls(); } }
  }
  async function recoverConfirmation() {
    if (!state.pendingConfirmation || state.busy) return;
    const pending = state.pendingConfirmation, epoch = state.epoch; state.busy = true; clearError(); controls();
    try {
      const data = await api('/requests/' + encodeURIComponent(pending.requestId));
      const receipt = acceptReceipt(data.request, pending.conversationId, pending.requestId);
      // Awaiting approval is not evidence that an in-flight POST was rejected.
      // Keep the hold until a durable post-confirmation state is observed.
      if (receipt.status === 'awaiting_confirmation') { announce('Confirmação ainda não comprovada. Não houve reenvio automático. Confira novamente em instantes.'); return; }
      state.pendingConfirmation = null; state.uncertain = false;
      await selectConversation(pending.conversationId, false);
      announce('Estado da confirmação recuperado. O pedido não foi repetido.');
    } catch (error) { showError(error); }
    finally { if (epoch === state.epoch) { state.busy = false; controls(); } }
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
      if (await tryOperationalCommand(message)) return;
      if (state.attachments.some(item => item.kind === 'operation-media')) throw failure('invalid');
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
    for (const entry of artifactCache.values()) if (entry.url) URL.revokeObjectURL(entry.url); artifactCache.clear(); messageNodes.clear(); $('messages').replaceChildren();
    clearAttachments();
    Object.assign(state, { token: '', status: null, conversations: [], messages: [], selected: null, activeRequest: null, activeConversation: null, activeStatus: null, pending: null, pendingConfirmation: null, uncertain: false, retryAllowed: false, busy: false, loading: false, historyUnverified: false });
    Object.assign(credit, { status: null, busy: false, pending: null, uncertain: false, open: false }); $('credits-terms').checked = false; renderCredits();
    coinWallet = null; coinsChecked = false;
    $('access-token').value = ''; $('command').value = ''; $('disconnect').hidden = true;
    $('access-status').textContent = 'Acesso esquecido nesta página. Mensagens já enviadas permanecem no histórico privado.';
    clearError(); renderStatus(); renderHistory(); renderMessages(); renderAttachments();
  }
  $('billing-link').href = storeReference ? '/neural-billing.html?store=' + encodeURIComponent(storeReference) : '/central-creditos.html';
  $('credits-toggle').addEventListener('click', () => { credit.open = !credit.open; renderCredits(); if (credit.open) loadCredits(); });
  $('credits-refresh').addEventListener('click', loadCredits);
  $('credits-terms').addEventListener('change', controls);
  $('credits-retry').addEventListener('click', () => startCheckout(undefined, true));
  $('tasks-link').href = '/neural-tasks.html' + (storeReference ? '?store=' + encodeURIComponent(storeReference) : '');
  $('advanced-link').hidden = !!storeReference || personal;
  if (personal) { $('admin-login').href = '/minha-conta.html?returnTo=' + encodeURIComponent('/neural-workspace.html?personal=1'); $('admin-login').textContent = 'Entrar na minha conta'; $('account-label').textContent = 'Chat privado da sua conta'; $('tasks-link').hidden = true; }
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
  else loadConversations(true).then(() => { if (params.get('credits') === '1') { credit.open = true; renderCredits(); loadCredits(); } });
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') mountNeuralWorkspace();
