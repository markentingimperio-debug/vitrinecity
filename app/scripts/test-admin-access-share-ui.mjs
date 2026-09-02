import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const html=await readFile(new URL('../public/admin.html',import.meta.url),'utf8');
for(const id of ['accessShareCenter','shareClientAccess','shareSellerAccess','shareCourierAccess','shareAdminAccess'])assert.match(html,new RegExp(`id=["']${id}["']`));
for(const path of ['/acessos.html','/entrar.html','/entregador.html','/admin-login.html'])assert.ok(html.includes(path),`acesso ausente: ${path}`);
assert.match(html,/navigator\.share/);
assert.match(html,/clipboard\.writeText/);
assert.match(html,/Adicionar à tela inicial/i);
assert.match(html,/token privado/i);
console.log('admin access share UI tests passed');
