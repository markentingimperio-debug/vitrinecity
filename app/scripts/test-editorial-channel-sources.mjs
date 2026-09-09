import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {EDITORIAL_CHANNELS,editorialFeedUrl,parseEditorialChannelFeed,fetchEditorialFeed,createEditorialChannelSources} from '../editorial-channel-sources.js';
import {createWebStoryResearch} from '../web-story-research.js';

const clock=Date.parse('2026-09-09T19:00:00Z'),recipeUrl='https://panelinha.com.br/receita/bolo-de-cenoura';
const response=(text,type='text/xml')=>new Response(text,{headers:{'content-type':type}});
const video=index=>'video'+String(index).padStart(6,'0');
const entry=(channel,{index=1,title='Bolo de cenoura',description='',date=new Date(clock-3600000).toISOString(),views='120',suffix=true}={})=>`<entry><id>yt:video:${video(index)}</id><yt:videoId>${video(index)}</yt:videoId><yt:channelId>${suffix?channel.channelId.slice(2):channel.channelId}</yt:channelId><title>${title}</title><published>${date}</published><media:group><media:description>${description}</media:description><media:community><media:statistics views="${views}"/></media:community></media:group></entry>`;
const feed=(channel,items=[],suffix=true)=>`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015"><id>yt:channel:${suffix?channel.channelId.slice(2):channel.channelId}</id><yt:channelId>${suffix?channel.channelId.slice(2):channel.channelId}</yt:channelId><title>${channel.name}</title>${items.join('')}</feed>`;
const recipe=()=>'<script type="application/ld+json">'+JSON.stringify({'@type':'Recipe',name:'Bolo de cenoura',recipeIngredient:['3 cenouras médias','3 ovos','2 xícaras de farinha'],recipeInstructions:[{ '@type':'HowToStep',text:'Bata as cenouras e os ovos até obter uma mistura homogênea, transfira para a tigela e adicione a farinha com cuidado.'},{'@type':'HowToStep',text:'Misture delicadamente a massa do bolo de cenoura, coloque na forma preparada e asse até que o centro esteja firme e o palito saia limpo.'}]})+'</script>';
function fixture({paused=false,respond,research}={}){
  const db=new Database(':memory:');let time=clock,allowed=!paused;const calls=[];
  const fetchImpl=async(url,options)=>{calls.push({url,options});assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.headers.authorization,undefined);const channel=EDITORIAL_CHANNELS.find(c=>c.feedUrl===url);return await respond?.(url,channel,options)||response(feed(channel));};
  const channels=createEditorialChannelSources({db,now:()=>time,canRun:()=>allowed,fetchImpl,research});return {db,channels,calls,fetchImpl,advance:n=>time+=n,pause:()=>allowed=false,close:()=>{channels.close();db.close();}};
}
test('four official Atom identities accept exact full or suffix IDs and preserve metadata without invented views',()=>{
  for(const channel of EDITORIAL_CHANNELS)for(const suffix of [true,false]){
    const rows=parseEditorialChannelFeed(feed(channel,[entry(channel,{suffix,title:'Bolo &amp; cenoura',views:'0'}),entry(channel,{index:2,views:'not-a-number'})],suffix),channel,{now:clock});
    assert.equal(rows.length,2);assert.equal(rows[0].title,'Bolo & cenoura');assert.equal(rows[0].views,0);assert.equal(rows[1].views,null);assert.equal(rows[0].publishedAt,clock-3600000);assert.equal(rows[0].url,'https://www.youtube.com/watch?v=video000001');
  }
});
test('tampered channel, XML entities, invalid identity, old/future and duplicate entries fail closed',()=>{
  const c=EDITORIAL_CHANNELS[0],xml=feed(c,[entry(c)]);
  assert.throws(()=>parseEditorialChannelFeed(xml.replaceAll(c.channelId.slice(2),'X'.repeat(22)),c,{now:clock}),/feed_identity_mismatch/);
  assert.throws(()=>parseEditorialChannelFeed(feed(c,[entry(EDITORIAL_CHANNELS[1])]),c,{now:clock}),/feed_identity_mismatch/);
  assert.throws(()=>parseEditorialChannelFeed(xml.replace('<feed','<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///private">]><feed'),c,{now:clock}),/feed_invalid/);
  assert.throws(()=>parseEditorialChannelFeed('x'.repeat(524289),c,{now:clock}),/feed_too_large/);
  const rows=parseEditorialChannelFeed(feed(c,[entry(c),entry(c),entry(c,{index:2,date:'2020-01-01'}),entry(c,{index:3,date:new Date(clock+3600000).toISOString()})]),c,{now:clock});assert.equal(rows.length,1);
});
test('description links only pair with the known publisher; no credentials, offsite media or redirect endpoints',()=>{
  const c=EDITORIAL_CHANNELS[2];const rows=parseEditorialChannelFeed(feed(c,[entry(c,{description:`${recipeUrl}. https://evil.test/receita/x https://panelinha.com.br.evil.test/receita/x https://panelinha.com.br/receita/x.jpg https://www.youtube.com/redirect?q=${recipeUrl}`})]),c,{now:clock});assert.deepEqual(rows[0].sourceLinks,[recipeUrl]);
  for(const bad of ['https://127.0.0.1/feed',c.feedUrl+'&extra=1',c.feedUrl.replace('www.youtube.com','www.youtube.com.evil.test'),c.feedUrl.replace('https:','http:')])assert.equal(editorialFeedUrl(bad),'');
});
test('fixed feed fetches are GET only, bounded, no redirects or authorization',async()=>{
  const c=EDITORIAL_CHANNELS[0];let count=0;
  await assert.rejects(fetchEditorialFeed('https://127.0.0.1',{fetchImpl:async()=>count++}),/feed_origin_denied/);assert.equal(count,0);
  const output=await fetchEditorialFeed(c.feedUrl,{fetchImpl:async(url,options)=>{assert.equal(url,c.feedUrl);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.deepEqual(Object.keys(options.headers),['accept']);return response(feed(c));}});assert.match(output,/<feed/);
  await assert.rejects(fetchEditorialFeed(c.feedUrl,{fetchImpl:async()=>new Response('redirect',{status:302,headers:{'content-type':'text/xml',location:'https://127.0.0.1'}})}),/feed_unavailable/);
  await assert.rejects(fetchEditorialFeed(c.feedUrl,{fetchImpl:async()=>response('x'.repeat(524289))}),/feed_too_large/);
  const controller=new AbortController();controller.abort();assert.throws(()=>fetchEditorialFeed(c.feedUrl,{signal:controller.signal,fetchImpl:async()=>count++}),/feed_aborted/);assert.equal(count,0);
});
test('snapshot is read only, empty differs from failure, hourly singleflight and restart preserve cooldown',async()=>{
  const x=fixture({respond:(_url,c)=>c.id==='bbc-brasil'?response('<invalid/>'):undefined});const before=x.db.prepare('SELECT total_changes() n').get().n;
  assert.equal(x.channels.snapshot().channels[0].status,'never');assert.equal(x.channels.snapshot().controls.canSync,true);assert.equal(x.db.prepare('SELECT total_changes() n').get().n,before);
  const first=x.channels.sync(),second=x.channels.sync();assert.equal(first,second);await first;assert.equal(x.calls.length,4);
  const state=x.channels.snapshot();assert.equal(state.channels[0].status,'empty');assert.equal(state.channels[1].status,'error');assert.equal(state.channels[1].errorCode,'feed_invalid');assert.equal(state.controls.reason,'cooldown');
  const restarted=createEditorialChannelSources({db:x.db,now:()=>clock,fetchImpl:x.fetchImpl});await restarted.sync();assert.equal(x.calls.length,4);restarted.close();x.close();
});
test('pausing during a deferred feed or closing prevents ingestion and further channel requests',async()=>{
  let resolve;const deferred=new Promise(done=>resolve=done);const x=fixture({respond:(_url,c)=>c.id==='tv-brasil'?deferred:undefined});
  const pending=x.channels.sync();x.pause();resolve(response(feed(EDITORIAL_CHANNELS[0],[entry(EDITORIAL_CHANNELS[0])])));await pending;
  assert.equal(x.calls.length,1);assert.equal(x.channels.snapshot().total,0);assert.equal(x.channels.snapshot().controls.reason,'global_paused');await x.channels.sync();assert.equal(x.calls.length,1);x.close();
  const y=fixture();y.channels.close();await y.channels.sync();assert.equal(y.calls.length,0);assert.equal(y.channels.snapshot().controls.reason,'closed');y.db.close();
});
test('public recipe is exact paired text for manual review; no Story, article or quota is created',async()=>{
  const x=fixture({respond:(url,c)=>c?response(feed(c,c.id==='panelinha'?[entry(c,{index:2,description:recipeUrl})]:[])):response(recipe(),'text/html')});await x.channels.sync();
  const item=x.channels.snapshot().items[0];assert.equal(item.sourceStatus,'text_ready');assert.equal(item.editorUrl,null);assert.equal(item.evidence.sourceUrl,recipeUrl);assert.equal(item.evidence.ingredients.length,3);assert.equal(item.evidence.steps.length,2);assert.match(item.evidence.contentHash,/^[a-f0-9]{64}$/);
  assert.equal(x.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('web_stories','editorial_articles','web_story_automation_jobs')").get().n,0);x.close();
});
test('unrelated recipe or changed video title cannot retain a ready association',async()=>{
  let changed=false;const x=fixture({respond:(url,c)=>c?response(feed(c,c.id==='panelinha'?[entry(c,{index:2,title:changed?'Salada de frango e legumes':'Bolo de cenoura',description:recipeUrl})]:[])):response(recipe(),'text/html')});await x.channels.sync();assert.equal(x.channels.snapshot().items[0].sourceStatus,'text_ready');
  changed=true;x.advance(3600001);await x.channels.sync();assert.equal(x.channels.snapshot().items[0].sourceStatus,'discovery_only');assert.equal(x.channels.snapshot().items[0].evidence,null);
  x.db.prepare("UPDATE editorial_channel_items SET evidence_json=? WHERE video_id=?").run(JSON.stringify({sourceUrl:recipeUrl,title:'Bolo de cenoura',ingredients:['cenoura'],steps:['preparo'],contentHash:'a'.repeat(64)}),video(2));assert.equal(x.channels.snapshot().items[0].sourceStatus,'discovery_only');x.close();
});
test('news metadata becomes a pending topic, not fetched evidence; query, sorting and bounded pagination are literal',async()=>{
  const db=new Database(':memory:');const research=createWebStoryResearch({db,now:()=>clock,requirePreparedEvidence:true,fetchImpl:async()=>{throw Error('no source read in metadata collection');}});
  const channels=createEditorialChannelSources({db,research,now:()=>clock,fetchImpl:async url=>{const c=EDITORIAL_CHANNELS.find(c=>c.feedUrl===url);return response(feed(c,c.id==='tv-brasil'?[entry(c,{index:1,title:'Banco Central e juros',views:'10'}),entry(c,{index:2,title:'Inflação e Banco Central',views:'200'})]:[]));}});await channels.sync();
  assert.equal(research.list().length,2);assert.equal(research.list({automatic:true}).length,0);const state=channels.snapshot({q:'Banco',sort:'views',limit:1});assert.equal(state.total,2);assert.equal(state.nextOffset,1);assert.equal(state.items[0].views,200);assert.equal(state.items[0].sourceStatus,'research_pending');assert.equal(state.items[0].editorUrl,null);assert.equal(channels.snapshot({topic:'recipes'}).total,0);channels.close();db.close();
});
