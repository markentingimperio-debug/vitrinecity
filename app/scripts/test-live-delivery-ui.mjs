import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const courier = readFileSync(new URL('../public/entregador.html', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../public/admin-entregas.html', import.meta.url), 'utf8');

assert.match(courier, /Ficar disponível/);
assert.match(courier, /Ativar localização e alertas/);
assert.match(courier, /getCurrentPosition/);
assert.match(courier, /watchPosition/);
assert.match(courier, /now-lastLocationSentAt<10000/);
assert.match(courier, /distanceBetween\(lastLocation,point\)<50/);
assert.match(courier, /\/api\/courier\/availability/);
assert.match(courier, /\/api\/courier\/location/);
assert.match(courier, /\/api\/courier\/dispatch/);
assert.match(courier, /Oferta exclusiva/);
assert.match(courier, /offer-countdown/);
assert.match(courier, /data-offer-action="accept"/);
assert.match(courier, /data-offer-action="decline"/);
assert.match(courier, /AudioContext/);
assert.match(courier, /navigator\.vibrate/);
assert.match(courier, /startLocation\(\).*await load|startLocation\(\)/s);
assert.match(courier, /stopLocation\(\)/);
assert.match(courier, /pixForm/);
assert.match(courier, /payoutForm/);

assert.match(admin, /Despacho em tempo real/);
assert.match(admin, /Última posição:/);
assert.match(admin, /distanceToStoreMeters|distance_to_store_meters/);
assert.match(admin, /data-map-lat/);
assert.match(admin, /openstreetmap\.org\/export\/embed/);
assert.match(admin, /só será carregado após esse gesto/);
assert.match(admin, /referrerpolicy="no-referrer"/);

console.log('live-delivery-ui: ok');
