export const OFFICIAL_METRIC_PROVIDERS = Object.freeze([
  { id: 'instagram', label: 'Instagram', implemented: true },
  { id: 'facebook', label: 'Facebook', implemented: true },
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

export function externalMetricsProviderStatus(env = process.env, capabilities = {}) {
  const youtube = youtubeMetricsConfig(env);
  return OFFICIAL_METRIC_PROVIDERS.map(provider => {
    if (provider.id === 'youtube') return { ...provider, configured: youtube.configured, autoSync: youtube.autoSync,
      intervalHours: youtube.intervalHours, maxVideos: youtube.maxVideos };
    if (provider.id === 'facebook' || provider.id === 'instagram') return {
      ...provider, configured: Boolean(capabilities[provider.id]), autoSync: false
    };
    return { ...provider, configured: false, autoSync: false };
  });
}

async function metaRequest(url, { fetchImpl, timeoutMs }) {
  let response;
  try {
    response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new Error('meta_api_unreachable');
  }
  if (!response?.ok) throw new Error(`meta_api_${Number(response?.status) || 502}`);
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== 'object') throw new Error('meta_api_invalid_response');
  return data;
}

function insightValue(insights, name) {
  const value = (insights?.data || []).find(item => item?.name === name)?.values?.[0]?.value;
  if (value && typeof value === 'object') return metricCount(Object.values(value).reduce((sum, item) => sum + Number(item || 0), 0));
  return metricCount(value);
}

function metaUrl(version, objectId, fields, accessToken, limit) {
  const objectPath = String(objectId).split('/').map(part => encodeURIComponent(part)).join('/');
  const url = new URL(`https://graph.facebook.com/${version}/${objectPath}`);
  url.searchParams.set('fields', fields);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('access_token', accessToken);
  return url;
}

export async function fetchMetaAggregatedInsights({
  accounts,
  apiVersion = 'v26.0',
  fetchImpl = fetch,
  maxItems = 200,
  timeoutMs = 15000,
  measuredAt = new Date().toISOString()
}) {
  const safeAccounts = Array.isArray(accounts) ? accounts.slice(0, 100) : [];
  if (!safeAccounts.length) throw new Error('meta_not_configured');
  const limit = boundedInteger(maxItems, 200, 1, 500);
  const facebook = [], instagram = [];
  for (const account of safeAccounts) {
    const token = String(account?.accessToken || '').trim();
    const pageId = String(account?.pageId || '').trim();
    if (!token || !pageId) continue;
    const pageUrl = metaUrl(apiVersion, `${pageId}/posts`,
      'id,created_time,reactions.limit(0).summary(true),comments.limit(0).summary(true),shares,insights.metric(post_impressions,post_clicks,post_video_views)',
      token, Math.min(100, limit));
    const pageData = await metaRequest(pageUrl, { fetchImpl, timeoutMs });
    for (const item of (pageData.data || []).slice(0, limit)) facebook.push({
      contentKey: String(item.id || ''), category: 'geral',
      views: insightValue(item.insights, 'post_impressions'), watchMs: 0, completions: 0,
      likes: metricCount(item.reactions?.summary?.total_count),
      comments: metricCount(item.comments?.summary?.total_count), shares: metricCount(item.shares?.count),
      clicks: insightValue(item.insights, 'post_clicks'), conversions: 0, measuredAt
    });
    const instagramId = String(account?.instagramId || '').trim();
    if (!instagramId) continue;
    const instagramUrl = metaUrl(apiVersion, `${instagramId}/media`,
      'id,timestamp,media_type,like_count,comments_count,insights.metric(views,reach,saved,shares,total_interactions)',
      token, Math.min(100, limit));
    const instagramData = await metaRequest(instagramUrl, { fetchImpl, timeoutMs });
    for (const item of (instagramData.data || []).slice(0, limit)) instagram.push({
      contentKey: String(item.id || ''), category: 'geral',
      views: Math.max(insightValue(item.insights, 'views'), insightValue(item.insights, 'reach')),
      watchMs: 0, completions: 0, likes: metricCount(item.like_count),
      comments: metricCount(item.comments_count), shares: insightValue(item.insights, 'shares'),
      clicks: 0, conversions: 0, measuredAt
    });
  }
  return { provider: 'meta', measuredAt, facebook, instagram };
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
