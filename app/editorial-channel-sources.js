import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {createHash} from 'node:crypto';
import {publicImageAddress} from './catalog-product-images.js';
import {fetchStoryResearchText,extractStoryResearchArticle,extractStoryRecipe,storyResearchUrl,storyResearchTopicMatches} from './web-story-research.js';

const HOUR=3600000,MAX_BYTES=512*1024;
export const EDITORIAL_CHANNELS=Object.freeze([
  {id:'tv-brasil',name:'TV Brasil',topic:'news',channelId:'UCSv9d0kQegylHWpP83jWSQg',hosts:['agenciabrasil.ebc.com.br','tvbrasil.ebc.com.br']},
  {id:'bbc-brasil',name:'BBC News Brasil',topic:'news',channelId:'UCthbIFAxbXTTQEC7EcQvP1Q',hosts:['www.bbc.com']},
  {id:'panelinha',name:'Panelinha',topic:'recipes',channelId:'UCfSPnAlDUTiIOAvNOI-a4yQ',hosts:['panelinha.com.br','www.panelinha.com.br']},
  {id:'minhas-plantas',name:'Minhas Plantas',topic:'gardening',channelId:'UC-8Uff7i2h5qtIvjXJDJqYA',hosts:['minhasplantas.com.br','www.minhasplantas.com.br']}
].map(item=>Object.freeze({...item,url:'https://www.youtube.com/channel/'+item.channelId,feedUrl:'https://www.youtube.com/feeds/videos.xml?channel_id='+item.channelId})));
const fail=code=>Object.assign(Error(code),{code});
const check=signal=>{if(signal?.aborted)throw fail('feed_aborted');};
const clean=value=>String(value??'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';}).replace(/&(amp|quot|apos|lt|gt);/g,(_,key)=>({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'}[key])).replace(/<[^>]*>/g,' ').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim();
const tags=(xml,name)=>[...xml.matchAll(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','g'))].map(match=>clean(match[1]));
const tag=(xml,name)=>tags(xml,name)[0]||'';
const pairedUrl=(value,channel)=>{const safe=storyResearchUrl(value);if(!safe)return '';const u=new URL(safe);return channel.hosts.includes(u.hostname)?safe:'';};
const contentHash=content=>createHash('sha256').update(JSON.stringify(Object.fromEntries(['kind','title','ingredients','steps','components','text','publishedAt','excerptOnly'].filter(key=>content[key]!==undefined).map(key=>[key,content[key]])))).digest('hex');
const matchesContent=(title,content)=>storyResearchTopicMatches(title,{title:content.title,excerpt:content.text||[...content.ingredients||[],...content.steps||[]].join(' ')});
export function editorialFeedUrl(value){return EDITORIAL_CHANNELS.find(channel=>channel.feedUrl===value)?.feedUrl||'';}
export function parseEditorialChannelFeed(xml,channel,{now=Date.now()}={}){
  if(typeof xml!=='string'||Buffer.byteLength(xml)>MAX_BYTES)throw fail('feed_too_large');
  if(/<!DOCTYPE|<!ENTITY/i.test(xml)||!/^\s*(?:<\?xml[^>]*>\s*)?<feed\b/i.test(xml)||!/<\/feed>\s*$/.test(xml))throw fail('feed_invalid');
  const entries=[...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)],head=xml.replace(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/g,'');
  const matchesId=value=>value===channel.channelId||value===channel.channelId.slice(2);
  if(tags(head,'yt:channelId').length!==1||!matchesId(tag(head,'yt:channelId'))||!matchesId(tag(head,'id').replace(/^yt:channel:/,''))||!tag(head,'id').startsWith('yt:channel:'))throw fail('feed_identity_mismatch');
  const seen=new Set(),items=[];
  for(const match of entries.slice(0,30)){
    const entry=match[1],videoId=tag(entry,'yt:videoId');
    if(tags(entry,'yt:channelId').length!==1||tags(entry,'yt:videoId').length!==1||!matchesId(tag(entry,'yt:channelId')))throw fail('feed_identity_mismatch');
    if(!/^[A-Za-z0-9_-]{11}$/.test(videoId)||tag(entry,'id')!=='yt:video:'+videoId||seen.has(videoId))continue;
    const publishedAt=Date.parse(tag(entry,'published')),title=tag(entry,'title').slice(0,180),description=tag(entry,'media:description').slice(0,12000);
    if(!title||!Number.isFinite(publishedAt)||publishedAt>now+300000||publishedAt<now-90*24*HOUR)continue;
    const rawViews=/<media:statistics\b[^>]*\bviews=["'](\d+)["']/i.exec(entry)?.[1],views=rawViews!==undefined&&Number.isSafeInteger(Number(rawViews))?Number(rawViews):null;
    const sourceLinks=[...new Set((description.match(/https:\/\/[^\s<>"']+/g)||[]).map(url=>pairedUrl(url.replace(/[),.;]+$/,''),channel)).filter(Boolean))].slice(0,5);
    seen.add(videoId);items.push({videoId,title,publishedAt,views,url:'https://www.youtube.com/watch?v='+videoId,sourceLinks});
  }
  return items;
}
export function fetchEditorialFeed(value,{signal,fetchImpl}={}){
  const url=editorialFeedUrl(value);if(!url)return Promise.reject(fail('feed_origin_denied'));check(signal);
  const timeout=AbortSignal.timeout(8000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
  if(fetchImpl)return (async()=>{const response=await fetchImpl(url,{method:'GET',redirect:'error',credentials:'omit',signal:combined,headers:{accept:'application/atom+xml,application/xml,text/xml'}});if(response.status!==200||!/^(?:application\/(?:atom\+xml|xml)|text\/xml)(?:;|$)/i.test(response.headers.get('content-type')||'')||Number(response.headers.get('content-length'))>MAX_BYTES)throw fail('feed_unavailable');let size=0;const chunks=[];try{for await(const chunk of response.body){size+=chunk.length;if(size>MAX_BYTES)throw fail('feed_too_large');chunks.push(Buffer.from(chunk));}}finally{await response.body?.cancel().catch(()=>{});}check(combined);return Buffer.concat(chunks).toString('utf8');})();
  return new Promise((resolve,reject)=>{
    const request=https.get(url,{agent:false,family:4,signal:combined,headers:{accept:'application/atom+xml,application/xml,text/xml','user-agent':'VitrineCity Editorial Sources/1.0'},lookup(host,options,callback){lookup(host,{family:4,all:true}).then(addresses=>{if(!addresses.length||addresses.some(item=>!publicImageAddress(item.address)))return callback(fail('feed_origin_denied'));options.all?callback(null,[addresses[0]]):callback(null,addresses[0].address,4);},callback);}},response=>{
      if(response.statusCode!==200||!/^(?:application\/(?:atom\+xml|xml)|text\/xml)(?:;|$)/i.test(response.headers['content-type']||'')||Number(response.headers['content-length'])>MAX_BYTES){response.destroy();reject(fail('feed_unavailable'));return;}
      let size=0;const chunks=[];response.on('data',chunk=>{size+=chunk.length;if(size>MAX_BYTES){response.destroy(fail('feed_too_large'));return;}chunks.push(chunk);});response.on('error',reject);response.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
    });request.on('error',()=>reject(fail(signal?.aborted?'feed_aborted':timeout.aborted?'feed_timeout':'feed_unavailable')));
  });
}

/** Public metadata cache only. The hourly caller owns scheduling and publication
 * remains in the existing reviewed pipeline. No credentials or media downloads. */
export function createEditorialChannelSources({db,canRun=()=>true,fetchImpl,now=Date.now,research=null}){
  db.exec(`CREATE TABLE IF NOT EXISTS editorial_channel_sync(id TEXT PRIMARY KEY,last_checked_at INTEGER NOT NULL DEFAULT 0,last_success_at INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'never',error_code TEXT NOT NULL DEFAULT '',items_count INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS editorial_channel_items(video_id TEXT PRIMARY KEY,channel_key TEXT NOT NULL REFERENCES editorial_channel_sync(id),title TEXT NOT NULL,url TEXT NOT NULL,published_at INTEGER NOT NULL,views INTEGER,source_links_json TEXT NOT NULL DEFAULT '[]',evidence_json TEXT NOT NULL DEFAULT '{}',evidence_checked_at INTEGER NOT NULL DEFAULT 0,first_seen_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_editorial_channel_items_recent ON editorial_channel_items(published_at DESC,video_id);`);
  for(const channel of EDITORIAL_CHANNELS)db.prepare('INSERT OR IGNORE INTO editorial_channel_sync(id) VALUES(?)').run(channel.id);
  let pending=null,closed=false;
  const iso=value=>value?new Date(value).toISOString():null;
  const state=()=>db.prepare('SELECT * FROM editorial_channel_sync').all();
  const latest=()=>Math.max(0,...state().map(row=>row.last_checked_at));
  function snapshot({topic='all',q='',sort='recent',limit=60,offset=0}={}){
    const take=Math.max(1,Math.min(200,Number(limit)||60)),skip=Math.max(0,Number(offset)||0),channels=EDITORIAL_CHANNELS.map(channel=>{const row=state().find(row=>row.id===channel.id);return {id:channel.id,name:channel.name,topic:channel.topic,channelId:channel.channelId,url:channel.url,feedUrl:channel.feedUrl,status:row.status,lastCheckedAt:iso(row.last_checked_at),lastSuccessAt:iso(row.last_success_at),errorCode:row.error_code||null,itemsCount:row.items_count};});
    const terms=clean(q).toLocaleLowerCase('pt-BR').split(/\s+/).filter(Boolean),items=[];
    for(const row of db.prepare('SELECT * FROM editorial_channel_items WHERE published_at>=? ORDER BY published_at DESC,video_id LIMIT 400').all(now()-90*24*HOUR)){
      const channel=EDITORIAL_CHANNELS.find(c=>c.id===row.channel_key);if(!channel||topic!=='all'&&channel.topic!==topic||!terms.every(term=>(row.title+' '+channel.name).toLocaleLowerCase('pt-BR').includes(term)))continue;
      let evidence={},sourceLinks=[];try{evidence=JSON.parse(row.evidence_json);sourceLinks=JSON.parse(row.source_links_json);}catch{}
      const safeEvidenceUrl=storyResearchUrl(evidence.sourceUrl),evidenceHost=safeEvidenceUrl&&new URL(safeEvidenceUrl).hostname;
      if(!safeEvidenceUrl||!channel.hosts.includes(evidenceHost)&&!(channel.topic==='gardening'&&['www.embrapa.br','embrapa.br'].includes(evidenceHost))||evidence.contentHash!==contentHash(evidence)||!matchesContent(row.title,evidence))evidence={};
      const key='trend:channel-'+row.video_id,topicSource=channel.topic==='news'?research?.get(key):null,ready=topicSource?.evidenceReady===true;
      const age=Math.max(1,(now()-row.published_at)/HOUR);
      items.push({key:'youtube:'+row.video_id,title:row.title,topic:channel.topic,channelName:channel.name,publishedAt:iso(row.published_at),url:row.url,views:row.views,popularityScore:row.views===null?null:Math.round(row.views/age*100)/100,sourceStatus:ready?'evidence_ready':evidence.sourceUrl?'text_ready':channel.topic==='news'?'research_pending':'discovery_only',editorUrl:ready?'/admin-web-stories.html?source='+encodeURIComponent(key):null,sourceLinks,evidence:evidence.sourceUrl?evidence:null});
    }
    if(sort==='views')items.sort((a,b)=>(b.views??-1)-(a.views??-1)||b.publishedAt.localeCompare(a.publishedAt));
    if(sort==='popular')items.sort((a,b)=>(b.popularityScore??-1)-(a.popularityScore??-1)||b.publishedAt.localeCompare(a.publishedAt));
    const last=latest(),busy=!!pending||state().some(row=>row.lease_until>now()),reason=closed?'closed':!canRun()?'global_paused':busy?'busy':last&&last+HOUR>now()?'cooldown':'ready';
    return {channels,items:items.slice(skip,skip+take),offset:skip,limit:take,total:items.length,nextOffset:skip+take<items.length?skip+take:null,busy,nextAt:iso(last?last+HOUR:0),lastCheckedAt:iso(last),controls:{canSync:reason==='ready',reason,nextAt:iso(last?last+HOUR:0)}};
  }
  async function collect({signal,isCurrent=()=>true}={}){
    const current=()=>!closed&&canRun()&&!signal?.aborted&&isCurrent(),checkpoint=()=>{if(!current())throw fail('feed_aborted');};
    for(const channel of EDITORIAL_CHANNELS){
      if(!current())break;
      const stamp=now(),claimed=db.prepare('UPDATE editorial_channel_sync SET last_checked_at=?,lease_until=? WHERE id=? AND lease_until<=? AND (last_checked_at=0 OR last_checked_at<=?)').run(stamp,stamp+30000,channel.id,stamp,stamp-HOUR).changes;if(!claimed)continue;
      try{
        const xml=await fetchEditorialFeed(channel.feedUrl,{signal,fetchImpl});checkpoint();const rows=parseEditorialChannelFeed(xml,channel,{now:now()});
        db.transaction(()=>{checkpoint();for(const item of rows){const old=db.prepare('SELECT channel_key FROM editorial_channel_items WHERE video_id=?').get(item.videoId);if(old&&old.channel_key!==channel.id)throw fail('feed_identity_mismatch');db.prepare(`INSERT INTO editorial_channel_items(video_id,channel_key,title,url,published_at,views,source_links_json,first_seen_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(video_id) DO UPDATE SET title=excluded.title,views=excluded.views,source_links_json=excluded.source_links_json,evidence_json=CASE WHEN title<>excluded.title OR source_links_json<>excluded.source_links_json THEN '{}' ELSE evidence_json END,evidence_checked_at=CASE WHEN title<>excluded.title OR source_links_json<>excluded.source_links_json THEN 0 ELSE evidence_checked_at END,updated_at=excluded.updated_at`).run(item.videoId,channel.id,item.title,item.url,item.publishedAt,item.views,JSON.stringify(item.sourceLinks),stamp,stamp);}
          db.prepare('DELETE FROM editorial_channel_items WHERE channel_key=? AND video_id NOT IN (SELECT video_id FROM editorial_channel_items WHERE channel_key=? ORDER BY published_at DESC,video_id LIMIT 100)').run(channel.id,channel.id);
          db.prepare("UPDATE editorial_channel_sync SET status=?,error_code='',items_count=?,last_success_at=?,lease_until=0 WHERE id=? AND last_checked_at=?").run(rows.length?'ready':'empty',rows.length,stamp,channel.id,stamp);
        }).immediate();
        if(channel.topic==='news')for(const item of rows.slice(0,3)){checkpoint();research?.addDiscoveredTopic?.({id:'channel-'+item.videoId,title:item.title,publishedAt:new Date(item.publishedAt).toISOString(),group:'news',refs:item.sourceLinks.map(url=>({url,title:item.title}))},{isCurrent:current});}
        if(channel.topic!=='news')for(const item of rows.filter(item=>item.sourceLinks.length||channel.topic==='gardening').slice(0,1)){
          const stored=db.prepare('SELECT evidence_checked_at,source_links_json FROM editorial_channel_items WHERE video_id=?').get(item.videoId);if(stored.evidence_checked_at>now()-24*HOUR)continue;
          let url=item.sourceLinks[0];try{checkpoint();let content;
            try{if(!url)throw fail('research_no_article');const html=await fetchStoryResearchText(url,{signal,fetchImpl});checkpoint();if(channel.topic==='recipes')content=extractStoryRecipe(html,url);else{const article=extractStoryResearchArticle(html);content={kind:'article',title:article.title,text:article.excerpt,publishedAt:article.publishedAt,excerptOnly:true};}}catch{checkpoint();if(channel.topic!=='gardening')throw fail('research_no_article');content=await research?.findGardeningSource?.(item.title,{signal,isCurrent:current});checkpoint();if(!content)throw fail('research_no_article');url=content.sourceUrl;}
            if(!matchesContent(item.title,content))throw fail('research_topic_mismatch');
            const evidence={...content,sourceUrl:url,checkedAt:new Date(now()).toISOString(),contentHash:contentHash(content)};
            db.transaction(()=>{checkpoint();db.prepare('UPDATE editorial_channel_items SET evidence_json=?,evidence_checked_at=? WHERE video_id=? AND title=? AND source_links_json=?').run(JSON.stringify(evidence),now(),item.videoId,item.title,stored.source_links_json);}).immediate();
          }catch{checkpoint();}
        }
      }catch(error){const codes=['feed_invalid','feed_identity_mismatch','feed_too_large','feed_timeout','feed_aborted'];db.prepare("UPDATE editorial_channel_sync SET status='error',error_code=?,lease_until=0 WHERE id=? AND last_checked_at=?").run(codes.includes(error.code)?error.code:'feed_unavailable',channel.id,stamp);if(!current())break;}
    }
  }
  function sync(options={}){if(pending||closed||!canRun())return pending||Promise.resolve(snapshot());pending=collect(options).finally(()=>{pending=null;});return pending;}
  return {snapshot,sync,close(){closed=true;},lastCheckedAt:()=>latest()};
}
