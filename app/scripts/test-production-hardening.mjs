import assert from 'node:assert/strict';
import express from 'express';
import {setupProductionHardening} from '../production-hardening.js';
let time=0;const app=express();setupProductionHardening(app,{now:()=>time});
app.post('/api/store-portal/:reference/mfa/:action',(_req,res)=>res.status(401).end());
app.get('/health',(_req,res)=>res.json({ok:true}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port;
try{
for(let i=0;i<8;i++)assert.equal((await fetch(base+'/api/store-portal/test/mfa/verify',{method:'POST'})).status,401);
const blocked=await fetch(base+'/api/store-portal/test/mfa/confirm',{method:'POST'});assert.equal(blocked.status,429);assert.equal(blocked.headers.get('retry-after'),'300');
assert.equal((await fetch(base+'/api/store-portal/other/mfa/verify',{method:'POST'})).status,401);
time=300001;assert.equal((await fetch(base+'/api/store-portal/test/mfa/verify',{method:'POST'})).status,401);
const health=await fetch(base+'/health');assert.equal(health.status,200);assert.match(health.headers.get('content-security-policy'),/object-src 'none'/);
console.log('Production hardening: MFA limit, shared confirm/verify budget, expiry and headers passed.');
}finally{await new Promise(r=>server.close(r));}
