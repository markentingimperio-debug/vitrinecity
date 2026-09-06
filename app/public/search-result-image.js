// An image URL is metadata, not permission to reuse the underlying image.
// Keep this module pure: transport existing thumbnails, never discover or proxy them.
const raster = /\.(?:jpe?g|png|webp|avif)$/i;
const youtubePath = /^\/vi(?:_webp)?\/[A-Za-z0-9_-]{11}\/[A-Za-z0-9_-]+\.(?:jpe?g|webp)$/;

function trustedOrigin(value) {
  try {
    const url=new URL(value);
    return ['https:','http:'].includes(url.protocol) && !url.username && !url.password ? url.origin : '';
  } catch { return ''; }
}

function trustedCdn(url) {
  const {hostname:host,pathname:path,searchParams:params}=url;
  if(['i.ytimg.com','img.youtube.com'].includes(host))return youtubePath.test(path);
  if(/^encrypted-tbn[0-3]\.gstatic\.com$/.test(host))return path==='/images' && /^tbn:[A-Za-z0-9_-]+$/.test(params.get('q') || '');
  if(/^tse[1-4]\.mm\.bing\.net$/.test(host))return path==='/th' && /^(?:OIP|OIF|OIG|OVP)\.[A-Za-z0-9_.-]+$/.test(params.get('id') || '')
    || /^\/th\/id\/(?:OIP|OIF|OIG|OVP)\.[A-Za-z0-9_.-]+$/.test(path);
  if(host==='upload.wikimedia.org')return path.startsWith('/wikipedia/') && raster.test(path);
  // This exact product-image host is already used by the curated affiliate catalog.
  if(host==='http2.mlstatic.com')return /^\/D_[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(path);
  return false;
}

export function safeResultImageUrl(value, origin) {
  if(typeof value!=='string' || !value || value.length>2048 || /[\s\u0000-\u001f\u007f\\#]/.test(value))return '';
  const own=trustedOrigin(origin), relative=value.startsWith('/');
  if(relative && (!own || value.startsWith('//')))return '';
  if(!relative && !/^https?:\/\//i.test(value))return '';
  try {
    const authority=relative?'':value.match(/^https?:\/\/([^/?#]*)/i)?.[1];
    const rawPath=(relative?value:value.replace(/^https?:\/\/[^/?#]*/i,'')).split(/[?#]/,1)[0];
    const decoded=decodeURIComponent(rawPath);
    // Inspect before URL normalizes dot segments; reject encoded separators/double encoding.
    if(/%(?:2f|5c)/i.test(rawPath) || /[%\\\u0000-\u001f\u007f]/.test(decoded) || decoded.includes('//') || decoded.split('/').some(part=>part==='.' || part==='..'))return '';
    const url=new URL(value,own || undefined);
    if(url.username || url.password || url.hash)return '';
    if(own && url.origin===own) {
      return /^\/(?:assets|uploads)\/[A-Za-z0-9_./-]+$/.test(decoded) && raster.test(decoded) ? url.href : '';
    }
    // Absolute external sources must be HTTPS at a known image CDN, with no port.
    if(relative || url.protocol!=='https:' || !authority || authority.includes(':') || !trustedCdn(url))return '';
    return url.href;
  } catch { return ''; }
}

export function getResultImage(item, origin) {
  if(!item || typeof item!=='object')return '';
  for(const value of [item.thumbnailUrl,item.imageUrl,item.logoUrl,item.facadeUrl]) {
    const url=safeResultImageUrl(value,origin);
    if(url)return url;
  }
  return '';
}
