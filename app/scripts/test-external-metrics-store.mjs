import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createExternalMetricsStore,createYouTubeMetricsSync,ACTIVE_EXTERNAL_METRICS_SQL} from '../external-metrics-store.js';
import {fetchYouTubeAggregatedInsights} from '../external-social-metrics.js';

const A='UC'+'A'.repeat(22),B='UCPN5ciXL85GdPGNjpWRIqrA';
function fixture(t){
  const db=new Database(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE social_external_insights(provider TEXT,content_key TEXT,category TEXT DEFAULT 'geral',views INTEGER DEFAULT 0,watch_ms INTEGER DEFAULT 0,completions INTEGER DEFAULT 0,likes INTEGER DEFAULT 0,comments INTEGER DEFAULT 0,shares INTEGER DEFAULT 0,clicks INTEGER DEFAULT 0,conversions INTEGER DEFAULT 0,measured_at TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(provider,content_key));
    CREATE TABLE social_external_sync_runs(id INTEGER PRIMARY KEY,provider TEXT,trigger_type TEXT,status TEXT,imported_count INTEGER DEFAULT 0,error_code TEXT DEFAULT '',started_at TEXT DEFAULT CURRENT_TIMESTAMP,finished_at TEXT);`);
  for(let i=0;i<34;i++)db.prepare("INSERT INTO social_external_insights(provider,content_key,views) VALUES ('youtube',?,100)").run('legacy-'+i);
  const before=db.prepare('SELECT * FROM social_external_insights ORDER BY content_key').all(),state={channelId:A};
  const store=createExternalMetricsStore({db,getYouTubeChannelId:()=>state.channelId});
  const totals=()=>db.prepare(`SELECT provider,SUM(views) views FROM social_external_insights WHERE ${ACTIVE_EXTERNAL_METRICS_SQL} GROUP BY provider`).all(store.activeChannelId());
  return {db,store,state,before,totals};
}
const item=(contentKey,views=10)=>({contentKey,views,measuredAt:'2026-09-09T18:00:00Z'});

test('additive migration preserves all 34 legacy rows and never attributes them to the new channel',t=>{
  const f=fixture(t),after=f.db.prepare('SELECT * FROM social_external_insights ORDER BY content_key').all();
  assert.deepEqual(after.map(({channel_id,...row})=>row),f.before);assert(after.every(row=>row.channel_id===''));
  assert.deepEqual(f.totals(),[]);assert.deepEqual(f.store.youtubeScope().history,{unscopedContents:34,otherChannelContents:0});
  createExternalMetricsStore({db:f.db,getYouTubeChannelId:()=>B});assert.equal(f.db.prepare('SELECT COUNT(*) n FROM social_external_insights').get().n,34);
});
test('switch A to B scopes every metric while retaining both histories and other providers',t=>{
  const f=fixture(t);f.store.persist('youtube',[item('a',100)],{channelId:A});f.store.persist('youtube',[item('b',900)],{channelId:B});
  for(const provider of ['facebook','instagram','google','tiktok','kwai'])f.store.persist(provider,[item('shared',5)]);
  assert.equal(f.totals().find(x=>x.provider==='youtube').views,100);f.state.channelId=B;
  assert.equal(f.totals().find(x=>x.provider==='youtube').views,900);assert.equal(f.totals().filter(x=>x.provider!=='youtube').length,5);
  assert.deepEqual(f.store.youtubeScope().history,{unscopedContents:34,otherChannelContents:1});assert.equal(f.store.youtubeScope().lastSync,null);
  f.state.channelId='invalid';assert.equal(f.totals().some(x=>x.provider==='youtube'),false);assert.equal(f.store.youtubeScope().channelId,null);
});
test('manual import cannot overwrite official YouTube metrics or attach unverified data to the active scope',t=>{
  const f=fixture(t);f.store.persist('youtube',[item('official',10)],{channelId:A});
  assert.equal(f.store.persist('youtube',[item('official',999)]),0);assert.equal(f.store.persist('youtube',[item('new-manual',600)]),1);
  assert.equal(f.totals().find(x=>x.provider==='youtube').views,10);
  assert.equal(f.store.persist('youtube',[item('official',999)],{channelId:B}),0);
  assert.equal(f.store.persist('facebook',[item('normal',1)]),1);assert.equal(f.store.persist('facebook',[item('normal',2)]),1);
  assert.equal(f.db.prepare("SELECT views FROM social_external_insights WHERE provider='facebook'").get().views,2);
});
test('sync captures the official channel, coalesces same-account reads and keeps truthful run metadata',async t=>{
  const f=fixture(t);let calls=0;
  const sync=createYouTubeMetricsSync({db:f.db,store:f.store,getConfig:()=>({configured:true,channelId:f.state.channelId}),fetchInsights:async config=>{calls++;return {channelId:config.channelId,channelTitle:'Canal ativo',items:[item('verified')]};}});
  const results=await Promise.all([sync(),sync()]);assert.equal(calls,1);assert.equal(results[0].channelId,A);
  const scope=f.store.youtubeScope();assert.equal(scope.lastSync.status,'completed');assert.equal(scope.lastSync.importedCount,1);assert.equal(scope.channelTitle,'Canal ativo');
  assert.equal(f.db.prepare("SELECT channel_id FROM social_external_sync_runs").get().channel_id,A);
});
test('change of channel during a collection cannot finish or import as the newly selected account',async t=>{
  const f=fixture(t);let release,calls=0;
  const sync=createYouTubeMetricsSync({db:f.db,store:f.store,getConfig:()=>({configured:true,channelId:f.state.channelId}),fetchInsights:config=>{calls++;return new Promise(resolve=>{release=()=>resolve({channelId:config.channelId,channelTitle:'Canal antigo',items:[item('old',100)]});});}});
  const first=sync();await new Promise(resolve=>setImmediate(resolve));f.state.channelId=B;
  await assert.rejects(sync(),/youtube_channel_sync_in_progress/);release();await assert.rejects(first,/youtube_channel_changed/);
  assert.equal(calls,1);assert.deepEqual(f.totals(),[]);assert.equal(f.store.youtubeScope().lastSync,null);
  const old=f.db.prepare('SELECT * FROM social_external_sync_runs').get();assert.equal(old.channel_id,A);assert.equal(old.status,'failed');
});
test('a returned channel mismatch fails without metrics; provider error strings do not leak',async t=>{
  const f=fixture(t),sync=createYouTubeMetricsSync({db:f.db,store:f.store,getConfig:()=>({configured:true,channelId:A}),fetchInsights:async()=>({channelId:B,items:[item('wrong')]})});
  await assert.rejects(sync(),/youtube_channel_mismatch/);assert.deepEqual(f.totals(),[]);
  const leaking=createYouTubeMetricsSync({db:f.db,store:f.store,getConfig:()=>({configured:true,channelId:A}),fetchInsights:async()=>{throw Error('PRIVATE_API_KEY');}});
  await assert.rejects(leaking(),error=>error.message==='youtube_sync_failed');assert(!JSON.stringify(f.db.prepare('SELECT * FROM social_external_sync_runs').all()).includes('PRIVATE'));
});
test('official collector checks channel identity and video ownership and excludes missing videos',async()=>{
  let wrongChannel=false,wrongOwner=false,calls=[];
  const fetchImpl=async input=>{const url=new URL(input);calls.push(url);const endpoint=url.pathname.split('/').pop();
    const data=endpoint==='channels'?{items:[{id:wrongChannel?B:A,snippet:{title:'Fixture'},contentDetails:{relatedPlaylists:{uploads:'playlist-fixture'}}}]}:endpoint==='playlistItems'?{items:[{contentDetails:{videoId:'one'}},{contentDetails:{videoId:'missing'}}]}:{items:[{id:'one',snippet:{channelId:wrongOwner?B:A},statistics:{viewCount:100}}]};return {ok:true,json:async()=>data};};
  const args={apiKey:'PRIVATE_API_KEY',channelId:A,fetchImpl};
  const result=await fetchYouTubeAggregatedInsights(args);assert.equal(result.items.length,1);assert.equal(result.channelId,A);assert.equal(calls.at(-1).searchParams.get('part'),'snippet,statistics');
  wrongChannel=true;calls=[];await assert.rejects(fetchYouTubeAggregatedInsights(args),/youtube_channel_mismatch/);assert.equal(calls.length,1);
  wrongChannel=false;wrongOwner=true;await assert.rejects(fetchYouTubeAggregatedInsights(args),/youtube_video_channel_mismatch/);
  assert(!JSON.stringify(result).includes('PRIVATE_API_KEY'));
});
