import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/chat-social.html', import.meta.url), 'utf8');

assert.match(html, /function requireLogin\(\)/, 'chat must have one login redirect helper');
assert.match(html, /if\(r\.status===401\)\{requireLogin\(\)/, 'JSON requests must redirect on expired sessions');
assert.match(html, /if\(r\.status===401\)return requireLogin\(\)/, 'file uploads must redirect on expired sessions');
assert.match(html, /start\(\)\.catch\(/, 'startup failures must be handled without an unhandled rejection');
assert.match(html, /Não foi possível carregar as conversas agora\./, 'logged-in load failures must have a friendly state');

console.log('chat-social-auth: ok');
