import test from 'node:test';
import assert from 'node:assert/strict';
import { siteAssistantDestination } from '../public/site-assistant-content.js';

const origin='https://vitrinecity.com';

test('viewer URLs preserve product, shop and course identity while enabling the embedded presentation',()=>{
  for(const value of ['/produto/13/adubo','/loja/official','/receitas','/cursos/canva']){
    const target=siteAssistantDestination(value,origin);
    assert.equal(target.kind,'embedded');assert.equal(target.contextPath,value);
    assert.equal(new URL(target.url).pathname,value);assert.equal(new URL(target.url).searchParams.get('lia'),'1');
  }
  const course=siteAssistantDestination('/course-checkout.html?curso=canva-para-lojas&lia=0',origin);
  assert.equal(course.contextPath,'/cursos/canva-para-lojas');assert.equal(new URL(course.url).searchParams.get('curso'),'canva-para-lojas');
  assert.deepEqual(new URL(course.url).searchParams.getAll('lia'),['1']);
});

test('public viewer rejects unsafe routes and preserves protected explicit links for external destinations',()=>{
  for(const value of ['/admin.html','/api/users','/carteira','/produto/13?token=private','javascript:alert(1)','//evil.test','https://u:p@evil.test','http://external.test']){
    assert.equal(siteAssistantDestination(value,origin),null,value);
  }
  for(const value of ['/meus-cursos.html','/entrar-cidade.html','/ir/partner-1','https://partner.example/product']){
    const target=siteAssistantDestination(value,origin);assert.equal(target.kind,'external');assert.equal(target.contextPath,undefined);
    assert.equal(new URL(target.url).searchParams.has('lia'),false);
  }
  assert.equal(siteAssistantDestination('/ir/partner-1',origin).partner,true);
});

test('only the existing verified Mercado Pago hosts receive the payment label',()=>{
  for(const host of ['mercadopago.com.br','www.mercadopago.com.br','mercadopago.com','www.mercadopago.com']){
    assert.equal(siteAssistantDestination('https://'+host+'/checkout/test?pref_id=confirmed',origin).payment,true);
  }
  for(const value of ['https://mercadopago.com.br.evil.test/','https://evil.test/?site=mercadopago.com.br','https://mercadopago.com.br:444/']){
    assert.equal(siteAssistantDestination(value,origin).payment,false,value);
  }
});

test('only the two designated customer forms embed without contributing a private context',()=>{
  for(const value of ['/entrar.html?returnTo=%2Floja.html','/minha-conta.html?returnTo=%2Floja.html']){
    const target=siteAssistantDestination(value,origin);assert.equal(target.kind,'embedded');assert.equal(target.contextPath,'');
    assert.equal(new URL(target.url).searchParams.get('lia'),'1');assert.equal(new URL(target.url).searchParams.get('returnTo'),'/loja.html');
  }
  for(const value of ['/admin.html','/pagamento.html','/checkout','/entrar.html?returnTo=https%3A%2F%2Fevil.test','/minha-conta.html?token=private','/course-checkout.html?curso=invalid/slug']){
    assert.equal(siteAssistantDestination(value,origin),null,value);
  }
  for(const value of ['/privacy.html','/termos-marketplace.html','/recuperar-acesso.html']){
    assert.equal(siteAssistantDestination(value,origin).kind,'external');
  }
});
