import assert from 'node:assert/strict';
import fs from 'node:fs';
import { safeResultImageUrl, getResultImage } from '../public/search-result-image.js';

const origin='https://vitrinecity.com';
const youtube='https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg';
const bing='https://tse1.mm.bing.net/th?id=OIP.example&pid=Api';
const officialProduct='https://adubonpkparaplantas.com.br/wp-content/uploads/2026/08/npk-10-10-10-liquido-500ml-300x300.jpg';
assert.equal(safeResultImageUrl(officialProduct),officialProduct,'The owner-provided official product image must be accepted.');
assert.equal(getResultImage({imageUrl:officialProduct},origin),officialProduct);
for(const value of [
  officialProduct.replace('adubonpkparaplantas.com.br','adubonpkparaplantas.com.br.evil.test'),
  officialProduct.replace('adubonpkparaplantas.com.br','www.adubonpkparaplantas.com.br'),
  officialProduct.replace('adubonpkparaplantas.com.br','adubonpkparaplantas.com.br:443'),
  officialProduct.replace('adubonpkparaplantas.com.br','adubonpkparaplantas.com.br:444'),
  officialProduct.replace('https://','http://'),
  officialProduct.replace('https://','https://user:pass@'),
  officialProduct.replace('/wp-content/uploads/2026/08/','/api/'),
  officialProduct.replace('/wp-content/uploads/2026/08/','/wp-content/uploads/2026/13/'),
  officialProduct.replace('/wp-content/uploads/2026/08/','/wp-content/uploads/2026/00/'),
  officialProduct.replace('/wp-content/uploads/2026/08/','/wp-content/uploads/2026/08/../'),
  officialProduct.replace('/wp-content/uploads/2026/08/','/wp-content/uploads/2026/08/%2e%2e/'),
  officialProduct.replace('.jpg','.svg'),officialProduct.replace('.jpg','.php'),
  officialProduct+'?redirect=https://evil.test/image.jpg'
])assert.equal(safeResultImageUrl(value,origin),'',value);
for(const value of [youtube,bing,
  'https://img.youtube.com/vi/dQw4w9WgXcQ/0.jpg',
  'https://i.ytimg.com/vi_webp/dQw4w9WgXcQ/hqdefault.webp',
  'https://encrypted-tbn0.gstatic.com/images?q=tbn%3Aexample',
  'https://tse4.mm.bing.net/th/id/OIP.example?pid=Api',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Photo.jpg/320px-Photo.jpg',
  'https://http2.mlstatic.com/D_Q_NP_2X_629064-MLA114933297788_082026-AB.webp'
])assert.equal(safeResultImageUrl(value),value,value);
for(const value of ['/assets/example.png','/uploads/store-assets/product.webp','/uploads/product.jpg?v=2']) {
  assert.equal(safeResultImageUrl(value,origin),origin+value);
  assert.equal(safeResultImageUrl(origin+value,origin),origin+value);
  assert.equal(safeResultImageUrl(value),'','Local paths require a trusted calling-page origin.');
}
assert.equal(safeResultImageUrl('/assets/example.png','http://127.0.0.1:8765'),'http://127.0.0.1:8765/assets/example.png');
for(const value of [null,{},[],42,'',youtube+' '.repeat(2100),
  'javascript:alert(1)','data:image/svg+xml,test','blob:https://vitrinecity.com/abc','file:///etc/passwd',
  '//i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg','http://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  'https://i.ytimg.com.evil.test/vi/dQw4w9WgXcQ/hqdefault.jpg','https://user:pass@i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  'https://i.ytimg.com:443/vi/dQw4w9WgXcQ/hqdefault.jpg','https://i.ytimg.com:444/vi/dQw4w9WgXcQ/hqdefault.jpg',
  'https://i.ytimg.com./vi/dQw4w9WgXcQ/hqdefault.jpg','https://i.ytimg.com/redirect?url=https://evil.test',
  'https://example.com/image.jpg','https://127.0.0.1/image.jpg','https://[::1]/image.jpg','https://2130706433/image.jpg',
  'https://192.168.1.1/image.jpg','https://metadata.google.internal/image.jpg','https://user@evil.test/image.jpg',
  'https://encrypted-tbn99.gstatic.com/images?q=tbn:example','https://www.gstatic.com/image.jpg',
  'https://tse1.mm.bing.net/redirect?url=https://evil.test','https://tse9.mm.bing.net/th?id=example',
  'https://upload.wikimedia.org/wikipedia/commons/example.svg',
  '/api/admin/data','/admin/report.png','/assets/x.svg','/assets/../uploads/image.jpg',
  '/assets/%2e%2e/uploads/image.jpg','/assets/a%2fb.jpg','/assets/%252e%252e/x.jpg',
  '/assets/a\\b.jpg','/uploads//image.jpg','/assets/image.jpg#hash','/uploads/image.jpg\n',
  'https://evil.test/uploads/image.jpg','https://vitrinecity.com/api/ads/serve?placement=banner'
])assert.equal(safeResultImageUrl(value,origin),'',String(value));
assert.equal(getResultImage({thumbnailUrl:youtube,imageUrl:'/assets/other.jpg'},origin),youtube);
assert.equal(getResultImage({thumbnailUrl:'javascript:bad',imageUrl:'/assets/other.jpg'},origin),origin+'/assets/other.jpg');
assert.equal(getResultImage({logoUrl:'/uploads/logo.png',facadeUrl:'/uploads/facade.jpg'},origin),origin+'/uploads/logo.png');
assert.equal(getResultImage({facadeUrl:'/uploads/facade.jpg'},origin),origin+'/uploads/facade.jpg');
assert.equal(getResultImage({url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'},origin),'','No derived thumbnail URL.');
for(const value of [null,undefined,{},'test'])assert.equal(getResultImage(value,origin),'');
const source=fs.readFileSync(new URL('../public/search-result-image.js',import.meta.url),'utf8');
assert.doesNotMatch(source,/\bfetch\s*\(|\bdocument\b|localStorage|sessionStorage|innerHTML|\bwindow\b/,'Shared URL helpers must be pure.');
console.log('Result images: strict CDN/local-path allowlists, no unsafe scheme/host/path, deterministic fallbacks and no requests.');
