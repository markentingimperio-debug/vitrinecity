import assert from 'node:assert/strict';
import { attachResultCover } from '../public/search-result-cover.js';

const origin = 'https://vitrinecity.com';
function element(tag) {
  return {tagName:tag.toUpperCase(), children:[], listeners:{},
    append(child){this.children.push(child);},
    addEventListener(name,fn){this.listeners[name]=fn;},
    remove(){this.removed=true;}
  };
}
const document={createElement:element};
for(const [item,expected] of [
  [{thumbnailUrl:'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'},'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'],
  [{imageUrl:'/uploads/product.jpg'},origin+'/uploads/product.jpg']
]) {
  const container=element('article');
  attachResultCover(container,item,{document,origin});
  assert.equal(container.children.length,1);
  const cover=container.children[0],image=cover.children[0];
  assert.equal(cover.className,'result-cover');assert.equal(image.tagName,'IMG');
  assert.equal(image.src,expected);assert.equal(image.alt,'');
  assert.equal(image.loading,'lazy');assert.equal(image.decoding,'async');
  assert.equal(image.referrerPolicy,'no-referrer');
  assert.equal(image.width,480);assert.equal(image.height,270);
  assert.equal(image.onclick,undefined,'A cover must not add another opening action');
  assert.equal(cover.tagName,'DIV');
  image.listeners.error();assert.equal(cover.removed,true,'Failed cover must not leave a broken image/empty box');
}
for(const item of [{},{thumbnailUrl:'javascript:alert(1)'},{thumbnailUrl:'https://127.0.0.1/private'},{imageUrl:'/api/admin/data'}]) {
  const container=element('article');attachResultCover(container,item,{document,origin});
  assert.equal(container.children.length,0,'No placeholder or arbitrary image request');
}
const container=element('article');
attachResultCover(container,{imageUrl:'/assets/example.png'},{document,origin});
const cover=container.children[0],image=cover.children[0];
image.naturalWidth=1;image.naturalHeight=1;image.listeners.load();
assert.equal(cover.removed,true,'Tracking-sized images are not useful covers');
console.log('Search covers: safe source only, lazy static image, one action preserved, failures collapse.');
