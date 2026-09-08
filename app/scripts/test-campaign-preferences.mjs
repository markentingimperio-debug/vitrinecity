import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import {setupCampaignPreferences} from '../campaign-preferences.js';
const db=new Database(':memory:');db.exec('CREATE TABLE consent_records(id INTEGER PRIMARY KEY,subject_user_id INTEGER,purpose TEXT,granted INTEGER,evidence_json TEXT);CREATE TABLE leads(email TEXT,consent INTEGER)');
const app=express();app.use(express.json());const user={id:1,email:'member@example.test',whatsapp:'5562999990000'};
const requireUser=(req,res,next)=>{if(req.headers['x-test-user']!=='1')return res.sendStatus(401);req.user=user;return next();};const sameOriginOnly=(req,res,next)=>req.headers.origin==='https://evil.test'?res.sendStatus(403):next();
const preferences=setupCampaignPreferences(app,{db,requireUser,sameOriginOnly,recordConsent:(req,item)=>db.prepare('INSERT INTO consent_records(subject_user_id,purpose,granted,evidence_json) VALUES(?,?,?,?)').run(item.userId,item.purpose,item.granted?1:0,JSON.stringify(item.evidence))});
assert.deepEqual(preferences.read(user),{email:false,whatsapp:false},'Account creation never implies advertising consent');
preferences.record({},user,{email:true,whatsapp:false});assert.deepEqual(preferences.read(user),{email:true,whatsapp:false});
preferences.record({},user,{email:true,whatsapp:true});assert.equal(preferences.read({...user,whatsapp:'5562988880000'}).whatsapp,false,'Consent does not transfer to a changed contact number');
preferences.record({},user,{email:false,whatsapp:false},'privacy_center');assert.deepEqual(preferences.read(user),{email:false,whatsapp:false});
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}/api/privacy/communications`;
try{assert.equal((await fetch(base)).status,401);assert.equal((await fetch(base,{method:'PUT',headers:{'Content-Type':'application/json','x-test-user':'1',origin:'https://evil.test'},body:'{"email":true,"whatsapp":true}'})).status,403);assert.equal((await fetch(base,{method:'PUT',headers:{'Content-Type':'application/json','x-test-user':'1'},body:'{"email":"true","whatsapp":false}'})).status,400);}finally{await new Promise(resolve=>server.close(resolve));db.close();}
console.log(JSON.stringify({ok:true,communications:'explicit channel consent, revocation, contact binding, authenticated settings'}));
