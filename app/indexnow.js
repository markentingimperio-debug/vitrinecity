const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

export function extractIndexNowUrls(xml, expectedHost) {
  const host = String(expectedHost || '').trim().toLowerCase();
  const urls = [];
  const seen = new Set();
  for (const match of String(xml || '').matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    const value = match[1].replaceAll('&amp;', '&').trim();
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== host || seen.has(url.href)) continue;
      seen.add(url.href);
      urls.push(url.href);
    } catch {}
  }
  return urls.slice(0, 10000);
}

export async function submitIndexNow({
  siteUrl = 'https://vitrinecity.com',
  key,
  fetchImpl = fetch,
  endpoint = INDEXNOW_ENDPOINT,
  timeoutMs = 15000
}) {
  const site = new URL(siteUrl);
  const safeKey = String(key || '').trim();
  if (!/^[A-Za-z0-9-]{8,128}$/.test(safeKey)) throw new Error('indexnow_invalid_key');
  const sitemapUrl = new URL('/sitemap.xml', site).href;
  const sitemapResponse = await fetchImpl(sitemapUrl, {
    headers: { accept: 'application/xml,text/xml;q=0.9' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!sitemapResponse?.ok) throw new Error(`indexnow_sitemap_${Number(sitemapResponse?.status) || 502}`);
  const urls = extractIndexNowUrls(await sitemapResponse.text(), site.hostname);
  if (!urls.length) throw new Error('indexnow_empty_sitemap');
  const keyLocation = new URL(`/${safeKey}.txt`, site).href;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', accept: 'application/json' },
    body: JSON.stringify({ host: site.hostname, key: safeKey, keyLocation, urlList: urls }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (![200, 202].includes(Number(response?.status))) {
    throw new Error(`indexnow_api_${Number(response?.status) || 502}`);
  }
  return { ok: true, status: Number(response.status), submitted: urls.length, keyLocation, sitemapUrl };
}
