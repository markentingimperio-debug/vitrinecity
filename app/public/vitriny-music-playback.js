import {youtubeSource} from './vitriny-music-core.js';
import {uniqueMusicQueue, loadMusicQueue, queueNeighbor, selectionHasEnded, youtubePlaybackError} from './vitriny-music-queue.js';
import {createYouTubePlayer} from './vitriny-youtube-player.js';

export function mountMediaPlayback({player, status, scope = 'music', onSelection = () => {}, fetchImpl = fetch, createPlayer = createYouTubePlayer}) {
  const document = player.ownerDocument, $ = id => document.getElementById(id);
  const controls = $('musicQueueControls'), continuous = $('continuousPlayback');
  let selected = null, queue = [], generation = 0, queueController, queueTimer, endedTimer;
  let played = false, failed = false, loading = false;
  const clearEnd = () => {clearTimeout(endedTimer); endedTimer = null;};
  const cancelQueue = () => {queueController?.abort(); queueController = null; clearTimeout(queueTimer); loading = false;};
  function refresh() {
    if (!controls) return;
    controls.hidden = !selected;
    $('previousSelection').disabled = !selected || !queueNeighbor(queue, selected, -1);
    $('nextSelection').disabled = !selected || !queueNeighbor(queue, selected, 1);
    const next = queueNeighbor(queue, selected, 1), index = queue.findIndex(item => item.slug === selected?.slug);
    $('queueStatus').textContent = !selected ? '' : loading ? 'Preparando a sequência de ' + (selected.genreLabel || 'música') + '…'
      : (selected.genreLabel || 'Seu estilo') + ' · ' + Math.max(1, index+1) + ' de ' + queue.length + ' seleções. ' + (next ? 'A seguir: ' + next.title : 'Última seleção desta sequência.');
  }
  function move(direction, automatic = false) {
    if (scope !== 'music' || !selected || automatic && (!continuous.checked || failed)) return;
    const next = queueNeighbor(queue, selected, direction);
    if (!next) {if (automatic) status.textContent = 'A sequência terminou. Escolha outra seleção para continuar.'; return;}
    open(next, {fromQueue:true, autoplay:true, scroll:!automatic});
  }
  function checkEnded() {
    clearEnd();
    if (scope !== 'music' || !selected || !continuous.checked || !played || failed) return;
    const own = generation;
    endedTimer = setTimeout(() => {
      if (own !== generation || !selected || !continuous.checked || !played || failed || loading) return;
      const instance = playback.getInstance(); if (!instance) return;
      let ended;
      try {ended = selectionHasEnded(selected, {state:instance.getPlayerState(), playlist:selected.kind === 'playlist' ? instance.getPlaylist() : null, playlistIndex:selected.kind === 'playlist' ? instance.getPlaylistIndex() : null});} catch {return;}
      if (!ended) return;
      played = false; move(1, true);
    }, 650);
  }
  const playback = createPlayer(player, {
    onReady:refresh,
    onState(state, instance) {
      if (!selected) return;
      if (state === 1) {
        if (selected.kind !== 'playlist') {
          let current; try {current = youtubeSource(instance.getVideoUrl(), 'video');} catch {}
          if (current && current.id !== youtubeSource(selected.url, selected.kind)?.id) return;
        }
        clearEnd(); played = true; failed = false;
        status.textContent = selected.kind === 'live' ? 'Rádio em reprodução. A próxima seleção começa somente se a transmissão terminar.' : 'Em reprodução · ' + selected.title;
      } else if (state === 0) {
        if (scope === 'music' && continuous?.checked) checkEnded();
        else status.textContent = 'Reprodução encerrada. Você pode reproduzir novamente ou escolher outra seleção.';
      } else if (state === 2) {clearEnd(); status.textContent = 'Reprodução pausada. Use o player para continuar.';}
    },
    onError(code) {
      clearEnd(); played = false; failed = true;
      status.textContent = youtubePlaybackError(code) + (scope === 'music' ? ' A sequência parou. Escolha outra seleção ou use o link do YouTube.' : ' Escolha outra sessão ou use o link do YouTube.');
    },
    onBlocked() {clearEnd(); played = false; status.textContent = 'O navegador pediu um toque para continuar. Toque em reproduzir no player do YouTube; a sequência permanece disponível.';},
    onUnavailable() {clearEnd(); played = false; status.textContent = 'O controle do player não carregou. Você ainda pode usar o player do YouTube ou escolher outra seleção.';},
  });
  function open(item, {fromQueue = false, autoplay = false, scroll = true, initialItems = []} = {}) {
    if (!youtubeSource(item?.url, item?.kind)) return;
    generation++; clearEnd(); played = false; failed = false; selected = item;
    onSelection(item, {scroll});
    status.textContent = autoplay ? 'Preparando a próxima seleção. Se necessário, toque em reproduzir no player.' : 'Seleção aberta. Toque em reproduzir no player do YouTube.';
    if (scope === 'music' && !fromQueue) {
      cancelQueue(); queue = uniqueMusicQueue(item, initialItems); loading = true;
      const own = generation, controller = new AbortController(); queueController = controller;
      queueTimer = setTimeout(() => controller.abort(), 10000);
      loadMusicQueue(item, {fetchImpl, signal:controller.signal, initialItems}).then(items => {
        if (own !== generation || !selected) return;
        clearTimeout(queueTimer); loading = false; queue = items; refresh(); checkEnded();
      }).catch(() => {if (own === generation) {loading = false; refresh();}});
    } else if (fromQueue) cancelQueue();
    refresh(); playback.open(item, {autoplay});
  }
  function close() {
    generation++; clearEnd(); cancelQueue(); playback.close();
    selected = null; queue = []; played = false; failed = false;
    if (continuous) continuous.checked = false;
    refresh();
  }
  $('previousSelection')?.addEventListener('click', () => move(-1));
  $('nextSelection')?.addEventListener('click', () => move(1));
  continuous?.addEventListener('change', () => {
    clearEnd();
    if (!continuous.checked) {status.textContent = 'A sequência automática foi desligada. As faixas da playlist continuam nos controles do YouTube.'; return;}
    status.textContent = 'Reprodução contínua ligada. Ao terminar esta seleção, vamos para a próxima deste estilo.'; checkEnded();
  });
  return {open, close};
}
