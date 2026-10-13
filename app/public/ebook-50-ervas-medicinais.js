const SLUG = '50-ervas-medicinais';
const PRICE_CENTS = 1599;

export function availableEbook(courses) {
  return Array.isArray(courses)
    ? courses.find(course => course.slug === SLUG && course.available === true && course.priceCents === PRICE_CENTS) || null
    : null;
}

export function activeEbook(enrollments) {
  return Array.isArray(enrollments)
    ? enrollments.find(course => course.course_slug === SLUG && course.status === 'active') || null
    : null;
}

export function mercadoPagoCheckoutUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const allowed = ['mercadopago.com', 'mercadopago.com.br'];
    return url.protocol === 'https:' && !url.username && !url.password &&
      allowed.some(domain => host === domain || host.endsWith(`.${domain}`)) ? url.href : '';
  } catch { return ''; }
}

async function readJson(response) {
  try { return await response.json(); } catch { return {}; }
}

async function initPurchasePage() {
  const button = document.getElementById('buy-ebook');
  const terms = document.getElementById('purchase-terms');
  const status = document.getElementById('purchase-status');
  const login = document.getElementById('login-link');
  let ready = false;

  try {
    const response = await fetch('/api/courses', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('catalog_unavailable');
    ready = Boolean(availableEbook((await readJson(response)).courses));
    status.textContent = ready ? 'Disponível para compra.' : 'A venda ainda não está disponível. Volte em breve.';
  } catch { status.textContent = 'Não foi possível verificar a disponibilidade agora. Tente novamente mais tarde.'; }
  button.disabled = !ready;
  button.textContent = ready ? 'Comprar por R$ 15,99' : 'Compra indisponível';

  button.addEventListener('click', async () => {
    if (!ready || button.disabled) return;
    if (!terms.checked) { status.textContent = 'Aceite as condições da compra para continuar.'; terms.focus(); return; }
    button.disabled = true;
    status.textContent = 'Preparando o pagamento…';
    try {
      const response = await fetch(`/api/courses/${SLUG}/checkout`, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ termsAccepted: true })
      });
      if (response.status === 401) {
        status.textContent = 'Entre ou crie sua conta para concluir a compra.';
        login.hidden = false;
        return;
      }
      const payload = await readJson(response);
      if (!response.ok) throw new Error(payload.error || 'Não foi possível iniciar o pagamento.');
      const checkoutUrl = mercadoPagoCheckoutUrl(payload.checkoutUrl);
      if (!checkoutUrl) throw new Error('O pagamento não retornou um endereço válido. Tente novamente.');
      window.location.assign(checkoutUrl);
    } catch (error) { status.textContent = error.message || 'Não foi possível iniciar o pagamento.'; }
    finally { button.disabled = false; }
  });
}

async function initLibraryPage() {
  const status = document.getElementById('library-status');
  const login = document.getElementById('library-login');
  const fileLink = document.getElementById('ebook-file');
  try {
    const response = await fetch('/api/my-courses', { credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401) {
      status.textContent = 'Entre na conta usada na compra para acessar o e-book.';
      login.hidden = false;
      return;
    }
    if (!response.ok) throw new Error('Não foi possível verificar seu acesso agora.');
    if (!activeEbook((await readJson(response)).courses)) {
      status.textContent = 'O e-book ainda não está disponível nesta conta. Se você acabou de pagar, aguarde a confirmação do pagamento e atualize esta página.';
      return;
    }
    const materials = await fetch(`/api/my-courses/${SLUG}/materials`, { credentials: 'same-origin', cache: 'no-store' });
    if (!materials.ok) throw new Error('Não foi possível carregar o arquivo agora.');
    const files = (await readJson(materials)).files;
    const pdf = Array.isArray(files) ? files.find(file => file.type === 'pdf' && typeof file.path === 'string') : null;
    if (!pdf) { status.textContent = 'O arquivo ainda está em preparação. Tente novamente mais tarde.'; return; }
    fileLink.href = `/api/my-courses/${SLUG}/material?path=${encodeURIComponent(pdf.path)}`;
    fileLink.hidden = false;
    status.textContent = 'Seu e-book está disponível. Abra o PDF pelo botão abaixo.';
  } catch (error) { status.textContent = error.message || 'Não foi possível carregar seu e-book agora.'; }
}

if (typeof document !== 'undefined') {
  if (document.body?.dataset.ebookPage === 'purchase') initPurchasePage();
  if (document.body?.dataset.ebookPage === 'library') initLibraryPage();
}
