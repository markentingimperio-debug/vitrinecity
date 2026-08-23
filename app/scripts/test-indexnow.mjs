import assert from 'node:assert/strict';
import { extractIndexNowUrls, submitIndexNow } from '../indexnow.js';

const xml = `<?xml version="1.0"?><urlset>
  <url><loc>https://vitrinecity.com/</loc></url>
  <url><loc>https://vitrinecity.com/loja?x=1&amp;y=2</loc></url>
  <url><loc>http://vitrinecity.com/insegura</loc></url>
  <url><loc>https://outro.example/fora</loc></url>
  <url><loc>https://vitrinecity.com/</loc></url>
</urlset>`;
assert.deepEqual(extractIndexNowUrls(xml, 'vitrinecity.com'), [
  'https://vitrinecity.com/',
  'https://vitrinecity.com/loja?x=1&y=2'
]);

const calls = [];
const result = await submitIndexNow({
  key: 'abcDEF12-3456',
  fetchImpl: async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return calls.length === 1
      ? { ok: true, status: 200, text: async () => xml }
      : { ok: true, status: 202 };
  }
});
assert.equal(result.submitted, 2);
assert.equal(calls[0].url, 'https://vitrinecity.com/sitemap.xml');
assert.equal(calls[1].url, 'https://api.indexnow.org/indexnow');
const payload = JSON.parse(calls[1].options.body);
assert.equal(payload.host, 'vitrinecity.com');
assert.equal(payload.keyLocation, 'https://vitrinecity.com/abcDEF12-3456.txt');
assert.deepEqual(payload.urlList, extractIndexNowUrls(xml, 'vitrinecity.com'));
await assert.rejects(() => submitIndexNow({ key: 'curta', fetchImpl: async () => ({}) }), /indexnow_invalid_key/);
console.log('indexnow: ok');
