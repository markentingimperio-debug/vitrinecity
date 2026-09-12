// Reuses a dated public prayer and its verified ready media in the existing
// Web Stories service. No timer, provider, new article or publication pipeline.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {getDailyPrayer,validDay,prayerDayInBrazil} from './prayer-daily.js';
import {prayerVideoScript} from './prayer-media.js';
import {storyPageVisibleText} from './web-story-render.js';

export const PRAYER_STORY_PREFIX='prayer-video:';
export const PRAYER_STORY_IMAGE='/assets/prayer/jesus-areia-v1.png';
const IMAGE_HASH='03789c08892c0ef3d46268efd7fe61ce69c50af63ffc6f0e9578f75be7c8ec90';
const KEY=/^prayer-video:(\d{4}-\d{2}-\d{2}):07$/;
const digest=value=>createHash('sha256').update(value).digest('hex');
const compact=value=>String(value??'').replace(/\s+/g,' ').trim();
const failure=code=>Object.assign(Error(code),{code,status:409});
const check=(value,code)=>{if(!value)throw failure(code);};
const table=(db,name)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
const held=notes=>({approved:false,draft:null,method:'local_editorial',notes,qualityFailures:[],review:{approved:false,qualityCheckOnly:true,notes:'A edição existente foi preservada; confira a origem antes de continuar.'}});

export function prayerStoryKey(day,slot='07'){
  if(!validDay(day)||slot!=='07')throw failure('prayer_story_slot_unavailable');
  return `${PRAYER_STORY_PREFIX}${day}:${slot}`;
}

// Keep whole sentences where possible. Long sentences split only at spaces;
// short endings attach to the previous thought, without invented filler.
export function prayerStoryPages(prayer){
  const body=compact([...prayer.paragraphs,prayer.reflectionTitle+'.',prayer.reflection,prayer.prompt].join(' '));
  check(body.length>=400&&body.length<=3500&&!/[<>]|https?:\/\//i.test(body),'prayer_story_copy_needs_review');
  const pieces=[];
  for(const raw of body.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[]){
    const sentence=compact(raw);let chunk='';
    for(const word of sentence.split(' ')){
      check(word.length<=120,'prayer_story_copy_needs_review');
      if(chunk&&chunk.length+1+word.length>120){pieces.push(chunk);chunk='';}
      chunk+=(chunk?' ':'')+word;
    }
    if(chunk){if(chunk.length<35&&pieces.length&&pieces.at(-1).length+chunk.length+1<=120)pieces[pieces.length-1]+=' '+chunk;else pieces.push(chunk);}
  }
  // A small heading belongs with the following sentence when it fits.
  for(let i=0;i<pieces.length-1;i++)if(pieces[i].length<35&&pieces[i].length+pieces[i+1].length+1<=120)pieces.splice(i,2,pieces[i]+' '+pieces[i+1]);
  check(pieces.length>=9&&pieces.length<=39&&pieces.join(' ')===body,'prayer_story_ten_pages_unavailable');
  return {body,pieces};
}

export function createPrayerWebStoryBridge({db,dataDir,publicDir,canRun=()=>true,now=()=>new Date()}){
  if(!db||!path.isAbsolute(dataDir||'')||!path.isAbsolute(publicDir||''))throw failure('prayer_story_configuration_invalid');
  function readSource(key){
    const match=typeof key==='string'&&KEY.exec(key);
    if(!match||!validDay(match[1])||match[1]>prayerDayInBrazil(now()))return null;
    const day=match[1],directory=path.join(dataDir,'prayer-media',day,'short'),readyPath=path.join(directory,'ready.json'),videoPath=path.join(directory,'video.mp4');
    const dataRoot=fs.realpathSync(dataDir),publicRoot=fs.realpathSync(publicDir),imagePath=path.join(publicDir,...PRAYER_STORY_IMAGE.split('/').filter(Boolean));
    check(fs.realpathSync(readyPath)===path.join(dataRoot,'prayer-media',day,'short','ready.json')&&fs.realpathSync(videoPath)===path.join(dataRoot,'prayer-media',day,'short','video.mp4')&&fs.realpathSync(imagePath)===path.join(publicRoot,'assets','prayer','jesus-areia-v1.png'),'prayer_story_path_changed');
    const readyStat=fs.statSync(readyPath),videoStat=fs.statSync(videoPath);
    check(readyStat.isFile()&&readyStat.size<=1024*1024&&videoStat.isFile()&&videoStat.size>=32&&videoStat.size<=15*1024*1024,'prayer_story_source_invalid');
    const ready=JSON.parse(fs.readFileSync(readyPath,'utf8')),prayer=getDailyPrayer(day),script=prayerVideoScript(day,'short');
    check(ready.day===day&&ready.format==='short'&&ready.videoPath===videoPath&&ready.publicVideoUrl===`https://vitrinecity.com/prayer-media/${day}/short.mp4`&&ready.bytes===videoStat.size&&ready.width===720&&ready.height===1280&&Number.isFinite(ready.durationSeconds)&&ready.durationSeconds>=3&&ready.durationSeconds<=60,'prayer_story_source_invalid');
    check(JSON.stringify(ready.script)===JSON.stringify(script)&&ready.binding===digest(JSON.stringify(ready.script))&&/^[a-f0-9]{64}$/.test(ready.sha256||'')&&digest(fs.readFileSync(videoPath))===ready.sha256,'prayer_story_source_changed');
    check(digest(fs.readFileSync(imagePath))===IMAGE_HASH,'prayer_story_image_changed');
    check(typeof ready.caption==='string'&&ready.caption.includes(script.text)&&ready.caption.includes(`#Oracao${day.replaceAll('-','')}`),'prayer_story_caption_changed');
    const {body,pieces}=prayerStoryPages(prayer),sourcePath=`/oracao-do-dia.html?dia=${day}#oracao`;
    const reuseContentHash=digest(JSON.stringify([body,IMAGE_HASH])),binding=digest(JSON.stringify({day,slot:'07',format:'short',videoHash:ready.sha256,scriptHash:ready.binding,imageHash:IMAGE_HASH,body,sourcePath}));
    return {id:key,key,kind:'page',group:'trends',slug:`oracao-${day}`,title:`${script.title} · ${day.split('-').reverse().join('/')}`,summary:compact(prayer.reflection),body,image_url:PRAYER_STORY_IMAGE,portal:'oracao',updated_at:ready.createdAt||'',sourcePath,commercial:false,
      sources:[{title:`Oração completa · ${prayer.edition}`,url:sourcePath},{title:'Vídeo desta oração',url:ready.publicVideoUrl}],
      reuseBinding:binding,facts:{day,slot:'07',format:'short',videoSha256:ready.sha256,scriptBinding:ready.binding,imageSha256:IMAGE_HASH,reuseContentHash,prayerTitle:prayer.title,edition:prayer.edition},pieces};
  }
  function source(key){try{return readSource(key);}catch{return null;}}
  function canonicalFor(input){
    if(!table(db,'editorial_web_stories'))return null;
    // Let SQLite select the one canonical record; never load thousands of full
    // story snapshots into memory for each image/source checkpoint.
    const row=db.prepare(`SELECT id,slug,article_id,draft_json,published_json FROM editorial_web_stories
      WHERE article_id=? OR CASE WHEN json_valid(draft_json) THEN
        json_extract(draft_json,'$.sourcePath')=? OR json_extract(draft_json,'$.reuseContentHash')=?
        ELSE 0 END OR CASE WHEN json_valid(published_json) THEN
        json_extract(published_json,'$.sourcePath')=? OR json_extract(published_json,'$.reuseContentHash')=?
        ELSE 0 END ORDER BY (article_id=?) DESC,id LIMIT 1`).get(input.key,input.sourcePath,input.facts.reuseContentHash,input.sourcePath,input.facts.reuseContentHash,input.key);
    if(!row)return null;
    let draft,published;try{draft=JSON.parse(row.draft_json);}catch{}try{published=JSON.parse(row.published_json);}catch{}
    return {storyId:row.id,url:'/stories/'+row.slug,sourceKey:row.article_id,published:Boolean(row.published_json),sameSource:row.article_id===input.key,binding:draft?.reuseBinding||published?.reuseBinding||null};
  }
  function eligible(input){
    const fresh=source(input?.key);if(!fresh||fresh.reuseBinding!==input.reuseBinding||canRun()!==true)return false;
    const prior=canonicalFor(fresh);
    if(prior&&(!prior.sameSource||prior.binding!==fresh.reuseBinding))return false;
    if(table(db,'web_story_automation_jobs')&&db.prepare("SELECT 1 FROM web_story_automation_jobs WHERE source_key=? AND status='review' LIMIT 1").get(fresh.key))return false;
    return true;
  }
  function list({q='',group='all',limit=50,offset=0}={}){
    if(!['all','trends'].includes(group)||offset>0||limit<1)return [];
    const item=source(prayerStoryKey(prayerDayInBrazil(now())));
    return item&&(!q||compact([item.title,item.body].join(' ')).toLocaleLowerCase('pt-BR').includes(compact(q).toLocaleLowerCase('pt-BR')))?[item]:[];
  }
  async function generate(input,{signal,isCurrent=()=>true,buttons={}}={},assets){
    if(!KEY.test(input?.key||''))return null;
    if(!eligible(input))return held('prayer_story_reuse_needs_review');
    const current=()=>!signal?.aborted&&isCurrent()===true&&eligible(input);
    const checkpoint=()=>{if(!current())throw failure('prayer_story_source_changed');};
    checkpoint();
    const fresh=source(input.key),image=await assets.image(fresh.image_url);checkpoint();
    check(image.hash===IMAGE_HASH,'prayer_story_image_changed');
    const logo=await assets.image('/assets/pwa-icon-192.png',{logo:true});checkpoint();
    const poster=await assets.poster(image);checkpoint();
    const pages=[`${fresh.facts.prayerTitle} · ${fresh.facts.edition}`,...fresh.pieces].map((text,index)=>({text,image:image.url,width:image.width,height:image.height,alt:'Representação artística de Jesus feita de areia junto ao mar.',imageCredit:'Ilustração IA',...(index>0&&index%2===0?{layout:'editorial'}:{})}));
    const draft={title:fresh.title,description:fresh.summary,category:'Oração',logo:logo.url,poster,sourcePath:fresh.sourcePath,sourceKind:'page',commercial:false,cta:buttons.cta==='Ler matéria completa'?'Ler oração completa':buttons.cta??'Ler oração completa',homeCta:buttons.homeCta??'',sources:fresh.sources,pages,reuseBinding:fresh.reuseBinding,reuseContentHash:fresh.facts.reuseContentHash};
    if(pages.some((_,i)=>[...storyPageVisibleText(draft,i)].length>180))return held('prayer_story_copy_needs_review');
    return {approved:true,draft,method:'local_editorial',notes:'prayer_story_reused',publicationAllowed:current,qualityFailures:[],review:{approved:true,grounded:true,original:true,complete:true,nonRepetitive:true,commerceBalanced:true,risk:'low',qualityCheckOnly:true,notes:'Texto integral da coleção editorial pública preservado; vídeo e arte local vinculados por hash, com identificação de ilustração IA.'},repair:{attempted:false}};
  }
  return {source,get:source,list,eligible,generate,canonicalFor};
}
