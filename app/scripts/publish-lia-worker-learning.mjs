import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {createLiaWorkerLearning} from '../vitriny-neural/lia-worker-learning.js';

const [appPath,ledgerPath]=process.argv.slice(2);
if(!appPath||!ledgerPath||!path.isAbsolute(appPath)||!path.isAbsolute(ledgerPath)||appPath===ledgerPath)throw new Error('two distinct absolute SQLite paths required');
for(const file of [appPath,ledgerPath]){
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw new Error('private SQLite file required');
}
const db=new Database(appPath),ledgerDb=new Database(ledgerPath,{readonly:true});
try{
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='lia_chat_operations'").get())throw new Error('operational database required');
  const cap=ledgerDb.prepare('SELECT budget_micro FROM admin_teaching_pilot_meta WHERE id=1').get()?.budget_micro;
  if(!Number.isSafeInteger(cap)||cap>20_000_000)throw new Error('administrative budget not verified');
  const learning=createLiaWorkerLearning({db});
  const published=learning.publishFaqProof({ledgerDb});
  const active=learning.retrieve();
  if(!active.length)throw new Error('published lesson not retrievable');
  console.log(JSON.stringify({...published,retrievable:true,scope:'code',ledgerCapMicroBrl:cap}));
}finally{ledgerDb.close();db.close();}
