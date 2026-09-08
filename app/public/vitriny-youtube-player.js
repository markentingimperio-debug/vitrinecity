import {youtubeSource} from './vitriny-music-core.js';

let apiPromise;
export function loadYouTubeIframeApi({window = globalThis.window, document = globalThis.document} = {}) {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api'; script.async = true;
    let settled = false;
    const finish = error => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (window.onYouTubeIframeAPIReady === ready) window.onYouTubeIframeAPIReady = previous;
      if (error) {script.remove(); apiPromise = null; reject(error);} else resolve(window.YT);
    };
    const ready = () => {try {previous?.();} catch {} finish(window.YT?.Player ? null : Error('youtube_api_unavailable'));};
    const timer = setTimeout(() => finish(Error('youtube_api_timeout')), 12000);
    window.onYouTubeIframeAPIReady = ready;
    script.addEventListener('error', () => finish(Error('youtube_api_unavailable')), {once:true});
    document.head.append(script);
  });
  return apiPromise;
}

export function controlledYoutubeUrl(source, origin) {
  if (!source?.embedUrl) return '';
  const url = new URL(source.embedUrl);
  url.searchParams.set('enablejsapi', '1'); url.searchParams.set('origin', new URL(origin).origin);
  url.searchParams.set('autoplay', '0'); url.searchParams.set('playsinline', '1');
  url.searchParams.set('controls', '1'); url.searchParams.set('loop', '0');
  return url.href;
}

// No network activity happens until open() is called by a selection gesture.
export function createYouTubePlayer(container, {origin = location.origin, apiLoader = loadYouTubeIframeApi, onReady = () => {}, onState = () => {}, onError = () => {}, onBlocked = () => {}, onUnavailable = () => {}} = {}) {
  const document = container.ownerDocument;
  let generation = 0, instance = null, ready = false, frame = null, activeSource = null, audioPreferences = null;
  function teardown() {
    generation++; ready = false;
    const previous = instance; instance = null; activeSource = null;
    try {previous?.destroy();} catch {}
    frame?.remove(); frame = null;
  }
  function close() {teardown(); audioPreferences = null;}
  function rememberAudio() {
    if (!instance || !ready) return;
    const observed = {};
    try {const volume = instance.getVolume(); if (typeof volume === 'number' && Number.isFinite(volume) && volume >= 0 && volume <= 100) observed.volume = volume;} catch {}
    try {const muted = instance.isMuted(); if (typeof muted === 'boolean') observed.muted = muted;} catch {}
    audioPreferences = Object.keys(observed).length ? observed : null;
  }
  function canReuseVideo(source) {
    if (!instance || !ready || source.kind === 'playlist' || activeSource?.kind === 'playlist') return false;
    try {return youtubeSource(instance.getVideoUrl(), 'video')?.id === activeSource?.id;} catch {return false;}
  }
  async function open(item, {autoplay = false} = {}) {
    const source = youtubeSource(item?.url, item?.kind);
    if (!source) return false;
    // A playlist's state/index may still refer to the previous selection while
    // a cue command is pending. A new instance also invalidates its old events.
    if (canReuseVideo(source)) {
      frame.title = item.title + ' · YouTube';
      try {instance[autoplay ? 'loadVideoById' : 'cueVideoById']({videoId:source.id}); activeSource = source; return true;} catch {}
    }
    rememberAudio(); teardown(); activeSource = source;
    const own = generation;
    frame = document.createElement('iframe'); frame.title = item.title + ' · YouTube';
    frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
    frame.referrerPolicy = 'strict-origin-when-cross-origin'; frame.allowFullscreen = true;
    frame.src = controlledYoutubeUrl(source, origin); container.replaceChildren(frame);
    const targetFrame = frame;
    try {
      const YT = await apiLoader();
      if (own !== generation || !targetFrame.isConnected) return false;
      instance = new YT.Player(targetFrame, {events:{
        onReady(event) {
          if (own !== generation || event.target !== instance) return;
          ready = true;
          try {if (audioPreferences?.volume !== undefined) event.target.setVolume(audioPreferences.volume);} catch {}
          try {if (audioPreferences?.muted === true) event.target.mute(); else if (audioPreferences?.muted === false) event.target.unMute();} catch {}
          onReady(event.target); if (autoplay) event.target.playVideo();
        },
        onStateChange(event) {if (own === generation && event.target === instance) onState(event.data, event.target);},
        onError(event) {if (own === generation && event.target === instance) onError(event.data, event.target);},
        onAutoplayBlocked(event) {if (own === generation && event.target === instance) onBlocked();},
      }});
      return true;
    } catch {
      if (own === generation) onUnavailable();
      return false;
    }
  }
  return {open, close, getInstance:() => ready ? instance : null};
}
