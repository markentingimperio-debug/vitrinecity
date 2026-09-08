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
  const credit=item.kind==='article'&&['Ilustração por IA','Foto de arquivo · 2024','ArionStar · CC0'].includes(item.imageCredit)?document.createElement('small'):null;
  if(credit){credit.className='result-image-credit';credit.textContent=item.imageCredit;credit.hidden=true;}
  image.addEventListener('error', () => cover.remove(), {once:true});
  image.addEventListener('load', () => {
    if (image.naturalWidth < 2 || image.naturalHeight < 2) cover.remove();
    else if(credit)credit.hidden=false;
  }, {once:true});
  image.src = src;
  cover.append(image);
  if(credit)cover.append(credit);
  container.append(cover);
}
