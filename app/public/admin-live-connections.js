(() => {
  'use strict';
  const el = id => document.getElementById(id);
  if (!el('liveConnections')) return;
  const YT = '/api/admin/live-studio/youtube-chat', IG = '/api/admin/instagram-messaging';
  const elements = ['liveConnectionsRefresh','liveYtSaveApp','liveYtAuthorize','liveYtBind','liveYtDisconnect','liveIgSave','liveIgLoginSave'];
  let youtube = null, instagram = null, studio = null, busy = false, closed = false, igDirty = false, igLoginDirty = false, holding = false, refreshPromise = null;
  const choices = new Map();
  const notice = message => { el('liveConnectionsNotice').textContent = message; };
  const dateLabel = value => Number.isFinite(value) && value > 0 ? new Date(value).toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo'}) + ' (Brasília)' : null;
  const codes = {
    youtube_chat_oauth_required:'Autorize primeiro o canal do YouTube.',
    youtube_chat_live_session_required:'O vínculo exige uma sessão de 2 horas ativa e enviando sinal ao YouTube.',
    youtube_chat_broadcast_invalid:'Confira se o link pertence ao canal autorizado e se a live já está pública.',
    youtube_chat_binding_changed:'O vínculo desta sessão mudou. Confira o estado antes de continuar.',
    youtube_chat_settings_changed:'Esta sessão já tem uma escolha de atendimento salva. Confira o estado atual.',
    youtube_app_invalid:'Confira o ID e o segredo do cliente Google. Preencha os dois para salvar novas credenciais.',
    youtube_https_origin_required:'A autorização exige o endereço público seguro da plataforma.',
    youtube_reconnect_required:'Autorize novamente o canal no Google.',
    instagram_accounts_invalid:'Escolha uma conta Instagram conectada. Contas indisponíveis podem ser removidas da seleção.',
    instagram_settings_invalid:'Confira as opções de atendimento do Instagram.',
    ecosystem_paused:'O atendimento está pausado na operação da plataforma.'
  };
  async function request(url, method, body) {
    let response, data;
    try {
      response = await fetch(url, {credentials:'same-origin',cache:'no-store', ...(method ? {method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {})});
      data = await response.json();
    } catch { throw Error('Não foi possível confirmar a operação. Atualize o estado antes de tentar novamente.'); }
    if (!response.ok) throw Error(response.status === 401 || response.status === 403 ? 'Entre com uma conta administradora autorizada para continuar.' : codes[data?.error] || 'A operação não foi confirmada. Confira o estado e as permissões antes de tentar novamente.');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('A resposta não pôde ser confirmada. Atualize o estado.');
    return data;
  }
  function sessionReady() {
    const s = studio?.status;
    return s?.online === true && s.streaming === true && s.recording !== true && s.continuous === false && s.durationSeconds === 7200 && Number.isFinite(s.deadline) && s.deadline * 1000 > Date.now();
  }
  function controls() {
    const blocked = busy || closed;
    for (const id of elements) el(id).disabled = blocked;
    el('liveConnectionsRefresh').disabled = busy || closed;
    el('liveYtSaveApp').disabled = blocked || !youtube?.oauth || !el('liveYtClientId').value.trim() || !el('liveYtClientSecret').value.trim();
    el('liveYtAuthorize').disabled = blocked || youtube?.oauth?.configured !== true;
    el('liveYtBind').disabled = blocked || youtube?.oauth?.connected !== true || youtube?.connected === true || !sessionReady() || !el('liveYtAutoReply').checked;
    el('liveYtDisconnect').disabled = blocked || !(youtube?.connected === true || youtube?.state === 'connected' && youtube?.broadcastId);
    el('liveIgSave').disabled = blocked || !instagram;
    el('liveIgLoginSave').disabled = blocked || !instagram || !/^\d{1,40}$/.test(el('liveIgLoginConfigId').value.trim());
    for (const id of ['liveIgEnabled','liveIgAutoReply','liveIgLiveComments']) el(id).disabled = blocked;
    for (const input of choices.values()) input.disabled = blocked;
  }
  function renderYoutube() {
    if (!youtube) { el('liveYtStatus').textContent = 'Estado do YouTube indisponível. Atualize para conferir.'; return; }
    const oauth = youtube.oauth;
    el('liveYtStatus').textContent = oauth?.connected === true ? 'Canal autorizado. A autorização não comprova que uma resposta já foi enviada.' : oauth?.configured === true ? 'Credenciais salvas. Falta autorizar o canal no Google.' : 'Aplicativo Google ainda não configurado para o chat.';
    el('liveYtChannel').textContent = typeof oauth?.channelTitle === 'string' ? oauth.channelTitle : typeof youtube.channelId === 'string' ? 'Canal esperado: ' + youtube.channelId : '';
    el('liveYtCallback').value = typeof oauth?.redirectUri === 'string' ? oauth.redirectUri : '';
    if (youtube.connected === true) {
      el('liveYtSession').textContent = (youtube.autoReply === true ? 'Lia pode responder no chat público desta sessão.' : 'Chat vinculado; respostas automáticas desativadas.') + (dateLabel(youtube.deadline) ? ' Limite da sessão: ' + dateLabel(youtube.deadline) + '.' : '');
    } else {
      el('liveYtSession').textContent = sessionReady() ? 'Sessão ativa. Informe a live pública correta e confirme o atendimento antes de vincular.' : 'Aguardando uma sessão de 2 horas ativa. Este painel não inicia nem prolonga a transmissão.';
    }
    const sent = Array.isArray(youtube.items) ? youtube.items.filter(item => item?.state === 'sent' && typeof item.providerReplyId === 'string' && item.providerReplyId.length > 0 && item.providerReplyId.length <= 512 && !/[\s\x00-\x1f\x7f]/.test(item.providerReplyId) && Number.isFinite(item.confirmedAt) && item.confirmedAt > 0) : [];
    el('liveYtReceipts').textContent = sent.length ? sent.length + ' envio(s) com recibo confirmado pelo YouTube nesta consulta. Último: ' + dateLabel(Math.max(...sent.map(item => item.confirmedAt))) + '. Isso não confirma leitura pelo público.' : 'Nenhuma resposta com recibo de envio confirmado nesta consulta.';
    if (Number.isSafeInteger(youtube.replyLimit)) el('liveYtSession').textContent += ' Limite: ' + youtube.replyLimit + ' respostas nesta sessão de 2 horas.';
  }
  function renderInstagram() {
    if (!instagram) { el('liveIgStatus').textContent = 'Estado do Instagram indisponível. Atualize para conferir.'; return; }
    const settings = instagram.settings;
    if (!igLoginDirty) el('liveIgLoginConfigId').value = typeof instagram.loginConfigId === 'string' ? instagram.loginConfigId : '';
    el('liveIgStatus').textContent = settings.enabled ? (settings.autoReply ? 'Envio automático habilitado nas contas selecionadas.' : 'Atendimento habilitado com aprovação na fila.') : 'Atendimento do Instagram pausado.';
    el('liveIgReadiness').textContent = instagram.configured === true ? 'IA de atendimento configurada. Confira também a autorização da Meta, os eventos recebidos e os recibos na fila; esta tela não comprova uma resposta entregue.' : 'A IA de atendimento ainda precisa ser configurada. A autorização da Meta é uma etapa separada; salvar opções não confirma que o Direct está funcionando.';
    el('liveIgLimit').textContent = Number.isSafeInteger(settings.dailyLimit) ? 'Limite compartilhado: ' + settings.dailyLimit + ' respostas por dia. Não há envio promocional automático fora de uma conversa permitida.' : 'O limite de atendimento é controlado pelo servidor.';
    if (igDirty) return;
    el('liveIgEnabled').checked = settings.enabled;
    el('liveIgAutoReply').checked = settings.autoReply;
    el('liveIgLiveComments').checked = settings.liveCommentsEnabled === true;
    const accounts = new Map();
    for (const account of instagram.accounts || []) if (Number.isSafeInteger(account.id) && account.id > 0) accounts.set(account.id, account);
    for (const id of settings.accountIds) if (!accounts.has(id)) accounts.set(id, {id,label:'Conta ' + id,connected:false});
    const selected = new Set(settings.accountIds.length ? settings.accountIds : accounts.get(7)?.connected === true ? [7] : []);
    choices.clear(); el('liveIgAccounts').replaceChildren();
    for (const account of accounts.values()) {
      const label = document.createElement('label'), input = document.createElement('input');
      label.className = 'check'; input.type = 'checkbox'; input.checked = selected.has(account.id); input.value = String(account.id);
      input.addEventListener('change', () => { igDirty = true; });
      label.append(input, document.createTextNode((typeof account.label === 'string' && account.label.trim() ? account.label : 'Conta ' + account.id) + ' · conexão ' + account.id + (account.connected ? '' : ' (indisponível)')));
      el('liveIgAccounts').append(label); choices.set(account.id,input);
    }
    if (!accounts.size) el('liveIgAccounts').textContent = 'Nenhuma conta Instagram conectada. Use a autorização abaixo.';
  }
  async function refresh() {
    if (closed) return;
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const results = await Promise.allSettled([request(YT + '/status'), request(IG), request('/api/admin/live-studio')]);
      if (closed) return false;
      const [yt,ig,obs] = results;
      youtube = yt.status === 'fulfilled' && typeof yt.value.connected === 'boolean' && typeof yt.value.oauth?.configured === 'boolean' ? yt.value : null;
      instagram = ig.status === 'fulfilled' && typeof ig.value.settings?.enabled === 'boolean' && typeof ig.value.settings?.autoReply === 'boolean' && Array.isArray(ig.value.settings?.accountIds) && ig.value.settings.accountIds.every(Number.isSafeInteger) ? ig.value : null;
      studio = obs.status === 'fulfilled' ? obs.value : null;
      holding = !youtube || !instagram || !studio;
      renderYoutube(); renderInstagram(); controls();
      if (holding) notice('Uma conexão não pôde ser conferida. Atualize o estado dessa rede antes de salvar ou ativar o atendimento.');
      return !holding;
    })();
    try { return await refreshPromise; } finally { refreshPromise = null; }
  }
  async function mutate(url, method, body, success) {
    if (busy || closed || url.startsWith(YT) && !youtube || url.startsWith(IG) && !instagram) return;
    busy = true; controls();
    try { await request(url, method, body); if (url === IG) igDirty = false; if (url === IG + '/login') igLoginDirty = false; notice(success); }
    catch (error) { holding = true; notice(error.message); }
    finally { if (url.endsWith('/oauth/app')) el('liveYtClientSecret').value = ''; await refresh(); busy = false; controls(); }
  }
  function broadcastId(value) {
    const text = value.trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
    let url; try { url = new URL(text); } catch { return null; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    let id = null;
    if (url.hostname === 'youtu.be' && /^\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname)) id = url.pathname.split('/')[1];
    if (['www.youtube.com','youtube.com'].includes(url.hostname)) {
      if (url.pathname === '/watch' && url.searchParams.getAll('v').length === 1) id = url.searchParams.get('v');
      else if (/^\/live\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname)) id = url.pathname.split('/')[2];
    }
    return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }
  el('liveConnectionsRefresh').addEventListener('click', async () => { if (busy) return; busy = true; controls(); const ok = await refresh(); if (ok) notice('Estados atualizados. Nenhuma transmissão ou mensagem foi iniciada por esta consulta.'); busy = false; controls(); });
  for (const id of ['liveYtClientId','liveYtClientSecret']) el(id).addEventListener('input', controls);
  el('liveIgLoginConfigId').addEventListener('input', () => { igLoginDirty = true; controls(); });
  el('liveYtAutoReply').addEventListener('change',controls);
  for (const id of ['liveIgEnabled','liveIgAutoReply','liveIgLiveComments']) el(id).addEventListener('change', () => { igDirty = true; });
  el('liveYtAppForm').addEventListener('submit', async event => {
    event.preventDefault(); if (el('liveYtSaveApp').disabled) return;
    const clientId = el('liveYtClientId').value.trim(), clientSecret = el('liveYtClientSecret').value.trim();
    if (!clientId || !clientSecret) return;
    await mutate(YT + '/oauth/app','POST',{clientId,clientSecret},'Configuração enviada. Confira abaixo se as credenciais foram salvas antes de autorizar o canal.');
  });
  el('liveYtAuthorize').addEventListener('click', async () => {
    if (el('liveYtAuthorize').disabled) return;
    busy = true; controls();
    try {
      const data = await request(YT + '/oauth/connect','POST',{}), url = new URL(data.authorizationUrl);
      if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth' || url.username || url.password || url.hash || url.searchParams.get('redirect_uri') !== youtube.oauth.redirectUri || url.searchParams.get('response_type') !== 'code' || !url.searchParams.get('state')) throw Error('O endereço de autorização não pôde ser validado. Atualize a conexão.');
      el('liveYtClientSecret').value = ''; window.location.assign(url.href);
    } catch (error) { notice(error.message); busy = false; controls(); }
  });
  el('liveYtBroadcastForm').addEventListener('submit', async event => {
    event.preventDefault(); if (el('liveYtBind').disabled) return;
    if (!sessionReady()) { controls(); notice('A sessão de 2 horas não está mais ativa. Confira o estado antes de vincular.'); return; }
    const id = broadcastId(el('liveYtBroadcastId').value);
    if (!id) { notice('Informe o link oficial ou o ID de 11 caracteres da live do YouTube.'); return; }
    await mutate(YT + '/broadcast','POST',{broadcastId:id,autoReply:true},'Vínculo solicitado. Confira abaixo se o servidor confirmou a sessão; nenhum sinal de live foi iniciado aqui.');
  });
  el('liveYtDisconnect').addEventListener('click', async () => {
    if (el('liveYtDisconnect').disabled) return;
    await mutate(YT + '/disconnect','POST',{},'Desconexão solicitada. Confira o estado. O sinal da transmissão não foi interrompido por este painel.');
  });
  el('liveIgForm').addEventListener('submit', async event => {
    event.preventDefault(); if (el('liveIgSave').disabled) return;
    const accountIds = [...choices].filter(([,input]) => input.checked).map(([id]) => id);
    if (el('liveIgEnabled').checked && !accountIds.length) { notice('Selecione a conta Instagram que Lia poderá atender.'); return; }
    await mutate(IG,'PUT',{enabled:el('liveIgEnabled').checked,autoReply:el('liveIgAutoReply').checked,liveCommentsEnabled:el('liveIgLiveComments').checked,accountIds},'Atualização solicitada. Confira as opções confirmadas pelo servidor e os recibos na fila.');
  });
  el('liveIgLoginForm').addEventListener('submit', async event => {
    event.preventDefault(); if (el('liveIgLoginSave').disabled) return;
    await mutate(IG + '/login','PUT',{configId:el('liveIgLoginConfigId').value.trim()},'Configuração enviada. Confira o identificador salvo antes de autorizar a conta na Meta.');
  });
  window.addEventListener?.('pagehide', () => { closed = true; el('liveYtClientSecret').value = ''; }, {once:true});
  controls();
  void refresh().then(() => { if (new URLSearchParams(window.location.search).get('youtubeChat') === 'needs_review') notice('A autorização do YouTube não foi concluída. Confira o canal escolhido e as permissões solicitadas.'); });
})();
