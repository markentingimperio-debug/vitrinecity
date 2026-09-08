import test from 'node:test';
import assert from 'node:assert/strict';
import {editorialImage,isGenericEditorialImage} from '../editorial-image-policy.js';

const options={siteUrl:'https://vitrinecity.test'};
test('reviewed archive photos preserve the actual place, date and photographer',()=>{
  const vitoria=editorialImage('/assets/editorial/vitoria-baia-arionstar-2024.webp');
  assert.equal(vitoria.credit,'ArionStar · CC0');assert.match(vitoria.caption,/Baía de Vitória.*2024.*ArionStar/);
  const match=editorialImage('/assets/editorial/whitecaps-lafc-bmo-tumford14-2024.webp');
  assert.equal(match.credit,'Foto de arquivo · 2024');assert.match(match.caption,/Los Angeles FC x Vancouver Whitecaps.*BMO Stadium.*2024.*Tumford14/);
});
test('known institutional covers never masquerade as an editorial photograph',()=>{
  for(const path of ['/assets/vitriny-city-master.jpg','/assets/vitriny-city-base.jpg','/assets/vitriny-city-norte.jpg','/assets/vitriny-city-leste.jpg','/assets/vitrinecity-realista.jpg','/assets/vitrinecity-avenida-premium.webp','/assets/vitrinecity-logo.png','/assets/pwa-icon-192.png','/assets/pwa-icon-512.png','/logo.png']){
    for(const value of [path,'https://vitrinecity.test'+path,path.toUpperCase()]){
      assert.equal(isGenericEditorialImage(value,options),true,value);
      assert.deepEqual(editorialImage(value,options),{url:'',kind:'none',credit:''},value);
    }
  }
});

test('legitimate recipe and subject-specific images survive without invented authorship',()=>{
  for(const path of ['/assets/recipes/bolo-cenoura.jpg','/assets/editorial/esportes-calendario.jpg','/uploads/store-assets/foto.png','/story-assets/abcdef.jpg','/assets/editorial/city-infrastructure.jpg']){
    assert.deepEqual(editorialImage(path,options),{url:path,kind:'editorial',credit:''});
    assert.equal(editorialImage('https://vitrinecity.test'+path,options).url,path);
    assert.equal(isGenericEditorialImage(path,options),false);
  }
});

test('only filenames emitted by known AI providers get an illustration credit',()=>{
  for(const path of ['/uploads/generated-videos/editorial-1788890400000-abc123de.png','/uploads/generated-videos/story-ai-a7150844-9ec1-4972-a3b4-10bd7da19a09.jpg','/uploads/generated-videos/editorial-ai-a7150844-9ec1-4972-a3b4-10bd7da19a09.png'])
    assert.deepEqual(editorialImage(path,options),{url:path,kind:'ai',credit:'Ilustração por IA'});
  for(const path of ['/assets/editorial/story-ai-a7150844-9ec1-4972-a3b4-10bd7da19a09.jpg','/uploads/generated-videos/foto.jpg','/uploads/generated-videos/editorial-cover.png'])assert.equal(editorialImage(path,options).credit,'');
});

test('no fallback, private request, executable URL or traversal is introduced for invalid input',()=>{
  for(const value of ['',null,{},'assets/editorial/capa.jpg','//vitrinecity.test/assets/x.jpg','https://outside.test/assets/x.jpg','https://user:password@vitrinecity.test/assets/x.jpg','javascript:alert(1)','/api/private/photo.jpg','/assets/x.svg','/assets/x.jpg?token=private','/assets/x.jpg#track','/assets/../assets/editorial/x.jpg','/assets/./editorial/x.jpg','/assets/%2e%2e/x.jpg','/assets/x\\y.jpg','/assets/x.jpg\n'])assert.deepEqual(editorialImage(value,options),{url:'',kind:'none',credit:''},String(value));
});
