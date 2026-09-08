import {youtubeSource} from './vitriny-music-core.js';

export function uniqueMusicQueue(selected, items = [], limit = 96) {
  const seen = new Set(), genre = selected?.genre;
  return [selected, ...items].filter(item => {
    if (!item || item.genre !== genre || typeof item.slug !== 'string') return false;
    const source = youtubeSource(item.url, item.kind);
    if (!source) return false;
    const key = (source.kind === 'playlist' ? 'playlist' : 'video') + ':' + source.id;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, Math.max(1, Math.min(96, Number(limit) || 96)));
}

export async function loadMusicQueue(selected, {fetchImpl = fetch, signal, initialItems = []} = {}) {
  const fallback = uniqueMusicQueue(selected, initialItems);
  if (!selected?.genre || !youtubeSource(selected.url, selected.kind)) return fallback;
  const params = new URLSearchParams({genero:selected.genre, p:'1'});
  const read = async page => {
    params.set('p', String(page));
    const response = await fetchImpl('/api/media/music?' + params, {signal, credentials:'same-origin', redirect:'error'});
    if (!response.ok) return null;
    const data = await response.json();
    return data && Number(data.page) === page ? data : null;
  };
  try {
    const first = await read(1);
    if (signal?.aborted || !first) return fallback;
    const count = Math.max(1, Math.min(4, Number(first.pages) || 1));
    const rest = await Promise.allSettled(Array.from({length:count-1}, (_, index) => read(index+2)));
    if (signal?.aborted) return fallback;
    const items = [first, ...rest.filter(result => result.status === 'fulfilled').map(result => result.value)].flatMap(data => Array.isArray(data?.items) ? data.items.slice(0,24) : []);
    return uniqueMusicQueue(selected, [...items, ...initialItems]);
  } catch { return fallback; }
}

export function selectionHasEnded(item, {state, playlist, playlistIndex} = {}) {
  if (!item || state !== 0) return false;
  if (item.kind !== 'playlist') return true;
  // Intermediate track ENDED events belong to the native YouTube playlist.
  return Array.isArray(playlist) && playlist.length > 0 && Number.isInteger(playlistIndex) && playlistIndex === playlist.length-1;
}

export function youtubePlaybackError(code) {
  if ([101,150].includes(Number(code))) return 'O canal não permite reproduzir este vídeo dentro de outros sites.';
  if (Number(code) === 100) return 'Este vídeo foi removido, ficou privado ou está indisponível.';
  if (Number(code) === 153) return 'O YouTube não conseguiu identificar esta página. Confira as permissões do navegador ou use o link do YouTube.';
  if (Number(code) === 2) return 'O YouTube não reconheceu esta seleção.';
  return 'Não foi possível reproduzir esta seleção no player do YouTube.';
}

export function queueNeighbor(queue, current, direction) {
  const index = queue.findIndex(item => item.slug === current?.slug);
  return index < 0 ? null : queue[index + (direction < 0 ? -1 : 1)] || null;
}
