(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const base = '/api/jarvis/public';
  let enabled = false, active = null, version = 0, statusVersion = 0;
  let exchanges = []; // Page memory only: never persisted or sent as conversation context.
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const safeUrl = value => {
    if (typeof value !== 'string' || value.length > 2048 || /[\s\\\u0000-\u001f]/.test(value)) return '';
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) return '';
      return url.href;
    } catch { return ''; }
  };
  const announce = text => { $('announcement').textContent = text; };
  function controls() {
    $('ask').disabled = !enabled || Boolean(active) || !$('search-consent').checked;
    $('cancel').hidden = !active;
    $('question').disabled = Boolean(active);
    $('search-consent').disabled = Boolean(active);
    $('clear-history').disabled = !exchanges.length && !active;
    $('conversation').setAttribute('aria-busy', String(Boolean(active)));
  }
  function render() {
    const box = $('exchanges'); box.replaceChildren();
    if (!exchanges.length) box.append(node('p', 'Sua primeira resposta aparecerá aqui, junto das fontes consultadas.', 'muted'));
    for (const exchange of exchanges) {
      const article = node('article', null, 'exchange');
      article.append(node('h3', exchange.question));
      const labels = { local_model: 'SÍNTESE LOCAL · EXPERIMENTAL', excerpts: 'TRECHOS DAS FONTES · SEM SÍNTESE', approved_memory: 'CONHECIMENTO PÚBLICO REVISADO' };
      article.append(node('span', exchange.status === 'no_sources' ? 'SEM FONTES SUFICIENTES' : labels[exchange.mode] || 'RESPOSTA EXPERIMENTAL', 'tag'));
      article.append(node('p', exchange.answer, 'answer'));
      if (exchange.sources.length) {
        const sources = node('ol', null, 'sources'); sources.setAttribute('aria-label', 'Fontes desta resposta');
        for (const source of exchange.sources) {
          const item = node('li'), href = safeUrl(source.url), title = String(source.title || 'Fonte consultada').slice(0, 250);
          const link = node(href ? 'a' : 'span', title);
          if (href) { link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer nofollow'; }
          item.append(link, node('small', source.reviewed === true ? 'Conhecimento revisado para uso público' : 'Fonte da web · confira o conteúdo original', 'source-meta'));
          if (typeof source.excerpt === 'string' && source.excerpt) item.append(node('p', source.excerpt.slice(0, 1800), 'source-excerpt'));
          sources.append(item);
        }
        article.append(sources);
      }
      if (exchange.researchedAt && Number.isFinite(Date.parse(exchange.researchedAt))) article.append(node('p', 'Consulta registrada em '+new Date(exchange.researchedAt).toLocaleString('pt-BR')+'.', 'fine'));
      if (exchange.notice) article.append(node('p', exchange.notice, 'fine'));
      box.append(article);
    }
    controls();
  }
  async function loadStatus() {
    const current = ++statusVersion;
    $('refresh-status').disabled = true;
    try {
      const response = await fetch(base+'/status', { credentials:'omit', cache:'no-store', signal:AbortSignal.timeout(8000) });
      const data = await response.json();
      if (current !== statusVersion) return;
      if (!response.ok || typeof data.enabled !== 'boolean') throw Error('status');
      enabled = data.enabled;
      $('service-state').textContent = enabled ? 'DISPONÍVEL' : 'PAUSADO';
      $('service-notice').textContent = typeof data.notice === 'string' ? data.notice.slice(0, 1000) : enabled ? 'Pronto para uma pergunta. A geração local pode levar até um minuto.' : 'O Jarvis público está pausado. Você pode continuar usando a busca.';
    } catch {
      if (current !== statusVersion) return;
      enabled = false; $('service-state').textContent = 'NÃO CONFIRMADO';
      $('service-notice').textContent = 'Não foi possível verificar o serviço. Tente verificar a disponibilidade novamente.';
    } finally { if (current === statusVersion) { $('refresh-status').disabled = false; controls(); } }
  }
  function cancel(message) {
    version++;
    if (active) { clearTimeout(active.timer); active.controller.abort(); active = null; }
    controls(); announce(message); $('question').focus();
  }
  $('ask-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (active || !enabled || !$('ask-form').reportValidity()) return;
    if (!$('search-consent').checked) return;
    const question = $('question').value.trim();
    if (question.length < 3 || question.length > 300) {
      $('error').textContent = 'Digite uma pergunta entre 3 e 300 caracteres, além de espaços.';
      $('error').hidden = false; $('question').focus(); return;
    }
    $('error').hidden = true;
    const current = ++version, controller = new AbortController();
    const request = { controller, timedOut:false, timer:null };
    request.timer = setTimeout(() => { request.timedOut = true; controller.abort(); }, 75000);
    active = request; controls(); announce('Consultando fontes públicas. A geração local pode levar até um minuto.');
    try {
      const response = await fetch(base+'/ask', { method:'POST', credentials:'omit', cache:'no-store', signal:controller.signal,
        headers:{ 'Content-Type':'application/json', 'X-Jarvis-Public':'1' }, body:JSON.stringify({question,searchConsent:true}) });
      const data = await response.json();
      if (current !== version || controller.signal.aborted) return;
      if (!response.ok) throw Error(typeof data.error === 'string' ? data.error.slice(0, 500) : 'O Jarvis não pôde responder. Tente novamente mais tarde.');
      if (!['ready','no_sources'].includes(data.status) || typeof data.answer !== 'string') throw Error('Não há resposta confirmada. Tente novamente.');
      exchanges.push({question,status:data.status,mode:data.mode,answer:data.answer.slice(0, 10000),
        sources:(Array.isArray(data.sources) ? data.sources : []).filter(item => item && typeof item === 'object').slice(0, 8),
        researchedAt:typeof data.researchedAt === 'string' ? data.researchedAt : '', notice:typeof data.notice === 'string' ? data.notice.slice(0, 1000) : ''});
      exchanges = exchanges.slice(-6); render();
      announce(data.status === 'no_sources' ? 'Consulta concluída, sem fontes suficientes.' : 'Resposta disponível abaixo. Confira as fontes.');
    } catch (error) {
      if (current !== version) return;
      if (error.name === 'AbortError' && !request.timedOut) return;
      $('error').textContent = request.timedOut ? 'A consulta demorou mais que o esperado. Você pode tentar novamente ou usar a busca.' : error.message || 'Não foi possível concluir a consulta.';
      $('error').hidden = false; announce('Consulta não concluída. Nenhuma resposta foi adicionada.');
    } finally {
      clearTimeout(request.timer);
      if (current === version) { active = null; controls(); }
    }
  });
  $('question').addEventListener('input', () => { $('question-count').textContent = $('question').value.length+' / 300'; });
  $('search-consent').addEventListener('change', controls);
  $('cancel').addEventListener('click', () => cancel('Consulta cancelada nesta página.'));
  $('clear-history').addEventListener('click', () => { cancel('Conversa removida da memória desta página.'); exchanges = []; $('error').hidden = true; render(); });
  $('refresh-status').addEventListener('click', loadStatus);
  window.addEventListener('pagehide', () => { version++; statusVersion++; if (active) { clearTimeout(active.timer); active.controller.abort(); active = null; } exchanges = []; $('exchanges').replaceChildren(); $('question').value = ''; $('search-consent').checked = false; controls(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { render(); loadStatus(); } });
  $('search-consent').checked = false;
  controls(); loadStatus();
})();
