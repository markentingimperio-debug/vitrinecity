(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const storeReference = new URLSearchParams(location.search).get('store') || '';
  const isStore = Boolean(storeReference);
  const adminBase = '/api/admin/vitriny-neural/billing';
  const storeBase = '/api/store-portal/' + encodeURIComponent(storeReference) + '/neural/billing';
  const state = { token: '', reference: storeReference, status: null, plans: [], periods: [], ledger: [], busy: false, loading: false, epoch: 0, pending: new Map() };
  const requests = new Set();
  const messages = {
    unauthorized: 'Entre novamente para acessar os créditos desta conta.',
    forbidden: 'Este acesso não tem permissão para consultar ou alterar estes créditos.',
    mfa: 'Conclua o segundo fator no portal da loja e conecte novamente.',
    unavailable: 'Não foi possível consultar o serviço. Tente atualizar em instantes.',
    invalid: 'Revise os campos: créditos inteiros, datas válidas e referências corretas são obrigatórios.',
    conflict: 'O registro já existe, está em uso ou mudou de estado. Atualize antes de tentar novamente.',
    notFound: 'Loja, plano, período ou tarefa não disponível para este acesso.',
    disabled: 'O controle de créditos não está habilitado para esta operação.',
    timeout: 'A confirmação não chegou. A operação pode ter sido registrada. Atualize antes de tentar novamente; repetir os mesmos dados mantém a identificação do pedido.',
    invalidResponse: 'O servidor devolveu uma resposta inválida. Atualize antes de repetir uma operação.'
  };
  const movementLabels = { grant: 'Franquia concedida', reserve: 'Reserva de tarefa', charge: 'Consumo confirmado', settle: 'Consumo confirmado', release: 'Reserva liberada', revoke: 'Período revogado', review_required: 'Aguardando revisão', reconcile: 'Revisão manual', resolve: 'Revisão manual', adjustment: 'Ajuste registrado' };
  const fail = (key, status) => Object.assign(new Error(messages[key] || messages.unavailable), { key, status });
  const textNode = (tag, text) => { const element = document.createElement(tag); if (text != null) element.textContent = String(text); return element; };
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('pt-BR') : '—';
  const date = value => typeof value === 'number' && Number.isFinite(value) && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleString('pt-BR') : '—';
  function clearError() { $('error').hidden = true; $('error').textContent = ''; }
  function showError(error) {
    if (error?.key === 'stale') return;
    $('error').textContent = messages[error?.key] || messages.unavailable; $('error').hidden = false;
    if (!isStore && error?.status === 401) $('admin-login').hidden = false;
  }
  function httpError(status) { return fail(({ 400: 'invalid', 401: 'unauthorized', 403: 'forbidden', 404: 'notFound', 409: 'conflict', 413: 'invalid', 422: 'invalid', 428: 'mfa', 429: 'conflict', 503: 'disabled' })[status] || 'unavailable', status); }
  async function api(url, method = 'GET', body) {
    const epoch = state.epoch, controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000); requests.add(controller);
    try {
      const headers = { Accept: 'application/json' };
      if (isStore && state.token) headers['x-store-token'] = state.token;
      if (method !== 'GET') { headers['content-type'] = 'application/json'; headers['x-neural-request'] = '1'; }
      const response = await fetch(url, { method, headers, credentials: 'same-origin', cache: 'no-store', signal: controller.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (epoch !== state.epoch) throw fail('stale');
      if (!response.ok) throw httpError(response.status);
      let data; try { data = await response.json(); } catch { throw fail('invalidResponse'); }
      if (epoch !== state.epoch) throw fail('stale');
      if (!data || data.ok !== true) throw fail('invalidResponse');
      return data;
    } catch (error) {
      if (epoch !== state.epoch) throw fail('stale');
      if (error?.name === 'AbortError') throw fail('timeout');
      if (!error?.key && method !== 'GET') throw fail('timeout');
      throw error;
    } finally { clearTimeout(timer); requests.delete(controller); }
  }
  function scopeBase() { return isStore ? storeBase : adminBase + '/stores/' + encodeURIComponent(state.reference); }
  function controls() {
    const locked = state.busy || state.loading;
    $('connect').disabled = locked; $('load-store').disabled = locked; $('store-reference').disabled = locked;
    $('refresh').disabled = locked || !state.reference || (isStore && !state.token);
    $('create-plan').disabled = isStore || locked;
    $('grant-period').disabled = isStore || locked || !state.reference || !state.status?.enabled || !state.plans.length;
    $('resolve-task-submit').disabled = isStore || locked || !state.reference || !state.status?.enabled;
    for (const button of $('periods').querySelectorAll('button')) button.disabled = locked;
    for (const id of ['plan-form', 'period-form', 'resolve-form']) $(id).setAttribute('aria-busy', String(state.busy));
  }
  function renderPlans() {
    const list = $('plans'), select = $('period-plan'), selected = select.value;
    list.replaceChildren(); select.replaceChildren();
    const placeholder = textNode('option', 'Selecione um plano'); placeholder.value = ''; select.append(placeholder);
    for (const plan of state.plans) {
      if (!plan || typeof plan.code !== 'string') continue;
      list.append(textNode('li', (plan.name || plan.code) + ' [' + plan.code + '] · ' + number(plan.monthlyCredits) + ' créditos/período · reserva ' + number(plan.taskReserveCredits) + '/tarefa · entrada ' + number(plan.inputCreditsPer1000) + ' e saída ' + number(plan.outputCreditsPer1000) + ' créditos/1.000 tokens'));
      const option = textNode('option', (plan.name || plan.code) + ' [' + plan.code + ']'); option.value = plan.code; select.append(option);
    }
    select.value = state.plans.some(plan => plan.code === selected) ? selected : '';
    if (!list.children.length) list.append(textNode('li', 'Nenhum plano interno cadastrado.'));
  }
  function renderStatus() {
    const status = state.status;
    const periodLabel = ({ expired: 'Período encerrado', revoked: 'Período revogado', scheduled: 'Período ainda não iniciado' })[status?.state] || 'Sem período ativo';
    $('period-status').textContent = !status ? 'Selecione uma loja ou conecte seu acesso.' : !status.enabled ? 'Controle de créditos desabilitado. Nenhuma cobrança automática.' : (status.active ? 'Período ativo' : periodLabel) + ' · loja ' + state.reference;
    for (const [id, field] of [['granted', 'grantedCredits'], ['used', 'usedCredits'], ['reserved', 'reservedCredits']]) $(id).textContent = number(status?.[field]);
    $('available').textContent = number(!status ? undefined : status.spendableCredits ?? (status.active && status.enabled ? status.availableCredits : 0));
    $('period-window').textContent = status?.periodStart != null ? 'Validade: ' + date(status.periodStart) + ' até ' + date(status.periodEnd) : '';
    $('plan-detail').textContent = status?.plan ? 'Plano: ' + String(status.plan.name || status.plan.code || 'interno') + ' · reserva por tarefa: ' + number(status.plan.taskReserveCredits) + ' créditos.' : '';
    const pending = status?.pendingReviews;
    $('pending-status').textContent = typeof pending === 'number' && pending > 0 ? number(pending) + ' tarefa(s) aguardando revisão de consumo.' : status?.reservedCredits > 0 ? 'Há créditos reservados. Confira tarefas em andamento e eventuais revisões pendentes com a administração.' : '';
  }
  function renderLedger() {
    const list = $('ledger'); list.replaceChildren(); $('ledger-empty').hidden = state.ledger.length > 0;
    for (const item of state.ledger) {
      if (!item || typeof item !== 'object') continue;
      const row = textNode('tr');
      const reason = ({ usage_incomplete: 'Consumo sem medição completa; reserva retida.', reserved_budget_exceeded: 'Consumo requer revisão do limite reservado.' })[item.reason] || item.reason;
      row.append(textNode('td', date(item.createdAt)), textNode('td', movementLabels[item.type] || 'Registro de créditos'), textNode('td', item.type === 'review_required' ? 'Sem débito final' : number(item.amountCredits)), textNode('td', [item.taskId, reason].filter(value => typeof value === 'string' && value).join(' · ') || '—'));
      list.append(row);
    }
  }
  function renderPeriods() {
    const list = $('periods'); list.replaceChildren();
    for (const period of state.periods) {
      if (!period || typeof period.id !== 'string') continue;
      const revoked = !!period.revokedAt || period.status === 'revoked';
      const entry = textNode('li');
      entry.append(textNode('span', 'Período ' + period.id + ' · ' + date(period.periodStart) + ' até ' + date(period.periodEnd) + ' · ' + number(period.grantedCredits) + ' créditos' + (revoked ? ' · revogado' : '')));
      if (!revoked) {
        const button = textNode('button', 'Revogar período'); button.type = 'button'; button.className = 'secondary';
        button.addEventListener('click', () => revokePeriod(period.id)); entry.append(button);
      }
      list.append(entry);
    }
  }
  function render() { renderStatus(); renderLedger(); if (!isStore) { renderPlans(); renderPeriods(); } controls(); }
  async function reloadScope() {
    if (!state.reference || (isStore && !state.token)) return;
    const base = scopeBase();
    const [status, ledger, periods] = await Promise.all([api(base + '/status'), api(base + '/ledger'), isStore ? Promise.resolve({ items: [] }) : api(base + '/periods')]);
    if (!Array.isArray(ledger.items) || !Array.isArray(periods.items)) throw fail('invalidResponse');
    state.status = status; state.ledger = ledger.items; state.periods = periods.items; render();
    if (isStore) $('access-status').textContent = 'Loja conectada. O acesso será esquecido ao sair desta página.';
  }
  async function load() {
    if (state.loading || state.busy || (isStore && !state.token)) return;
    const epoch = state.epoch; state.loading = true; clearError(); controls();
    try {
      if (!isStore) { const plans = await api(adminBase + '/plans'); if (!Array.isArray(plans.items)) throw fail('invalidResponse'); state.plans = plans.items; }
      await reloadScope(); render();
    } catch (error) {
      if (epoch === state.epoch) { state.status = null; state.ledger = []; state.periods = []; render(); showError(error); }
    } finally { if (epoch === state.epoch) { state.loading = false; controls(); } }
  }
  function integer(id, minimum = 0) { const raw = $(id).value.trim(), value = Number(raw); if (!raw || !Number.isSafeInteger(value) || value < minimum) throw fail('invalid'); return value; }
  function required(id) { const value = $(id).value.trim(); if (!value) throw fail('invalid'); return value; }
  async function mutate(url, payload, success, idempotent = false) {
    if (isStore || state.busy || state.loading) return;
    const epoch = state.epoch;
    const signature = url + '\n' + JSON.stringify(payload);
    let body = payload;
    if (idempotent) {
      if (!state.pending.has(signature)) state.pending.set(signature, crypto.randomUUID());
      body = { ...payload, idempotencyKey: state.pending.get(signature) };
    }
    state.busy = true; clearError(); controls();
    try {
      await api(url, 'POST', body); state.pending.delete(signature);
      $('announcement').textContent = success;
      if (url === adminBase + '/plans') { const plans = await api(adminBase + '/plans'); if (!Array.isArray(plans.items)) throw fail('invalidResponse'); state.plans = plans.items; }
      await reloadScope(); render();
    } catch (error) { showError(error); }
    finally { if (epoch === state.epoch) { state.busy = false; controls(); } }
  }
  function forget() {
    state.epoch += 1;
    for (const controller of requests) controller.abort(); requests.clear();
    state.token = ''; state.status = null; state.ledger = []; state.periods = []; state.plans = []; state.pending.clear(); state.busy = false; state.loading = false;
    $('access-token').value = ''; $('disconnect').hidden = true; $('access-status').textContent = 'Aguardando autenticação.'; $('announcement').textContent = '';
    for (const id of ['resolve-task', 'resolve-reason', 'resolve-credits', 'period-start', 'period-end']) $(id).value = '';
    clearError(); render();
  }
  async function revokePeriod(id) {
    if (isStore || state.busy || state.loading || !state.status) return;
    if (!window.confirm('Revogar o período ' + id + ' da loja ' + state.reference + '? Isso bloqueia novas reservas neste período e não realiza estorno financeiro.')) return;
    await mutate(scopeBase() + '/periods/' + encodeURIComponent(id) + '/revoke', {}, 'Revogação registrada. Nenhuma transação financeira foi realizada.');
  }
  $('access-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!isStore || state.busy || state.loading) return;
    const token = $('access-token').value.trim(); if (!token) return;
    forget(); state.token = token; $('disconnect').hidden = false; await load();
  });
  $('disconnect').addEventListener('click', forget);
  $('store-form').addEventListener('submit', async event => {
    event.preventDefault(); if (isStore || state.busy || state.loading) return;
    const reference = $('store-reference').value.trim(); if (!reference) return;
    state.reference = reference; state.status = null; state.ledger = []; state.periods = []; $('announcement').textContent = ''; render(); await load();
  });
  $('refresh').addEventListener('click', load);
  $('plan-form').addEventListener('submit', async event => {
    event.preventDefault(); if (isStore || state.busy || state.loading) return;
    try {
      const payload = { code: required('plan-code'), name: required('plan-name'), monthlyCredits: integer('plan-monthly', 1), taskReserveCredits: integer('plan-reserve', 1), inputCreditsPer1000: integer('plan-input'), outputCreditsPer1000: integer('plan-output') };
      if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(payload.code) || payload.name.length > 100 || payload.taskReserveCredits > payload.monthlyCredits) throw fail('invalid');
      await mutate(adminBase + '/plans', payload, 'Plano interno criado. Nenhum cliente foi cobrado.');
    } catch (error) { showError(error); }
  });
  $('period-form').addEventListener('submit', async event => {
    event.preventDefault(); if (isStore || state.busy || state.loading || !state.status?.enabled) return;
    try {
      const payload = { planCode: required('period-plan'), periodStart: new Date(required('period-start')).getTime(), periodEnd: new Date(required('period-end')).getTime() };
      if (!Number.isSafeInteger(payload.periodStart) || !Number.isSafeInteger(payload.periodEnd) || payload.periodEnd <= payload.periodStart) throw fail('invalid');
      if (!window.confirm('Conceder manualmente a franquia do plano ' + payload.planCode + ' à loja ' + state.reference + '? Isso não confirma pagamento nem cria cobrança automática.')) return;
      await mutate(scopeBase() + '/periods', payload, 'Período concedido manualmente. Nenhuma cobrança ou renovação automática foi criada.', true);
    } catch (error) { showError(error); }
  });
  $('resolve-form').addEventListener('submit', async event => {
    event.preventDefault(); if (isStore || state.busy || state.loading || !state.status?.enabled) return;
    try {
      const id = required('resolve-task'), payload = { chargeCredits: integer('resolve-credits'), reason: required('resolve-reason') };
      if (payload.reason.length < 5 || payload.reason.length > 500) throw fail('invalid');
      if (!window.confirm('Registrar débito final de ' + payload.chargeCredits + ' crédito(s) na tarefa ' + id + ' da loja ' + state.reference + '? Confirme somente após revisar a execução.')) return;
      await mutate(scopeBase() + '/tasks/' + encodeURIComponent(id) + '/resolve', payload, 'Revisão manual registrada no extrato.', true);
    } catch (error) { showError(error); }
  });
  window.addEventListener('pagehide', forget);
  $('store-access').hidden = !isStore; $('admin-store').hidden = isStore; $('admin-controls').hidden = isStore;
  $('account-label').textContent = isStore ? 'CRÉDITOS DA SUA LOJA' : 'ADMINISTRAÇÃO';
  $('chat-link').href = '/neural-workspace.html' + (isStore ? '?store=' + encodeURIComponent(storeReference) : '');
  controls(); if (!isStore) load();
})();
