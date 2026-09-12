import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {fetchStoryCatalogImage,storyCatalogImageUrl} from '../web-story-catalog-image.js';
import {catalogImageUrl} from '../catalog-product-images.js';
import {storySourcePreflight} from '../web-story-ai.js';
const url='https://down-bs-br.img.susercontent.com/br-11134207-820lr-mpxy82d0505ccb.webp';
function transport({addresses=[{address:'93.184.216.34',family:4}],status=200,type='image/webp',body=Buffer.from('fixture-image'),headers={}}={}){
  const calls=[];
  return {calls,lookupImpl:async()=>addresses,httpsGet:(target,options,callback)=>{
    calls.push({target,options});const request=new EventEmitter();request.destroy=error=>{if(error)request.emit('error',error);request.emit('close');};
    queueMicrotask(()=>options.lookup(new URL(target).hostname,{all:true},(error,checked)=>{
      if(error){request.destroy(error);return;}assert.deepEqual(checked,[addresses[0]]);assert.equal(options.agent,false);assert.equal(options.family,4);
      const response=Readable.from([body]);response.statusCode=status;response.headers={'content-type':type,...headers};response.once('close',()=>request.emit('close'));callback(response);
    }));return request;
  }};
}
test('only known Shopee raster URLs qualify for stories; the public product proxy stays unchanged',async()=>{
  assert.equal(storyCatalogImageUrl(url),url);assert.equal(catalogImageUrl(url),'');
  assert.equal(storyCatalogImageUrl(url.replace('down-bs-br','down-tx-br')),url.replace('down-bs-br','down-tx-br'));
  for(const bad of [url.replace('https:','http:'),url.replace('.com/','.com.evil.test/'),url+'?redirect=1',url+'#x',url.replace('/br-','/../br-'),url.replace('/br-','/%62r-'),url.replace('.com/','.com:444/'),url.replace('https://','https://user:pass@'),'https://127.0.0.1/a.webp','https://cdn-checkout.cakto.com.br/products/a.png']){
    assert.equal(storyCatalogImageUrl(bad),'',bad);const fake=transport();await assert.rejects(fetchStoryCatalogImage(bad,fake),/unsupported_image_origin/);assert.equal(fake.calls.length,0);
  }
  const source={kind:'affiliate',commercial:true,title:'Organização',summary:'Separe as roupas e os itens da mala para encontrar o conteúdo durante a viagem.',body:'O kit contém sete saquinhos organizadores. O material transparente facilita localizar as roupas e os pequenos itens guardados. Consulte as medidas e a cor da opção escolhida antes de concluir sua escolha.',sourcePath:'/ofertas/kit',image_url:url};
  assert.equal(storySourcePreflight(source).eligible,true);
});
test('Shopee transfer pins a public DNS address and validates status, MIME and byte limits without redirects',async()=>{
  const success=transport();assert.deepEqual(await fetchStoryCatalogImage(url,success),{type:'image/webp',body:Buffer.from('fixture-image')});assert.equal(success.calls.length,1);
  for(const options of [{addresses:[{address:'127.0.0.1'}]},{addresses:[{address:'93.184.216.34'},{address:'10.0.0.1'}]},{addresses:[]},{status:302,headers:{location:'http://127.0.0.1/'}},{type:'text/html'},{headers:{'content-length':4*1024*1024+1}},{body:Buffer.alloc(4*1024*1024+1)}]){
    const fake=transport(options);await assert.rejects(fetchStoryCatalogImage(url,fake),/non_public_image_address|invalid_catalog_image|image_too_large/);assert.equal(fake.calls.length,1);
  }
});
