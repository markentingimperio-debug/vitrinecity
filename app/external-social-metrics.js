export const OFFICIAL_METRIC_PROVIDERS = Object.freeze([
  { id: 'instagram', label: 'Instagram', implemented: false },
  { id: 'facebook', label: 'Facebook', implemented: false },
  { id: 'tiktok', label: 'TikTok', implemented: false },
  { id: 'youtube', label: 'YouTube', implemented: true },
  { id: 'google', label: 'Google', implemented: false },
  { id: 'kwai', label: 'Kwai', implemented: false }
]);

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function metricCount(value) {
  const number = Math.round(Number(value) || 0);
  return Math.max(0, Math.min(1e12, number));
}

export function youtubeMetricsConfig(env = process.env) {
  const apiKey = String(env.YOUTUBE_API_KEY || '').trim();
  const channelId = String(env.YOUTUBE_CHANNEL_ID || '').trim();
  const intervalHours = boundedInteger(env.SOCIAL_METRICS_SYNC_INTERVAL_HOURS, 24, 6, 168);
  return {
    apiKey,
    channelId,
    configured: Boolean(apiKey && channelId),
    autoSync: enabled(env.SOCIAL_METRICS_AUTO_SYNC),
    maxVideos: boundedInteger(env.YOUTUBE_METRICS_MAX_VIDEOS, 200, 1, 500),
    intervalHours,
    intervalMs: intervalHours * 60 * 60 * 1000
  };
}

export function externalMetricsProviderStatus(env = process.env) {
  const youtube = youtubeMetricsConfig(env);
  return OFFICIAL_METRIC_PROVIDERS.map(provider => provider.id === 'youtube'
    ? { ...provider, configured: youtube.configured, autoSync: youtube.autoSync,
        intervalHours: youtube.intervalHours, maxVideos: youtube.maxVideos }
    : { ...provider, configured: false, autoSync: false });
}

async function youtubeRequest(path, params, { apiKey, fetchImpl, timeoutMs }) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [key, value] of Object.entries({ ...params, key: apiKey })) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  let response;
  try {
    response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new Error('youtube_api_unreachable');
  }
  if (!response?.ok) throw new Error(`youtube_api_${Number(response?.status) || 502}`);
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== 'object') throw new Error('youtube_api_invalid_response');
  return data;
}

export async function fetchYouTubeAggregatedInsights({
  apiKey,
  channelId,
  fetchImpl = fetch,
  maxVideos = 200,
  timeoutMs = 12000,
  measuredAt = new Date().toISOString()
}) {
  const safeApiKey = String(apiKey || '').trim();
  const safeChannelId = String(channelId || '').trim();
  if (!safeApiKey || !safeChannelId) throw new Error('youtube_not_configured');
  const safeMaximum = boundedInteger(maxVideos, 200, 1, 500);
  const requestOptions = { apiKey: safeApiKey, fetchImpl, timeoutMs };

  const channelData = await youtubeRequest('channels', {
    part: 'snippet,contentDetails',
    id: safeChannelId,
    maxResults: 1
  }, requestOptions);
  const channel = channelData.items?.[0];
  const uploadsPlaylist = channel?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylist) throw new Error('youtube_channel_not_found');

  const videos = [];
  const seen = new Set();
  let pageToken = '';
  while (videos.length < safeMaximum) {
    const page = await youtubeRequest('playlistItems', {
      part: 'contentDetails,snippet',
      playlistId: uploadsPlaylist,
      maxResults: Math.min(50, safeMaximum - videos.length),
      pageToken
    }, requestOptions);
    for (const item of page.items || []) {
      const videoId = String(item?.contentDetails?.videoId || item?.snippet?.resourceId?.videoId || '').trim();
      if (!videoId || seen.has(videoId)) continue;
      seen.add(videoId);
      videos.push({ videoId, publishedAt: String(item?.contentDetails?.videoPublishedAt || item?.snippet?.publishedAt || '') });
      if (videos.length >= safeMaximum) break;
    }
    pageToken = String(page.nextPageToken || '');
    if (!pageToken || !(page.items || []).length) break;
  }

  const statistics = new Map();
  for (let index = 0; index < videos.length; index += 50) {
    const ids = videos.slice(index, index + 50).map(video => video.videoId);
    const data = await youtubeRequest('videos', {
      part: 'statistics',
      id: ids.join(',')
    }, requestOptions);
    for (const item of data.items || []) statistics.set(String(item.id), item.statistics || {});
  }

  return {
    provider: 'youtube',
    channelId: safeChannelId,
    channelTitle: String(channel?.snippet?.title || ''),
    measuredAt,
    items: videos.map(video => {
      const stats = statistics.get(video.videoId) || {};
      return {
        contentKey: video.videoId,
        category: 'geral',
        views: metricCount(stats.viewCount),
        watchMs: 0,
        completions: 0,
        likes: metricCount(stats.likeCount),
        comments: metricCount(stats.commentCount),
        shares: 0,
        clicks: 0,
        conversions: 0,
        measuredAt
      };
    })
  };
}
