import {createHash} from 'node:crypto';
import {splitCompleteText} from './web-story-ai.js';
import {storyPageVisibleText} from './web-story-render.js';
import {storySourceCta} from './web-story-cta.js';

// Exact, repository-reviewed recipe/image pairs from seed-editorial-starters.mjs.
// A changed source must obtain a fresh editorial review; an ID alone is no proof.
const reviewedRecipes=new Map([
  ['starter-recipe-fricasse','da4ece6040492376952fc550d5a5036323878ddfadd3c893e2de1a552a0bee6a'],
  ['starter-recipe-cake','484a255058e2672178391b7774d00a853af29faa90dd8128000825d5bb2a6881'],
  ['starter-recipe-bowl','96ffbcb5ac00e3af5cbeff96b7d6f156711b749f7fea737965e0fd8025614f1b']
]);
const allowedPortals=new Set(['receitas','plantas-e-jardinagem']);
const compact=value=>String(value||'').replace(/\s+/g,' ').trim();
const signature=row=>createHash('sha256').update(JSON.stringify([row.id,row.portal,row.title,row.summary,row.body,row.image_url])).digest('hex');
const hasTable=(db,name)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const held=code=>({approved:false,draft:null,notes:code,qualityFailures:[],review:{approved:false,qualityCheckOnly:true,notes:''},method:'local_editorial'});

/** Re-layout of an already reviewed original. No generative calls, summaries,
 * new claims or override of a rejected story. Unknown provenance stays with
 * the existing review workflow. Publication still belongs to web-stories.js. */
export function createLocalEditorialStories({db,assets}) {
  function eligible(source) {
    if(source?.kind!=='article'||source.commercial!==false||!allowedPortals.has(source.portal)||!hasTable(db,'editorial_articles'))return false;
    const row=db.prepare("SELECT * FROM editorial_articles WHERE id=? AND status='published' AND published_at IS NOT NULL").get(source.key);
    if(!row||row.portal!==source.portal||row.title!==source.title||row.summary!==source.summary||row.body!==source.body||row.image_url!==source.image_url||source.sourcePath!=='/artigo/'+encodeURIComponent(row.slug))return false;
    // Old reviewers' refusals remain authoritative, including legacy jobs whose
    // detailed criteria were never persisted. Changing a caption cannot erase it.
    if(hasTable(db,'web_story_automation_jobs')&&db.prepare("SELECT 1 FROM web_story_automation_jobs WHERE source_key=? AND status='review' LIMIT 1").get(source.key))return false;
    if(hasTable(db,'editorial_web_stories')&&db.prepare('SELECT 1 FROM editorial_web_stories WHERE article_id=?').get(source.key))return false;
    const reviews=hasTable(db,'editorial_agent_reviews')?db.prepare('SELECT agent_code,approved,created_at FROM editorial_agent_reviews WHERE article_id=?').all(source.key):[];
    if(reviews.some(item=>item.approved!==1))return false;
    // Legacy reviews are timestamp-bound, not content-bound. Even five positive
    // rows cannot attest text changed within the same second. Only an explicit
    // reviewed content hash can enable this local workflow.
    if(reviewedRecipes.get(row.id)!==signature(row))return false;
    const image=String(row.image_url||'');
    return /^\/(?:assets\/(?:recipes|editorial)\/|uploads\/generated-videos\/)[a-zA-Z0-9._/-]+\.(?:png|jpe?g|webp)$/.test(image)&&!image.includes('..');
  }
  async function generate(source,{signal,isCurrent=()=>true,buttons={}}={}) {
    if(!eligible(source))return null;
    const checkpoint=()=>{if(signal?.aborted||!isCurrent()||!eligible(source))throw Object.assign(Error('ai_source_changed'),{code:'ai_source_changed'});};
    checkpoint();
    const body=compact(source.body),title=compact(source.title),description=compact(source.summary);
    // Preserve every source word and quantity. Never pad a thin source or cut a
    // long procedure to make it fit. News and commercial sources are excluded.
    if(body.length<650||body.length>1700||title.length<8||title.length>65||description.length<30||description.length>160||/[<>]|https?:\/\/|www\./i.test(body+title+description))return held('local_source_needs_editing');
    if(/\b(?:cura|emagrec|tratamento|medicamento|dose|veneno|agrot[oó]xico|garantid[oa])\b/i.test(body))return held('local_source_needs_review');
    if(source.portal==='receitas'&&(!/\bingredientes\b[^:]{0,40}:/i.test(body)||!/(?:\bpreparo\b|\bmodo de fazer\b)[^:]{0,30}:/i.test(body)))return held('local_source_needs_editing');
    let pieces;
    try{pieces=splitCompleteText(body,8,18);}catch{return held('local_source_needs_editing');}
    if(pieces.join(' ')!==body)return held('local_source_needs_editing');
    try{
      const image=await assets.image(source.image_url);checkpoint();
      const logo=await assets.image('/assets/pwa-icon-192.png',{logo:true});checkpoint();
      const poster=await assets.poster(image);checkpoint();
      const pages=['Um guia completo para você.',...pieces,'Veja o conteúdo completo na página relacionada.'].map((text,index)=>({text,image:image.url,width:image.width,height:image.height,alt:title,imageCredit:'Imagem do artigo',...(index>0&&index<=pieces.length&&index%2===1?{layout:'editorial'}:{})}));
      const draft={title,description,category:source.portal==='receitas'?'Receitas':'Plantas e jardinagem',logo:logo.url,poster,sourcePath:source.sourcePath,cta:buttons.cta??storySourceCta(source),homeCta:buttons.homeCta??'',pages,sources:[],aiGenerated:false,editorialMethod:'source_preserved',sourceContentHash:signature({id:source.key,portal:source.portal,title:source.title,summary:source.summary,body:source.body,image_url:source.image_url})};
      if(pages.some((_,index)=>[...storyPageVisibleText(draft,index)].length>180))return held('local_source_needs_editing');
      return {approved:true,notes:'local_editorial_preserved',draft,method:'local_editorial',publicationAllowed:()=>eligible(source),qualityFailures:[],review:{approved:true,grounded:true,original:true,complete:true,nonRepetitive:true,commerceBalanced:true,risk:'low',qualityCheckOnly:true,notes:'Texto integral e imagem da fonte própria aprovada foram preservados.'},repair:{attempted:false}};
    }catch(error){if(error.code==='ai_source_changed')throw error;return held('local_source_image_invalid');}
  }
  return {eligible,generate};
}
