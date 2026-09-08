import assert from 'node:assert/strict';
import express from 'express';
import {catalogImageUrl,originalCatalogImageUrl,publicImageAddress,setupCatalogProductImages} from '../catalog-product-images.js';
for(const value of ['http://adubonpkparaplantas.com.br/wp-content/uploads/a.jpg','https://adubonpkparaplantas.com.br.evil.test/wp-content/uploads/a.jpg','https://user:pass@vitrinecity.com/uploads/a.jpg','https://vitrinecity.com:8443/uploads/a.jpg','https://127.0.0.1/uploads/a.jpg','https://vitrinecity.com/admin','/api/health'])assert.equal(catalogImageUrl(value),'',value);
assert.equal(catalogImageUrl('/uploads/a.jpg'),'https://vitrinecity.com/uploads/a.jpg');
assert.equal(originalCatalogImageUrl('https://adubonpkparaplantas.com.br/wp-content/uploads/2026/08/adubo-300x300.jpg'),'https://adubonpkparaplantas.com.br/wp-content/uploads/2026/08/adubo.jpg');
assert.equal(originalCatalogImageUrl('/uploads/product-300x300.jpg'),'https://vitrinecity.com/uploads/product-300x300.jpg','Only WordPress-generated thumbnail suffixes may be removed');
for(const address of ['0.0.0.0','127.0.0.1','10.2.3.4','172.16.1.1','192.168.1.1','169.254.169.254','100.64.0.1','224.0.0.1','::1','::ffff:127.0.0.1'])assert.equal(publicImageAddress(address),false,address);
assert.equal(publicImageAddress('93.184.216.34'),true);
const app=express();let calls=0,published=true;
setupCatalogProductImages(app,{getProduct:id=>published&&id===12?{image_url:'https://adubonpkparaplantas.com.br/wp-content/uploads/product.jpg'}:null,fetchImage:async()=>{calls++;return {type:'image/jpeg',body:Buffer.from([255,216,255,217])};}});
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
try{
  let response=await fetch(`${base}/api/marketplace/products/12/image`);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/jpeg');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  response=await fetch(`${base}/api/marketplace/products/12/image?url=http://127.0.0.1`);assert.equal(response.status,200);assert.equal(calls,1,'Only the database image is used and repeated loads are cached');
  published=false;response=await fetch(`${base}/api/marketplace/products/12/image`);assert.equal(response.status,404,'An unpublished product cannot be accessed through a warm cache');
  response=await fetch(`${base}/api/marketplace/products/invalid/image`);assert.equal(response.status,404);
}finally{await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({ok:true,images:'catalog identity, cache, publication gate, HTTPS origins, private address rejection'}));
