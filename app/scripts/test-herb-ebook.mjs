import test from 'node:test';
import assert from 'node:assert/strict';
import { activeEbook, availableEbook, mercadoPagoCheckoutUrl } from '../public/ebook-50-ervas-medicinais.js';

test('a compra só é oferecida para o e-book disponível com o preço anunciado', () => {
  const ebook = { slug: '50-ervas-medicinais', available: true, priceCents: 1599 };
  assert.equal(availableEbook([]), null);
  assert.equal(availableEbook([{ ...ebook, available: false }]), null);
  assert.equal(availableEbook([{ ...ebook, priceCents: 999 }]), null);
  assert.equal(availableEbook([{ ...ebook, slug: 'outro-livro' }]), null);
  assert.deepEqual(availableEbook([ebook]), ebook);
});

test('a biblioteca exige matrícula ativa mesmo quando novas vendas são pausadas', () => {
  const ebook = { course_slug: '50-ervas-medicinais', status: 'active', contentReady: true };
  assert.equal(activeEbook([{ ...ebook, status: 'revoked' }]), null);
  assert.deepEqual(activeEbook([{ ...ebook, contentReady: false }]), { ...ebook, contentReady: false });
  assert.equal(activeEbook([{ ...ebook, course_slug: 'outro-livro' }]), null);
  assert.deepEqual(activeEbook([ebook]), ebook);
});

test('a navegação de pagamento aceita somente URLs HTTPS do Mercado Pago', () => {
  assert.equal(mercadoPagoCheckoutUrl('https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=123'),
    'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=123');
  assert.equal(mercadoPagoCheckoutUrl('https://sandbox.mercadopago.com.br/checkout'),
    'https://sandbox.mercadopago.com.br/checkout');
  for (const url of ['http://mercadopago.com.br/checkout', 'https://mercadopago.com.br.evil.test/',
    'https://evil.test/', 'javascript:alert(1)', '/arquivo.pdf', 'https://user@mercadopago.com.br/checkout']) {
    assert.equal(mercadoPagoCheckoutUrl(url), '', url);
  }
});
