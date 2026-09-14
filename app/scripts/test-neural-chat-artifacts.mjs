import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import Database from 'better-sqlite3';
import {createChatArtifacts,downloadChatArtifact,isPublicArtifactIPv4,CHAT_ARTIFACT_LIMITS} from '../vitriny-neural/chat-artifacts.js';
import {assertChatArtifact} from '../public/neural-chat-contract.js';
import {mountNeuralChatApi} from '../vitriny-neural/chat-api.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/T8AAAAASUVORK5CYII=','base64');
function fixture(){const db=new Database(':memory:'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'neural-artifact-test-'));db.exec('CREATE TABLE neural_chat_requests(id TEXT PRIMARY KEY,scope TEXT NOT NULL)');
 const id=randomUUID();db.prepare('INSERT INTO neural_chat_requests VALUES(?,?)').run(id,'admin:1');
 const artifacts=createChatArtifacts({db,directory});return {db,directory,id,artifacts,close(){db.close();fs.rmSync(directory,{recursive:true,force:true});}};}
test('generated image persisted privately, duplicate delivery no overwrite, exact owner and no provider URL',async()=>{
 const f=fixture();try{const image=await f.artifacts.ingest('admin:1',{requestId:f.id,kind:'image',data:png,mimeType:'image/png'});assertChatArtifact(image);assert.equal(image.availability,'ready');assert.equal(image.bytes,png.length);
 assert.equal(f.artifacts.forRequest('admin:1',f.id).length,1);assert.ok(fs.readFileSync(f.artifacts.read('admin:1',image.id).path).equals(png));
 assert.throws(()=>f.artifacts.read('admin:2',image.id),{code:'chat_not_found'});assert.throws(()=>f.artifacts.read('admin:1','../.env'),{code:'chat_not_found'});
 assert.deepEqual(await f.artifacts.ingest('admin:1',{requestId:f.id,kind:'image',data:png,mimeType:'image/png'}),image);assert.equal(JSON.stringify(image).includes('path'),false);
 }finally{f.close();}
});
test('invalid bytes never become a delivered artifact and failed quota remains accounted',async()=>{
 const f=fixture();try{await assert.rejects(f.artifacts.ingest('admin:1',{requestId:f.id,kind:'image',data:Buffer.from('<script>bad</script>'),mimeType:'image/png'}),{code:'chat_artifact_unavailable'});
 assert.deepEqual(f.artifacts.forRequest('admin:1',f.id),[]);assert.equal(f.db.prepare('SELECT state,reserved FROM neural_chat_artifacts').get().reserved,CHAT_ARTIFACT_LIMITS.fileBytes);
 await assert.rejects(f.artifacts.ingest('admin:1',{requestId:f.id,kind:'image',data:png,mimeType:'image/png'}));
 }finally{f.close();}
});
test('remote ingestion rejects unsafe origins and private DNS before any network request',async()=>{
 let requests=0;const options={resolve:async()=>[{address:'127.0.0.1',family:4}],request:()=>{requests++;throw Error('must not call');}};
 for(const url of ['http://v15-kling.klingai.com/x','https://example.com/x','https://klingai.com.evil.test/x','https://user@v15-kling.klingai.com/x','https://v15-kling.klingai.com:4430/x','https://v15-kling.klingai.com/x#fragment','https://v15-kling.klingai.com/x'])await assert.rejects(downloadChatArtifact(url,options));
 assert.equal(requests,0);for(const ip of ['0.0.0.0','10.1.2.3','127.0.0.1','169.254.169.254','172.16.1.1','192.168.1.1','100.64.1.1','198.18.0.1','224.0.0.1','::1'])assert.equal(isPublicArtifactIPv4(ip),false);
 assert.equal(isPublicArtifactIPv4('8.8.8.8'),true);
});
test('binary and Range routes authenticate every read and stream private bytes',async()=>{
 const f=fixture(),app=express();const image=await f.artifacts.ingest('admin:1',{requestId:f.id,kind:'image',data:png,mimeType:'image/png'});
 mountNeuralChatApi({app,chat:{status:()=>({})},artifacts:f.artifacts,requireAdmin:(req,res,next)=>{if(!req.get('x-owner'))return res.status(401).end();req.user={id:req.get('x-owner')};next();},sameOriginOnly:(_req,_res,next)=>next(),getAuthorizedStore:()=>null});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/admin/vitriny-neural/chat/artifacts/${image.id}`;
 try{assert.equal((await fetch(base+'/content')).status,401);assert.equal((await fetch(base+'/download',{headers:{'x-owner':'2',range:'bytes=0-2'}})).status,404);
 const result=await fetch(base+'/content',{headers:{'x-owner':'1',range:'bytes=0-7'}});assert.equal(result.status,206);assert.equal(result.headers.get('cache-control'),'no-store');assert.equal(result.headers.get('content-length'),'8');assert.ok(Buffer.from(await result.arrayBuffer()).equals(png.subarray(0,8)));
 assert.equal((await fetch(base+'/content',{headers:{'x-owner':'1',range:'bytes=10000-'}})).status,416);
 const download=await fetch(base+'/download',{headers:{'x-owner':'1'}});assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/^attachment/);assert.ok(Buffer.from(await download.arrayBuffer()).equals(png));
 }finally{await new Promise(r=>server.close(r));f.close();}
});
