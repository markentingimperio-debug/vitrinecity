// Preserve the existing music/cinema implementation and compose Vitrine Play.
import {setupMediaCatalog as setupBaseMediaCatalog} from './media-catalog-base.js';
import {setupVitrinePlay} from './vitrine-play.js';

export function setupMediaCatalog(options) {
  const media=setupBaseMediaCatalog(options);
  const play=setupVitrinePlay(options);
  return {...media,sitemapPaths:()=>[...new Set([...media.sitemapPaths(),...play.sitemapPaths()])]};
}
