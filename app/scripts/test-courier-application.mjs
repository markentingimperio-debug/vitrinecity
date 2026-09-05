import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
const publicPage=readFileSync(new URL('../public/entregador.html',import.meta.url),'utf8');
const adminPage=readFileSync(new URL('../public/admin-entregas.html',import.meta.url),'utf8');

for(const marker of ['courier_applications','cpf_hash','cpf_last4','terms_accepted_at','privacy_accepted_at','idempotency_key']) assert.match(server,new RegExp(marker));
assert.match(server,/app\.post\('\/api\/courier\/applications'/);
assert.match(server,/validCpf\(cpf\)/);
assert.match(server,/courier-application:/);
assert.match(server,/app\.patch\('\/api\/admin\/local-delivery\/applications\/:id'/);
assert.match(server,/temporaryPassword/);
assert.doesNotMatch(server,/INSERT INTO courier_applications[^;]*(cpf_raw|cpf_plain)/s);

for(const field of ['name','whatsapp','cpf','city','state','termsAccepted','privacyAccepted']) assert.match(publicPage,new RegExp(`name=["']${field}["']`));
assert.match(publicPage,/\/api\/courier\/applications/);
assert.match(publicPage,/Seu cadastro será analisado/);
assert.match(adminPage,/Solicitações de cadastro/);
assert.match(adminPage,/data-application-action="approve"/);
assert.match(adminPage,/data-application-action="reject"/);
assert.match(adminPage,/temporaryPassword/);

console.log('courier-application: ok');
