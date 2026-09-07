import {createHash} from 'node:crypto';

const TYPES=new Set([
  'content.view','content.complete','content.share','search.query','search.click',
  'commerce.product-view','commerce.add-to-cart','commerce.purchase',
  'ads.impression','ads.click','ads.conversion','support.resolved',
  'platform.error','platform.performance','social.follow'
]);
const SOURCES=new Set(['vitrine-social','marketplace','search','ads','support','platform','admin-neural']);
const SAFE_KEYS=new Set(['watchSeconds','completed','position','resultCount','valueCents','quantity','latencyMs','statusCode','campaignId','productId','postId','queryLength','conversion','errorClass','channel']);
const SECRET=/-----BEGIN .*PRIVATE KEY-----|\b(?:sk-proj-|ghp_|github_pat_|AKIA)[A-Za-z0-9_\-]{10,}/;

function cleanText(v,max,min=0){const s=String(v??'').trim();if(s.length<min||s.length>max||SECRET.test(s))throw new Error('Evento da plataforma inválido.');return s;}
function safePayload(value){
  const input=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const out={};
  for(const [key,val] of Object.entries(input)){
    if(!SAFE_KEYS.has(key))continue;
    if(typeof val==='string')out[key]=cleanText(val,180);
    else if(typeof val==='number'&&Number.isFinite(val))out[key]=val;
    else if(typeof val==='boolean')out[key]=val;
  }
  return out;
}
function pseudonym(value,salt){if(!value)return'';return createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0,24);}

export function createPlatformBridge({neural,pseudonymSalt='vitriny-neural-v1'}={}){
  if(!neural?.ingest)throw new TypeError('Platform bridge requer Vitriny Neural.');
  function capture(input={}){
    const type=cleanText(input.type,80,2);if(!TYPES.has(type))throw new Error('Tipo de evento não permitido.');
    const source=cleanText(input.source,64,2);if(!SOURCES.has(source))throw new Error('Origem de evento não permitida.');
    const entityType=cleanText(input.entityType||'',64);
    const entityId=cleanText(input.entityId||'',160);
    const actorHash=pseudonym(input.actorId,pseudonymSalt);
    const payload=safePayload(input.payload);
    if(actorHash)payload.actorHash=actorHash;
    return neural.ingest({
      type,source,entityType,entityId,payload,
      dedupeKey:input.dedupeKey?cleanText(input.dedupeKey,180,3):'',
      priority:Math.max(0,Math.min(9,Number(input.priority)||0)),
      occurredAt:input.occurredAt
    });
  }
  function captureBatch(events=[]){
    if(!Array.isArray(events)||events.length>500)throw new Error('Lote de eventos inválido.');
    return events.map((event,index)=>{try{return{index,ok:true,result:capture(event)};}catch(error){return{index,ok:false,error:String(error?.message||'invalid_event').slice(0,180)};}});
  }
  return {capture,captureBatch,policy:{types:[...TYPES],sources:[...SOURCES],safePayloadKeys:[...SAFE_KEYS],rawPersonalData:false}};
}
