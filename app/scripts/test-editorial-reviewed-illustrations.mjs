import assert from 'node:assert/strict';
import test from 'node:test';
import {editorialImage} from '../editorial-image-policy.js';

test('reused illustrations disclose their context without impersonating named people',()=>{
  const television=editorialImage('/assets/editorial/noite-cinema.jpg');
  assert.equal(television.kind,'editorial');
  assert.equal(television.credit,'Imagem ilustrativa');
  assert.match(television.caption,/Não retrata um elenco/);
  for(const path of ['/uploads/generated-videos/criciuma-juventude-editorial-20260909.png','/uploads/generated-videos/book-chapter-42-1788310312511.png']){
    const image=editorialImage(path);assert.equal(image.kind,'ai');assert.match(image.caption,/IA/);assert.match(image.caption,/Não/);
  }
});

test('reviewed captions cannot authorize external, queried, traversal or substituted files',()=>{
  for(const path of ['https://evil.test/assets/editorial/noite-cinema.jpg','/assets/editorial/../editorial/noite-cinema.jpg','/assets/editorial/noite-cinema.jpg?x=1','/assets/editorial/%6eoite-cinema.jpg'])assert.equal(editorialImage(path).kind,'none');
  assert.equal(editorialImage('/uploads/generated-videos/book-chapter-43-1788310481729.png').caption,undefined);
  assert.equal(editorialImage('/uploads/generated-videos/book-chapter-43-1788310481729.png').kind,'editorial');
  assert.match(editorialImage('/assets/editorial/whitecaps-lafc-bmo-tumford14-2024.webp').caption,/27 de outubro de 2024/);
});

test('the new chickpea recipe discloses its AI illustration without claiming a photographed preparation',()=>{
  const image=editorialImage('/assets/recipes/salada-grao-de-bico-tomate-pepino.png');
  assert.equal(image.kind,'ai');assert.equal(image.credit,'Ilustração por IA');
  assert.match(image.caption,/grão-de-bico com tomate e pepino/);
  assert.match(image.caption,/Não é uma fotografia de um prato preparado/);
});
