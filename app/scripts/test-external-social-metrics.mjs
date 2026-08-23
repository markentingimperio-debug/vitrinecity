import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  externalMetricsProviderStatus,
  fetchGoogleSearchAggregatedInsights,
  fetchKwaiAggregatedInsights,
  fetchMetaAggregatedInsights,
  fetchTikTokAggregatedInsights,
  fetchYouTubeAggregatedInsights,
  googleSearchMetricsConfig,
  kwaiMetricsConfig,
  tiktokMetricsConfig,
  youtubeMetricsConfig
} from '../external-social-metrics.js';

const requests = [];
const mockFetch = async input => {
  const url = new URL(input);
  requests.push(url);
  const path = url.pathname.split('/').pop();
  if (path === 'channels') return {
    ok: true,
    status: 200,
    json: async () => ({ items: [{ snippet: { title: 'Vitrine City' },
      contentDetails: { relatedPlaylists: { uploads: 'UU_TEST' } } }] })
  };
  if (path === 'playlistItems' && !url.searchParams.get('pageToken')) return {
    ok: true,
    status: 200,
    json: async () => ({ nextPageToken: 'page-2', items: [
      { contentDetails: { videoId: 'video-1' } },
      { contentDetails: { videoId: 'video-2' } }
    ] })
  };
  if (path === 'playlistItems') return {
    ok: true,
    status: 200,
    json: async () => ({ items: [{ contentDetails: { videoId: 'video-3' } }] })
  };
  if (path === 'videos') return {
    ok: true,
    status: 200,
    json: async () => ({ items: [
      { id: 'video-1', statistics: { viewCount: '120', likeCount: '15', commentCount: '3' } },
      { id: 'video-2', statistics: { viewCount: '80', likeCount: '7' } }
    ] })
  };
  throw new Error('unexpected_request');
};

const result = await fetchYouTubeAggregatedInsights({
  apiKey: 'secret-api-key',
  channelId: 'UC_TEST',
  fetchImpl: mockFetch,
  measuredAt: '2026-08-23T12:00:00.000Z'
});
assert.equal(result.provider, 'youtube');
assert.equal(result.channelTitle, 'Vitrine City');
assert.equal(result.items.length, 3);
assert.deepEqual(result.items[0], {
  contentKey: 'video-1', category: 'geral', views: 120, watchMs: 0, completions: 0,
  likes: 15, comments: 3, shares: 0, clicks: 0, conversions: 0,
  measuredAt: '2026-08-23T12:00:00.000Z'
});
assert.equal(result.items[2].views, 0);
assert.equal(requests.filter(url => url.pathname.endsWith('/playlistItems')).length, 2);
assert.equal(requests.filter(url => url.pathname.endsWith('/videos')).length, 1);
assert(requests.every(url => url.searchParams.get('key') === 'secret-api-key'));

const config = youtubeMetricsConfig({
  YOUTUBE_API_KEY: 'key',
  YOUTUBE_CHANNEL_ID: 'channel',
  SOCIAL_METRICS_AUTO_SYNC: 'true',
  SOCIAL_METRICS_SYNC_INTERVAL_HOURS: '1',
  YOUTUBE_METRICS_MAX_VIDEOS: '999'
});
assert.equal(config.configured, true);
assert.equal(config.autoSync, true);
assert.equal(config.intervalHours, 6);
assert.equal(config.maxVideos, 500);
const statuses = externalMetricsProviderStatus({ YOUTUBE_API_KEY: 'key', YOUTUBE_CHANNEL_ID: 'channel' });
assert.equal(statuses.find(provider => provider.id === 'youtube').configured, true);
assert.equal(statuses.find(provider => provider.id === 'instagram').implemented, true);
assert.equal(externalMetricsProviderStatus({}, { facebook:true }).find(provider => provider.id === 'facebook').configured, true);
assert.equal(tiktokMetricsConfig({TIKTOK_CONTENT_ACCESS_TOKEN:'token',TIKTOK_METRICS_MAX_VIDEOS:'900'}).maxVideos,500);
assert.equal(externalMetricsProviderStatus({TIKTOK_CONTENT_ACCESS_TOKEN:'token'}).find(provider=>provider.id==='tiktok').configured,true);
assert.equal(googleSearchMetricsConfig({GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN:'token',GOOGLE_SEARCH_CONSOLE_SITE_URL:'sc-domain:vitrinecity.com'}).configured,true);
assert.equal(externalMetricsProviderStatus({GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN:'token',GOOGLE_SEARCH_CONSOLE_SITE_URL:'sc-domain:vitrinecity.com'}).find(provider=>provider.id==='google').configured,true);
assert.equal(kwaiMetricsConfig({KWAI_APP_ID:'app',KWAI_ACCESS_TOKEN:'token',KWAI_METRICS_MAX_VIDEOS:'800'}).maxVideos,500);
assert.equal(externalMetricsProviderStatus({KWAI_APP_ID:'app',KWAI_ACCESS_TOKEN:'token'}).find(provider=>provider.id==='kwai').configured,true);

const kwaiRequests=[];
const kwaiResult=await fetchKwaiAggregatedInsights({appId:'kwai-app',accessToken:'kwai-secret',maxVideos:3,
  measuredAt:'2026-08-23T18:00:00.000Z',fetchImpl:async input=>{const url=new URL(input);kwaiRequests.push(url);
    return {ok:true,status:200,json:async()=>url.searchParams.has('cursor')?
      ({result:1,video_list:[{photo_id:'kw-2',view_count:200,like_count:11,comment_count:3}]}):
      ({result:1,last_cursor:'next-1',video_list:[{photo_id:'kw-1',view_count:400,like_count:25,comment_count:7}]})};
  }});
assert.equal(kwaiResult.items.length,2);
assert.equal(kwaiResult.items[0].views,400);
assert.equal(kwaiResult.items[1].comments,3);
assert.equal(kwaiRequests[1].searchParams.get('cursor'),'next-1');
assert(kwaiRequests.every(url=>url.searchParams.get('app_id')==='kwai-app'&&url.searchParams.get('access_token')==='kwai-secret'));

await assert.rejects(fetchKwaiAggregatedInsights({appId:'app',accessToken:'do-not-leak',
  fetchImpl:async()=>({ok:false,status:401,json:async()=>({error:'do-not-leak'})})}),
  error=>error.message==='kwai_api_401'&&!error.message.includes('do-not-leak'));

let googleRequest;
const googleResult=await fetchGoogleSearchAggregatedInsights({accessToken:'google-secret',siteUrl:'sc-domain:vitrinecity.com',
  measuredAt:'2026-08-23T17:00:00.000Z',lookbackDays:28,fetchImpl:async(input,options)=>{googleRequest={url:new URL(input),options};
    return {ok:true,status:200,json:async()=>({rows:[{keys:['https://vitrinecity.com/social'],clicks:32,impressions:900,ctr:.0355,position:7.2}]})};
  }});
assert.equal(googleResult.startDate,'2026-07-26');
assert.equal(googleResult.endDate,'2026-08-22');
assert.equal(googleResult.items[0].views,900);
assert.equal(googleResult.items[0].clicks,32);
assert.equal(googleRequest.options.headers.authorization,'Bearer google-secret');
assert.deepEqual(JSON.parse(googleRequest.options.body).dimensions,['page']);
assert(googleRequest.url.pathname.includes(encodeURIComponent('sc-domain:vitrinecity.com')));

await assert.rejects(fetchGoogleSearchAggregatedInsights({accessToken:'do-not-leak',siteUrl:'sc-domain:vitrinecity.com',
  fetchImpl:async()=>({ok:false,status:403,json:async()=>({error:'do-not-leak'})})}),
  error=>error.message==='google_api_403'&&!error.message.includes('do-not-leak'));

const tiktokRequests=[];
const tiktokResult=await fetchTikTokAggregatedInsights({accessToken:'tiktok-secret',maxVideos:3,
  measuredAt:'2026-08-23T16:00:00.000Z',fetchImpl:async(input,options)=>{tiktokRequests.push({url:new URL(input),options});
    const body=JSON.parse(options.body);return {ok:true,status:200,json:async()=>body.cursor===undefined?
      ({data:{videos:[{id:'tt-1',view_count:500,like_count:40,comment_count:8,share_count:6}],has_more:true,cursor:77},error:{code:'ok'}}):
      ({data:{videos:[{id:'tt-2',view_count:300,like_count:20,comment_count:4,share_count:2}],has_more:false},error:{code:'ok'}})};
  }});
assert.equal(tiktokResult.items.length,2);
assert.equal(tiktokResult.items[0].views,500);
assert.equal(tiktokResult.items[1].shares,2);
assert.equal(JSON.parse(tiktokRequests[1].options.body).cursor,77);
assert.equal(tiktokRequests[0].options.headers.authorization,'Bearer tiktok-secret');
assert(tiktokRequests.every(request=>request.url.searchParams.get('fields').includes('view_count')));

await assert.rejects(fetchTikTokAggregatedInsights({accessToken:'do-not-leak',
  fetchImpl:async()=>({ok:false,status:401,json:async()=>({error:'do-not-leak'})})}),
  error=>error.message==='tiktok_api_401'&&!error.message.includes('do-not-leak'));

const metaRequests=[];
const metaResult=await fetchMetaAggregatedInsights({accounts:[{pageId:'page-1',instagramId:'ig-1',accessToken:'private-token'}],
  measuredAt:'2026-08-23T15:00:00.000Z',fetchImpl:async input=>{const url=new URL(input);metaRequests.push(url);
    if(url.pathname.endsWith('/page-1/posts'))return {ok:true,status:200,json:async()=>({data:[{id:'post-1',
      reactions:{summary:{total_count:9}},comments:{summary:{total_count:2}},shares:{count:3},insights:{data:[
        {name:'post_impressions',values:[{value:120}]},{name:'post_clicks',values:[{value:7}]}]}}]})};
    if(url.pathname.endsWith('/ig-1/media'))return {ok:true,status:200,json:async()=>({data:[{id:'media-1',
      like_count:12,comments_count:4,insights:{data:[{name:'views',values:[{value:80}]},{name:'reach',values:[{value:60}]},
        {name:'shares',values:[{value:5}]}]}}]})};
    throw new Error('unexpected_meta_request');
  }});
assert.equal(metaResult.facebook[0].views,120);
assert.equal(metaResult.facebook[0].clicks,7);
assert.equal(metaResult.instagram[0].views,80);
assert.equal(metaResult.instagram[0].shares,5);
assert(metaRequests.every(url=>url.searchParams.get('access_token')==='private-token'));

await assert.rejects(fetchMetaAggregatedInsights({accounts:[{pageId:'p',accessToken:'do-not-leak'}],
  fetchImpl:async()=>({ok:false,status:403,json:async()=>({error:'do-not-leak'})})}),
  error=>error.message==='meta_api_403'&&!error.message.includes('do-not-leak'));

await assert.rejects(
  fetchYouTubeAggregatedInsights({
    apiKey: 'do-not-leak',
    channelId: 'UC_TEST',
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: 'do-not-leak' }) })
  }),
  error => error.message === 'youtube_api_403' && !error.message.includes('do-not-leak')
);

const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const panel=fs.readFileSync(new URL('../public/admin-intelligence.html',import.meta.url),'utf8');
assert.match(server,/CREATE TABLE IF NOT EXISTS google_search_oauth/);
assert.match(server,/webmasters\.readonly/);
assert.match(server,/access_type:'offline'/);
assert.match(server,/google_search_oauth_states/);
assert.match(server,/activeGoogleSearchAccessToken/);
assert.match(server,/grant_type:'refresh_token'/);
assert.match(server,/encryptGoogleSearchToken\(payload\.refresh_token\)/);
assert.match(panel,/Conectar Google/);

console.log('external-social-metrics: ok');
