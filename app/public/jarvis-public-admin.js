(() => {
  'use strict';
  const $ = id => document.getElementById(id), base = '/api/admin/jarvis-public';
  let snapshot = null, items = [], editing = null, dirty = false, busy = false, fresh = false, version = 0;
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const count = value => Number.isSafeInteger(value) && value >= 0 ? String(value) : '—';
  const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('pt-BR') : 'Não informada';
  const announce = text => { $('announcement').textContent = text; };
  const safeUrl = value => {
    if (typeof value !== 'string' || value.length > 2048 || /[\s\\\u0000-\u001f]/.test(value)) return '';
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
  };
  const validItem = item => item && typeof item === 'object' && /^[1-9]\d{0,9}$/.test(String(item.id)) && Number.isSafeInteger(item.revision) && item.revision >= 1;
  function controls() {
    $('refresh').disabled = busy || dirty;
    $('toggle-enabled').disabled = busy || !fresh || !snapshot || dirty;
    $('filter').disabled = busy;
    $('edit-fields').disabled = busy || !editing;
    $('document-title').readOnly = !fresh;
    $('document-body').readOnly = !fresh;
    $('save').disabled = !fresh;
    // Cancelling a stale edit remains available when writes are locked after a conflict.
    $('discard').disabled = busy || !editing;
    document.querySelectorAll('#documents button, #documents input').forEach(element => { element.disabled = busy || !fresh || dirty || Boolean(editing); });
    document.querySelectorAll('#documents [data-approve]').forEach(element => {
      const confirmation = document.getElementById(element.dataset.confirmation);
      element.disabled = busy || !fresh || Boolean(editing) || !confirmation?.checked;
    });
    $('edit-notice').textContent = dirty ? 'Você tem alterações não salvas. Salve como rascunho ou cancele a edição antes de atualizar a lista.' : !fresh && editing ? 'Estado desatualizado. Cancele a edição e atualize os dados antes de alterar este item.' : '';
  }
  function showError(error) {
    $('error').textContent = error.message || 'Não foi possível concluir a operação.';
    $('error').hidden = false;
  }
  async function api(path, method = 'GET', body) {
    const response = await fetch(base+path, {method,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000),
      headers:method === 'GET' ? {} : {'Content-Type':'application/json','X-Jarvis-Request':'1'},
      ...(body ? {body:JSON.stringify(body)} : {})});
    if (response.status === 401) { location.assign('/admin-login.html'); throw Error('Entre novamente na conta administrativa.'); }
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 409) { fresh = false; throw Error('O item foi alterado em outra sessão. Cancele a edição, atualize os dados e revise a nova versão.'); }
      throw Error(typeof data.error === 'string' ? data.error.slice(0, 600) : 'Não foi possível concluir. Atualize os dados e tente novamente.');
    }
    return data;
  }
  function renderStatus() {
    $('service-state').textContent = !fresh ? '—' : snapshot.enabled ? 'Ativo' : 'Pausado';
    $('service-detail').textContent = fresh ? 'Somente o Jarvis público' : 'Estado não confirmado';
    $('toggle-enabled').textContent = snapshot?.enabled ? 'Pausar Jarvis público' : 'Ativar Jarvis público';
    $('queries-today').textContent = count(snapshot?.queriesToday);
    $('approved-count').textContent = count(snapshot?.approved);
    $('draft-count').textContent = count(snapshot?.drafts);
    $('settings-detail').textContent = fresh ? 'Versão da configuração: '+snapshot.revision+'. Alterações exigem uma ação explícita.' : 'Atualize os dados para confirmar o estado antes de alterar a configuração.';
    $('capacity').textContent = Number.isSafeInteger(snapshot?.capacity) ? 'Capacidade da base pública: '+snapshot.capacity+' conhecimentos.' : '';
    controls();
  }
  function resetEditor() {
    editing = null; dirty = false; $('edit-form').reset();
    $('editing').textContent = 'Escolha “Revisar texto” em um conhecimento da base pública.';
    controls();
  }
  function edit(item) {
    if (busy || !fresh || editing) return;
    editing = {id:item.id,revision:item.revision,title:String(item.title || ''),body:String(item.body || '')};
    $('document-title').value = editing.title; $('document-body').value = editing.body;
    $('editing').textContent = 'Editando #'+item.id+' · versão '+item.revision+'. Salvar retira a aprovação anterior.';
    dirty = false; controls(); $('editor-title').focus();
  }
  function renderDocuments() {
    const box = $('documents'); box.replaceChildren();
    const filter = $('filter').value, filtered = items.filter(item => filter === 'all' || item.status === filter);
    if (!filtered.length) box.append(node('p', 'Nenhum conhecimento público neste filtro.', 'muted'));
    for (const item of filtered) {
      const article = node('article', null, 'document'), head = node('div', null, 'section-head');
      const labels = {draft:'RASCUNHO',approved:'APROVADO PARA O PÚBLICO',archived:'ARQUIVADO'};
      head.append(node('h3', String(item.title || 'Sem título').slice(0, 200)), node('span', labels[item.status] || 'NÃO CONFIRMADO', 'tag '+(Object.hasOwn(labels,item.status) ? item.status : '')));
      article.append(head, node('p', '#'+item.id+' · versão '+item.revision+' · atualizado em '+date(item.updatedAt), 'fine'));
      const href = safeUrl(item.url);
      if (href) {
        const link = node('a', 'Conferir fonte original ↗', 'source-link'); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer nofollow';
        article.append(link, node('p', href, 'fine'));
      } else article.append(node('p', 'Fonte sem endereço HTTPS válido. Confira antes de aprovar.', 'fine'));
      if (item.expiresAt) article.append(node('p', 'Validade informada: '+String(item.expiresAt).slice(0, 40), 'fine'));
      if (item.foundAt) article.append(node('p', 'Encontrado em '+date(item.foundAt), 'fine'));
      const details = node('details'); details.append(node('summary', 'Ler conhecimento completo'), node('p', String(item.body || '').slice(0, 2500), 'document-body')); article.append(details);
      const actions = node('div', null, 'actions'), editButton = node('button', 'Revisar texto'); editButton.type = 'button'; editButton.addEventListener('click', () => edit(item)); actions.append(editButton);
      if (item.status !== 'draft') {
        const draft = node('button', 'Voltar a rascunho'); draft.type = 'button'; draft.addEventListener('click', () => transition(item, 'draft')); actions.append(draft);
      }
      if (item.status !== 'archived') {
        const archive = node('button', 'Arquivar'); archive.type = 'button'; archive.addEventListener('click', () => transition(item, 'archived')); actions.append(archive);
      }
      if (item.status !== 'approved' && String(item.body || '').startsWith('PRÉVIA NÃO REVISADA')) {
        article.append(node('p', 'Prévia automática: confira a fonte e a licença, depois revise o texto e salve um rascunho antes da aprovação pública.', 'fine'));
      } else if (item.status !== 'approved') {
        const confirmation = node('label', null, 'check'), checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.id = 'confirm-public-'+item.id;
        confirmation.htmlFor = checkbox.id;
        confirmation.append(checkbox, node('span', 'Conferi o conteúdo, a fonte e a licença/autorização de uso. Autorizo expressamente que este conhecimento fique disponível em respostas públicas.'));
        article.append(confirmation);
        const approve = node('button', 'Aprovar para uso público', 'primary'); approve.type = 'button'; approve.dataset.approve = '1'; approve.dataset.confirmation = checkbox.id; approve.disabled = true;
        checkbox.addEventListener('change', controls); approve.addEventListener('click', () => { if (checkbox.checked) transition(item, 'approved'); }); actions.append(approve);
      }
      article.append(actions); box.append(article);
    }
    controls();
  }
  async function load() {
    if (busy || dirty) return;
    busy = true; const current = ++version; controls(); $('error').hidden = true;
    try {
      const [state, knowledge] = await Promise.all([api('/status'), api('/knowledge')]);
      if (current !== version) return;
      if (typeof state.enabled !== 'boolean' || !Number.isSafeInteger(state.revision) || !Array.isArray(knowledge.items)) throw Error('Dados incompletos. Tente atualizar novamente.');
      snapshot = state; items = knowledge.items.filter(validItem).slice(0, 500); fresh = true;
      // Manual refresh discards only an unchanged editor, never an unsaved edit.
      resetEditor(); renderStatus(); renderDocuments(); announce('Base pública atualizada. Nenhuma alteração foi aplicada aos conhecimentos.');
    } catch (error) { if (current === version) { fresh = false; renderStatus(); showError(error); } }
    finally { if (current === version) { busy = false; controls(); } }
  }
  async function mutate(operation, success) {
    if (busy || !fresh) return;
    busy = true; controls(); $('error').hidden = true;
    try {
      await operation();
      busy = false; resetEditor(); await load(); announce(success);
    } catch (error) {
      // A timed-out write may have reached the server: never retry automatically.
      fresh = false; renderStatus(); showError(error); announce('Operação não confirmada. Atualize os dados antes de tentar novamente.');
    } finally { busy = false; controls(); }
  }
  function transition(item, status) {
    if (editing || busy || !fresh) return;
    mutate(async () => {
      const data = await api('/knowledge/'+item.id+'/status', 'POST', {status,revision:item.revision,...(status === 'approved' ? {confirmedPublic:true} : {})});
      if (!validItem(data.item)) throw Error('Não foi possível confirmar a nova versão. Atualize os dados.');
    }, status === 'approved' ? 'Conhecimento aprovado para uso público.' : status === 'archived' ? 'Conhecimento arquivado e retirado das respostas públicas.' : 'Conhecimento devolvido a rascunho.');
  }
  $('edit-form').addEventListener('submit', event => {
    event.preventDefault(); if (!editing || busy || !fresh || !$('edit-form').reportValidity()) return;
    const original = {...editing}, title = $('document-title').value.trim(), body = $('document-body').value.trim();
    mutate(async () => {
      const data = await api('/knowledge/'+original.id, 'PUT', {title,body,revision:original.revision});
      if (!validItem(data.item) || data.item.status !== 'draft') throw Error('Não foi possível confirmar o rascunho. Atualize os dados.');
    }, 'Texto salvo como rascunho. A aprovação pública exige uma nova revisão explícita.');
  });
  for (const id of ['document-title','document-body']) $(id).addEventListener('input', () => {
    dirty = Boolean(editing && ($('document-title').value !== editing.title || $('document-body').value !== editing.body)); controls();
  });
  $('discard').addEventListener('click', () => { resetEditor(); announce('Edição local cancelada. Nenhuma alteração foi enviada.'); });
  $('toggle-enabled').addEventListener('click', () => {
    if (!snapshot || !fresh || busy || dirty) return;
    const enabled = !snapshot.enabled, revision = snapshot.revision;
    mutate(() => api('/settings', 'POST', {enabled,revision}), enabled ? 'Jarvis público ativado.' : 'Jarvis público pausado.');
  });
  $('refresh').addEventListener('click', load);
  $('filter').addEventListener('change', renderDocuments);
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  load();
})();
