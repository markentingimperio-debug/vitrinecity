import assert from 'node:assert/strict';
import {
  externalMetricsProviderStatus,
  fetchMetaAggregatedInsights,
  fetchYouTubeAggregatedInsights,
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

console.log('external-social-metrics: ok');
