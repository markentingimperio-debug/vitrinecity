import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';

const HOST=process.env.LIA_BROKER_HOST||'127.0.0.1';
const PORT=Number(process.env.LIA_BROKER_PORT||8791);
const TOKEN=String(process.env.LIA_BROKER_ADMIN_TOKEN||'');
const API_KEY=String(process.env.OPENAI_API_KEY||'');
const EXECUTION_ENABLED=process.env.LIA_BROKER_EXECUTION_ENABLED==='1';
const MODEL=String(process.env.LIA_BROKER_DEFAULT_MODEL||'gpt-5.4-mini');

if(!Number.isInteger(PORT)||PORT<1||PORT>65535)throw new Error('invalid_port');
if(TOKEN.length<32)throw new Error('broker_token_too_short');
if(API_KEY&&(/[\r\n\0]/.test(API_KEY)||API_KEY.length<20))throw new Error('invalid_api_key');

function digest(v){return createHash('sha256').update(String(v)).digest();}
function equal(a,b){return timingSafeEqual(digest(a),digest(b));}
function authorized(req){const b=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');return Boolean(b)&&equal(b,TOKEN);}
function send(res,status,payload){const raw=JSON.stringify(payload);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-length':Buffer.byteLength(raw)});res.end(raw);}

const server=http.createServer((req,res)=>{
  const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  if(req.method==='GET'&&url.pathname==='/health')return send(res,200,{ok:true,service:'lia-openai-broker',version:'2026-09-17-v1',keyConfigured:Boolean(API_KEY),executionEnabled:EXECUTION_ENABLED,defaultModel:MODEL,bind:HOST});
  if(!authorized(req))return send(res,401,{error:'unauthorized'});
  if(req.method==='GET'&&url.pathname==='/v1/status')return send(res,200,{keyConfigured:Boolean(API_KEY),executionEnabled:EXECUTION_ENABLED,defaultModel:MODEL,realKeyExposed:false});
  // Fail closed until the budget-lease proxy phase is installed.
  if(url.pathname.startsWith('/v1/'))return send(res,423,{error:'broker_execution_locked'});
  return send(res,404,{error:'not_found'});
});
server.requestTimeout=10000;server.headersTimeout=8000;server.keepAliveTimeout=5000;
server.listen(PORT,HOST,()=>console.log(JSON.stringify({event:'lia_openai_broker_started',host:HOST,port:PORT,keyConfigured:Boolean(API_KEY),executionEnabled:EXECUTION_ENABLED,defaultModel:MODEL})));
