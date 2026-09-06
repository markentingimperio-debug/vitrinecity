// Runs only in a disposable container with an empty in-memory database.
import assert from 'node:assert/strict';
import Database from '/app/node_modules/better-sqlite3/lib/index.js';
import { createJarvis } from './jarvis-core.js';
const db=new Database(':memory:');
const core=createJarvis(db,{env:{JARVIS_LOCAL_MODEL:'1'}});
assert.equal((await core.status()).model.state,'ready');
for(const question of ['Quais são os limites do Jarvis?','Onde está o catálogo de ofertas?','Como ensinar conhecimentos e corrigir a memória?']){
  const answer=await core.ask({question},1);
  console.log(JSON.stringify({question,mode:answer.mode,durationMs:answer.durationMs,answer:answer.answer,sources:answer.sources.map(s=>s.title)}));
  assert.equal(answer.mode,'local_model');assert.ok(answer.durationMs<60000);
}
const unknown=await core.ask({question:'Qual a cotação de bitcoin amanhã?'},1);
assert.equal(unknown.status,'no_sources');assert.equal(unknown.mode,'retrieval');
console.log('Model smoke passed; no-sources abstention passed.');
db.close();
