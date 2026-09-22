export async function mountLiveVoice(document, fetchImpl = globalThis.fetch) {
  const host = document.querySelector('main');
  if (!host || document.getElementById('lia-live-voice')) return;
  const make = (tag, value) => { const node = document.createElement(tag); if (value) node.textContent = value; return node; };
  const panel = make('section'); panel.id = 'lia-live-voice'; panel.className = 'card';
  const title = make('h2', 'Conversar com Lia por voz ao vivo');
  const note = make('p', 'Teste privado no navegador. Você fala pelo microfone e ouve a Lia em tempo real. A voz desta conversa ainda não é enviada ao OBS nem às redes.');
  const cost = make('small', 'GPT-Live usa a API OpenAI por tempo de sessão. O consumo final aparece ao encerrar; esta prévia não usa os créditos dos clientes.');
  const start = make('button', 'Iniciar conversa privada'); start.type = 'button';
  const stop = make('button', 'Encerrar conversa'); stop.type = 'button'; stop.className = 'danger'; stop.disabled = true;
  const status = make('p', 'Verificando disponibilidade…'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const audio = make('audio'); audio.autoplay = true; audio.controls = true; audio.hidden = true;
  const captions = make('div'); captions.setAttribute('aria-label', 'Legendas da conversa');
  const caller = make('p'); const lia = make('p'); captions.append(caller, lia);
  panel.append(title, note, cost, start, stop, status, audio, captions); host.append(panel);

  let peer = null, events = null, microphone = null, closeTimer = null, ready = false, finalized = false, starting = false, configured = false;
  let inputText = '', outputText = '';
  const show = message => { status.textContent = message; };
  const cleanup = () => {
    clearTimeout(closeTimer);
    microphone?.getTracks().forEach(track => track.stop());
    events?.close(); peer?.close(); audio.srcObject = null; audio.hidden = true;
    microphone = null; events = null; peer = null; ready = false; starting = false;
    start.disabled = !configured; stop.disabled = true;
  };
  const onEvent = event => {
    if (event.type === 'session.started') { ready = true; stop.disabled = false; show('Lia ouvindo. Fale normalmente.'); }
    else if (event.type === 'session.input_transcript.delta' && typeof event.delta === 'string') { inputText = (inputText + event.delta).slice(-3000); caller.textContent = 'Você: ' + inputText; }
    else if (event.type === 'session.output_transcript.delta' && typeof event.delta === 'string') { outputText = (outputText + event.delta).slice(-3000); lia.textContent = 'Lia: ' + outputText; show('Lia falando.'); }
    else if (event.type === 'session.closed') { finalized = true; const seconds = Number(event.usage?.seconds); show(Number.isFinite(seconds) ? `Conversa encerrada. ${seconds} segundos de voz registrados pela OpenAI.` : 'Conversa encerrada. Consumo final indisponível.'); cleanup(); }
    else if (event.type === 'error') show('A conversa encontrou um erro. Encerre e confira a conexão.');
  };
  const waitForIce = connection => connection.iceGatheringState === 'complete' ? Promise.resolve() : new Promise((resolve, reject) => {
    const timer = setTimeout(() => { connection.removeEventListener('icegatheringstatechange', check); reject(Error('O microfone não conseguiu estabelecer a conexão.')); }, 10000);
    const check = () => { if (connection.iceGatheringState === 'complete') { clearTimeout(timer); connection.removeEventListener('icegatheringstatechange', check); resolve(); } };
    connection.addEventListener('icegatheringstatechange', check); check();
  });
  const statusResponse = await fetchImpl('/api/admin/live-studio/lia/voice-live/status', {headers: {accept: 'application/json'}}).then(response => response.ok ? response.json() : {configured: false}).catch(() => ({configured: false}));
  configured = Boolean(statusResponse.configured);
  if (!globalThis.RTCPeerConnection || !globalThis.navigator?.mediaDevices?.getUserMedia) configured = false;
  start.disabled = !configured;
  show(configured ? 'Pronta para teste privado. O microfone será solicitado ao iniciar.' : 'Voz ao vivo indisponível neste navegador ou na configuração da OpenAI.');

  start.addEventListener('click', async () => {
    if (starting || ready || !configured) return;
    starting = true; start.disabled = true; finalized = false; inputText = ''; outputText = ''; caller.textContent = ''; lia.textContent = ''; show('Conectando microfone e Lia…');
    try {
      peer = new RTCPeerConnection();
      peer.addEventListener('track', event => { audio.hidden = false; audio.srcObject = new MediaStream([event.track]); audio.play().catch(() => show('Clique em reproduzir para ouvir a Lia.')); });
      microphone = await globalThis.navigator.mediaDevices.getUserMedia({audio: true});
      for (const track of microphone.getAudioTracks()) peer.addTrack(track, microphone);
      events = peer.createDataChannel('oai-events');
      events.addEventListener('message', ({data}) => { try { onEvent(JSON.parse(data)); } catch { show('Evento de voz inválido.'); } });
      events.addEventListener('close', () => { if (!finalized) { show('Conexão interrompida. Consumo final não confirmado.'); cleanup(); } });
      await peer.setLocalDescription(await peer.createOffer());
      await waitForIce(peer);
      const response = await fetchImpl('/api/admin/live-studio/lia/voice-live/session', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({sdp: peer.localDescription?.sdp})});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.error || 'Falha ao iniciar a conversa.');
      if (typeof data.transport?.sdp !== 'string') throw Error('A resposta de áudio veio incompleta.');
      await peer.setRemoteDescription({type: 'answer', sdp: data.transport.sdp});
      show('Aguardando a confirmação da sessão…');
    } catch (error) { show(error.message || 'Falha na conexão de voz.'); cleanup(); }
  });
  stop.addEventListener('click', () => {
    if (!ready || events?.readyState !== 'open') return;
    stop.disabled = true; show('Encerrando conversa e conferindo consumo…');
    events.send(JSON.stringify({type: 'session.close'}));
    closeTimer = setTimeout(() => { if (!finalized) { show('Conversa interrompida. Consumo final não confirmado.'); cleanup(); } }, 15000);
  });
  globalThis.addEventListener?.('pagehide', () => { if (ready && events?.readyState === 'open') events.send(JSON.stringify({type: 'session.close'})); cleanup(); }, {once: true});
}
