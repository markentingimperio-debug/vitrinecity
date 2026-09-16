import {randomUUID,createHash} from 'node:crypto';
import {request as httpsRequest} from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {rasterSize} from '../web-story-assets.js';
import {chatError,chatId,validateChatScope} from './chat-attachments.js';

export const CHAT_ARTIFACT_LIMITS=Object.freeze({fileBytes:64*1024*1024,scopeBytes:128*1024*1024,globalBytes:1024*1024*1024,scopeCount:40,globalCount:400});
const TYPES=new Set(['image/png','image/jpeg','image/webp','video/mp4']);
const extensions={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4'};
const fail=(code='chat_artifact_invalid',status=400)=>{throw chatError(code,status);};
export function isPublicArtifactIPv4(address){
  if(isIP(address)!==4)return false;
  const [a,b]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&[0,168].includes(b)||a===100&&b>=64&&b<=127||a===198&&[18,19,51].includes(b)||a===203&&b===0);
}
/** Only provider-owned result hosts, public pinned IPv4, no redirects, cookies,
 * credentials or general URL proxy. URL never enters public metadata. */
export async function downloadChatArtifact(url,{resolve=lookup,request=httpsRequest,maxBytes=CHAT_ARTIFACT_LIMITS.fileBytes}={}){
  let target;try{target=new URL(url);}catch{fail();}
  if(typeof url!=='string'||url.length>8192||/[\\\s\u0000-\u001f\u007f]/.test(url)||target.protocol!=='https:'||target.username||target.password||target.port||target.hash||!(/^[-a-z0-9]+\.klingai\.com$/.test(target.hostname)||target.hostname==='h1.inkwai.com'))fail();
  let dnsTimer;const addresses=await Promise.race([resolve(target.hostname,{all:true,family:4}),new Promise((_,reject)=>{dnsTimer=setTimeout(()=>reject(chatError('chat_artifact_unavailable',503)),5000);})]).finally(()=>clearTimeout(dnsTimer));
  if(!addresses.length||addresses.some(a=>a.family!==4||!isPublicArtifactIPv4(a.address)))fail();
  const pinned=addresses[0].address;
  return await new Promise((resolveResult,reject)=>{
    let done=false,req;const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(chatError('chat_artifact_unavailable',503)):resolveResult(value);};
    const timer=setTimeout(()=>{req?.destroy();finish(true);},30000);
    req=request(target,{method:'GET',headers:{accept:'image/png,image/jpeg,image/webp,video/mp4','accept-encoding':'identity'},
      lookup:(_host,options,callback)=>options?.all?callback(null,[{address:pinned,family:4}]):callback(null,pinned,4)},response=>{
      const mimeType=String(response.headers['content-type']||'').split(';')[0].trim().toLowerCase(),length=response.headers['content-length'];
      if(response.statusCode!==200||!TYPES.has(mimeType)||length!==undefined&&(!/^\d+$/.test(length)||BigInt(length)>BigInt(maxBytes))){response.destroy();finish(true);return;}
      let bytes=0;const chunks=[];
      response.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes){response.destroy();finish(true);}else chunks.push(chunk);});
      response.on('end',()=>finish(!bytes,{data:Buffer.concat(chunks,bytes),mimeType}));
      response.on('error',()=>finish(true));response.on('aborted',()=>finish(true));
    });
    req.on('error',()=>finish(true));req.end();
  });
}
function inspectRaster(data,mimeType){
  let size;try{size=rasterSize(data);}catch{fail();}
  const valid=size.type==='png'?data.length>=45&&data.readUInt32BE(8)===13&&data.toString('ascii',12,16)==='IHDR'&&data.subarray(-12).equals(Buffer.from('0000000049454e44ae426082','hex')):
    size.type==='jpeg'?data.length>=4&&data.subarray(-2).equals(Buffer.from([255,217])):size.type==='webp'?data.readUInt32LE(4)+8===data.length:false;
  if(!valid||mimeType!=='image/'+size.type||size.width<1||size.height<1||size.width>8192||size.height>8192||size.width*size.height>33554432)fail();
  return {width:size.width,height:size.height};
}
export function inspectChatVideo(file,data){
  if(data.length<24||data.toString('ascii',4,8)!=='ftyp')fail();
  // Walk bounded ISO-BMFF boxes; reject malformed or fragmented/external wrappers.
  let offset=0,boxes=0;const types=new Set();
  while(offset<data.length){
    if(++boxes>10000||offset+8>data.length)fail();let size=data.readUInt32BE(offset);const type=data.toString('ascii',offset+4,offset+8);
    if(size===1){if(offset+16>data.length)fail();const large=data.readBigUInt64BE(offset+8);if(large>BigInt(data.length))fail();size=Number(large);}
    if(size===0)size=data.length-offset;if(size<8||offset+size>data.length)fail();types.add(type);offset+=size;
  }
  if(!types.has('moov')||!types.has('mdat'))fail();
  const probe=spawnSync('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json',file],{encoding:'utf8',timeout:15000,maxBuffer:128*1024,windowsHide:true});
  if(probe.status!==0||probe.error)fail();let result;try{result=JSON.parse(probe.stdout);}catch{fail();}
  const video=result.streams?.filter(s=>s.codec_type==='video');
  if(video?.length!==1||!['h264','hevc','av1','vp9'].includes(video[0].codec_name))fail();
  const {width,height}=video[0],durationSeconds=Number(result.format?.duration);
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>8192||height>8192||width*height>33554432||!Number.isFinite(durationSeconds)||durationSeconds<=0||durationSeconds>60)fail();
  return {width,height,durationSeconds};
}
export function createChatArtifacts({db,directory,now=Date.now,download=downloadChatArtifact,inspectVideo=inspectChatVideo}={}){
  if(!db||typeof directory!=='string'||!path.isAbsolute(directory))throw new TypeError('Private artifact directory required.');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});const root=fs.realpathSync(directory);
  db.exec(`CREATE TABLE IF NOT EXISTS neural_chat_artifacts(id TEXT PRIMARY KEY,scope TEXT NOT NULL,request_id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,mime_type TEXT NOT NULL DEFAULT '',name TEXT NOT NULL DEFAULT '',bytes INTEGER NOT NULL,reserved INTEGER NOT NULL,
    state TEXT NOT NULL,digest TEXT NOT NULL DEFAULT '',width INTEGER,height INTEGER,duration_seconds REAL,created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_chat_artifacts_scope ON neural_chat_artifacts(scope);`);
  function checkOwner(scope,requestId){validateChatScope(scope);chatId(requestId);if(!db.prepare('SELECT 1 FROM neural_chat_requests WHERE id=? AND scope=?').get(requestId,scope))fail('chat_not_found',404);}
  function quota(scope){
    validateChatScope(scope);const sums=local=>db.prepare(`SELECT COUNT(*) n,COALESCE(SUM(bytes+reserved),0) b FROM neural_chat_artifacts WHERE state!='released' ${local?'AND scope=?':''}`).get(...(local?[scope]:[]));
    const local=sums(true),all=sums(false);return local.n<CHAT_ARTIFACT_LIMITS.scopeCount&&all.n<CHAT_ARTIFACT_LIMITS.globalCount&&local.b+CHAT_ARTIFACT_LIMITS.fileBytes<=CHAT_ARTIFACT_LIMITS.scopeBytes&&all.b+CHAT_ARTIFACT_LIMITS.fileBytes<=CHAT_ARTIFACT_LIMITS.globalBytes;
  }
  function disk(id){chatId(id);return path.join(root,id);}
  function metadata(r){return {id:r.id,requestId:r.request_id,kind:r.kind,name:r.name||'arquivo',mimeType:r.mime_type|| (r.kind==='video'?'video/mp4':'image/png'),bytes:r.bytes,
    ...(r.width?{width:r.width,height:r.height}:{}),...(r.duration_seconds?{durationSeconds:r.duration_seconds}:{}),availability:r.state==='ready'?'ready':'unavailable'};}
  const claim=db.transaction((scope,input)=>{
    checkOwner(scope,input.requestId);if(!['image','video'].includes(input.kind))fail();
    const prior=db.prepare('SELECT * FROM neural_chat_artifacts WHERE request_id=?').get(input.requestId);
    if(prior){if(prior.scope!==scope||prior.kind!==input.kind||prior.state==='released')fail();return prior;}
    if(!quota(scope))fail('chat_artifact_quota',429);
    const id=randomUUID();db.prepare('INSERT INTO neural_chat_artifacts(id,scope,request_id,kind,bytes,reserved,state,created_at) VALUES(?,?,?,?,0,?,?,?)').run(id,scope,input.requestId,input.kind,CHAT_ARTIFACT_LIMITS.fileBytes,'reserved',now());
    return db.prepare('SELECT * FROM neural_chat_artifacts WHERE id=?').get(id);
  });
  async function ingest(scope,input){
    const claimed=claim.immediate(scope,input);if(claimed.state==='ready')return metadata(claimed);
    if(db.prepare("UPDATE neural_chat_artifacts SET state='ingesting' WHERE id=? AND scope=? AND state='reserved'").run(claimed.id,scope).changes!==1)fail('chat_artifact_unavailable',503);
    // A previous interrupted ingest is never silently overwritten; provider work
    // is not repeated. Existing bytes/reservation remain available for review.
    const filename=disk(claimed.id);if(fs.existsSync(filename))fail('chat_artifact_unavailable',503);
    try{
      const fetched=input.data?{data:input.data,mimeType:input.mimeType}:await download(input.url);
      const {data,mimeType}=fetched;
      if(!Buffer.isBuffer(data)||!data.length||data.length>CHAT_ARTIFACT_LIMITS.fileBytes||!TYPES.has(mimeType)||mimeType.startsWith('image/')!==(input.kind==='image'))fail();
      const fd=fs.openSync(filename,'wx',0o600);try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      const dimensions=input.kind==='image'?inspectRaster(data,mimeType):inspectVideo(filename,data),digest=createHash('sha256').update(data).digest('hex');
      checkOwner(scope,input.requestId);
      db.prepare("UPDATE neural_chat_artifacts SET state='ready',mime_type=?,name=?,bytes=?,reserved=0,digest=?,width=?,height=?,duration_seconds=? WHERE id=? AND scope=? AND state='ingesting'")
        .run(mimeType,`vitrinecity-${input.kind}-${claimed.id.slice(0,8)}.${extensions[mimeType]}`,data.length,digest,dimensions.width,dimensions.height,dimensions.durationSeconds??null,claimed.id,scope);
      return metadata(db.prepare('SELECT * FROM neural_chat_artifacts WHERE id=?').get(claimed.id));
    }catch{db.prepare("UPDATE neural_chat_artifacts SET state='unavailable' WHERE id=? AND scope=? AND state='ingesting'").run(claimed.id,scope);fail('chat_artifact_unavailable',503);}
  }
  function read(scope,id){validateChatScope(scope);chatId(id);const r=db.prepare('SELECT * FROM neural_chat_artifacts WHERE id=? AND scope=?').get(id,scope);if(!r)fail('chat_not_found',404);checkOwner(scope,r.request_id);
    if(r.state!=='ready')fail('chat_artifact_unavailable',503);const filename=disk(r.id);let stat;try{stat=fs.lstatSync(filename);}catch{fail('chat_artifact_unavailable',503);}
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==r.bytes)fail('chat_artifact_unavailable',503);return {...metadata(r),path:filename};}
  return {ingest,read,canReserve:quota,reserve:(scope,input)=>{const r=claim.immediate(scope,input);return {id:r.id,requestId:r.request_id,state:r.state};},
    ownsReservation:(scope,id,kind)=>{checkOwner(scope,id);return !!db.prepare("SELECT 1 FROM neural_chat_artifacts WHERE scope=? AND request_id=? AND kind=? AND state='reserved' AND reserved=?").get(scope,id,kind,CHAT_ARTIFACT_LIMITS.fileBytes);},
    releaseReservation:(scope,id)=>{checkOwner(scope,id);return db.prepare("UPDATE neural_chat_artifacts SET state='released',reserved=0 WHERE scope=? AND request_id=? AND state='reserved'").run(scope,id).changes===1;},
    forRequest:(scope,id)=>{checkOwner(scope,id);return db.prepare("SELECT * FROM neural_chat_artifacts WHERE scope=? AND request_id=? AND state='ready'").all(scope,id).map(metadata);}};
}
