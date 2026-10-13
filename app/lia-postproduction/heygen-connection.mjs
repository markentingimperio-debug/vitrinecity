/** Load a server-owned HeyGen credential. No network on import/load, no browser keys. */
import fs from 'node:fs';
import path from 'node:path';
import {createElevenLabsHeyGenProviders,heygenBinding} from './heygen.mjs';
import {requireValue,problem} from './providers.mjs';
export function loadHeyGenConnection(filename,{now=Date.now}={}){
  requireValue(typeof filename==='string'&&path.isAbsolute(filename),'heygen_private_path_required');
  let descriptor,data;
  try{
    const full=path.resolve(filename);let ancestor=path.parse(full).root;
    for(const piece of path.dirname(full).slice(ancestor.length).split(path.sep).filter(Boolean)){
      ancestor=path.join(ancestor,piece);const s=fs.lstatSync(ancestor);
      requireValue(s.isDirectory()&&!s.isSymbolicLink()&&(s.mode&0o022)===0&&[0,process.geteuid()].includes(s.uid),'heygen_private_path_invalid');
    }
    requireValue((fs.statSync(path.dirname(full)).mode&0o077)===0,'heygen_private_directory_required');
    descriptor=fs.openSync(full,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    const s=fs.fstatSync(descriptor);
    requireValue(s.isFile()&&s.size>0&&s.size<=65536&&(s.mode&0o077)===0&&[0,process.geteuid()].includes(s.uid),'heygen_private_file_invalid');
    const buffer=Buffer.alloc(s.size+1),count=fs.readSync(descriptor,buffer,0,buffer.length,0);
    requireValue(count===s.size,'heygen_private_file_changed');
    data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,count)));
  }catch(error){
    if(error?.code?.startsWith('heygen_'))throw error;
    throw problem('heygen_private_configuration_unreadable');
  }finally{if(descriptor!==undefined)fs.closeSync(descriptor);}
  requireValue(data?.schema===1&&data.provider==='heygen'&&typeof data.apiKey==='string'&&/^[\x21-\x7e]{8,4096}$/.test(data.apiKey)&&data.metadataAccessVerified===true,'heygen_private_configuration_invalid');
  const binding=heygenBinding(data);
  requireValue(Array.isArray(data.allowedUserIds)&&data.allowedUserIds.length>0&&data.allowedUserIds.length<=1000&&data.allowedUserIds.every(id=>Number.isSafeInteger(id)&&id>0&&id<=999999999999999),'heygen_accounts_invalid');
  requireValue(['lipsync:write','assets:write','account:read'].every(scope=>data.requiredScopesVerified?.[scope]===true),'heygen_scopes_unverified');
  requireValue(data.expiresAt===null||typeof data.expiresAt==='string'&&Number.isFinite(Date.parse(data.expiresAt)),'heygen_expiration_invalid');
  const active=()=>data.expiresAt===null||Date.parse(data.expiresAt)>now();
  requireValue(active(),'heygen_key_expired');
  return Object.freeze({binding,mode:data.mode,
    allowsUser:id=>active()&&data.allowedUserIds.includes(id),
    createProviders:({elevenLabsKey,fetchImpl=globalThis.fetch}={})=>createElevenLabsHeyGenProviders({elevenLabsKey,heygenKey:data.apiKey,mode:data.mode,accountBinding:data.accountBinding,fetchImpl,beforeRequest:active})});
}
