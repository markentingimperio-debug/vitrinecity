import assert from 'node:assert/strict';
import {
  externalMetricsProviderStatus,
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
assert.equal(statuses.find(provider => provider.id === 'instagram').implemented, false);

await assert.rejects(
  fetchYouTubeAggregatedInsights({
    apiKey: 'do-not-leak',
    channelId: 'UC_TEST',
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: 'do-not-leak' }) })
  }),
  error => error.message === 'youtube_api_403' && !error.message.includes('do-not-leak')
);

console.log('external-social-metrics: ok');
