const money = cents => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export function courseCheckoutPath(slug) { return /^[a-z0-9][a-z0-9-]{0,100}$/.test(String(slug || '')) ? '/course-checkout.html?curso=' + encodeURIComponent(slug) : ''; }
export function selectedCourse(data, slug) {
  const course = data?.courses?.find(item => item.slug === slug);
  return course && Number.isSafeInteger(course.priceCents) && course.priceCents > 0 && typeof course.title === 'string' && course.title.trim() ? course : null;
}
export function safeCoursePaymentUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && ['www.mercadopago.com.br', 'mercadopago.com.br', 'www.mercadopago.com', 'mercadopago.com'].includes(url.hostname) && !url.username && !url.password && !url.port ? url.href : ''; } catch { return ''; }
}
const activeEnrollment = (data, slug) => data?.courses?.some(row => row.course_slug === slug && row.status === 'active');

export function mountCourseCheckout({ doc = document, win = window, fetchImpl = fetch } = {}) {
  const byId = id => doc.getElementById(id), form = byId('course-payment-form'), button = byId('pay-button'), message = byId('checkout-message');
  const slug = new URLSearchParams(win.location.search).get('curso') || '';
  let course = null, user = null, mode = 'register', ready = false, busy = false, uncertain = false, owned = false;
  const request = (url, body) => fetchImpl(url, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store', credentials: 'same-origin' });
  function update() {
    byId('register-fields').hidden = mode !== 'register'; byId('register-fields').disabled = mode !== 'register' || busy;
    byId('login-fields').hidden = mode !== 'login'; byId('login-fields').disabled = mode !== 'login' || busy;
    byId('account-tabs').hidden = mode === 'signed'; byId('signed-account').hidden = mode !== 'signed';
    byId('choose-register').setAttribute('aria-pressed', String(mode === 'register')); byId('choose-login').setAttribute('aria-pressed', String(mode === 'login'));
    for (const id of ['choose-register', 'choose-login', 'other-account']) byId(id).disabled = busy;
    form.hidden = owned; byId('owned-course').hidden = !owned;
    button.disabled = !ready || busy || uncertain || owned || course?.available !== true || !byId('purchase-consent').checked || (mode === 'register' && !byId('account-consent').checked);
    button.textContent = busy ? 'Preparando seu pagamento…' : !ready ? 'Consultando curso e acesso…' : mode === 'signed' ? 'Ir ao pagamento · ' + money(course.priceCents) : mode === 'login' ? 'Entrar e ir ao pagamento' : 'Criar conta e ir ao pagamento';
  }
  function changeMode(next) {
    if (busy) return;
    if (next === 'login' && !byId('login-email').value) byId('login-email').value = byId('register-email').value;
    if (next === 'register' && !byId('register-email').value) byId('register-email').value = byId('login-email').value;
    mode = next; message.textContent = ''; update();
  }
  function renderCourse(value) {
    course = value;
    byId('course-title').textContent = value.title; byId('course-description').textContent = value.description || 'Conteúdo digital na área do aluno da VitrineCity.';
    byId('course-price').textContent = money(value.priceCents);
    byId('course-format').textContent = value.contentType === 'original' ? 'Aulas em texto, atividades práticas e checklists.' : 'Conteúdo digital disponível na área do aluno.';
    byId('course-modules').hidden = !(Number.isInteger(value.modules) && value.modules > 0); byId('course-modules').textContent = value.modules + ' módulos';
    byId('course-details').href = '/centro-educacional.html#' + encodeURIComponent(slug);
    const cover = byId('course-cover');
    cover.hidden = true;
    try { if (typeof value.coverUrl === 'string' && value.coverUrl.trim()) { const url = new URL(value.coverUrl, win.location.origin); if (url.protocol === 'https:' || (url.origin === win.location.origin && url.pathname.startsWith('/'))) { cover.src = url.href; cover.alt = 'Capa do curso ' + value.title; cover.hidden = false; } } } catch {}
  }
  function showUser(value) {
    user = value; mode = 'signed'; byId('account-name').textContent = value.name || 'Sua conta'; byId('account-email').textContent = value.email || '';
  }
  async function getCourse() {
    const response = await request('/api/courses');
    if (!response.ok) throw new Error('Não foi possível consultar o curso. Tente novamente.');
    const value = selectedCourse(await response.json(), slug);
    if (!value) throw new Error('Este curso não foi encontrado. Volte ao catálogo para escolher um curso disponível.');
    return value;
  }
  async function getUser() {
    const response = await request('/api/auth/me');
    if (response.status === 401) return null;
    const data = await response.json();
    if (!response.ok || data.authenticated !== true || !data.user?.email) throw new Error('Não foi possível verificar sua conta. Seu curso permanece neste resumo.');
    return data.user;
  }
  async function checkOwned() {
    const response = await request('/api/my-courses');
    if (response.status === 401) { user = null; mode = 'login'; throw new Error('Sua sessão expirou. Entre aqui para continuar neste curso.'); }
    if (!response.ok) throw new Error('Não foi possível consultar seus cursos. Vamos conferir antes de iniciar outra compra.');
    const data = await response.json();
    if (!Array.isArray(data.courses)) throw new Error('Não foi possível consultar seus cursos. Consulte novamente.');
    owned = activeEnrollment(data, slug);
    if (owned) message.textContent = 'Este curso já está na sua conta. Você pode acessar sem comprar novamente.';
    return owned;
  }
  async function load() {
    if (busy || uncertain) return;
    ready = false; byId('retry-load').hidden = true; message.textContent = ''; update();
    if (!courseCheckoutPath(slug)) { byId('course-title').textContent = 'Escolha um curso'; byId('course-price').textContent = '—'; message.textContent = 'Volte ao catálogo e escolha o curso que deseja comprar.'; return; }
    try {
      renderCourse(await getCourse());
      if (course.available !== true) { message.textContent = 'Este curso ainda não está disponível para compra. Nenhum pagamento foi iniciado.'; return; }
      const current = await getUser();
      if (current) { showUser(current); await checkOwned(); } else { user = null; mode = 'register'; }
      ready = true;
    } catch (error) { message.textContent = error.message || 'Não foi possível carregar a compra.'; byId('retry-load').hidden = false; }
    finally { update(); }
  }
  byId('choose-register').addEventListener('click', () => changeMode('register'));
  byId('choose-login').addEventListener('click', () => changeMode('login'));
  byId('other-account').addEventListener('click', () => { if (!busy) { user = null; changeMode('login'); } });
  byId('retry-load').addEventListener('click', load);
  for (const id of ['purchase-consent', 'account-consent']) { byId(id).checked = false; byId(id).addEventListener('change', update); }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled || busy || !form.reportValidity()) return;
    busy = true; update(); message.textContent = '';
    let checkoutStarted = false;
    try {
      const fresh = await getCourse();
      if (fresh.available !== true) { renderCourse(fresh); throw new Error('Este curso ficou indisponível. Nenhum pagamento foi iniciado.'); }
      if (fresh.priceCents !== course.priceCents) { renderCourse(fresh); byId('purchase-consent').checked = false; throw new Error('O preço foi atualizado. Confira o novo total e aceite novamente antes de pagar.'); }
      const expectedEmail = mode === 'signed' ? user.email : byId(mode === 'login' ? 'login-email' : 'register-email').value.trim().toLowerCase();
      if (mode !== 'signed') {
        const registering = mode === 'register', passwordInput = byId(registering ? 'register-password' : 'login-password');
        const body = { email: expectedEmail, password: passwordInput.value };
        if (registering) Object.assign(body, { name: byId('register-name').value.trim(), adultConfirmed: byId('account-consent').checked, termsAccepted: byId('account-consent').checked });
        const response = await request(registering ? '/api/auth/register' : '/api/auth/login', body);
        const data = await response.json();
        passwordInput.value = '';
        if (!response.ok || data.ok !== true) {
          if (registering && response.status === 409) { mode = 'login'; byId('login-email').value = expectedEmail; }
          throw new Error(data.error || 'Não foi possível entrar na conta. Confira os dados.');
        }
      }
      const current = await getUser();
      if (!current) { user = null; mode = 'login'; throw new Error('Sua conta ainda não foi confirmada neste navegador. Entre aqui para continuar.'); }
      showUser(current);
      if (String(current.email).toLowerCase() !== String(expectedEmail).toLowerCase()) { byId('purchase-consent').checked = false; throw new Error('A conta conectada mudou. Confira o e-mail acima e aceite novamente para continuar.'); }
      if (await checkOwned()) return;
      const beforePayment = await getCourse();
      if (beforePayment.available !== true || beforePayment.priceCents !== course.priceCents) {
        renderCourse(beforePayment); byId('purchase-consent').checked = false;
        throw new Error('As condições do curso mudaram. Confira a disponibilidade e o total antes de continuar.');
      }
      checkoutStarted = true;
      const response = await request(`/api/courses/${encodeURIComponent(slug)}/checkout`, { termsAccepted: true });
      if (response.status === 401) { checkoutStarted = false; user = null; mode = 'login'; throw new Error('Sua sessão expirou. Entre novamente para continuar neste curso.'); }
      if ([400, 404, 409, 429, 503].includes(response.status)) checkoutStarted = false;
      const data = await response.json();
      if (response.status === 409 && data.code === 'course_already_enrolled' && data.alreadyEnrolled === true) { owned = true; message.textContent = 'Este curso já está na sua conta. Acesse sem comprar novamente.'; return; }
      if (!response.ok) throw new Error(data.error || 'Não foi possível iniciar o pagamento.');
      const url = safeCoursePaymentUrl(data.checkoutUrl);
      if (!url || !data.reference) throw new Error('Não foi possível verificar o endereço de pagamento.');
      // This event represents a provider checkout, never a payment or enrollment.
      doc.dispatchEvent(new win.CustomEvent('vc:course-checkout', { detail: { slug, amount: course.priceCents } }));
      uncertain = true; // Keep the button locked while the browser leaves this page.
      win.location.assign(url);
    } catch (error) {
      uncertain = checkoutStarted;
      message.textContent = uncertain ? 'Não foi possível confirmar a abertura do pagamento. Não repita a solicitação agora; confira “Meus cursos” ou fale com a equipe.' : error.message || 'Não foi possível continuar. Confira os dados.';
    } finally {
      byId('register-password').value = ''; byId('login-password').value = '';
      busy = false; update();
    }
  });
  const loaded = load();
  return { ready: loaded };
}
