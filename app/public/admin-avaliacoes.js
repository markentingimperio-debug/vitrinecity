const $ = id => document.getElementById(id);
let products = [], preview = null, page = 0, busy = false;
const PAGE_SIZE = 30;
function element(tag, value, className) { const node = document.createElement(tag); if (value != null) node.textContent = value; if (className) node.className = className; return node; }
function message(value, error = false) { $('message').textContent = value; $('message').className = error ? 'error' : 'success'; }
function errorMessage(error) { message(error.message || 'Não foi possível concluir. Tente novamente.', true); }
async function api(url, data) {
  const response = await fetch(`/api/admin/review-imports${url}`, { credentials: 'same-origin', ...(data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}) });
  if (response.status === 401 || response.status === 403) throw new Error('A sessão administrativa expirou ou não tem acesso. Entre novamente pelo painel.');
  let result; try { result = await response.json(); } catch { throw new Error('O servidor não respondeu. Tente novamente.'); }
  if (!response.ok) { const error = new Error(result.error || 'Não foi possível concluir.'); error.data = result; throw error; }
  return result;
}
function controls() {
  ['productId', 'sourceUrl', 'file', 'content', 'confirmed'].forEach(id => { $(id).disabled = busy; });
  $('previewButton').disabled = busy;
  $('publish').disabled = busy || !preview?.id || !preview.summary.new || !$('confirmed').checked;
}
function invalidate() { preview = null; $('preview').hidden = true; $('confirmed').checked = false; controls(); }
function renderPage() {
  const rows = preview?.rows || [], totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  $('rows').replaceChildren();
  rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).forEach(row => {
    const tr = element('tr'), product = element('td', row.productName); product.append(element('small', `${row.storeName} · #${row.productId}`));
    const author = element('td', row.author); author.append(element('small', row.createdAt.slice(0, 10).split('-').reverse().join('/')));
    const comment = element('td', [row.title, row.body || 'Avaliação somente com estrelas.', row.variation ? `Variação: ${row.variation}` : ''].filter(Boolean).join('\n'), 'comment');
    const status = element('td'); status.append(element('span', row.duplicate ? 'Duplicada' : 'Nova', `tag${row.duplicate ? ' duplicate' : ''}`));
    tr.append(product, author, element('td', `${row.rating} / 5 ★`, 'rating'), comment, status); $('rows').append(tr);
  });
  $('pageLabel').textContent = `Página ${page + 1} de ${totalPages} · ${rows.length} avaliações`;
  $('previous').disabled = page === 0; $('next').disabled = page + 1 >= totalPages;
}
function showPreview(data) {
  preview = data; page = 0; $('confirmed').checked = false; $('preview').hidden = false;
  const summary = data.summary;
  $('summary').textContent = `${summary.new} novas · ${summary.duplicates} duplicadas · ${summary.invalid} inválidas`;
  $('errors').replaceChildren();
  if (data.errors?.length) { const list = element('ul'); data.errors.forEach(error => list.append(element('li', `Avaliação ${error.line}: ${error.message}`))); $('errors').append(list); }
  const groups = new Map();
  data.rows.forEach(row => { const key = `${row.productId}:${row.source.key}`; const group = groups.get(key) || { ...row, count: 0 }; if (!row.duplicate) group.count++; groups.set(key, group); });
  $('groups').replaceChildren();
  groups.forEach(group => { const line = element('div', null, 'group'), link = element('a', 'Conferir anúncio na Shopee ↗'); link.href = group.source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; line.append(element('span', `${group.productName} (#${group.productId}) · ${group.count} novas`), link); $('groups').append(line); });
  renderPage(); controls(); $('previewTitle').focus();
}
async function loadHistory() {
  const { batches } = await api(''); $('history').replaceChildren();
  if (!batches.length) { $('history').append(element('p', 'Nenhum lote importado ainda.', 'muted')); return; }
  batches.forEach(batch => {
    const row = element('article', null, 'batch'), info = element('div'), hidden = batch.status === 'hidden';
    info.append(element('strong', `${batch.imported_count} avaliações · ${hidden ? 'Ocultas' : 'Publicadas'}`), element('p', `Importado em ${new Date(`${batch.created_at.replace(' ', 'T')}Z`).toLocaleString('pt-BR')} · ${batch.summary.duplicates} duplicatas ignoradas`), element('small', `Lote ${batch.id}`));
    if (batch.imported_count) {
      const button = element('button', hidden ? 'Restaurar lote' : 'Ocultar lote', 'secondary'); button.type = 'button';
      button.addEventListener('click', async () => { button.disabled = true; try { await api(`/${batch.id}/visibility`, { action: hidden ? 'restore' : 'hide' }); message(hidden ? 'Avaliações do lote restauradas.' : 'Avaliações do lote ocultadas. Você pode restaurá-las a qualquer momento.'); await loadHistory(); } catch (error) { errorMessage(error); button.disabled = false; } });
      row.append(info, button);
    } else row.append(info);
    $('history').append(row);
  });
}
$('importForm').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return; busy = true; invalidate(); message('Conferindo os dados…'); controls();
  try {
    const file = $('file').files[0];
    if (file && file.size > 2 * 1024 * 1024) throw new Error('Use um arquivo com até 2 MB.');
    const content = file ? await file.text() : $('content').value;
    const data = await api('/preview', { content, productId: $('productId').value || undefined, sourceUrl: $('sourceUrl').value || undefined });
    showPreview(data); message(data.summary.new ? 'Prévia pronta. Confira os produtos e confirme para publicar.' : 'Todas as avaliações já foram importadas. Nenhuma será duplicada.');
  } catch (error) { if (error.data?.summary) showPreview(error.data); errorMessage(error); }
  finally { busy = false; controls(); }
});
$('publish').addEventListener('click', async () => {
  if (busy || !preview?.id || !$('confirmed').checked) return; busy = true; controls();
  try { const result = await api(`/${preview.id}/publish`, { confirmed: true }); invalidate(); message(`${result.summary.new} avaliações importadas e publicadas. ${result.summary.duplicates} duplicatas ignoradas.`); await loadHistory(); await loadProducts(); }
  catch (error) { errorMessage(error); } finally { busy = false; controls(); }
});
async function loadProducts() {
  const selected = $('productId').value; ({ products } = await api('/products'));
  $('productId').replaceChildren(new Option('Vários produtos — informados no arquivo', ''));
  products.forEach(product => $('productId').append(new Option(`${product.store_name} · ${product.name} (#${product.id})`, String(product.id))));
  $('productId').value = selected || new URLSearchParams(location.search).get('product') || '';
}
$('productId').addEventListener('change', () => { $('sourceUrl').value = products.find(product => String(product.id) === $('productId').value)?.source_url || ''; invalidate(); });
['sourceUrl', 'content'].forEach(id => $(id).addEventListener('input', invalidate));
$('file').addEventListener('change', () => { if ($('file').files.length) $('content').value = ''; invalidate(); });
$('content').addEventListener('input', () => { $('file').value = ''; });
$('confirmed').addEventListener('change', controls);
$('previous').addEventListener('click', () => { page--; renderPage(); });
$('next').addEventListener('click', () => { page++; renderPage(); });
$('refresh').addEventListener('click', () => loadHistory().catch(errorMessage));
$('template').addEventListener('click', () => { const blob = new Blob(['\uFEFFproduct_id;source_url;review_id;author;rating;date;title;body;variation\r\n'], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob), link = element('a'); link.href = url; link.download = 'modelo-avaliacoes-shopee.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
Promise.all([loadProducts(), loadHistory()]).then(() => { $('sourceUrl').value = products.find(product => String(product.id) === $('productId').value)?.source_url || ''; }).catch(errorMessage);
