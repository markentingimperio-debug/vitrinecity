import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {injectPublicMeasurement} from '../public-measurement.js';
import {measurementContext} from '../public/measurement-policy.js';

const page=readFileSync(new URL('../public/portfolio.html',import.meta.url),'utf8');
const assetRoot=new URL('../public/assets/portfolio/',import.meta.url);

test('public portfolio links only the approved PDF and bounded public assets, never internal evidence or editor controls',()=>{
  const names=readdirSync(assetRoot).sort((a,b)=>a.localeCompare(b));
  assert.deepEqual(names,['avenida-conceitual-800.webp','avenida-conceitual.webp','cidade-3d-real.webp','vitrinecity-portfolio-20260909.pdf']);
  const pdf=readFileSync(new URL('vitrinecity-portfolio-20260909.pdf',assetRoot));
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  assert.equal(createHash('sha256').update(pdf).digest('hex'),'e1587109f27ca4c017ffa044c9b82747c804fbc74c9213d4bbce4cdcc937f76a');
  assert.ok(pdf.length<2_000_000);
  assert.doesNotMatch(page,/contenteditable|fontes-internas|FONTES-E-LIMITACOES|\/admin|\.codex|file:\/\/|Editar textos|Salvar cópia HTML/);
  for(const name of names.filter(n=>n.endsWith('.webp'))){const data=readFileSync(new URL(name,assetRoot));assert.equal(data.subarray(0,4).toString(),'RIFF');assert.equal(data.subarray(8,12).toString(),'WEBP');assert.ok(statSync(new URL(name,assetRoot)).size<400_000);}
  assert.match(page,/download="Portfolio-VitrineCity-2026.pdf"/);
});

test('metrics keep their approved origin and limitations; contact matches the existing official channel',()=>{
  for(const evidence of ['434 mil','1,1 mi','usuários ativos','Qualidade de tráfego não auditada.','não corresponde a pessoas únicas.','agrotecnicavendas','R$ 868.536,06','50.298','não são vendas realizadas dentro da VitrineCity','Valor informado pela gestão; período e comprovante a confirmar.','Visão conceitual · ilustração arquitetônica','captura real fornecida pela gestão em 08/09/2026'])assert.ok(page.includes(evidence),evidence);
  const existingContact=readFileSync(new URL('../public/contato.html',import.meta.url),'utf8');
  const whatsapp='https://wa.me/message/UNP637XE2QGCJ1';
  assert.ok(existingContact.includes(whatsapp));assert.ok(page.includes(whatsapp));assert.match(page,/href="\/contato#contact-form"/);
  for(const match of page.matchAll(/<a\b([^>]+)>/g)){if(/target="_blank"/.test(match[1]))assert.match(match[1],/rel="noopener noreferrer"/);}
});

test('public route is discoverable and measurement retains consent loader and sanitized campaign context',()=>{
  const home=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const business=readFileSync(new URL('../public/para-empresas.html',import.meta.url),'utf8');
  assert.match(home,/href="\/portfolio"/);assert.match(business,/href="\/portfolio"/);
  assert.match(page,/rel="canonical" href="https:\/\/vitrinecity.com\/portfolio"/);
  assert.match(readFileSync(new URL('../server.js',import.meta.url),'utf8'),/'\/para-empresas\.html', '\/portfolio',/);
  for(const route of ['/portfolio','/portfolio.html']){
    const measured=injectPublicMeasurement(page,route);
    assert.equal((measured.match(/data-vc-google-analytics="enabled"/g)||[]).length,1);
    assert.equal((measured.match(/src="\/analytics\.js/g)||[]).length,1);
    const context=measurementContext(new URL('https://vitrinecity.com'+route+'?email=private@example.com&token=secret&utm_source=portfolio'), 'https://example.com/private?email=hidden');
    assert.doesNotMatch(JSON.stringify(context),/private|secret|hidden|email/);
    assert.match(context.page_location,/utm_source=portfolio/);
  }
});
