import { getResultImage } from './search-result-image.js';

// A cover illustrates the result; it is not another link or a video player.
export function attachResultCover(container, item, {document, origin}) {
  const src = getResultImage(item, origin);
  if (!src) return;
  const cover = document.createElement('div');
  cover.className = 'result-cover';
  const image = document.createElement('img');
  image.alt = '';
  image.width = 480;
  image.height = 270;
  image.loading = 'lazy';
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  image.addEventListener('error', () => cover.remove(), {once:true});
  image.addEventListener('load', () => {
    if (image.naturalWidth < 2 || image.naturalHeight < 2) cover.remove();
  }, {once:true});
  image.src = src;
  cover.append(image);
  container.append(cover);
}
