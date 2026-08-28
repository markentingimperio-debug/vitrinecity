import assert from 'node:assert/strict';
import { extractPublicBusinessContacts, isPublicNetworkAddress } from '../business-prospecting.js';

const contacts = extractPublicBusinessContacts(`
  <a href="mailto:Comercial@Empresa.com.br">E-mail</a>
  <a href="https://instagram.com/empresa">Instagram</a>
  <a href="https://www.facebook.com/empresa">Facebook</a>
  <a href="https://www.tiktok.com/@empresa">TikTok</a>
  <a href="https://wa.me/5562999999999?text=Oi">WhatsApp</a>
  <a href="https://chat.whatsapp.com/ConvitePublico123">Grupo público</a>
`);
assert.deepEqual(contacts, {
  email: 'comercial@empresa.com.br', whatsapp: '5562999999999',
  whatsappGroupUrl: 'https://chat.whatsapp.com/ConvitePublico123',
  instagramUrl: 'https://instagram.com/empresa', facebookUrl: 'https://www.facebook.com/empresa',
  tiktokUrl: 'https://www.tiktok.com/@empresa'
});

const empty = extractPublicBusinessContacts('<img src="contato@empresa.com.png"><p>Sem contatos</p>');
assert.equal(empty.email, '');
assert.equal(empty.instagramUrl, '');
assert.equal(isPublicNetworkAddress('127.0.0.1'), false);
assert.equal(isPublicNetworkAddress('10.20.30.40'), false);
assert.equal(isPublicNetworkAddress('192.168.1.10'), false);
assert.equal(isPublicNetworkAddress('8.8.8.8'), true);
console.log('business-prospecting: ok');
