export const TRIAL_VERSION = 'building-trial-30d-v1';
export const TRIAL_PLAN = 'basic_monthly_trial';
const money = cents => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) + ' (Brasília)' : 'a data informada na assinatura';
const terminal = ['cancelled', 'canceled', 'rejected', 'refunded', 'charged_back', 'failed'];

// Offer copy and consent are tied to the exact conditions supported by this UI.
export function validTrial(config) {
  const trial = config?.buildingTrial;
  return trial?.enabled === true && trial.days === 30 && trial.monthlyCents === 1000 && trial.version === TRIAL_VERSION;
}

export function subscriptionPayload(values, { config, trial, accepted }) {
  if (!config) throw new Error('Aguarde a consulta das condições da assinatura.');
  const body = Object.fromEntries(['lotCode', 'businessName', 'segment', 'name', 'whatsapp', 'email'].map(key => [key, String(values[key] || '').trim()]));
  body.consent = values.consent === true || values.consent === 'on';
  body.planCode = trial ? TRIAL_PLAN : 'basic_monthly';
  if (trial) {
    if (!validTrial(config)) throw new Error('O período grátis não está disponível. Nenhuma assinatura paga foi criada.');
    if (accepted !== true) throw new Error('Confirme o aceite dos 30 dias grátis e da cobrança mensal posterior.');
    body.trialConsent = true;
    body.trialConsentVersion = TRIAL_VERSION;
  }
  return body;
}

export function safeSubscriptionCheckout(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['www.mercadopago.com.br', 'mercadopago.com.br', 'www.mercadopago.com', 'mercadopago.com'].includes(url.hostname) && !url.username && !url.password && !url.port ? url.href : '';
  } catch { return ''; }
}

export function buildingOrderState(order, now = Date.now()) {
  if (!order) return { kind: 'unknown', title: 'Não foi possível confirmar a assinatura', text: 'Consulte novamente ou fale com a equipe. O retorno do Mercado Pago, sozinho, não confirma a ativação.', active: false, pending: false };
  const status = order.status || order.paymentStatus;
  const sub = order.subscriptionStatus;
  const trial = Boolean(order.trialVersion);
  const active = status === 'approved';
  if (terminal.includes(status) || terminal.includes(sub)) return { kind: 'closed', title: 'Assinatura encerrada', text: 'Esta assinatura não está ativa. O cancelamento encerra a disponibilidade do prédio e da vitrine.', active: false, pending: false };
  if (['paused', 'awaiting_payment', 'cancellation_pending', 'conflict'].includes(sub) || status === 'paused') {
    const texts = { paused: 'A assinatura está pausada. A vitrine não está disponível enquanto o acesso estiver suspenso.', awaiting_payment: 'O período grátis terminou. A confirmação da mensalidade ainda está pendente e o acesso está suspenso.', cancellation_pending: 'O cancelamento está em verificação. Ainda não há confirmação de encerramento; consulte novamente ou fale com a equipe.', conflict: 'A reserva precisa de atendimento da equipe. Não crie outra assinatura para tentar resolver.' };
    return { kind: 'attention', title: sub === 'cancellation_pending' ? 'Verificando cancelamento' : 'Assinatura precisa de atenção', text: texts[sub] || texts.paused, active: false, pending: sub === 'cancellation_pending' };
  }
  if (trial && active && order.trialActive === true && Date.parse(order.trialUntil) > now) return { kind: 'trial', title: 'Seu período grátis está ativo!', text: `Sem mensalidade durante o teste. A primeira cobrança de ${money(order.billingAmountCents || 1000)} está prevista para ${date(order.trialUntil)}; depois, a renovação é mensal automática. Cancele antes dessa data para não receber a primeira cobrança.`, active: true, pending: false };
  if (active && (order.paymentReceived === true || order.billingType === 'one_time')) return { kind: 'paid', title: 'Pagamento confirmado', text: order.billingType === 'one_time' ? 'Seu pagamento e a reserva do prédio foram confirmados. Você pode enviar os materiais para revisão.' : 'Sua assinatura está ativa. A renovação mensal é processada pelo Mercado Pago.', active: true, pending: false };
  if (active && !trial) return { kind: 'authorized', title: 'Assinatura autorizada', text: 'A autorização foi confirmada pelo Mercado Pago. O recebimento da mensalidade ainda não foi confirmado.', active: true, pending: false };
  if (trial && active) return { kind: 'attention', title: 'Verificando a mensalidade', text: 'Não há confirmação de período grátis ativo nem de mensalidade recebida. Consulte novamente para conferir o acesso.', active: false, pending: true };
  return { kind: 'pending', title: trial ? 'Falta autorizar sua assinatura' : 'Assinatura pendente', text: trial ? `Sua reserva foi solicitada, mas o período grátis ainda não está ativo. Conclua a autorização no Mercado Pago. Os 30 dias contam desde a solicitação da reserva; a primeira cobrança está prevista para ${date(order.trialUntil)}. Você também pode cancelar abaixo.` : 'O Mercado Pago ainda não confirmou a autorização da assinatura. Consulte novamente em instantes.', active: false, pending: true };
}

export function canCancelBuilding(order, token) {
  return Boolean(token && order && (order.billingType === 'recurring' || order.trialVersion) && !terminal.includes(order.status || order.paymentStatus) && !terminal.includes(order.subscriptionStatus));
}

export function readManageToken(reference, win = window) {
  for (const store of ['localStorage', 'sessionStorage']) { try { const value = win[store].getItem('vc_store_' + reference); if (value) return value; } catch {} }
  return '';
}

export function saveManageToken(reference, token, win = window) {
  if (!reference || !token) return false;
  for (const store of ['localStorage', 'sessionStorage']) { try { win[store].setItem('vc_store_' + reference, token); return true; } catch {} }
  return false;
}

export function mountBuildingCheckout({ doc = document, win = window, fetchImpl = fetch } = {}) {
  const byId = id => doc.getElementById(id), form = byId('checkout-form'), button = byId('checkout-button'), message = byId('message');
  const consent = byId('trialConsent'), terms = form.elements.consent;
  const params = new URLSearchParams(win.location.search), requestedTrial = params.get('plano') === TRIAL_PLAN, explicitPaid = params.get('plano') === 'basic_monthly';
  let config = null, useTrial = false, loading = true, submitting = false, uncertain = false, lotsReady = false, hasLot = false;
  const update = () => { button.disabled = loading || submitting || uncertain || !lotsReady || !hasLot || !config || (useTrial && !consent.checked) || !terms.checked; };
  const lots = [...doc.querySelectorAll('.lot')];
  function choose(lot) {
    if (!lot || lot.disabled) return;
    lots.forEach(item => item.classList.toggle('active', item === lot));
    byId('lotCode').value = lot.dataset.lot;
    byId('previewLot').textContent = lot.dataset.label;
    byId('previewPlace').textContent = lot.dataset.place;
    const query = new URLSearchParams(win.location.search); query.set('lote', lot.dataset.lot);
    win.history.replaceState(null, '', '?' + query.toString());
  }
  lots.forEach(lot => lot.addEventListener('click', () => choose(lot)));
  choose(lots.find(lot => lot.dataset.lot === params.get('lote')));
  byId('businessName').addEventListener('input', () => { byId('storePreview').textContent = byId('businessName').value.trim().slice(0, 28) || 'SUA MARCA'; });
  consent.checked = false;
  consent.addEventListener('change', update); terms.addEventListener('change', update);
  async function load() {
    try {
      const response = await fetchImpl('/api/payments/mercadopago/config', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const loaded = await response.json();
      if (!loaded || typeof loaded !== 'object' || (loaded.buildingTrial?.enabled === true && !validTrial(loaded))) throw new Error();
      useTrial = !explicitPaid && validTrial(loaded);
      if (requestedTrial && !useTrial) {
        message.textContent = 'O período grátis não está disponível agora. Nenhuma assinatura paga foi criada.';
        byId('paid-option').hidden = false;
      } else {
        config = loaded;
        byId('checkout-price').textContent = useTrial ? '30 dias grátis' : 'R$10 por mês';
        byId('checkout-renewal').textContent = useTrial ? 'Depois, R$10/mês com renovação automática pelo Mercado Pago.' : 'Renovação mensal automática pelo Mercado Pago.';
        byId('trial-conditions').hidden = !useTrial;
        byId('trial-consent-label').hidden = !useTrial;
        consent.required = useTrial;
        button.textContent = useTrial ? 'Começar 30 dias grátis' : 'Assinar por R$10/mês';
      }
    } catch { message.textContent = 'Não foi possível consultar as condições. Recarregue a página para tentar novamente; nenhuma assinatura foi criada.'; }
    finally { loading = false; update(); }
  }
  const ready = Promise.all([load(), (async () => {
    try {
      const response = await fetchImpl('/api/lots', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const data = await response.json();
      for (const lot of lots) {
        const current = data.lots?.find(item => item.code === lot.dataset.lot);
        lot.disabled = current?.status !== 'available';
        if (lot.disabled) lot.querySelector('small').textContent = current?.status === 'occupied' ? (current.businessName || 'Lote ocupado') : 'Indisponível para reserva';
      }
      hasLot = lots.some(lot => !lot.disabled);
      const selected = lots.find(lot => lot.classList.contains('active'));
      if (!selected || selected.disabled) choose(lots.find(lot => !lot.disabled));
      if (!hasLot) message.textContent = 'Os prédios desta fase já foram reservados. Consulte a equipe sobre novos endereços.';
    } catch { message.textContent = 'Não foi possível verificar os prédios disponíveis. Recarregue a página antes de reservar.'; }
    finally { lotsReady = true; update(); }
  })()]);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled || submitting || !form.reportValidity()) return;
    let body;
    try { body = subscriptionPayload(Object.fromEntries(new win.FormData(form)), { config, trial: useTrial, accepted: consent.checked }); }
    catch (error) { message.textContent = error.message; return; }
    submitting = true; update(); button.textContent = 'Abrindo Mercado Pago…'; message.textContent = '';
    let response;
    try {
      response = await fetchImpl('/api/payments/mercadopago/subscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      uncertain = response.ok;
      const data = await response.json();
      let saved = false;
      if (data.reference && data.manageToken) {
        saved = saveManageToken(data.reference, data.manageToken, win);
        const manage = byId('manage-reservation');
        manage.href = `/painel-lojista.html?ref=${encodeURIComponent(data.reference)}&token=${encodeURIComponent(data.manageToken)}`;
        manage.hidden = false;
      }
      if (!response.ok) {
        uncertain = response.status >= 500;
        throw new Error(data.error || 'Não foi possível iniciar a assinatura.');
      }
      const url = safeSubscriptionCheckout(data.checkoutUrl);
      if (!url || !data.reference || !data.manageToken || (useTrial && (data.trialVersion !== TRIAL_VERSION || !Number.isFinite(Date.parse(data.trialUntil)) || data.billingAmountCents !== 1000))) {
        uncertain = true;
        throw new Error('A reserva precisa ser verificada antes de continuar. Use a gestão da reserva ou fale com a equipe; não faça outra solicitação.');
      }
      if (!saved) {
        const continueLink = byId('continue-subscription');
        continueLink.href = url; continueLink.hidden = false;
        message.textContent = 'Seu navegador não permitiu guardar o acesso. Salve o link “Gerenciar ou cancelar minha reserva” e mantenha esta página aberta. Continue no Mercado Pago em outra aba pelo botão abaixo.';
        return;
      }
      win.location.assign(url);
    } catch (error) {
      if (!response) uncertain = true;
      message.textContent = uncertain ? `${error.message || 'Não foi possível confirmar a resposta.'} Não repita a solicitação; consulte a equipe ou a gestão da reserva.` : error.message;
      submitting = false; button.textContent = useTrial ? 'Começar 30 dias grátis' : 'Assinar por R$10/mês'; update();
    }
  });
  update();
  return { ready };
}

export async function mountBuildingLanding({ doc = document, fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl('/api/payments/mercadopago/config', { cache: 'no-store' });
    if (!response.ok || !validTrial(await response.json())) return false;
    doc.querySelectorAll('[data-building-trial]').forEach(item => { item.hidden = false; });
    doc.querySelectorAll('[data-building-paid]').forEach(item => { item.hidden = true; });
    doc.querySelectorAll('a[href^="/comprar-lote.html"]').forEach(link => { link.href = '/comprar-lote.html?plano=' + TRIAL_PLAN; });
    return true;
  } catch { return false; }
}

export function mountBuildingStatus({ doc = document, win = window, fetchImpl = fetch, panel = false, onActivated = () => {} } = {}) {
  const byId = id => doc.getElementById(id), query = new URLSearchParams(win.location.search);
  const reference = query.get('external_reference') || query.get('ref') || '', token = query.get('token') || readManageToken(reference, win);
  let order = null, busy = false, timer = null, attempts = 0;
  const message = byId('billing-message'), cancel = byId('cancel-subscription'), refresh = byId('refresh-subscription');
  if (token) saveManageToken(reference, token, win);
  async function refreshOrder() {
    if (!reference || busy) return;
    busy = true; refresh.disabled = true;
    try {
      const response = await fetchImpl('/api/orders/' + encodeURIComponent(reference), { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const previouslyInactive = order && !buildingOrderState(order).active;
      order = await response.json();
      const state = buildingOrderState(order);
      if (panel) {
        doc.documentElement.dataset.subscriptionSuspended = String(!state.active);
        if (!state.active) doc.querySelectorAll('[data-panel]').forEach(item => { item.hidden = true; });
        if (state.active && previouslyInactive) onActivated();
      }
      byId(panel ? 'billing-title' : 'title').textContent = state.title;
      byId(panel ? 'billing-text' : 'text').textContent = state.text;
      if (!panel) {
        byId('icon').textContent = state.active ? '✅' : state.pending ? '⏳' : 'ℹ️';
        byId('steps').classList.toggle('show', state.active);
        const manage = byId('storeAction');
        manage.hidden = !token;
        manage.textContent = state.active ? 'Configurar minha loja' : 'Gerenciar minha reserva';
        if (token) manage.href = `/painel-lojista.html?ref=${encodeURIComponent(reference)}&token=${encodeURIComponent(token)}`;
        if (order.lot) {
          byId('lot').classList.add('show'); byId('business').textContent = order.businessName || 'Sua vitrine';
          byId('lotLabel').textContent = order.lot.label || order.lot.code; byId('lotPlace').textContent = order.lot.place || 'VitrineCity';
          byId('segment').textContent = order.segment || '—'; byId('orderReference').textContent = reference;
          if (typeof order.lot.mapUrl === 'string' && order.lot.mapUrl.startsWith('/') && !order.lot.mapUrl.startsWith('//')) byId('mapAction').href = order.lot.mapUrl;
        }
      }
      cancel.hidden = !canCancelBuilding(order, token);
      cancel.textContent = order.trialVersion && !order.paymentReceived ? 'Cancelar reserva e assinatura' : 'Cancelar assinatura mensal';
      message.textContent = '';
      if (state.pending && attempts++ < 24 && !timer) timer = win.setTimeout(() => { timer = null; refreshOrder(); }, 5000);
    } catch { message.textContent = 'Não foi possível atualizar a situação. Nenhuma confirmação foi presumida. Tente consultar novamente.'; }
    finally { busy = false; refresh.disabled = false; }
  }
  refresh.addEventListener('click', refreshOrder);
  cancel.addEventListener('click', async () => {
    if (busy || !canCancelBuilding(order, token)) return;
    if (!win.confirm('Cancelar esta reserva e a renovação mensal? O prédio e a vitrine deixarão de estar disponíveis imediatamente. Cancelando antes da primeira cobrança, você não paga a mensalidade do teste.')) return;
    busy = true; cancel.disabled = true; refresh.disabled = true; message.textContent = 'Solicitando cancelamento…';
    try {
      const response = await fetchImpl(`/api/store-portal/${encodeURIComponent(reference)}/cancel-subscription`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      const data = await response.json();
      if (!response.ok || data.status !== 'cancelled') throw new Error(data.error || 'O cancelamento ainda não foi confirmado. Consulte novamente ou fale com a equipe.');
      order = { ...order, ...data, status: 'cancelled' };
      const state = buildingOrderState(order);
      byId(panel ? 'billing-title' : 'title').textContent = state.title; byId(panel ? 'billing-text' : 'text').textContent = state.text;
      cancel.hidden = true;
      if (timer) { win.clearTimeout(timer); timer = null; }
      if (!panel) byId('steps').classList.remove('show');
      else { doc.documentElement.dataset.subscriptionSuspended = 'true'; byId('form').hidden = true; doc.querySelectorAll('[data-panel]').forEach(item => { item.hidden = true; }); }
      message.textContent = 'Cancelamento confirmado pelo Mercado Pago.';
    } catch (error) { message.textContent = error.message || 'Não foi possível confirmar o cancelamento. Consulte novamente ou fale com a equipe.'; }
    finally { busy = false; cancel.disabled = false; refresh.disabled = false; }
  });
  if (!reference) { byId(panel ? 'billing-title' : 'title').textContent = 'Referência não informada'; message.textContent = 'Abra o link da sua reserva para consultar ou cancelar.'; refresh.disabled = true; }
  const ready = refreshOrder();
  return { ready };
}
