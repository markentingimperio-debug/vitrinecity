// Isolated visual fixture: no production database, credentials, workers or external requests.
import express from 'express';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { setupAffiliateCatalog } from '../affiliate-catalog.js';
import { integrationObserver } from '../integration-health.js';
const db=new Database(':memory:'),app=express();app.use(express.json());
const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
db.exec(`CREATE TABLE social_external_sync_runs(id INTEGER PRIMARY KEY,provider TEXT,status TEXT,error_code TEXT,started_at TEXT,finished_at TEXT);
  INSERT INTO social_external_sync_runs VALUES(1,'facebook','failed','permissions',datetime('now'),datetime('now'));
  INSERT INTO social_external_sync_runs VALUES(2,'youtube','completed','',datetime('now'),datetime('now'));`);
await integrationObserver.run('openrouter_text',async()=>{throw Object.assign(new Error('Inference is blocked'),{status:403});}).catch(()=>{});
const catalog=setupAffiliateCatalog({app,db,siteUrl:'http://127.0.0.1',publicDir,startMonitor:false,
  requireAdmin:(_req,_res,next)=>next(),sameOriginOnly:(_req,_res,next)=>next()});
app.use(express.static(publicDir));
const server=app.listen(0,'127.0.0.1',()=>console.log('Isolated fixture: http://127.0.0.1:'+server.address().port+'/admin-saude.html'));
process.on('SIGINT',()=>{catalog.close();server.close(()=>{db.close();process.exit(0);});});
