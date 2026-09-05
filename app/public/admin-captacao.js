(() => {
  const $ = id => document.getElementById(id);
  const count = value => Number(value || 0).toLocaleString('pt-BR');
  function table(id, rows) {
    const target = $(id); target.replaceChildren();
    if (!rows.length) { target.textContent = 'Ainda não há sessões registradas neste período.'; return; }
    const table = document.createElement('table'), head = document.createElement('thead'), body = document.createElement('tbody');
    const tr = document.createElement('tr');
    for (const label of ['Grupo', 'Sessões', 'Próximo passo', 'Cadastros']) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; tr.append(th); }
    head.append(tr);
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (const value of [row.label, count(row.sessions), count(row.engagedSessions), count(row.signupSessions)]) {
        const td = document.createElement('td'); td.textContent = value; tr.append(td);
      }
      body.append(tr);
    }
    table.append(head, body); target.append(table);
  }
  async function refresh() {
    $('refresh').disabled = true; $('period').disabled = true;
    $('reportStatus').className = ''; $('reportStatus').textContent = 'Consultando indicadores…';
    try {
      const response = await fetch('/api/admin/organic-acquisition?days=' + encodeURIComponent($('period').value), { cache: 'no-store' });
      if (response.status === 401 || response.status === 403) throw new Error('Acesso expirado ou restrito. Entre novamente pelo painel administrativo.');
      if (!response.ok) throw new Error('Não foi possível consultar. Tente atualizar novamente.');
      const data = await response.json(), s = data.summary;
      $('sessions').textContent = count(s.sessions); $('engaged').textContent = count(s.engagedSessions); $('signups').textContent = count(s.signupSessions);
      $('rate').textContent = s.sessions ? (100 * s.signupSessions / s.sessions).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%' : '—';
      for (const id of ['channels', 'landings', 'campaigns']) table(id, data[id]);
      $('reportStatus').textContent = `Atualizado agora · janela móvel de ${data.range.days} dias.` + (data.truncated ? ` Atenção: amostra limitada às ${count(data.limit)} sessões mais recentes.` : '');
    } catch (error) {
      $('reportStatus').className = 'error'; $('reportStatus').textContent = error.message;
      for (const id of ['sessions', 'engaged', 'signups', 'rate']) $(id).textContent = '—';
      for (const id of ['channels', 'landings', 'campaigns']) $(id).replaceChildren();
    } finally { $('refresh').disabled = false; $('period').disabled = false; }
  }
  function generate() {
    const channel = $('channel').value, piece = $('piece').value;
    if (!['instagram', 'tiktok', 'youtube', 'facebook', 'kwai', 'blog_parceiro', 'whatsapp'].includes(channel) || !/^[a-z0-9_-]{1,50}$/.test(piece)) return;
    const url = new URL('/guias/plantas-em-vasos.html', location.origin);
    url.search = new URLSearchParams({ utm_source: channel, utm_medium: ['blog_parceiro', 'whatsapp'].includes(channel) ? 'referral' : 'organic_social', utm_campaign: 'plantas_vasos', utm_content: piece }).toString();
    $('campaignUrl').value = url.href; $('copyStatus').textContent = 'Link gerado. Nenhuma publicação foi enviada.';
  }
  $('campaignForm').addEventListener('submit', event => { event.preventDefault(); generate(); });
  $('copyLink').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('campaignUrl').value); $('copyStatus').textContent = 'Link copiado.'; }
    catch { $('campaignUrl').focus(); $('campaignUrl').select(); $('copyStatus').textContent = 'Selecione e copie o link acima.'; }
  });
  $('refresh').addEventListener('click', refresh); $('period').addEventListener('change', refresh);
  generate(); refresh();
})();
