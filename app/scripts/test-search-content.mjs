import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSearchContentProvider } from '../search-content.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vitrine-search-content-'));
try {
  const get=createSearchContentProvider(dir,()=>[{slug:'cozinha',title:'Curso de cozinha',description:'Preparo de alimentos'}]);
  assert.equal(get().length,1);
  fs.writeFileSync(path.join(dir,'search-content.json'),JSON.stringify([
    {title:'Bolo',kind:'recipe',status:'published',url:'/receitas/bolo'},
    {title:'Rascunho',kind:'recipe',status:'draft',url:'/receitas/rascunho'},
    {title:'Admin',status:'published',url:'/admin'},
    {title:'Ataque',status:'published',url:'javascript:alert(1)'},
    {title:'Forma',kind:'affiliate',status:'published',url:'https://example.com/official-affiliate-link'}
  ]));
  const items=get();assert.equal(items.length,3);assert.equal(items[1].url,'/receitas/bolo');assert.equal(items[2].kind,'affiliate');
  assert.ok(items.every(item=>!['Admin','Rascunho','Ataque'].includes(item.title)));
  fs.writeFileSync(path.join(dir,'search-content.json'),'invalid JSON');assert.equal(get().length,1,'Bad optional catalog cannot break courses or search.');
  console.log('search-content: published content, safe paths, explicit affiliate offers, missing/invalid catalog passed');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
