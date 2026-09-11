import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mountCourseCheckout, selectedCourse, courseCheckoutPath, safeCoursePaymentUrl } from '../public/course-checkout.js';

const base = { slug: 'geladinhos-gourmet', title: 'Geladinhos Gourmet', description: 'Produção e vendas', available: true, priceCents: 2399, modules: 6, contentType: 'original', coverUrl: '/assets/course-test.png' };
const ok = (data, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
class Element {
  constructor() { this.listeners = {}; this.attrs = {}; this.hidden = false; this.disabled = false; this.checked = false; this.value = ''; this.textContent = ''; }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  async fire(type) { for (const fn of this.listeners[type] || []) await fn({ preventDefault() {} }); }
  reportValidity() { return true; }
}
function harness({ logged = false, search = '?curso=geladinhos-gourmet', course = base, courses, enrollments = [], authPost, checkoutPost, accountGet, myCoursesGet, quoteGet } = {}) {
  const nodes = new Map(), get = key => { if (!nodes.has(key)) nodes.set(key, new Element()); return nodes.get(key); };
  const requests = [], redirects = [], events = [];
  let connected = logged, user = { name: 'Aluno Teste', email: 'aluno@example.test' }, catalogCalls = 0;
  const doc = { getElementById: get, dispatchEvent: event => events.push(event) };
  const win = { location: { origin: 'https://vitrinecity.com', search, assign: url => redirects.push(url) }, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } } };
  for (const prefix of ['register', 'login']) { get(prefix + '-email').value = user.email; get(prefix + '-password').value = 'test-password-only'; }
  get('register-name').value = user.name;
  const fetchImpl = async (path, opts = {}) => {
    requests.push({ path, ...opts });
    if (path === '/api/courses') { catalogCalls++; return ok({ courses: courses || [typeof course === 'function' ? course(catalogCalls) : course] }); }
    if(path.endsWith('/quote')){const value=typeof course==='function'?course(catalogCalls):course;return quoteGet?quoteGet():ok({quote:{originalAmountCents:value.priceCents,discountCents:0,amountCents:value.priceCents,couponCode:'',eligible:false,percent:0}});}
    if (path === '/api/auth/me') return accountGet ? accountGet(connected, user) : connected ? ok({ authenticated: true, user }) : ok({ authenticated: false }, 401);
    if (path === '/api/my-courses') return myCoursesGet ? myCoursesGet() : ok({ courses: enrollments });
    if (path === '/api/auth/register' || path === '/api/auth/login') {
      const body = JSON.parse(opts.body);
      const response = authPost ? await authPost(path, body) : ok({ ok: true }, path.endsWith('register') ? 201 : 200);
      if (response.ok) { connected = true; user = { name: body.name || user.name, email: body.email }; }
      return response;
    }
    if (path.endsWith('/checkout')) return checkoutPost ? checkoutPost(path, opts) : ok({ reference: 'course_local_test', checkoutUrl: 'https://www.mercadopago.com.br/checkout/test' }, 201);
    throw new Error('Unexpected request ' + path);
  };
  return { doc, win, fetchImpl, get, requests, redirects, events, posts: () => requests.filter(r => r.method === 'POST'), purchases: () => requests.filter(r => r.path.endsWith('/checkout')) };
}
async function accept(h) { h.get('account-consent').checked = true; h.get('purchase-consent').checked = true; await h.get('purchase-consent').fire('change'); }
const liaQuote=(eligible=true)=>({originalAmountCents:2399,discountCents:eligible?120:0,amountCents:eligible?2279:2399,couponCode:eligible?'LIA5':'',eligible,percent:eligible?5:0});

test('Lia benefit is visible before purchase and the confirmed discounted amount stays in the embedded handoff',async()=>{
  const h=harness({logged:true,quoteGet:()=>ok({quote:liaQuote()})});h.win.vcLiaNavigate=()=>true;
  await mountCourseCheckout(h).ready;assert.equal(h.get('lia-course-benefit').hidden,false);assert.match(h.get('course-original-price').textContent,/23,99/);assert.match(h.get('course-lia-discount').textContent,/1,20/);assert.match(h.get('course-price').textContent,/22,79/);
  await accept(h);await h.get('course-payment-form').fire('submit');assert.deepEqual(JSON.parse(h.purchases()[0].body),{termsAccepted:true,couponCode:'LIA5',expectedAmountCents:2279});assert.equal(h.events[0].detail.amount,2279);assert.equal(h.redirects.length,0);
});
test('expired or newly available Lia benefit refreshes the price and requires consent before account or payment',async()=>{
  for(const startsEligible of [true,false]){let calls=0;const h=harness({quoteGet:()=>ok({quote:liaQuote(++calls===1?startsEligible:!startsEligible)})});await mountCourseCheckout(h).ready;await accept(h);await h.get('course-payment-form').fire('submit');assert.equal(h.posts().length,0);assert.equal(h.get('purchase-consent').checked,false);assert.equal(h.get('lia-course-benefit').hidden,startsEligible);assert.match(h.get('checkout-message').textContent,/aceite novamente/);}
});
test('server-side coupon expiration cannot silently charge the original price or retry',async()=>{
  const h=harness({logged:true,quoteGet:()=>ok({quote:liaQuote()}),checkoutPost:()=>ok({code:'lia_quote_changed',error:'Confira o novo total.',quote:liaQuote(false)},409)});
  await mountCourseCheckout(h).ready;await accept(h);await h.get('course-payment-form').fire('submit');await h.get('course-payment-form').fire('submit');assert.equal(h.purchases().length,1);assert.equal(h.get('purchase-consent').checked,false);assert.match(h.get('course-price').textContent,/23,99/);assert.equal(h.get('lia-course-benefit').hidden,true);assert.equal(h.redirects.length,0);assert.equal(h.events.length,0);
});
test('missing or inconsistent authoritative quote prevents checkout instead of displaying an invented discount',async()=>{
  for(const quote of [null,{...liaQuote(),amountCents:1}]){const h=harness({quoteGet:()=>ok({quote})});await mountCourseCheckout(h).ready;await accept(h);await h.get('course-payment-form').fire('submit');assert.equal(h.purchases().length,0);assert.equal(h.get('pay-button').disabled,true);assert.equal(h.get('retry-load').hidden,false);}
});

test('public summary loads before any auth mutation or checkout and ignores URL price', async () => {
  const h = harness({ search: '?curso=geladinhos-gourmet&priceCents=1' }); await mountCourseCheckout(h).ready;
  assert.equal(h.get('course-title').textContent, base.title); assert.match(h.get('course-price').textContent, /23,99/); assert.equal(h.posts().length, 0); assert.equal(h.get('pay-button').disabled, true); assert.equal(h.get('account-consent').checked, false); assert.equal(h.get('purchase-consent').checked, false); assert.equal(h.get('login-fields').hidden, true); assert.equal(h.get('register-fields').hidden, false);
});
test('invalid or unavailable course never opens checkout or asks the server to register', async () => {
  for (const opts of [{ search: '?curso=../admin' }, { course: { ...base, available: false } }, { course: { ...base, priceCents: '2399' } }, { courses: [] }]) {
    const h = harness(opts); await mountCourseCheckout(h).ready; await accept(h); await h.get('course-payment-form').fire('submit'); assert.equal(h.posts().length, 0); assert.equal(h.get('pay-button').disabled, true);
  }
});
test('new student registers in place using only the lightweight digital fields before authenticated payment', async () => {
  const h = harness(); await mountCourseCheckout(h).ready; await accept(h); await h.get('course-payment-form').fire('submit');
  assert.deepEqual(h.posts().map(r => r.path), ['/api/auth/register', '/api/courses/geladinhos-gourmet/checkout']);
  assert.deepEqual(JSON.parse(h.posts()[0].body), { name: 'Aluno Teste', email: 'aluno@example.test', password: 'test-password-only', adultConfirmed: true, termsAccepted: true });
  assert.deepEqual(JSON.parse(h.purchases()[0].body), { termsAccepted: true,couponCode:'',expectedAmountCents:2399 });
  assert.ok(h.requests.findIndex(r => r.path === '/api/my-courses') < h.requests.findIndex(r => r.path.endsWith('/checkout')));
  assert.equal(h.redirects[0], 'https://www.mercadopago.com.br/checkout/test'); assert.equal(h.events[0].type, 'vc:course-checkout'); assert.equal(h.get('register-password').value, '');
});
test('existing student signs in on the same course summary without a registration detour', async () => {
  const h = harness(); await mountCourseCheckout(h).ready; await h.get('choose-login').fire('click'); await accept(h); await h.get('course-payment-form').fire('submit');
  assert.deepEqual(h.posts().map(r => r.path), ['/api/auth/login', '/api/courses/geladinhos-gourmet/checkout']); assert.equal(h.get('login-fields').disabled, true); assert.equal(h.get('signed-account').hidden, false);
});
test('authenticated student sees verified identity and needs no registration fields', async () => {
  const h = harness({ logged: true }); await mountCourseCheckout(h).ready; assert.equal(h.get('register-fields').disabled, true); assert.equal(h.get('account-email').textContent, 'aluno@example.test'); h.get('purchase-consent').checked = true; await h.get('purchase-consent').fire('change'); await h.get('course-payment-form').fire('submit'); assert.equal(h.posts().length, 1); assert.equal(h.posts()[0].path, '/api/courses/geladinhos-gourmet/checkout');
});
test('email already registered changes to login with email and course preserved, without checkout', async () => {
  const h = harness({ authPost: async () => ok({ error: 'Este e-mail já possui uma conta.' }, 409) }); await mountCourseCheckout(h).ready; await accept(h); await h.get('course-payment-form').fire('submit'); assert.equal(h.purchases().length, 0); assert.equal(h.get('login-fields').hidden, false); assert.equal(h.get('login-email').value, 'aluno@example.test'); assert.equal(h.get('course-title').textContent, base.title); assert.equal(h.get('register-password').value, '');
});
test('invalid login stays in place, clears password and never creates a payment', async () => {
  const h = harness({ authPost: async () => ok({ error: 'E-mail ou senha incorretos.' }, 401) }); await mountCourseCheckout(h).ready; await h.get('choose-login').fire('click'); await accept(h); await h.get('course-payment-form').fire('submit'); assert.equal(h.purchases().length, 0); assert.match(h.get('checkout-message').textContent, /incorretos/); assert.equal(h.get('login-password').value, ''); assert.equal(h.redirects.length, 0);
});
test('active enrollment prevents repurchase both before checkout and through backend race guard', async () => {
  for (const opts of [{ logged: true, enrollments: [{ course_slug: base.slug, status: 'active' }] }, { logged: true, checkoutPost: async () => ok({ code: 'course_already_enrolled', alreadyEnrolled: true, nextUrl: '/meus-cursos.html' }, 409) }]) {
    const h = harness(opts); await mountCourseCheckout(h).ready; await accept(h); await h.get('course-payment-form').fire('submit'); assert.equal(h.get('owned-course').hidden, false); assert.equal(h.get('course-payment-form').hidden, true); assert.equal(h.redirects.length, 0); assert.equal(h.events.length, 0); if (opts.enrollments) assert.equal(h.purchases().length, 0);
  }
});
test('unavailable enrollment lookup blocks payment instead of risking duplicate purchase', async () => {
  const h = harness({ logged: true, myCoursesGet: () => ok({}, 503) }); await mountCourseCheckout(h).ready; await accept(h); await h.get('course-payment-form').fire('submit'); assert.equal(h.purchases().length, 0); assert.equal(h.get('retry-load').hidden, false);
});
test('changed price is rendered and requires a fresh unchecked consent before account or payment creation', async () => {
  const h = harness({ course: count => ({ ...base, priceCents: count === 1 ? 2399 : 2999 }) }); await mountCourseCheckout(h).ready; await accept(h); await h.get('course-payment-form').fire('submit'); assert.match(h.get('course-price').textContent, /29,99/); assert.equal(h.get('purchase-consent').checked, false); assert.equal(h.posts().length, 0);
});
test('expired checkout session shows login again and preserves course without automatic retry', async () => {
  const h = harness({ logged: true, checkoutPost: async () => ok({ error: 'Sessão expirada' }, 401) }); await mountCourseCheckout(h).ready; await accept(h); await h.get('course-payment-form').fire('submit'); assert.equal(h.get('login-fields').hidden, false); assert.equal(h.purchases().length, 1); assert.equal(h.redirects.length, 0); assert.equal(h.get('course-title').textContent, base.title);
});
test('a second click while submitting or leaving the page cannot create another preference', async () => {
  let release; const h = harness({ logged: true, checkoutPost: () => new Promise(resolve => { release = resolve; }) }); await mountCourseCheckout(h).ready; await accept(h);
  const first = h.get('course-payment-form').fire('submit'); await new Promise(resolve => setTimeout(resolve, 0)); await h.get('course-payment-form').fire('submit'); assert.equal(h.purchases().length, 1); release(ok({ reference: 'course_test', checkoutUrl: 'https://www.mercadopago.com.br/checkout/test' }, 201)); await first; await h.get('course-payment-form').fire('submit'); assert.equal(h.purchases().length, 1);
});

test('embedded checkout hands the verified payment URL to Lia once and stays locked', async () => {
  const h = harness({ logged: true }), handoffs = [];
  h.win.vcLiaNavigate = url => { handoffs.push(url); return true; };
  await mountCourseCheckout(h).ready; await accept(h); await h.get('course-payment-form').fire('submit');
  await h.get('course-payment-form').fire('submit');
  assert.deepEqual(handoffs, ['https://www.mercadopago.com.br/checkout/test']);
  assert.equal(h.redirects.length, 0); assert.equal(h.purchases().length, 1); assert.equal(h.get('pay-button').disabled, true);
  assert.match(h.get('checkout-message').textContent, /Continue pelo link de pagamento na conversa/);
});

test('normal checkout still redirects when the Lia bridge returns false', async () => {
  const h = harness({ logged: true }); h.win.vcLiaNavigate = () => false;
  await mountCourseCheckout(h).ready; await accept(h); await h.get('course-payment-form').fire('submit');
  assert.deepEqual(h.redirects, ['https://www.mercadopago.com.br/checkout/test']); assert.equal(h.get('pay-button').disabled, true);
});

test('invalid payment reference or failed handoff cannot generate a second preference', async () => {
  for (const brokenReference of [true, false]) {
    const h = harness({ logged: true, ...(brokenReference ? { checkoutPost: () => ok({ reference: {}, checkoutUrl: 'https://www.mercadopago.com.br/checkout/test' }, 201) } : {}) });
    let handoffs = 0; h.win.vcLiaNavigate = () => { handoffs++; throw Error('bridge unavailable'); };
    await mountCourseCheckout(h).ready; await accept(h); await h.get('course-payment-form').fire('submit'); await h.get('course-payment-form').fire('submit');
    assert.equal(handoffs, brokenReference ? 0 : 1); assert.equal(h.purchases().length, 1); assert.equal(h.redirects.length, 0); assert.equal(h.get('pay-button').disabled, true);
  }
});
test('uncertain or invalid payment response cannot redirect, announce success or retry automatically', async () => {
  for (const checkoutPost of [async () => { throw Error('network'); }, async () => ok({ reference: 'ref', checkoutUrl: 'https://evil.test' }), async () => ({ ...ok({}), json: async () => { throw Error('bad-json'); } })]) {
    const h = harness({ logged: true, checkoutPost }); await mountCourseCheckout(h).ready; await accept(h); await h.get('course-payment-form').fire('submit'); await h.get('course-payment-form').fire('submit'); assert.equal(h.purchases().length, 1); assert.equal(h.redirects.length, 0); assert.equal(h.events.length, 0); assert.equal(h.get('pay-button').disabled, true);
  }
});
test('only exact catalog selection and HTTPS Mercado Pago checkout URLs are accepted', () => {
  assert.equal(courseCheckoutPath(base.slug), '/course-checkout.html?curso=geladinhos-gourmet'); assert.equal(courseCheckoutPath('../admin'), ''); assert.equal(selectedCourse({ courses: [base] }, 'other'), null);
  for (const value of ['javascript:alert(1)', 'https://mercadopago.com.br.evil.test/', 'https://user:pass@www.mercadopago.com.br/', 'http://mercadopago.com.br/']) assert.equal(safeCoursePaymentUrl(value), '');
});
test('course purchase entry points navigate to the summary and new checkout asks for no shipping data', () => {
  const publicFile = name => readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');
  const center = publicFile('centro-educacional.html'); assert.ok(center.includes("location.assign('/course-checkout.html?curso='+encodeURIComponent(course.slug))")); assert.doesNotMatch(center, /async function buy\(|fetch\(`\/api\/courses\/.*checkout/);
  const html = publicFile('course-checkout.html'); assert.match(html, /Já tenho conta/); assert.ok(html.indexOf('id="course-title"') < html.indexOf('id="register-fields"')); assert.doesNotMatch(html, /name="cpf"|name="postalCode"|name="street"|type="checkbox"[^>]+checked/); assert.match(html, /id="pay-button"[^>]*disabled/);
});
