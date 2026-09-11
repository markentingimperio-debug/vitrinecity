export function installPrayerAudio({document,window}){
  const play=document.getElementById('listenPrayer'),pause=document.getElementById('pausePrayer'),stop=document.getElementById('stopPrayer'),status=document.getElementById('audioStatus');
  const synth=window.speechSynthesis;
  if(!synth||!window.SpeechSynthesisUtterance){status.textContent='A leitura em voz alta não está disponível neste navegador. Você pode ler a oração ou assistir aos vídeos abaixo.';return;}
  play.hidden=false;
  status.textContent='Toque em Ouvir oração. A leitura usa a voz do seu aparelho.';
  let run=0,active=false,paused=false;
  function reset(){active=false;paused=false;play.disabled=false;pause.hidden=true;stop.hidden=true;pause.textContent='Pausar';}
  function cancel(){run++;synth.cancel();reset();}
  play.addEventListener('click',()=>{
    cancel();const current=run;
    const text=[document.getElementById('prayerTitle').textContent,...[...document.querySelectorAll('[data-prayer-paragraph]')].map(p=>p.textContent)].join('\n');
    const chunks=text.match(/[^.!?\n]+[.!?]?/g)||[text];
    let index=0;
    active=true;play.disabled=true;pause.hidden=false;stop.hidden=false;
    status.textContent='Preparando a leitura em voz alta…';
    function speak(){
      if(current!==run)return;
      if(index>=chunks.length){reset();status.textContent='Leitura da oração concluída.';return;}
      const utterance=new window.SpeechSynthesisUtterance(chunks[index++].trim());
      utterance.lang='pt-BR';utterance.rate=.9;
      const voice=synth.getVoices().find(v=>v.lang.toLowerCase()==='pt-br');if(voice)utterance.voice=voice;
      utterance.onstart=()=>{if(current===run)status.textContent='Ouvindo a oração. Leitura com a voz do seu aparelho.';};
      utterance.onend=speak;
      utterance.onerror=event=>{if(current!==run)return;cancel();status.textContent=event.error==='not-allowed'?'Toque em Ouvir oração para permitir a leitura.':'Não foi possível continuar a leitura. Você pode tentar novamente.';};
      synth.speak(utterance);
    }
    speak();
  });
  pause.addEventListener('click',()=>{
    if(!active)return;paused=!paused;
    if(paused)synth.pause();else synth.resume();
    pause.textContent=paused?'Continuar':'Pausar';status.textContent=paused?'Leitura pausada.':'Ouvindo a oração. Leitura com a voz do seu aparelho.';
  });
  stop.addEventListener('click',()=>{cancel();status.textContent='Leitura encerrada.';});
  window.addEventListener('pagehide',cancel);
  return cancel;
}

export function validPrayerPlayer(value){
  try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='iframe.videodelivery.net'&&!url.username&&!url.password&&!url.port&&/^\/[a-f0-9]{32}$/i.test(url.pathname)?url.href:null;}catch{return null;}
}

export async function installPrayerVideos({document,fetch,stopAudio=()=>{}}){
  const list=document.getElementById('prayerVideos'),status=document.getElementById('videoStatus'),retry=document.getElementById('retryPrayerVideos');
  async function load(){
    retry.hidden=true;status.textContent='Buscando vídeos de oração na Vitriny Social…';
    try{
      const day=document.getElementById('prayerEdition').getAttribute('datetime');
      const response=await fetch(`/api/prayer/videos?dia=${encodeURIComponent(day)}`,{signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw new Error('video request failed');
      const data=await response.json();if(!Array.isArray(data.videos))throw new Error('invalid video response');
      list.replaceChildren();
      for(const video of data.videos){
        const player=validPrayerPlayer(video.playerUrl);if(!player)continue;
        const card=document.createElement('article');card.className='prayer-video-card';
        const title=document.createElement('h3');title.textContent=String(video.caption||'Oração em vídeo').split('\n')[0].slice(0,140);
        const byline=document.createElement('p');byline.className='video-author';byline.textContent=`Por ${video.author} · Vitriny Social`;
        const frame=document.createElement('div');frame.className='prayer-player';
        const button=document.createElement('button');button.type='button';button.className='button button-primary';button.textContent='▶ Assistir e ouvir';button.setAttribute('aria-label',`Assistir e ouvir: ${title.textContent}`);
        button.addEventListener('click',()=>{
          stopAudio();
          // Start only the requested player and stop any previously opened one.
          for(const other of list.querySelectorAll('iframe')){const wrap=other.parentElement;other.remove();wrap.querySelector('button').hidden=false;}
          const iframe=document.createElement('iframe');iframe.src=player;iframe.title=title.textContent;iframe.allow='fullscreen';iframe.allowFullscreen=true;iframe.referrerPolicy='strict-origin-when-cross-origin';
          button.hidden=true;frame.append(iframe);
          iframe.addEventListener('load',()=>{iframe.focus();});
        });
        frame.append(button);
        const link=document.createElement('a');link.href=`/social?post=${encodeURIComponent(video.id)}`;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Abrir na Vitriny Social ↗';
        card.append(frame,title,byline,link);list.append(card);
      }
      status.textContent=list.children.length?'Toque em Assistir e ouvir e depois em reproduzir. O som pode ser ajustado no player.':'Ainda não há vídeo de oração publicado para este dia. Você pode ouvir a leitura da oração acima.';
    }catch{
      status.textContent='Não foi possível carregar os vídeos agora. A oração e a leitura em voz alta continuam disponíveis.';retry.hidden=false;
    }
  }
  retry.addEventListener('click',load);await load();
}

if(typeof document!=='undefined'){
  const stopAudio=installPrayerAudio({document,window});
  installPrayerVideos({document,fetch:window.fetch.bind(window),stopAudio});
}

