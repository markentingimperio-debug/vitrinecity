import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const publicDir = new URL('../public/', import.meta.url);
const documents = [
  ['termos-marketplace.html', 'marketplace-2026-08-22'],
  ['politica-vendedor-marketplace.html', 'seller-2026-08-22'],
  ['politica-comprador-marketplace.html', 'buyer-2026-08-22'],
  ['politica-devolucao-marketplace.html', 'returns-2026-08-22'],
  ['politica-cancelamento-marketplace.html', 'cancellation-2026-08-22'],
  ['politica-disputas-marketplace.html', 'disputes-2026-08-22']
];

for (const [file, version] of documents) {
  const html = await readFile(new URL(file, publicDir), 'utf8');
  assert.match(html, new RegExp(version), `${file} precisa declarar sua versão`);
}

const terms = await readFile(new URL('termos-marketplace.html', publicDir), 'utf8');
assert.match(terms, /revisão jurídica/i, 'os termos precisam indicar a revisão jurídica pendente');

const client = await readFile(new URL('../public/marketplace-terms.js', import.meta.url), 'utf8');
assert.match(client, /marketplaceTerms/);
assert.match(client, /termsAccepted: true/);
assert.match(client, /termos-marketplace\.html/);

const server = await readFile(new URL('../server.js', import.meta.url), 'utf8');
assert.match(server, /purpose: 'marketplace_buyer_terms'/);
assert.match(server, /version: 'marketplace-2026-08-22'/);
assert.match(server, /req\.body\?\.termsAccepted !== true/);
assert.match(server, /marketplace-terms\.js/);

console.log('marketplace-legal: ok');
