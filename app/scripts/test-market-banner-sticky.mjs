import assert from 'node:assert/strict';
import fs from 'node:fs';

// Import the browser module without mounting it, making no requests or ad impressions.
globalThis.location = { pathname: '/admin' };
globalThis.fetch = () => { throw new Error('This regression must not make requests.'); };
const { configureStickyHighlights } = await import('../public/market-outdoor.js');
assert.equal(typeof configureStickyHighlights, 'function', 'Sticky behavior must be scoped and testable.');

function classes() {
  const values = new Set();
  return {
    add: value => values.add(value),
    contains: value => values.has(value),
    toggle: (value, enabled) => enabled ? values.add(value) : values.delete(value)
  };
}
function fixture() {
  const listeners = new Map(), properties = new Map();
  const document = {
    activeElement: null,
    documentElement: { classList: classes(), style: { setProperty: (key, value) => properties.set(key, value) } },
    addEventListener: (name, listener) => listeners.set(name, listener)
  };
  const banner = { classList: classes(), offsetHeight: 72 };
  let resize;
  class Observer { constructor(callback) { resize = callback; } observe(target) { assert.equal(target, banner); } }
  return { document, banner, properties, listeners, Observer, resize: () => resize?.() };
}

for (const pathname of ['/', '/index.html', '/pesquisar.html']) {
  const f = fixture();
  configureStickyHighlights(f.banner, { document: f.document, pathname, ResizeObserver: f.Observer });
  assert.ok(f.banner.classList.contains('vc-hb-sticky'), pathname);
  assert.ok(f.document.documentElement.classList.contains('vc-hb-sticky-page'), pathname);
  assert.equal(f.document.documentElement.classList.contains('vc-hb-sticky-home'), pathname !== '/pesquisar.html');
  assert.equal(f.properties.get('--vc-market-banner-height'), '72px');
  f.banner.offsetHeight = 88; f.resize();
  assert.equal(f.properties.get('--vc-market-banner-height'), '88px', 'Home navigation must follow the actual banner height.');
  f.document.activeElement = { closest: selector => /input/.test(selector) ? {} : null };
  f.listeners.get('focusin')();
  assert.ok(f.document.documentElement.classList.contains('vc-hb-editing'), 'Editing must release the sticky banner.');
  f.document.activeElement = null; f.listeners.get('focusout')(); await Promise.resolve();
  assert.ok(!f.document.documentElement.classList.contains('vc-hb-editing'), 'Sticky mode returns after leaving the field.');
}
for (const pathname of ['/loja', '/ofertas/item', '/admin', '/pesquisar.html/extra', '/cidade-premium']) {
  const f = fixture();
  configureStickyHighlights(f.banner, { document: f.document, pathname, ResizeObserver: f.Observer });
  assert.ok(!f.banner.classList.contains('vc-hb-sticky'), pathname);
  assert.equal(f.listeners.size, 0, 'Other pages must retain the existing behavior.');
}

const css = fs.readFileSync(new URL('../public/market-outdoor.css', import.meta.url), 'utf8');
assert.match(css, /#vc-global-market-banner\.vc-hb-sticky\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;[^}]*z-index:\s*5;/);
assert.match(css, /\.vc-hb-sticky-home[^}]*body\s*>\s*header\s*\{[^}]*top:\s*var\(--vc-market-banner-height/);
assert.match(css, /\.vc-hb-editing[^}]*#vc-global-market-banner\.vc-hb-sticky\s*\{[^}]*position:\s*relative;/);
assert.match(css, /@media\s*\(max-height:\s*480px\)/, 'Small/keyboard viewports must not lose vertical reading space.');
assert.match(css, /scroll-padding-top:/, 'Anchor navigation must account for the sticky banner.');
const searchCss = fs.readFileSync(new URL('../public/search.css', import.meta.url), 'utf8');
assert.match(searchCss, /\.skip\{[^}]*z-index:10/, 'The existing skip link must remain above the z-index 5 banner.');
console.log('Banner: sticky only on home/search; editing, short viewports, home header and skip-link protections verified without network.');
