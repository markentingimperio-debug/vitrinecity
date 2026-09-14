import {createHash,randomUUID} from 'node:crypto';
import {rasterSize} from '../web-story-assets.js';

export const CHAT_ATTACHMENT_LIMITS=Object.freeze({maxPerMessage:3,imageMaxBytes:2*1024*1024,textMaxBytes:64*1024,
  retainedPerScope:40,retainedBytesPerScope:20*1024*1024,globalRetained:400,globalRetainedBytes:128*1024*1024,
  allowedMimeTypes:Object.freeze(['text/plain','text/markdown','text/csv','image/png','image/jpeg','image/webp'])});
export function chatError(code,status=400){return Object.assign(new Error(code),{code,status});}
export function validateChatScope(scope){
  if(typeof scope!=='string'||!(/^(?:(?:admin|store):[A-Za-z0-9][A-Za-z0-9._:-]{0,159}|user:[1-9]\d{0,14})$/).test(scope))throw chatError('chat_access_denied',403);
  return scope;
}
export function chatId(id){if(typeof id!=='string'||!(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/).test(id))throw chatError('chat_not_found',404);return id;}
const EXTENSIONS={'text/plain':['txt'],'text/markdown':['md','markdown'],'text/csv':['csv'],'image/png':['png'],'image/jpeg':['jpg','jpeg'],'image/webp':['webp']};
const SECRET=/-----BEGIN [^-]*PRIVATE KEY-----|\b(?:sk-proj-|ghp_|github_pat_|AKIA)[A-Za-z0-9_-]{10,}|\bBearer\s+[A-Za-z0-9._-]{16,}/i;
export function containsChatSecret(value){return SECRET.test(value);}
function metadata(row){return {id:row.id,name:row.name,mimeType:row.mime_type,bytes:row.bytes,kind:row.kind,textAvailable:row.kind==='text',
  ...(row.kind==='image'?{width:row.width,height:row.height}:{}),createdAt:row.created_at};}

/** Private SQLite storage only. No public URLs, remote fetches, document macros or parsing executables. */
export function createChatAttachments({db,now=Date.now}={}){
  db.exec(`CREATE TABLE IF NOT EXISTS neural_chat_attachments (
    id TEXT PRIMARY KEY, scope TEXT NOT NULL, name TEXT NOT NULL, mime_type TEXT NOT NULL, kind TEXT NOT NULL,
    bytes INTEGER NOT NULL, digest TEXT NOT NULL, data BLOB NOT NULL, text_content TEXT NOT NULL DEFAULT '',
    width INTEGER NOT NULL DEFAULT 0,height INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,
    UNIQUE(scope,name,mime_type,digest));
    CREATE INDEX IF NOT EXISTS idx_neural_chat_attachments_scope ON neural_chat_attachments(scope);`);
  const upload=db.transaction((scope,input)=>{
    validateChatScope(scope);
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['name','mimeType','dataBase64'].includes(key)))throw chatError('chat_input_invalid');
    const {name,mimeType,dataBase64}=input;
    if(typeof name!=='string'||typeof mimeType!=='string'||!name.trim()||name.length>120||name!==name.trim()||/[\\/:<>\x00-\x1f\x7f]/.test(name)||name.startsWith('.')||!Object.hasOwn(EXTENSIONS,mimeType)||!EXTENSIONS[mimeType].includes(name.split('.').pop().toLowerCase()))throw chatError('chat_attachment_invalid');
    const kind=mimeType.startsWith('image/')?'image':'text',maxBytes=kind==='image'?CHAT_ATTACHMENT_LIMITS.imageMaxBytes:CHAT_ATTACHMENT_LIMITS.textMaxBytes;
    if(typeof dataBase64!=='string'||!dataBase64||dataBase64.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64))throw chatError('chat_attachment_invalid');
    if(dataBase64.length>Math.ceil(maxBytes/3)*4)throw chatError('chat_attachment_too_large',413);
    const data=Buffer.from(dataBase64,'base64');
    if(!data.length||data.toString('base64')!==dataBase64)throw chatError('chat_attachment_invalid');
    if(data.length>maxBytes)throw chatError('chat_attachment_too_large',413);
    let textContent='',width=0,height=0;
    if(kind==='text'){
      try{textContent=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{throw chatError('chat_attachment_invalid');}
      if(!textContent.trim()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(textContent)||containsChatSecret(textContent))throw chatError('chat_attachment_invalid');
    }else{
      let size;try{size=rasterSize(data);}catch{throw chatError('chat_attachment_invalid');}
      const validEnvelope=size.type==='png'?data.length>=45&&data.readUInt32BE(8)===13&&data.toString('ascii',12,16)==='IHDR'&&data.subarray(-12).equals(Buffer.from('0000000049454e44ae426082','hex')):
        size.type==='jpeg'?data.length>=4&&data.subarray(-2).equals(Buffer.from([255,217])):
        size.type==='webp'?data.readUInt32LE(4)+8===data.length:false;
      if(!validEnvelope||mimeType!=='image/'+size.type||size.width<1||size.height<1||size.width>8000||size.height>8000||size.width*size.height>24000000)throw chatError('chat_attachment_invalid');
      width=size.width;height=size.height;
    }
    const digest=createHash('sha256').update(data).digest('hex');
    const prior=db.prepare('SELECT * FROM neural_chat_attachments WHERE scope=? AND name=? AND mime_type=? AND digest=?').get(scope,name,mimeType,digest);
    if(prior)return metadata(prior);
    const retained=db.prepare('SELECT COUNT(*) n,COALESCE(SUM(bytes),0) bytes FROM neural_chat_attachments WHERE scope=?').get(scope);
    const global=db.prepare('SELECT COUNT(*) n,COALESCE(SUM(bytes),0) bytes FROM neural_chat_attachments').get();
    if(retained.n>=CHAT_ATTACHMENT_LIMITS.retainedPerScope||retained.bytes+data.length>CHAT_ATTACHMENT_LIMITS.retainedBytesPerScope||global.n>=CHAT_ATTACHMENT_LIMITS.globalRetained||global.bytes+data.length>CHAT_ATTACHMENT_LIMITS.globalRetainedBytes)throw chatError('chat_attachment_quota',429);
    const id=randomUUID();
    db.prepare('INSERT INTO neural_chat_attachments(id,scope,name,mime_type,kind,bytes,digest,data,text_content,width,height,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id,scope,name,mimeType,kind,data.length,digest,data,textContent,width,height,now());
    return metadata(db.prepare('SELECT * FROM neural_chat_attachments WHERE id=? AND scope=?').get(id,scope));
  });
  function row(scope,id){validateChatScope(scope);chatId(id);const item=db.prepare('SELECT * FROM neural_chat_attachments WHERE id=? AND scope=?').get(id,scope);if(!item)throw chatError('chat_not_found',404);return item;}
  return {upload:(scope,input)=>upload.immediate(scope,input),metadata:(scope,id)=>metadata(row(scope,id)),
    read:(scope,id)=>{const item=row(scope,id);return {...metadata(item),data:item.data};},
    context:(scope,id)=>{const item=row(scope,id);return {...metadata(item),text:item.text_content};}};
}
