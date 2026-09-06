(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const number = (value, digits = 2) => value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const date = value => value ? new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'sem registro';
  const put = (id, value) => { $(id).textContent = value; };
  function element(tag, content, className) {
    const node = document.createElement(tag);
    if (content !== undefined) node.textContent = content;
    if (className) node.className = className;
    return node;
  }
  function tone(node, value) {
    node.classList.remove('good', 'bad', 'caution');
    if (value !== null && Number.isFinite(value)) node.classList.add(value < 0 ? 'bad' : 'good');
  }
  function drawChart(series) {
    const host = $('chart'), values = $('chart-values'); host.replaceChildren(); values.replaceChildren();
    if (!series.length) { host.append(element('p', 'Sem valores de resultado no período.', 'empty')); return; }
    const ns = 'http://www.w3.org/2000/svg';
    const svgEl = (tag, attrs, content) => { const node = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); if (content !== undefined) node.textContent = content; return node; };
    const svg = svgEl('svg', { viewBox: '0 0 580 185', role: 'img', 'aria-label': 'Acumulado realizado em USDT de teste. Valores disponíveis na lista abaixo do gráfico.' });
    const lo = Math.min(0, ...series.map(p => p.value)), hi = Math.max(0, ...series.map(p => p.value)), span = hi - lo || 1;
    const firstTime = Date.parse(series[0].at), timeSpan = Date.parse(series.at(-1).at) - firstTime || 1;
    const x = p => series.length === 1 ? 316 : 62 + (Date.parse(p.at) - firstTime) / timeSpan * 508;
    const y = v => 15 + (hi - v) / span * 130;
    for (const value of new Set([hi, (hi + lo) / 2, lo])) {
      svg.append(svgEl('line', { x1: 62, y1: y(value), x2: 570, y2: y(value), class: 'gridline' }));
      svg.append(svgEl('text', { x: 52, y: y(value) + 4, 'text-anchor': 'end' }, number(value, 3)));
    }
    svg.append(svgEl('path', { d: series.map((p, i) => `${i ? 'L' : 'M'} ${x(p)} ${y(p.value)}`).join(' '), class: 'line' }));
    for (const p of series) {
      const dot = svgEl('circle', { cx: x(p), cy: y(p.value), r: 3, class: 'point' });
      dot.append(svgEl('title', {}, `${date(p.at)} · ${number(p.value, 4)} USDT`)); svg.append(dot);
      values.append(element('li', `${date(p.at)}: ${number(p.value, 4)} USDT`));
    }
    svg.append(svgEl('text', { x: 62, y: 174 }, date(series[0].at).split(',')[0]));
    if (series.length > 1) svg.append(svgEl('text', { x: 570, y: 174, 'text-anchor': 'end' }, date(series.at(-1).at).split(',')[0]));
    host.append(svg);
  }
  function renderAgent(agent, demoEnabled) {
    const card = element('article', undefined, 'agent'), head = element('div', undefined, 'agent-header');
    const names = { BTCUSDT: ['₿', 'Bitcoin'], ETHUSDT: ['Ξ', 'Ethereum'], BNBUSDT: ['B', 'BNB'] };
    const [icon, name] = names[agent.symbol] || ['◇', agent.symbol];
    head.append(element('span', icon, 'coin'));
    const title = element('div'); title.append(element('h3', name), element('span', `${agent.symbol} · ${agent.strategyVersion}`, 'version')); head.append(title); card.append(head);
    card.append(element('span', !agent.signal ? 'SEM ANÁLISE RECEBIDA' : agent.stale ? 'SINAL HISTÓRICO · NÃO ATUAL' : demoEnabled ? 'ANÁLISE RECEBIDA' : 'PAUSADO · ÚLTIMO SINAL', 'status'));
    const metrics = element('dl');
    for (const [label, value] of [['Score', number(agent.signal?.score, 0)], ['RSI 14', number(agent.signal?.rsi, 1)], ['Momento 1h', `${number(agent.signal?.momentum1hPct)}${agent.signal?.momentum1hPct == null ? '' : '%'}`]]) {
      const group = element('div'); group.append(element('dt', label), element('dd', value)); metrics.append(group);
    }
    card.append(metrics, element('p', `Preço na análise: ${number(agent.signal?.price)} USDT`, 'agent-price'));
    const reasons = element('ul');
    for (const reason of [...(agent.signal?.positives || []), ...(agent.signal?.negatives || [])].slice(0, 5)) reasons.append(element('li', reason));
    if (!reasons.children.length) reasons.append(element('li', 'Nenhuma justificativa disponível.'));
    card.append(reasons);
    const result = element('div', undefined, 'agent-result'), pnl = element('span', `${number(agent.pnlUsd, 4)} USDT`); tone(pnl, agent.pnlUsd);
    result.append(element('span', `${agent.orders} ordens · ${agent.exits} saídas`), pnl); card.append(result);
    const time = element('time', `Última análise: ${date(agent.checkedAt)}`); if (agent.checkedAt) time.dateTime = agent.checkedAt; card.append(time);
    return card;
  }
  function render(data) {
    const s = data.summary;
    put('updated', `Leitura da VPS: ${date(data.generatedAt)}`);
    put('sync-label', 'Histórico carregado · consulta a cada 60 s');
    const statuses = { read_only: 'Somente leitura', stale: 'Sem sinal recente', attention: 'Requer atenção', unknown: 'Sem registro' };
    put('monitor', statuses[data.monitor.status] || 'Desconhecido');
    $('monitor').className = data.monitor.status === 'read_only' ? 'good' : 'caution';
    put('monitor-detail', `Verificado: ${date(data.monitor.checkedAt)}`);
    put('robot', data.demoEnabled === null ? 'Desconhecido' : data.demoEnabled ? 'Habilitado' : 'Desligado');
    $('robot').className = 'caution';
    put('robot-detail', data.demoEnabled ? (data.latest?.stale ? 'Habilitado, sem ciclo recente' : 'Consulte o último ciclo abaixo') : `Controle desde ${date(data.controlUpdatedAt)}`);
    const completePnl = s.sells > 0 && s.pricedSells === s.sells ? s.realizedInPeriod : null;
    put('pnl', number(completePnl, 4)); tone($('pnl'), completePnl);
    put('win-rate', s.winRate === null ? '—' : `${number(s.winRate, 1)}%`);
    put('win-detail', `${s.wins} positivas / ${s.pricedSells} saídas com resultado · ${s.losses} negativas`);
    put('cumulative', number(data.latest?.realizedPnlUsd, 4)); tone($('cumulative'), data.latest?.realizedPnlUsd);
    put('cycles', number(s.cycles, 0)); put('orders', number(s.buys + s.sells, 0)); put('off-cycles', number(s.offCycles, 0));
    const last = data.latest;
    put('network-state', last ? `Último ciclo: ${last.action.type} · ${date(last.checkedAt)}${last.stale ? ' · desatualizado' : ''}` : 'Nenhum ciclo registrado.');
    drawChart(data.series);
    $('agents').replaceChildren(...data.agents.map(a => renderAgent(a, data.demoEnabled)));
    put('evidence-history', s.cycles ? `${s.cycles} ciclos persistidos no período, com horário e origem. Novos relatórios são registrados na VPS.` : 'Nenhum ciclo neste período. Selecione um intervalo maior ou verifique o executor.');
    put('history-stage', s.cycles ? 'HISTÓRICO DISPONÍVEL' : 'SEM AMOSTRA');
    put('evidence-sample', `${s.sells} saídas reportadas, ${s.pricedSells} com resultado. Amostra histórica não comprova rentabilidade futura.`);
    const timeline = $('timeline'); timeline.replaceChildren();
    for (const event of data.timeline) {
      const row = element('article', undefined, 'decision'), time = element('time', date(event.at)); time.dateTime = event.at;
      const action = element('span', event.type === 'BUY' ? 'COMPRA' : 'VENDA', `action${event.type === 'SELL' ? ' sell' : ''}`);
      const reason = element('p', event.reason || 'Justificativa não registrada.');
      reason.append(element('small', `${event.source === 'journal' ? 'Journal importado' : event.source === 'snapshot' ? 'Último relatório preservado' : 'Executor → VPS'} · ${event.reportedOrder ? 'ordem reportada' : 'sem comprovante no relatório'}`));
      const result = element('span', event.type === 'SELL' ? number(event.pnlUsd, 4) : '—', 'result');
      if (event.type === 'SELL') { tone(result, event.pnlUsd); result.append(element('small', 'USDT de teste')); }
      row.append(time, action, element('strong', event.symbol || '—', 'symbol'), reason, result); timeline.append(row);
    }
    if (!data.timeline.length) timeline.append(element('p', 'Nenhuma compra ou venda registrada neste período.', 'empty'));
    put('coverage', s.firstAt ? `Registros no período: ${date(s.firstAt)} até ${date(s.lastAt)}. Horários no fuso do dispositivo.` : 'Sem registros no período selecionado.');
  }
  let loading = false;
  async function refresh() {
    if (loading) return;
    loading = true; $('refresh').disabled = true; $('period').disabled = true; $('dashboard').setAttribute('aria-busy', 'true');
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`/api/admin/crypto-matrix?days=${encodeURIComponent($('period').value)}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (response.status === 401 || response.status === 403) throw new Error('Sua sessão administrativa expirou ou não tem acesso. Entre novamente pela Central.');
      if (!response.ok) throw new Error('Não foi possível consultar o histórico. Tente atualizar novamente.');
      const data = await response.json(); render(data); $('error').hidden = true;
      put('announcement', `Dados atualizados. Robô ${data.demoEnabled === null ? 'sem estado confirmado' : data.demoEnabled ? 'habilitado' : 'desligado'}. Operação real bloqueada.`);
    } catch (error) {
      put('error', error.name === 'AbortError' ? 'A consulta demorou demais. Os valores abaixo, se presentes, são da última leitura.' : error.message);
      $('error').hidden = false; put('sync-label', 'Falha na atualização · dados anteriores podem estar desatualizados');
    } finally { clearTimeout(timeout); loading = false; $('refresh').disabled = false; $('period').disabled = false; $('dashboard').setAttribute('aria-busy', 'false'); }
  }
  $('refresh').addEventListener('click', refresh); $('period').addEventListener('change', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  refresh();
})();
