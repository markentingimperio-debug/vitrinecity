import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../public/painel-lojista.html', import.meta.url), 'utf8');

assert.match(page, /VitrineCity Entregas/);
assert.match(page, /id="enableOrderSound"/);
assert.match(page, /AudioContext/);
assert.match(page, /setInterval\(pollCommerce/);
assert.match(page, /payment_status==='approved'/);
assert.match(page, /seenPaidOrders/);
assert.match(page, /delivery_mode==='local'/);
assert.match(page, /Preparar para retirada/);
assert.match(page, /aria-live="assertive"/);

console.log('seller order alert static checks passed');
