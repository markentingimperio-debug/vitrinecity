import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const courier = readFileSync(new URL('../public/entregador.html', import.meta.url), 'utf8');

assert.match(courier, /data-tab="chat"/, 'courier navigation must expose internal chat');
assert.match(courier, /id="chatPanel"/, 'courier page must provide a chat panel');
assert.match(courier, /id="courierMessages"/, 'courier page must provide a message list');
assert.match(courier, /id="courierMessageForm"/, 'courier page must provide a message form');
assert.match(courier, /api\('\/api\/courier\/messages'\)/, 'chat must load courier messages');
assert.match(courier, /api\('\/api\/courier\/messages',\{method:'POST'/, 'chat must post courier messages');
assert.match(courier, /esc\(message\.message\)/, 'chat must escape message content before rendering');
assert.match(courier, /maxlength="2000"/, 'chat input must mirror the server-side size limit');
assert.match(courier, /aria-live="polite"/, 'chat updates must be announced accessibly');

// Existing operational surfaces are safety rails for this additive feature.
for (const marker of ['/api/courier/dispatch', '/api/courier/location', 'pixForm', 'payoutForm']) {
  assert.ok(courier.includes(marker), `courier chat must preserve ${marker}`);
}

console.log('courier-chat-ui: ok');
