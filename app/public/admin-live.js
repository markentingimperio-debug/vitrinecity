const $ = id => document.getElementById(id);
const platformNames={instagram:'Instagram',youtube:'YouTube',tiktok:'TikTok'};
const platformLabel=document.createElement('label');
platformLabel.htmlFor='platform';platformLabel.textContent='Editar credenciais da rede';
const platformSelect=document.createElement('select');platformSelect.id='platform';
platformSelect.append(...Object.entries(platformNames).map(([id,name])=>new Option(name,id)));
const platformHelp=document.createElement('p');platformHelp.id='platformHelp';platformHelp.className='muted';
document.querySelector('label[for="server"]').before(platformLabel,platformSelect,platformHelp);
$('destination').nextElementSibling.textContent='Este campo registra a página da loja. Adicione o link na rede quando o recurso estiver disponível; o OBS não cria botões de compra.';
let profiles={};
const targetsBox=document.createElement('fieldset');
const targetsLegend=document.createElement('legend');targetsLegend.textContent='Transmitir o mesmo vídeo nestas redes';targetsBox.append(targetsLegend);
for(const [id,name] of Object.entries(platformNames)){
  const label=document.createElement('label');label.className='check';
  const input=document.createElement('input');input.type='checkbox';input.id='target-'+id;input.value=id;
  label.append(input,document.createTextNode(name));targetsBox.append(label);
}
platformLabel.before(targetsBox);
const selectedTargets=()=>Object.keys(platformNames).filter(p=>$('target-'+p).checked);
const networkBox=document.createElement('section');networkBox.className='card';
const networkTitle=document.createElement('h2');networkTitle.textContent='Saídas simultâneas';networkBox.append(networkTitle);
const networkRows={};
for(const [id,name] of Object.entries(platformNames)){
  const row=document.createElement('div');const status=document.createElement('p');
  const stop=document.createElement('button');stop.type='button';stop.className='danger';stop.textContent='Parar somente '+name;stop.disabled=true;
  stop.onclick=async()=>{stop.disabled=true;try{await api('/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'stop-network',platform:id})});}catch(e){$('message').textContent=e.message;}finally{await refresh().catch(()=>{});}};
  row.append(status,stop);networkRows[id]={status,stop};networkBox.append(row);
}
document.querySelector('aside').prepend(networkBox);
function platformUI(){
  const platform=platformSelect.value;
  document.querySelector('label[for="server"]').textContent='Servidor oficial — '+platformNames[platform];
  $('server').placeholder=platform==='youtube'?'rtmps://a.rtmps.youtube.com:443/live2':platform==='tiktok'?'Cole o servidor liberado pelo TikTok':'rtmps://…:443/rtmp/';
  platformHelp.textContent='Salve as credenciais de cada rede antes de trocar este seletor. Marque acima as redes que receberão o mesmo vídeo simultaneamente. '+(platform==='tiktok'?'É necessário acesso oficial a servidor e chave de transmissão. Ter LIVE Studio instalado não confirma esse acesso. Prefira RTMPS; RTMP não criptografa o sinal. Conteúdo gravado deve ser identificado e permitido pela rede. Movimentos não garantem ausência de bloqueios.':platform==='youtube'?'Copie o servidor RTMPS e a chave no YouTube Studio. Confira as opções de início automático antes de enviar o sinal.':'Copie o servidor RTMPS e a chave da sessão no Live Producer.');
  updateSessionDuration();
}
platformSelect.onchange=()=>{
  const profile=profiles[platformSelect.value]||{};
  $('server').value=profile.server||'';$('key').value='';$('clearKey').checked=false;
  $('keyStatus').textContent=profile.hasKey?'Chave desta rede armazenada; não exibida.':'Nenhuma chave cadastrada para esta rede.';
  dirty=true;$('start').disabled=true;$('preview').disabled=true;
  platformUI();
};
const directLink=document.querySelector('a[href="https://www.instagram.com/"]');
if(directLink){
  directLink.href='/admin-chatbotx.html#automationJobs';
  directLink.textContent='Abrir fila de respostas no Direct';
  const section=directLink.closest('section');
  section.querySelectorAll('p')[0].textContent='Comentários → Direct do Instagram: acompanhe a fila no painel de atendimento.';
  section.querySelectorAll('p')[1].textContent='A integração precisa receber o comentário por webhook. Respostas de live só são enviadas enquanto a live estiver ativa. Consulte o modo de aprovação no painel; nenhum envio é confirmado apenas por esta tela.';
}
$('repetitions').append(new Option('Contínuo — até parar', '0'));
document.querySelector('h1 + p').textContent='Prepare a apresentação, teste sem publicar e controle a transmissão. Vídeos de até 10 minutos, com repetição limitada ou contínua.';
$('stop').nextElementSibling.textContent='Enviar sinal não confirma que a live está pública. Pode ser necessário confirmar na rede. O limite de 2 horas encerra o sinal do OBS e das saídas; a plataforma pode encerrá-lo antes. Nenhuma live encerrada é reiniciada automaticamente.';
let media = [], initialized = false, busy = false, dirty = false;
function sessionDuration() {
  if ($('sessionDuration').value === '7200') return 7200;
  if ($('sessionDuration').value === 'configured') return undefined;
  throw Error('Selecione a duração da transmissão.');
}
function durationDescription() {
  if (sessionDuration() === 7200) return '2 horas, com encerramento automático';
  const repetitions = Number($('repetitions').value);
  if (repetitions === 0) return 'tempo ilimitado, até você parar';
  const item = media.find(m => m.file === $('media').value);
  const seconds = Math.min(1800, Math.round((item?.duration || 0) * repetitions));
  return `${seconds} segundos, conforme as repetições salvas`;
}
function updateSessionDuration(status = {}) {
  const bounded = sessionDuration() === 7200;
  $('start').textContent = bounded ? 'Transmitir por 2 horas' : 'Transmitir conforme repetições';
  const deadline = Number(status.deadline);
  if ((status.streaming || status.recording) && Number.isFinite(deadline) && deadline > 0) {
    $('sessionTiming').textContent = `Encerramento confirmado pelo OBS: ${new Date(deadline * 1000).toLocaleString('pt-BR')}. Restam ${Math.max(0, Math.ceil(Number(status.remaining) || 0))} segundos.`;
  } else if (status.streaming && status.continuous) {
    $('sessionTiming').textContent = 'Esta sessão está sem limite de duração. Use Parar sinal para encerrá-la.';
  } else {
    $('sessionTiming').textContent = bounded
      ? 'O vídeo será repetido por 2 horas a partir do início do sinal. O prazo confirmado aparecerá aqui; reiniciar o estúdio não prolonga a sessão. O teste continua limitado a 15 segundos.'
      : `Duração escolhida: ${durationDescription()}. O teste continua limitado a 15 segundos.`;
  }
}
async function api(url, options) {
  const response = await fetch('/api/admin/live-studio' + url, options);
  if ([401,403].includes(response.status)) { location.href='/admin-login.html'; throw Error('Entre na administração.'); }
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Falha na operação.');
  return data;
}
function updateMedia() {
  const item = media.find(m => m.file === $('media').value);
  $('duration').textContent = item ? Number($('repetitions').value) === 0 ? `Loop contínuo: o vídeo de ${Math.round(item.duration)} segundos reinicia até você parar ou a conexão/rede encerrar. Não reinicia uma live encerrada.` : `Duração total: ${Math.round(item.duration * Number($('repetitions').value))} segundos. Parada automática ativada.` : 'Nenhum vídeo disponível.';
  if (item && !$('video').src.endsWith('/'+item.file)) $('video').src='/api/admin/live-studio/media/'+encodeURIComponent(item.file);
  updateSessionDuration();
}
async function refresh() {
  const data = await api('');
  profiles=data.profiles||{};
  if (!initialized) {
    media = data.media;
    $('video').nextElementSibling.textContent=`Biblioteca disponível: ${media.length} vídeo(s). Revise imagem e áudio antes de iniciar o sinal.`;
    $('media').replaceChildren(...media.map(m => new Option(m.label, m.file)));
    for (const key of ['title','media','repetitions','destination','platform','server']) if(data.config[key] != null) $(key).value=data.config[key];
    for(const p of (data.config.targets||[data.config.platform||'instagram'])) if($('target-'+p)) $('target-'+p).checked=true;
    initialized = true; updateMedia();platformUI();
  }
  $('keyStatus').textContent=profiles[platformSelect.value]?.hasKey?'Chave desta rede armazenada de forma privada; não exibida.':'Nenhuma chave cadastrada para esta rede.';
  const s=data.status;
  $('status').textContent=!s.online?'OBS indisponível':s.streaming?'OBS enviando para o distribuidor — confira cada saída':s.recording?'Teste local em gravação':'OBS pronto · sem transmissão';
  const labels={sending:'Enviando sinal — publicação não verificada',connecting:'Conectando',stopped:'Parada',failed:'Falha — confira servidor/chave e acesso da conta'};
  for(const [id,row] of Object.entries(networkRows)){
    const state=s.networks?.[id]?.state;
    row.status.textContent=platformNames[id]+': '+(!s.online?'status indisponível':labels[state]||(profiles[id]?.hasKey?'Credenciais salvas; sem sinal':'Configuração pendente'));
    row.stop.disabled=busy||!s.online||!['connecting','sending'].includes(state);
  }
  $('telemetry').textContent=JSON.stringify({atualizado:s.updatedAt?new Date(s.updatedAt).toLocaleString('pt-BR'):null,versao:s.version,fps:s.fps,cpu:s.cpu,modo:s.continuous?'Loop contínuo':s.durationSeconds===7200?'2 horas · encerramento automático':'Sessão com limite',segundosRestantes:s.remaining,quadrosPerdidos:s.droppedFrames},null,2);
  updateSessionDuration(s);
  $('sessionDuration').disabled=busy||s.streaming||s.recording;
  $('result').textContent=s.lastMessage||'';
  $('preview').disabled=busy||dirty||!s.online||s.streaming||s.recording;
  $('start').disabled=busy||dirty||!s.online||!selectedTargets().length||selectedTargets().some(p=>!profiles[p]?.hasKey||!profiles[p]?.server)||s.streaming||s.recording;
  $('stop').disabled=busy||!s.online;
}
$('config').addEventListener('input',()=>{dirty=true;$('preview').disabled=true;$('start').disabled=true;});
$('media').onchange=updateMedia; $('repetitions').onchange=updateMedia;
$('sessionDuration').onchange=()=>{try{updateSessionDuration();}catch(error){$('message').textContent=error.message;$('start').disabled=true;}};
$('config').onsubmit=async e=>{e.preventDefault();try{const body=Object.fromEntries(['title','media','repetitions','destination','platform','server','key'].map(k=>[k,$(k).value]));body.targets=selectedTargets();body.clearKey=$('clearKey').checked;await api('/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});$('key').value='';$('clearKey').checked=false;dirty=false;$('message').textContent='Configuração salva. Nenhuma transmissão iniciada.';await refresh();}catch(err){$('message').textContent=err.message;}};
for(const action of ['preview','start','stop']) $(action).onclick=async()=>{
  if (busy) return;
  let durationSeconds;
  if(action==='start') {
    try { durationSeconds=sessionDuration(); } catch(error) { $('message').textContent=error.message; return; }
    if (!$('reviewed').checked || !confirm('Enviar agora o mesmo vídeo para '+selectedTargets().map(p=>platformNames[p]).join(', ')+' por '+durationDescription()+'? As transmissões poderão ficar públicas imediatamente.')) return;
  }
  busy=true;
  for(const id of ['preview','start','stop','sessionDuration']) $(id).disabled=true;
  try{const data=await api('/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,confirm:action==='start'?'TRANSMITIR':undefined,...(durationSeconds!==undefined?{durationSeconds}:{})})});$('message').textContent=data.message;}catch(err){$('message').textContent=err.message;}finally{busy=false;await refresh().catch(()=>{});}
};
refresh().catch(e=>$('message').textContent=e.message);
setInterval(()=>refresh().catch(e=>{$('status').textContent='Sem atualização: '+e.message;for(const id of ['preview','start','stop'])$(id).disabled=true;}),5000);
import('/admin-live-lia.js').then(module=>module.mountLiveLia(document)).catch(()=>{const note=document.createElement('p');note.textContent='A preparação da Lia está indisponível. Os controles do estúdio continuam acima.';document.querySelector('main').append(note);});
