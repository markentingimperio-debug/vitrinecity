import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { setupAffiliateIndexNow } from '../affiliate-indexnow.js';
const db = new Database(':memory:');
let products = [{slug:'produto',title:'Produto',description:'Descrição',status:'published',health:'unchecked',clicks:0},
  {slug:'rascunho',title:'Privado',status:'draft'}];
let code=200, calls=[], duringRequest;
const options={db,siteUrl:'https://vitrinecity.com',rows:()=>products,start:false,
  fetcher:async(_url,options)=>{calls.push(JSON.parse(options.body));duringRequest?.();return {status:code};}};
let worker=setupAffiliateIndexNow(options);
assert.equal((await worker.flush()).submitted,2);
assert.deepEqual(calls[0].urlList,['https://vitrinecity.com/ofertas','https://vitrinecity.com/ofertas/produto']);
products[0].clicks=15;products[0].health='reachable';
assert.equal((await worker.flush()).submitted,0,'Clicks and successful link checks must not resubmit');
worker.close(); worker=setupAffiliateIndexNow(options);
assert.equal((await worker.flush()).submitted,0,'Accepted snapshot survives worker restart');
products[0].description='Nova descrição'; code=429;
assert.equal((await worker.flush()).submitted,0);
code=200; duringRequest=()=>{products[0].description='Alteração simultânea';};
assert.equal((await worker.flush()).submitted,2,'Retry after throttling');
duringRequest=null;
assert.equal((await worker.flush()).submitted,2,'Concurrent edit must remain pending');
products[0].status='paused';assert.equal((await worker.flush()).submitted,2);
products[0].status='draft';assert.equal((await worker.flush()).submitted,2,'Notify removal from public catalog');
assert.equal((await worker.flush()).submitted,0);
assert.equal(worker.status().lastError,null);
worker.close();db.close();console.log('Affiliate IndexNow: retry, persistence, deduplication, drafts, pauses and concurrent edits passed.');
