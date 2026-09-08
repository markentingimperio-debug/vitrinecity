import {createHash} from 'node:crypto';
import {publicPlatformCurriculum} from './public-platform-curriculum-manifest.js';

const stopWords=new Set('a o as os de da do das dos e em um uma para por com que qual quais como onde quando quanto tenho tem fazer quero saber sobre me se na no nas nos ao ela ele isso esta este sao voce voces jarvis'.split(' '));
const normalize=value=>String(value??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const words=value=>[...new Set((normalize(value).match(/[a-z0-9]{2,40}/g)||[]).filter(word=>!stopWords.has(word)))].slice(0,24);
const sha256=value=>createHash('sha256').update(String(value)).digest('hex');
const manifest=new Map(publicPlatformCurriculum.documents.map(doc=>[doc.source,doc]));

/** Read-only, exact-content allowlist of public platform facts. No tenant data,
 * full admin memory, web candidates or conversation history is eligible here. */
export function createApprovedPlatformKnowledge({db,now=Date.now}={}){
  if(!db?.prepare)throw new TypeError('Conhecimento aprovado requer leitura SQLite.');
  const exists=()=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='jarvis_documents'").get());
  function eligible(){
    if(!exists())return [];
    const today=new Date(Number(now())).toISOString().slice(0,10),sources=[...manifest.keys()];
    return db.prepare(`SELECT id,title,body,source,revision,expires_at FROM jarvis_documents
      WHERE status='approved' AND updated_by=0 AND expires_at IS NOT NULL AND expires_at>=?
      AND source IN (${sources.map(()=>'?').join(',')})`).all(today,...sources)
      .filter(doc=>{const expected=manifest.get(doc.source);return expected&&doc.title===expected.title&&doc.expires_at===expected.expiresAt&&sha256(doc.body)===expected.bodySha256;});
  }
  function retrieve(query){
    const tokens=words(query);if(!tokens.length)return [];
    let remaining=3900;
    return eligible().map(doc=>{const title=new Set(words(doc.title)),body=new Set(normalize(doc.body).match(/[a-z0-9]{2,40}/g)||[]),matches=tokens.filter(token=>title.has(token)||body.has(token));return{doc,matches:matches.length,score:matches.reduce((score,token)=>score+(title.has(token)?3:1),0)};})
      .filter(item=>item.matches>=Math.min(2,tokens.length))
      .sort((a,b)=>b.score-a.score||a.doc.id-b.doc.id).slice(0,3)
      .map(({doc},index)=>{const excerpt=doc.body.slice(0,Math.min(1300,remaining));remaining-=excerpt.length;return{citation:'VC'+(index+1),title:doc.title,source:doc.source,revision:doc.revision,expiresAt:doc.expires_at,excerpt};});
  }
  return {retrieve,status(){return{scope:'public_platform_facts_only',curriculumId:publicPlatformCurriculum.id,approvedAvailable:eligible().length,readOnly:true,privateDocuments:false,automaticApproval:false,weightTraining:false};}};
}
