import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
for (const marker of [
  'CREATE TABLE IF NOT EXISTS social_moderation_actions',
  'CREATE TABLE IF NOT EXISTS social_appeals',
  'CREATE TABLE IF NOT EXISTS social_account_restrictions',
  "'/api/social/posts/:id/appeal'",
  "'/api/admin/social/moderation/history'",
  "'/api/admin/social/appeals/:id'",
  'requireActiveSocialUser'
]) assert.ok(server.includes(marker), `Fluxo de moderação ausente: ${marker}`);

const admin = fs.readFileSync(new URL('../public/admin-moderation-enhanced.js', import.meta.url), 'utf8');
new Function(admin);
for (const action of ['approve','reject','remove','suspend','restore','appeal-accept','appeal-reject']) {
  assert.ok(admin.includes(action), `Ação administrativa ausente: ${action}`);
}

const appealsPage = fs.readFileSync(new URL('../public/recursos-social.html', import.meta.url), 'utf8');
for (const script of appealsPage.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(script[1]);
assert.ok(appealsPage.includes('/api/social/appeals'));
assert.ok(appealsPage.includes('/appeal'));
console.log('moderacao-social: ok');
