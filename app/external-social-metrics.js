import { classifyIntegrationFailure } from './integration-health.js';

export const OFFICIAL_METRIC_PROVIDERS = Object.freeze([
  { id: 'instagram', label: 'Instagram', implemented: true },
  { id: 'facebook', label: 'Facebook', implemented: true },
  { id: 'tiktok', label: 'TikTok', implemented: true },
  { id: 'youtube', label: 'YouTube', implemented: true },
  { id: 'google', label: 'Google', implemented: true },
  { id: 'kwai', label: 'Kwai', implemented: true }
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

export function tiktokMetricsConfig(env = process.env) {
  const accessToken = String(env.TIKTOK_CONTENT_ACCESS_TOKEN || '').trim();
  return {
    accessToken,
    configured: Boolean(accessToken),
    maxVideos: boundedInteger(env.TIKTOK_METRICS_MAX_VIDEOS, 200, 1, 500)
  };
}

export function googleSearchMetricsConfig(env = process.env) {
  const accessToken = String(env.GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN || '').trim();
  const siteUrl = String(env.GOOGLE_SEARCH_CONSOLE_SITE_URL || '').trim();
  return {
    accessToken,
    siteUrl,
    configured: Boolean(accessToken && siteUrl),
    lookbackDays: boundedInteger(env.GOOGLE_SEARCH_CONSOLE_LOOKBACK_DAYS, 28, 1, 90),
    maxPages: boundedInteger(env.GOOGLE_SEARCH_CONSOLE_MAX_PAGES, 500, 1, 25000)
  };
}

export function kwaiMetricsConfig(env = process.env) {
  const appId = String(env.KWAI_APP_ID || '').trim();
  const accessToken = String(env.KWAI_ACCESS_TOKEN || '').trim();
  return { appId, accessToken, configured: Boolean(appId && accessToken),
    maxVideos: boundedInteger(env.KWAI_METRICS_MAX_VIDEOS, 200, 1, 500) };
}

export function externalMetricsProviderStatus(env = process.env, capabilities = {}) {
  const youtube = youtubeMetricsConfig(env);
  const tiktok = tiktokMetricsConfig(env);
  const google = googleSearchMetricsConfig(env);
  const kwai = kwaiMetricsConfig(env);
  return OFFICIAL_METRIC_PROVIDERS.map(provider => {
    if (provider.id === 'youtube') return { ...provider, configured: youtube.configured, autoSync: youtube.autoSync,
      intervalHours: youtube.intervalHours, maxVideos: youtube.maxVideos };
    if (provider.id === 'facebook' || provider.id === 'instagram') return {
      ...provider, configured: Boolean(capabilities[provider.id]), autoSync: false
    };
    if (provider.id === 'tiktok') return { ...provider, configured: tiktok.configured, autoSync: false,
      maxVideos: tiktok.maxVideos };
    if (provider.id === 'google') return { ...provider, configured: google.configured, autoSync: false,
      lookbackDays: google.lookbackDays, maxPages: google.maxPages };
    if (provider.id === 'kwai') return { ...provider, configured: kwai.configured, autoSync: false,
      maxVideos: kwai.maxVideos };
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
  const data = await response.json().catch(() => null);
  if (!response?.ok) {
    const detail = data?.error || {};
    const diagnosticCode = classifyIntegrationFailure({status: response.status, providerCode: detail.code, message: detail.message});
    console.error('Meta metrics request rejected', JSON.stringify({ status:Number(response?.status)||502,
      code:Number(detail.code)||0, subcode:Number(detail.error_subcode)||0, diagnosticCode }));
    const error = new Error(`meta_api_${Number(response?.status) || 502}`);
    error.diagnosticCode = diagnosticCode;
    throw error;
  }
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
  const facebook = [], instagram = [], errors = [];
  let successfulRequests = 0;
  for (const account of safeAccounts) {
    const token = String(account?.accessToken || '').trim();
    const pageId = String(account?.pageId || '').trim();
    if (!token || !pageId) continue;
    const pageUrl = metaUrl(apiVersion, `${pageId}/posts`,
      'id,created_time,reactions.limit(0).summary(true),comments.limit(0).summary(true),shares,insights.metric(post_impressions,post_clicks,post_video_views)',
      token, Math.min(100, limit));
    let pageData;
    try { pageData = await metaRequest(pageUrl, { fetchImpl, timeoutMs }); }
    catch (error) {
      if (error.message !== 'meta_api_400' || ['permissions','authentication','access_blocked'].includes(error.diagnosticCode)) { errors.push(error); continue; }
      const basicPageUrl = metaUrl(apiVersion, `${pageId}/posts`,
        'id,created_time,reactions.limit(0).summary(true),comments.limit(0).summary(true),shares',
        token, Math.min(100, limit));
      try { pageData = await metaRequest(basicPageUrl, { fetchImpl, timeoutMs }); }
      catch (fallbackError) { errors.push(fallbackError); continue; }
    }
    successfulRequests++;
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
    let instagramData;
    try { instagramData = await metaRequest(instagramUrl, { fetchImpl, timeoutMs }); }
    catch (error) {
      if (error.message !== 'meta_api_400' || ['permissions','authentication','access_blocked'].includes(error.diagnosticCode)) { errors.push(error); continue; }
      const basicInstagramUrl = metaUrl(apiVersion, `${instagramId}/media`,
        'id,timestamp,media_type,like_count,comments_count', token, Math.min(100, limit));
      try { instagramData = await metaRequest(basicInstagramUrl, { fetchImpl, timeoutMs }); }
      catch (fallbackError) { errors.push(fallbackError); continue; }
    }
    successfulRequests++;
    for (const item of (instagramData.data || []).slice(0, limit)) instagram.push({
      contentKey: String(item.id || ''), category: 'geral',
      views: Math.max(insightValue(item.insights, 'views'), insightValue(item.insights, 'reach')),
      watchMs: 0, completions: 0, likes: metricCount(item.like_count),
      comments: metricCount(item.comments_count), shares: insightValue(item.insights, 'shares'),
      clicks: 0, conversions: 0, measuredAt
    });
  }
  if (!successfulRequests && errors.length) throw errors[0];
  return { provider: 'meta', measuredAt, facebook, instagram, skippedAccounts: errors.length };
}

export async function fetchKwaiAggregatedInsights({
  appId, accessToken, fetchImpl = fetch, maxVideos = 200, timeoutMs = 12000,
  measuredAt = new Date().toISOString()
}) {
  const safeAppId = String(appId || '').trim();
  const safeToken = String(accessToken || '').trim();
  if (!safeAppId || !safeToken) throw new Error('kwai_not_configured');
  const safeMaximum = boundedInteger(maxVideos, 200, 1, 500);
  const items = [];
  let cursor = '';
  const seenCursors = new Set();
  while (items.length < safeMaximum) {
    const url = new URL('https://open.kuaishou.com/openapi/photo/list');
    url.searchParams.set('app_id', safeAppId);
    url.searchParams.set('access_token', safeToken);
    url.searchParams.set('count', String(Math.min(20, safeMaximum - items.length)));
    if (cursor) url.searchParams.set('cursor', cursor);
    let response;
    try {
      response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new Error('kwai_api_unreachable');
    }
    if (!response?.ok) throw new Error(`kwai_api_${Number(response?.status) || 502}`);
    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== 'object') throw new Error('kwai_api_invalid_response');
    if (payload.result !== undefined && ![0, 1, '0', '1'].includes(payload.result)) throw new Error('kwai_api_error');
    const videos = Array.isArray(payload.video_list) ? payload.video_list :
      Array.isArray(payload.videoList) ? payload.videoList : [];
    for (const video of videos) items.push({
      contentKey: String(video?.photo_id || video?.photoId || ''), category: 'geral',
      views: metricCount(video?.view_count ?? video?.viewCount), watchMs: 0, completions: 0,
      likes: metricCount(video?.like_count ?? video?.likeCount),
      comments: metricCount(video?.comment_count ?? video?.commentCount), shares: 0,
      clicks: 0, conversions: 0, measuredAt
    });
    const nextCursor = String(payload.last_cursor ?? payload.lastCursor ?? '');
    if (!videos.length || !nextCursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  return { provider: 'kwai', measuredAt, items: items.filter(item => item.contentKey).slice(0, safeMaximum) };
}

export async function fetchGoogleSearchAggregatedInsights({
  accessToken, siteUrl, fetchImpl = fetch, lookbackDays = 28, maxPages = 500,
  timeoutMs = 12000, measuredAt = new Date().toISOString()
}) {
  const safeToken = String(accessToken || '').trim();
  const safeSiteUrl = String(siteUrl || '').trim();
  if (!safeToken || !safeSiteUrl) throw new Error('google_not_configured');
  const safeMaximum = boundedInteger(maxPages, 500, 1, 25000);
  const safeLookback = boundedInteger(lookbackDays, 28, 1, 90);
  const end = new Date(measuredAt);
  if (Number.isNaN(end.getTime())) throw new Error('google_invalid_measured_at');
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - safeLookback + 1);
  const date = value => value.toISOString().slice(0, 10);
  const url = new URL(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(safeSiteUrl)}/searchAnalytics/query`);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${safeToken}` },
      body: JSON.stringify({ startDate: date(start), endDate: date(end), dimensions: ['page'],
        rowLimit: safeMaximum, dataState: 'final' }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw new Error('google_api_unreachable');
  }
  if (!response?.ok) throw new Error(`google_api_${Number(response?.status) || 502}`);
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== 'object') throw new Error('google_api_invalid_response');
  const items = (Array.isArray(payload.rows) ? payload.rows : []).slice(0, safeMaximum).map(row => ({
    contentKey: String(row?.keys?.[0] || '').slice(0, 180), category: 'geral',
    views: metricCount(row?.impressions), watchMs: 0, completions: 0,
    likes: 0, comments: 0, shares: 0, clicks: metricCount(row?.clicks), conversions: 0,
    measuredAt, ctr: Number(row?.ctr) || 0, position: Number(row?.position) || 0
  })).filter(item => item.contentKey);
  return { provider: 'google', siteUrl: safeSiteUrl, startDate: date(start), endDate: date(end), measuredAt, items };
}

async function tiktokRequest(body, { accessToken, fetchImpl, timeoutMs }) {
  const url = new URL('https://open.tiktokapis.com/v2/video/list/');
  url.searchParams.set('fields', 'id,create_time,view_count,like_count,comment_count,share_count');
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw new Error('tiktok_api_unreachable');
  }
  if (!response?.ok) throw new Error(`tiktok_api_${Number(response?.status) || 502}`);
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== 'object') throw new Error('tiktok_api_invalid_response');
  if (String(payload.error?.code || 'ok') !== 'ok') throw new Error('tiktok_api_error');
  return payload.data || {};
}

export async function fetchTikTokAggregatedInsights({
  accessToken, fetchImpl = fetch, maxVideos = 200, timeoutMs = 12000,
  measuredAt = new Date().toISOString()
}) {
  const safeToken = String(accessToken || '').trim();
  if (!safeToken) throw new Error('tiktok_not_configured');
  const safeMaximum = boundedInteger(maxVideos, 200, 1, 500);
  const items = [];
  let cursor;
  while (items.length < safeMaximum) {
    const body = { max_count: Math.min(20, safeMaximum - items.length) };
    if (cursor !== undefined) body.cursor = cursor;
    const data = await tiktokRequest(body, { accessToken: safeToken, fetchImpl, timeoutMs });
    const videos = Array.isArray(data.videos) ? data.videos : [];
    for (const video of videos) items.push({
      contentKey: String(video?.id || ''), category: 'geral', views: metricCount(video?.view_count),
      watchMs: 0, completions: 0, likes: metricCount(video?.like_count),
      comments: metricCount(video?.comment_count), shares: metricCount(video?.share_count),
      clicks: 0, conversions: 0, measuredAt
    });
    if (!data.has_more || !videos.length) break;
    cursor = data.cursor;
    if (cursor === undefined || cursor === null || cursor === '') break;
  }
  return { provider: 'tiktok', measuredAt, items: items.filter(item => item.contentKey).slice(0, safeMaximum) };
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
