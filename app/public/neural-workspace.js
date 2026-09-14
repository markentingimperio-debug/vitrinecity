(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const storeReference = new URLSearchParams(location.search).get('store') || '';
  const base = storeReference
    ? '/api/store-portal/' + encodeURIComponent(storeReference) + '/neural/tasks'
    : '/api/admin/vitriny-neural/tasks';
  const state = { token: '', status: null, tasks: [], selected: null, busy: false, loading: false, timer: null, epoch: 0, pending: null };
  $('billing-link').href = '/neural-billing.html' + (storeReference ? '?store=' + encodeURIComponent(storeReference) : '');
  const requests = new Set();
  const labels = { queued: 'Na fila', running: 'Preparando rascunho', draft_ready: 'Rascunho disponível', failed: 'Falhou', cancelled: 'Cancelada', interrupted: 'Interrompida', blocked: 'Recurso indisponível' };
  const kinds = { website: 'Rascunho de site ou código', content: 'Texto ou roteiro', unsupported: 'Integração pendente' };
  const errors = {
    credits: 'Saldo de créditos de IA insuficiente para reservar a tarefa. Consulte seu plano e extrato.',
    subscription: 'Seu acesso precisa de um período de plano de IA ativo. Consulte a administração.',
    usageReview: 'Consumo pendente de conferência. Os créditos reservados não foram tratados como uso gratuito.',
    unavailable: 'Não foi possível acessar a Neural. Tente atualizar em instantes.',
    unauthorized: 'Entre novamente para acessar as tarefas da sua conta.',
    forbidden: 'Este acesso não tem permissão ou plano habilitado para usar a Neural.',
    mfa: 'Conclua a verificação de segundo fator no portal da loja e depois conecte novamente nesta página.',
    quota: 'O limite de tarefas do seu acesso foi atingido. Confira as cotas antes de enviar outro comando.',
    disabled: 'O piloto da Neural não está habilitado para este acesso.',
    conflict: 'Já existe uma tarefa em andamento ou o estado mudou. Atualize o histórico antes de continuar.',
    invalid: 'Não foi possível aceitar este pedido. Revise o comando e tente novamente.',
    notFound: 'Esta tarefa ou arquivo não está disponível para o seu acesso.',
    integration: 'Este pedido exige uma integração ainda indisponível no piloto. Nenhuma publicação ou geração de mídia foi realizada.',
    local: 'O modelo local não está disponível ou habilitado. A equipe precisa configurar e verificar o serviço.',
    unqualified: 'Nenhum modelo local validado está disponível para esta tarefa. A administração precisa configurar o modelo e executar o benchmark antes de habilitar este recurso.',
    interrupted: 'A preparação foi interrompida. Nenhuma publicação foi realizada; revise o estado antes de criar outro pedido.',
    failed: 'A Neural não conseguiu preparar este rascunho. Nenhuma conclusão foi confirmada.',
    timeout: 'O servidor não respondeu a tempo. Atualize o histórico antes de reenviar; seu pedido pode já ter sido recebido.',
    invalidResponse: 'O servidor devolveu uma resposta inválida. Atualize o histórico antes de tentar novamente.'
  };
  const errorCodes = {
    billing_insufficient_credits: 'credits', billing_task_budget_exhausted: 'credits',
    billing_credits_exhausted: 'credits',
    billing_subscription_required: 'subscription', billing_usage_review_required: 'usageReview', billing_disabled: 'disabled',
    task_provider_unqualified: 'unqualified', model_unavailable: 'local', task_provider_failed: 'local',
    task_tool_unavailable: 'integration', task_disabled: 'disabled', tasks_disabled: 'disabled',
    task_scope_disabled: 'forbidden', task_scope_denied: 'forbidden', store_not_enabled: 'forbidden',
    task_busy: 'conflict', task_conflict: 'conflict', task_idempotency_conflict: 'conflict',
    task_quota_exhausted: 'quota', task_capacity_exhausted: 'quota', task_budget_exhausted: 'quota',
    task_not_found: 'notFound', task_file_not_found: 'notFound', task_input_invalid: 'invalid',
    task_interrupted: 'interrupted', task_timeout: 'timeout'
  };
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text != null) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  };
  function fail(key, status) { return Object.assign(new Error(errors[key] || errors.unavailable), { key, status }); }
  function clearError() { $('error').hidden = true; $('error').textContent = ''; }
  function showError(error) {
    if (error?.key === 'stale') return;
    $('error').textContent = errors[error?.key] || errors.unavailable;
    $('error').hidden = false;
    if (error?.status === 401 && !storeReference) $('admin-login').hidden = false;
  }
  function announce(message) { $('announcement').textContent = message; }
  function httpError(status, code) {
    if (status === 428) return fail('mfa', status);
    if (typeof code === 'string' && Object.hasOwn(errorCodes, code)) return fail(errorCodes[code], status);
    return fail(({ 400: 'invalid', 401: 'unauthorized', 403: 'forbidden', 404: 'notFound', 409: 'conflict', 413: 'invalid', 422: 'invalid', 428: 'mfa', 429: 'quota', 503: 'disabled' })[status] || 'unavailable', status);
  }
  async function api(path, method = 'GET', body, binary = false) {
    const epoch = state.epoch, controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    requests.add(controller);
    try {
      const headers = { Accept: binary ? 'application/octet-stream' : 'application/json' };
      if (storeReference && state.token) headers['x-store-token'] = state.token;
      if (method !== 'GET') { headers['content-type'] = 'application/json'; headers['x-neural-request'] = '1'; }
      const response = await fetch(base + path, { method, headers, credentials: 'same-origin', cache: 'no-store', signal: controller.signal, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      if (epoch !== state.epoch) throw fail('stale');
      if (!response.ok) {
        let detail = null; try { detail = await response.json(); } catch {}
        if (epoch !== state.epoch) throw fail('stale');
        throw httpError(response.status, detail?.code);
      }
      if (binary) {
        const blob = await response.blob();
        if (epoch !== state.epoch) throw fail('stale');
        return blob;
      }
      let data;
      try { data = await response.json(); } catch { throw fail('invalidResponse'); }
      if (epoch !== state.epoch) throw fail('stale');
      if (!data || data.ok !== true) throw fail('invalidResponse');
      return data;
    } catch (error) {
      if (epoch !== state.epoch) throw fail('stale');
      if (error?.name === 'AbortError') throw fail('timeout');
      throw error;
    } finally { clearTimeout(timeout); requests.delete(controller); }
  }
  function activeTask() { return state.tasks.find(task => task.status === 'running'); }
  function runsExhausted() { return state.status?.usage?.remainingRuns === 0; }
  function creditBlocked() { const b=state.status?.billing; return b?.enabled===true && (!b.active || b.availableCredits < (b.plan?.taskReserveCredits || 1)); }
  function canSend() { return !!state.status?.enabled && (!storeReference || !!state.token) && !state.busy && !state.loading && !activeTask() && !runsExhausted() && !creditBlocked(); }
  function controls() {
    $('send').disabled = !canSend();
    $('send').textContent = state.busy ? 'Processando…' : 'Enviar comando ↑';
    $('refresh').disabled = state.loading || state.busy || (!!storeReference && !state.token);
    $('connect').disabled = state.loading || state.busy;
    $('command-form').setAttribute('aria-busy', String(state.busy));
    $('start-task').disabled = state.busy || !state.status?.enabled || !!activeTask() || runsExhausted() || creditBlocked();
    $('start-task').title = runsExhausted() ? 'Cota diária de execuções esgotada.' : '';
    $('send').title = runsExhausted() ? 'Cota diária de execuções esgotada. Histórico e downloads continuam disponíveis.' : '';
    $('cancel-task').disabled = state.busy;
    for (const button of document.querySelectorAll('[data-example]')) button.disabled = state.busy;
  }
  function quotaText(usage, limits) {
    if (!usage || typeof usage !== 'object') return 'Cotas não informadas pelo servidor.';
    const number = value => Number.isFinite(Number(value)) && value !== null ? Math.max(0, Number(value)) : null;
    const used = number(usage.dailyTasks), limit = number(limits?.dailyTasks), remaining = number(usage.remaining);
    const runs = number(usage.dailyRuns), remainingRuns = number(usage.remainingRuns);
    const parts = [];
    if (used !== null) parts.push(used + ' tarefa(s) usada(s)');
    if (limit !== null) parts.push('limite ' + limit);
    if (remaining !== null) parts.push(remaining + ' disponível(is)');
    if (runs !== null) parts.push(runs + ' execução(ões) usada(s)');
    if (remainingRuns !== null) parts.push(remainingRuns + ' execução(ões) disponível(is)');
    if (remainingRuns === 0) parts.push('cota diária de execuções esgotada; histórico e downloads disponíveis');
    return parts.length ? parts.join(' · ') : 'Cotas controladas pelo servidor para este acesso.';
  }
  function renderStatus() {
    $('service-status').textContent = state.status ? (state.status.enabled ? 'Piloto habilitado' : 'Piloto desabilitado') : (storeReference ? 'Conecte sua loja para continuar' : 'Disponibilidade não confirmada');
    $('quota-status').textContent = quotaText(state.status?.usage, state.status?.limits);
    $('execution-mode').textContent = (state.status?.localOnly ? 'Somente modelo local' : 'Roteamento definido pelo servidor') + (state.status?.draftOnly ? ' · apenas rascunhos para revisão' : ' · este chat não publica nem executa código');
    const billing = state.status?.billing;
    $('billing-status').textContent = billing?.enabled
      ? (billing.active ? String(billing.availableCredits ?? '—') + ' créditos disponíveis · ' + String(billing.reservedCredits ?? '—') + ' reservados · ' + String(billing.usedCredits ?? '—') + ' consumidos' : 'Sem período ativo de plano de IA.')
      : 'Controle comercial não habilitado neste acesso; não há cobrança automática.';
    controls();
  }
  function updateTask(item) {
    if (!item || typeof item.id !== 'string' || !labels[item.status]) throw fail('invalidResponse');
    const index = state.tasks.findIndex(task => task.id === item.id);
    if (index === -1) state.tasks.unshift(item); else state.tasks[index] = { ...state.tasks[index], ...item };
    return state.tasks.find(task => task.id === item.id);
  }
  function renderHistory() {
    const list = $('task-list'); list.replaceChildren();
    $('history-empty').hidden = state.tasks.length > 0;
    for (const item of state.tasks) {
      const entry = node('li'), button = node('button'); button.type = 'button';
      button.setAttribute('aria-current', String(state.selected === item.id));
      button.append(node('span', item.instruction || 'Tarefa ' + item.id.slice(0, 8), 'task-label'), node('span', labels[item.status] || 'Estado desconhecido', 'task-state'));
      button.addEventListener('click', () => selectTask(item.id)); entry.append(button); list.append(entry);
    }
  }
  function taskError(item) {
    if (item.status === 'blocked') return errors.integration;
    if (item.status === 'interrupted') return errors.interrupted;
    if (typeof item.errorCode === 'string' && Object.hasOwn(errorCodes, item.errorCode)) return errors[errorCodes[item.errorCode]];
    return errors.failed;
  }
  function renderTask() {
    const item = state.tasks.find(task => task.id === state.selected);
    $('welcome').hidden = !!item; $('task-detail').hidden = !item;
    if (!item) {
      for (const id of ['task-title', 'task-status', 'task-meta', 'task-guidance', 'task-output']) $(id).textContent = '';
      $('task-events').replaceChildren(); $('task-files').replaceChildren();
      controls(); return;
    }
    $('task-title').textContent = item.instruction || 'Comando salvo no servidor';
    $('task-status').textContent = labels[item.status] || 'Estado desconhecido';
    $('task-detail').setAttribute('aria-busy', String(item.status === 'running'));
    $('task-meta').textContent = (kinds[item.kind] || 'Tarefa') + ' · ' + Math.max(0, Number(item.stepCount) || 0) + ' etapa(s) registrada(s)';
    if(item.billing) $('task-meta').textContent += item.billing.state==='review_required' ? ' · créditos pendentes de conferência' : ' · ' + String(item.billing.chargedCredits ?? 0) + ' créditos consumidos';
    const guidance = { queued: 'Pedido salvo. Você pode iniciar a preparação ou cancelar. Reabrir esta página não o inicia automaticamente.', running: 'Preparando o rascunho. Você pode acompanhar ou cancelar; nenhuma publicação será realizada.', draft_ready: 'Rascunho disponível para revisão. Arquivos de código não foram executados nem testados.', cancelled: 'Tarefa cancelada. Nenhuma publicação foi realizada.' };
    $('task-guidance').textContent = guidance[item.status] || taskError(item);
    $('task-output').textContent = typeof item.resultText === 'string' ? item.resultText : '';
    $('task-output').hidden = !$('task-output').textContent;
    const events = $('task-events'); events.replaceChildren();
    for (const event of (Array.isArray(item.events) ? item.events : []).slice(-30)) events.append(node('li', 'Etapa ' + String(event.step ?? '—') + ' · ' + String(event.tool || 'processamento') + ' · ' + String(event.outcome || 'registrada')));
    const files = $('task-files'); files.replaceChildren();
    for (const file of Array.isArray(item.files) ? item.files : []) {
      if (typeof file.path !== 'string') continue;
      const button = node('button', 'Baixar ' + file.path + (Number.isFinite(Number(file.bytes)) ? ' · ' + Math.max(0, Number(file.bytes)) + ' bytes' : ''));
      button.type = 'button'; button.addEventListener('click', () => downloadFile(item.id, file.path, button)); files.append(button);
    }
    $('start-task').hidden = item.status !== 'queued';
    $('cancel-task').hidden = !['queued', 'running'].includes(item.status);
    controls();
  }
  function render() { renderStatus(); renderHistory(); renderTask(); }
  function schedulePoll() {
    clearTimeout(state.timer); state.timer = null;
    const task = activeTask();
    if (task) state.timer = setTimeout(() => pollTask(task.id), 2000);
  }
  async function pollTask(id) {
    try {
      const data = await api('/' + encodeURIComponent(id)); updateTask(data.item); render();
      if (data.item.status !== 'running') { announce(labels[data.item.status] || 'Estado atualizado'); await refreshStatus(); }
      schedulePoll();
    } catch (error) { showError(error); controls(); }
  }
  async function refreshStatus() { const data = await api('/status'); state.status = data; renderStatus(); }
  async function loadTasks() {
    if (state.loading || (storeReference && !state.token)) return;
    const epoch = state.epoch;
    state.loading = true; clearError(); controls();
    try {
      const [status, history] = await Promise.all([api('/status'), api('')]);
      state.status = status;
      state.tasks = (Array.isArray(history.items) ? history.items : []).filter(item => typeof item.id === 'string' && labels[item.status]);
      if (!state.tasks.some(task => task.id === state.selected)) state.selected = state.tasks[0]?.id || null;
      render(); schedulePoll();
      if (storeReference) $('access-status').textContent = 'Loja conectada. O acesso será esquecido ao fechar ou recarregar.';
    } catch (error) { if (epoch === state.epoch) { state.status = null; renderStatus(); showError(error); } }
    finally { if (epoch === state.epoch) { state.loading = false; controls(); } }
  }
  async function selectTask(id) {
    state.selected = id; renderHistory(); renderTask(); clearError();
    try { const data = await api('/' + encodeURIComponent(id)); updateTask(data.item); renderHistory(); renderTask(); schedulePoll(); }
    catch (error) { showError(error); }
  }
  async function runTask(id) {
    const data = await api('/' + encodeURIComponent(id) + '/run', 'POST', {});
    updateTask(data.item); render(); schedulePoll();
  }
  async function submit(event) {
    event.preventDefault();
    if (!canSend()) return;
    const instruction = $('command').value.trim(); if (instruction.length < 3 || instruction.length > 6000) return;
    if (state.pending?.instruction !== instruction) state.pending = { instruction, idempotencyKey: crypto.randomUUID() };
    state.busy = true; clearError(); controls();
    let created = false;
    try {
      const data = await api('', 'POST', state.pending);
      const item = updateTask(data.item); state.selected = item.id; state.pending = null; created = true; $('command').value = ''; render();
      announce('Pedido salvo. Iniciando a preparação do rascunho.');
      if (item.status === 'queued') await runTask(item.id);
      await refreshStatus();
    } catch (error) {
      showError(error);
      if (created) announce('Pedido salvo. Confira o estado da tarefa antes de enviar novamente.');
    } finally { state.busy = false; controls(); }
  }
  async function changeTask(action) {
    const item = state.tasks.find(task => task.id === state.selected);
    if (!item || state.busy || (action === 'run' && (!state.status?.enabled || activeTask() || runsExhausted()))) return;
    state.busy = true; clearError(); controls();
    try {
      if (action === 'run') await runTask(item.id);
      else { const data = await api('/' + encodeURIComponent(item.id) + '/cancel', 'POST', {}); updateTask(data.item); render(); schedulePoll(); }
      await refreshStatus();
    } catch (error) { showError(error); }
    finally { state.busy = false; controls(); }
  }
  async function downloadFile(id, path, button) {
    button.disabled = true; clearError();
    try {
      const downloaded = await api('/' + encodeURIComponent(id) + '/file?path=' + encodeURIComponent(path), 'GET', undefined, true);
      const blob = new Blob([downloaded], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob), link = node('a');
      link.href = url; link.download = path.split(/[\\/]/).pop().replace(/[^a-zA-Z0-9._-]/g, '_') || 'rascunho.txt';
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      announce('Download do rascunho iniciado. Revise antes de usar.');
    } catch (error) { showError(error); }
    finally { button.disabled = false; }
  }
  function forgetAccess() {
    state.epoch += 1; clearTimeout(state.timer); for (const controller of requests) controller.abort();
    state.token = ''; state.status = null; state.tasks = []; state.selected = null; state.busy = false; state.loading = false; state.pending = null;
    $('access-token').value = ''; $('disconnect').hidden = true; $('access-status').textContent = 'Acesso esquecido nesta página. Tarefas já enviadas permanecem no servidor.';
    clearError(); render();
  }
  $('command-form').addEventListener('submit', submit);
  $('refresh').addEventListener('click', loadTasks);
  $('start-task').addEventListener('click', () => changeTask('run'));
  $('cancel-task').addEventListener('click', () => changeTask('cancel'));
  $('disconnect').addEventListener('click', forgetAccess);
  $('access-form').addEventListener('submit', event => {
    event.preventDefault(); if (state.busy || state.loading) return;
    const token = $('access-token').value.trim(); if (!token) return;
    forgetAccess(); state.token = token; $('disconnect').hidden = false; loadTasks();
  });
  for (const button of document.querySelectorAll('[data-example]')) button.addEventListener('click', () => { $('command').value = button.dataset.example; $('command').focus(); });
  window.addEventListener('pagehide', () => { state.epoch += 1; state.token = ''; $('access-token').value = ''; clearTimeout(state.timer); for (const controller of requests) controller.abort(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { if (storeReference) forgetAccess(); else loadTasks(); } });
  if (storeReference) { $('account-label').textContent = 'Espaço da sua loja'; $('store-access').hidden = false; render(); }
  else loadTasks();
})();
