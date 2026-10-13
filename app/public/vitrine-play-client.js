(() => {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const $=selector=>document.querySelector(selector);
  if(document.body.dataset.playMode==='public') {
    const data=$('#play-data');if(!data)return;
    const {series,selected}=JSON.parse(data.textContent),video=$('#play-video');if(!video)return;
    let current=series.episodes.find(e=>e.number===selected),marathon=false,lastSaved=0;
    const key='vitrine-play:'+series.slug;
    const status=message=>{$('#play-status').textContent=message;};
    function selectEpisode(number,play=false) {
      const next=series.episodes.find(e=>e.number===number);if(!next)return;
      current=next;video.pause();video.src=next.mediaUrl;video.querySelectorAll('track').forEach(t=>t.remove());
      if(next.captionUrl){const track=document.createElement('track');track.kind='captions';track.srclang='pt-BR';track.label='Português';track.src=next.captionUrl;track.default=true;video.append(track);}
      $('#episode-title').textContent=next.title;$('#episode-summary').textContent=next.summary;status('');
      document.querySelectorAll('[data-episode]').forEach(a=>a.classList.toggle('active',Number(a.dataset.episode)===number));
      const u=new URL(location.href);u.pathname='/series/'+series.slug+'/'+number;history.replaceState(null,'',u);
      if(play)video.play().catch(()=>status('Toque em reproduzir para continuar.'));
    }
    document.querySelectorAll('[data-episode]').forEach(a=>a.addEventListener('click',event=>{
      if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();selectEpisode(Number(a.dataset.episode),true);
    }));
    try {
      const saved=JSON.parse(localStorage.getItem(key)||'null');
      if(saved&&series.episodes.some(e=>e.number===saved.number)&&Number.isFinite(saved.seconds)&&saved.seconds>=0){
        $('#resume-play').hidden=false;$('#resume-play').addEventListener('click',()=>{
          video.addEventListener('loadedmetadata',()=>{video.currentTime=Math.min(saved.seconds,Math.max(0,video.duration-1));video.play().catch(()=>{});},{once:true});
          selectEpisode(saved.number);$('#resume-play').hidden=true;
        });
      }
    } catch { /* Private browsing may deny local storage. Playback still works. */ }
    video.addEventListener('timeupdate',()=>{if(Date.now()-lastSaved<4000)return;lastSaved=Date.now();try{localStorage.setItem(key,JSON.stringify({number:current.number,seconds:video.currentTime}));}catch{}});
    video.addEventListener('error',()=>status('O vídeo está indisponível no momento. Tente outro capítulo ou volte mais tarde.'));
    video.addEventListener('ended',()=>{const next=series.episodes[series.episodes.indexOf(current)+1];if(marathon&&next)selectEpisode(next.number,true);else status(next?'Próximo capítulo disponível na lista.':'Você chegou ao último capítulo disponível.');});
    $('#marathon').addEventListener('click',()=>{marathon=!marathon;$('#marathon').textContent=marathon?'Maratona ativada — desativar':'Maratonar capítulos disponíveis';video.play().catch(()=>{});});
    $('#share-play').addEventListener('click',async()=>{try{const url=new URL('/series/'+series.slug+'/'+current.number,location.origin).href;if(navigator.share)await navigator.share({title:series.title,url});else{await navigator.clipboard.writeText(url);status('Link copiado.');}}catch{status('Compartilhamento cancelado ou indisponível. Copie o endereço da página.');}});
    return;
  }
  if(document.body.dataset.playMode!=='admin')return;
  let state=null;
  const notice=message=>{$('#admin-status').textContent=message;};
  async function request(path,method='GET',body) {
    const response=await fetch('/api/admin/series'+path,{method,credentials:'same-origin',headers:{accept:'application/json',...(body!==undefined?{'content-type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    if(!response.headers.get('content-type')?.includes('application/json'))throw Error('Entre na administração para continuar.');
    const data=await response.json();if(!response.ok)throw Error(data.error||'Não foi possível concluir.');return data;
  }
  const localDate=v=>v?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(v)):'Sem data';
  const localInput=v=>v?new Date(Date.parse(v)-3*3600000).toISOString().slice(0,16):'';
  const field=(label,name,value='',type='text',extra='')=>`<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
  const area=(label,name,value='',rows=4)=>`<label>${esc(label)}<textarea name="${name}" rows="${rows}">${esc(value)}</textarea></label>`;
  const stageLabel={script:'Roteiro',scenes:'Cenas',voices:'Vozes ElevenLabs',video:'Vídeo Kling',lipsync:'Lip-sync HeyGen',edit:'Edição HeyGen/FFmpeg',clips:'Clipes',social:'Redes'};
  const statusLabel={draft:'Rascunho',producing:'Em produção',review:'Aguardando revisão',approved:'Aprovado/agendado',published:'Publicado',queued:'Na fila',leased:'Executando',completed:'Concluído',uncertain:'Reconciliar',blocked:'Bloqueado',cancelled:'Cancelado'};
  function modal(title,html,onSave) {
    const d=document.createElement('dialog');d.innerHTML=`<form><h2>${esc(title)}</h2>${html}<p class="form-error" role="alert"></p><div class="actions"><button type="submit" class="button">Salvar</button><button type="button" class="secondary" data-close>Cancelar</button></div></form>`;
    document.body.append(d);d.querySelector('[data-close]').onclick=()=>d.close();d.addEventListener('close',()=>d.remove());
    d.querySelector('form').onsubmit=async event=>{event.preventDefault();const button=d.querySelector('[type=submit]');button.disabled=true;try{await onSave(Object.fromEntries(new FormData(event.target)));d.close();await load();}catch(error){d.querySelector('.form-error').textContent=error.message;}finally{button.disabled=false;}};d.showModal();
  }
  function editSeries(s={}) {
    modal(s.id?'Editar série':'Nova série',field('Título','title',s.title,'text','required maxlength="120"')+field('Identificador do link (ex.: ela-ja-sabia)','slug',s.slug,'text',s.id?'readonly':'required pattern="[a-z0-9]+(-[a-z0-9]+)*"')+field('Gênero','genre',s.genre||'Drama')+field('Quantidade planejada de capítulos','plannedEpisodes',s.plannedEpisodes||12,'number','min="1" max="100"')+area('Sinopse pública','synopsis',s.synopsis)+area('Bíblia da série: história, continuidade, roupas e cenários','bible',s.bible,7)+area('Personagens (JSON): id, name, description, elementId, klingApiElementId, voiceId, referenceUrl, continuity','characters',JSON.stringify(s.characters||[],null,2),8)+field('Capa: caminho de mídia ou URL de CDN autorizado','posterUrl',s.posterUrl)+field('Temporada em arquivo único (opcional, após todos os capítulos)','compilationUrl',s.compilationUrl)+`<label>Visibilidade<select name="status"><option value="draft">Rascunho — privado</option><option value="live" ${s.status==='live'?'selected':''}>Visível no catálogo</option></select></label>`,async data=>{data.characters=JSON.parse(data.characters||'[]');await request(s.id?'/'+s.id:'',s.id?'PUT':'POST',data);});
  }
  function editEpisode(e={}) {
    if(!state.series.length){notice('Cadastre uma série primeiro.');return;}
    const options=state.series.map(s=>`<option value="${esc(s.id)}" ${s.id===e.seriesId?'selected':''}>${esc(s.title)}</option>`).join('');
    modal(e.id?'Editar capítulo (exige nova aprovação)':'Novo capítulo',`<label>Série<select name="seriesId" ${e.id?'disabled':''}>${options}</select></label>`+field('Número do capítulo','number',e.number||1,'number',e.id?'readonly':'min="1" max="100" required')+field('Título','title',e.title,'text','required maxlength="140"')+area('Resumo público sem revelar o desfecho','summary',e.summary)+field('Duração planejada em segundos','targetSeconds',e.targetSeconds||80,'number','min="60" max="90"')+field('Lançamento — Brasília (UTC−3)','releaseAt',localInput(e.releaseAt),'datetime-local','required')+field('Limite total de geração deste capítulo (R$). Zero bloqueia custo.','budgetBrl',(e.budgetCents||0)/100,'number','min="0" max="10000" step="0.01"')+area('Roteiro: personagens, falas, narrador e trilha','script',e.script,8)+area('Cenas (JSON, opcional)','scenes',JSON.stringify(e.scenes||[],null,2),5)+field('Vídeo final: mídia local ou CDN autorizado','mediaUrl',e.mediaUrl)+field('Duração real do vídeo final (segundos)','duration',e.duration||'','number','min="60" max="90"')+field('Legenda WebVTT (opcional)','captionUrl',e.captionUrl)+field('Clipe para redes (opcional)','clipUrl',e.clipUrl)+`<p>Salvar uma alteração retira o capítulo de exibição e invalida a aprovação anterior. Nenhuma cobrança é iniciada por este formulário.</p>`,async data=>{data.scenes=JSON.parse(data.scenes||'[]');data.releaseAt=data.releaseAt?new Date(data.releaseAt+':00-03:00').toISOString():null;data.revision=e.revision;await request(e.id?'/episodes/'+e.id:'/episodes',e.id?'PUT':'POST',data);});
  }
  function approveEpisode(e) {
    modal('Revisar capítulo '+e.number,`<p>${esc(e.title)}</p>${e.mediaUrl?`<video class="admin-preview" controls playsinline preload="metadata" src="${esc(e.mediaUrl)}"></video>`:'<p>Adicione primeiro um vídeo final.</p>'}<label class="check"><input name="reviewed" type="checkbox" required>Assisti ao vídeo completo e conferi duração, áudio, legendas e continuidade.</label><label class="check"><input name="rightsConfirmed" type="checkbox" required>Tenho autorização de uso dos vídeos, imagens, vozes e trilhas.</label><p>A publicação no site ocorrerá somente a partir de ${esc(localDate(e.releaseAt))}, se a série estiver visível. Redes sociais exigem aprovação separada.</p>`,async()=>request('/episodes/'+e.id+'/approve','POST',{revision:e.revision,reviewed:true,rightsConfirmed:true}));
  }
  async function packet(e) {
    const data=await request('/episodes/'+e.id+'/packet');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='vitrine-play-capitulo-'+e.number+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice('Pacote exportado: roteiro, tarefas, regras de produção e rascunho de tráfego com link rastreável.');
  }
  async function seedPilot() {
    if(!confirm('Criar o piloto original “Ela Já Sabia” como rascunho, sem gerar mídia ou gastar créditos?'))return;
    const s=await request('','POST',{title:'Ela Já Sabia',slug:'ela-ja-sabia',genre:'Drama · segredos e reviravoltas',plannedEpisodes:12,status:'draft',synopsis:'Ana prepara um jantar para confrontar uma traição. Mas uma assinatura falsificada revela um segredo que vai muito além do casamento.',bible:'Obra original. Todos os personagens são adultos fictícios. Ana percebe a traição, mas investiga com inteligência e sem violência. O mistério central é a tentativa de vender a casa herdada da mãe. Capítulos de 60 a 90 segundos; narrador breve; diálogo conduz o conflito; final com pergunta ou revelação. Preservar aparência, roupa por sequência, planta da casa e voz de cada personagem. Não copiar cenas, músicas, imagens ou falas de novelas existentes.',characters:[{id:'ana',name:'Ana',description:'Protagonista adulta, firme, emoção contida.',elementId:'322331458310022',klingApiElementId:'',voiceId:'',referenceUrl:'',continuity:'Identidade permanente em todos os capítulos. Preservar rosto, cabelo e proporções; trocar figurino somente quando o roteiro indicar mudança de sequência.'},{id:'marcos',name:'Marcos',description:'Marido adulto, seguro na aparência, hesitante ao ser confrontado.',elementId:'322331477308921',klingApiElementId:'',voiceId:'',referenceUrl:'',continuity:'Identidade permanente em todos os capítulos. Preservar rosto, barba, cabelo e proporções; figurino segue continuidade.'},{id:'bia',name:'Bia',description:'Amiga adulta, próxima e afetuosa; esconde sua participação.',elementId:'322331937685489',klingApiElementId:'',voiceId:'',referenceUrl:'',continuity:'Identidade permanente em todos os capítulos. Preservar rosto, cabelo e proporções; figurino segue continuidade.'},{id:'narrador',name:'Narrador',description:'Voz distinta do elenco. Intervenções breves.',elementId:'',klingApiElementId:'',voiceId:'',referenceUrl:'',continuity:'Somente voz; não possui identidade visual.'}]});
    await request('/episodes','POST',{seriesId:s.id,number:1,title:'A traição era só o começo',summary:'Um jantar, uma fotografia e uma pergunta que ninguém esperava.',targetSeconds:80,budgetBrl:0,script:'00–07 | Detalhe da mesa posta. Narrador: “Ana preparou um jantar. Mas não estava comemorando o casamento.”\n07–18 | Marcos se senta. Marcos: “Você disse que era uma surpresa.” Ana: “É. E eu queria que a Bia estivesse aqui.”\n18–30 | Bia entra; vê Marcos e hesita. Bia: “Aconteceu alguma coisa?” Ana coloca uma fotografia na mesa.\n30–42 | Ana: “Eu sei sobre vocês dois.” Marcos: “Você está entendendo tudo errado.”\n42–55 | Reação silenciosa de Bia. Ana: “A traição eu já sabia.” Trilha diminui; som do relógio.\n55–68 | Ana apresenta um anúncio impresso. Ana: “Quero saber por que colocaram a minha casa à venda.”\n68–80 | Bia: “Marcos, você disse que ela tinha assinado.” Ana: “Assinado o quê?” Corte antes da resposta.',scenes:[
      {number:1,seconds:10,description:'Plano detalhe da mesa de jantar preparada. Ana organiza os talheres; câmera lenta aproxima do rosto dela. Ana não fala; manter identidade, blusa preta e expressão controlada.',dialogue:'Narrador: Ana preparou um jantar. Mas não estava comemorando o casamento.'},
      {number:2,seconds:5,description:'Marcos chega e senta à mesa. Close médio somente nele durante a fala; Ana fica fora de foco ou de costas. Manter camisa azul-marinho e identidade permanente.',dialogue:'Marcos: Você disse que era uma surpresa.'},
      {number:3,seconds:5,description:'Contraplano em Ana, única boca visível falando. Marcos aparece apenas de costas. Preservar rosto, cabelo e blusa preta.',dialogue:'Ana: É. E eu queria que a Bia estivesse aqui.'},
      {number:4,seconds:10,description:'Bia entra pela porta, vê Marcos e hesita. Close nela durante a fala; Ana e Marcos ficam em reação sem boca falando. Preservar roupa vinho.',dialogue:'Bia: Aconteceu alguma coisa?'},
      {number:5,seconds:5,description:'Ana coloca uma fotografia sobre a mesa e encara os dois. Close em Ana durante a fala; Bia e Marcos apenas reagem.',dialogue:'Ana: Eu sei sobre vocês dois.'},
      {number:6,seconds:5,description:'Close em Marcos, único personagem falando. Ana e Bia fora de foco. Expressão defensiva, mesma camisa azul-marinho.',dialogue:'Marcos: Você está entendendo tudo errado.'},
      {number:7,seconds:10,description:'Reação silenciosa de Bia e corte para Ana, que fala em close. Música reduz e entra som discreto de relógio.',dialogue:'Ana: A traição eu já sabia.'},
      {number:8,seconds:10,description:'Ana desliza um anúncio de imóvel sobre a mesa. Plano sobre o ombro de Marcos; apenas Ana fala de frente.',dialogue:'Ana: Quero saber por que colocaram a minha casa à venda.'},
      {number:9,seconds:10,description:'Close em Bia encarando Marcos, tensa. Bia é a única boca visível durante a fala; Marcos reage em silêncio.',dialogue:'Bia: Marcos, você disse que ela tinha assinado.'},
      {number:10,seconds:10,description:'Close final em Ana. Silêncio curto antes da pergunta. Depois da fala, cortar para o olhar de Marcos sem resposta, criando cliffhanger.',dialogue:'Ana: Assinado o quê?'}
    ]});
    await load();notice('Piloto criado como rascunho. Faltam vozes/referências, data, cenas e vídeo. Nenhuma API paga foi acionada.');
  }
  function render() {
    const published=state.episodes.filter(e=>e.status==='published').length;
    const currentJobs=state.jobs.filter(j=>state.episodes.some(e=>e.id===j.episode_id&&e.revision===j.revision));
    $('#play-admin').innerHTML=`<div class="stats"><div><b>${state.series.length}</b><span>Séries</span></div><div><b>${state.episodes.length}</b><span>Capítulos cadastrados</span></div><div><b>${published}</b><span>Publicados</span></div><div><b>R$ 0</b><span>Tráfego ativado pelo módulo</span></div></div><div class="notice">${state.worker.credentialsConfigured?'Credencial de worker configurada; isto não comprova conexão ou geração.':'Worker de produção ainda não configurado.'} O catálogo e a publicação de vídeos revisados funcionam independentemente. Anúncios: somente rascunhos.</div><div class="actions"><button class="button" data-action="new-series">Nova série</button><button class="secondary" data-action="new-episode">Novo capítulo</button><button class="secondary" data-action="pilot">Criar piloto original</button><button class="secondary" data-action="release">Verificar lançamentos aprovados</button><button class="secondary" data-action="refresh">Atualizar</button></div><h2>Catálogo</h2><div class="admin-series-grid">${state.series.map(s=>`<article class="panel"><small>${s.status==='live'?'Visível':'Rascunho privado'} · GRATUITO</small><h3>${esc(s.title)}</h3><p>${esc(s.synopsis)}</p><button class="secondary" data-action="edit-series" data-id="${s.id}">Editar série e personagens</button> <a href="/series/${esc(s.slug)}" target="_blank" rel="noopener">Abrir catálogo</a></article>`).join('')||'<p>Cadastre uma série ou crie o piloto original para começar.</p>'}</div><h2>Capítulos e lançamentos</h2><div class="table-scroll"><table><thead><tr><th>Série / capítulo</th><th>Lançamento (Brasília)</th><th>Situação</th><th>Ações</th></tr></thead><tbody>${state.episodes.map(e=>`<tr><td><small>${esc(state.series.find(s=>s.id===e.seriesId)?.title)}</small><strong>${e.number}. ${esc(e.title)}</strong><small>Revisão ${e.revision} · Limite R$ ${(e.budgetCents/100).toFixed(2)}</small></td><td>${esc(localDate(e.releaseAt))}</td><td>${esc(statusLabel[e.status]||e.status)}</td><td><div class="row-actions"><button data-action="edit-episode" data-id="${e.id}">Editar</button><button data-action="plan" data-id="${e.id}">Planejar produção</button><button data-action="approve" data-id="${e.id}">Revisar vídeo</button><button data-action="approve-social" data-id="${e.id}">Revisar clipe/redes</button><button data-action="packet" data-id="${e.id}">Exportar pacote</button></div></td></tr>`).join('')||'<tr><td colspan="4">Nenhum capítulo cadastrado.</td></tr>'}</tbody></table></div><h2>Fila de criação e publicação</h2><p>As datas de estreia não iniciam uma geração sem worker. Custos incertos exigem reconciliação; não repetimos automaticamente.</p><div class="table-scroll"><table><thead><tr><th>Capítulo</th><th>Etapa</th><th>Estado</th><th>Custo reservado/real</th><th>Observação</th></tr></thead><tbody>${currentJobs.map(j=>`<tr><td>${esc(state.episodes.find(e=>e.id===j.episode_id)?.title)}</td><td>${esc(stageLabel[j.stage]||j.stage)}</td><td>${esc(statusLabel[j.status]||j.status)}</td><td>R$ ${(j.reserved_cents/100).toFixed(2)}</td><td>${esc(j.error)}${j.status==='uncertain'?`<button data-action="reconcile" data-id="${j.id}">Reconciliar sem cobrança</button>`:''}</td></tr>`).join('')||'<tr><td colspan="5">A fila aparece depois de planejar um capítulo.</td></tr>'}</tbody></table></div>`;
  }
  async function load(){state=await request('');render();notice('Painel atualizado. Nenhuma geração ou campanha é iniciada ao abrir esta página.');}
  $('#play-admin').addEventListener('click',async event=>{
    const button=event.target.closest('[data-action]');if(!button)return;const {action,id}=button.dataset,e=state.episodes.find(x=>x.id===id);
    button.disabled=true;
    try {
      if(action==='new-series')editSeries();if(action==='edit-series')editSeries(state.series.find(s=>s.id===id));
      if(action==='new-episode')editEpisode();if(action==='edit-episode')editEpisode(e);
      if(action==='approve')approveEpisode(e);if(action==='packet')await packet(e);
      if(action==='plan'){await request('/episodes/'+id+'/plan','POST',{});await load();notice('Etapas enfileiradas. A execução depende do worker, das aprovações e do limite de custo.');}
      if(action==='release'){const r=await request('/release','POST',{});await load();notice(r.published+' capítulo(s) publicado(s).');}
      if(action==='refresh')await load();if(action==='pilot')await seedPilot();
      if(action==='approve-social'){
        if(!e.clipUrl)throw Error('Adicione ou gere o clipe antes da revisão.');
        modal('Revisar clipe e autorizar publicação nas redes',`<video class="admin-preview" controls playsinline preload="metadata" src="${esc(e.clipUrl)}"></video><label class="check"><input required type="checkbox">Revisei o clipe, os direitos e a identificação de conteúdo gerado por IA.</label><label class="check"><input required type="checkbox">Autorizo publicar este clipe nas contas conectadas e aprovadas no worker. Não autorizo anúncios pagos.</label>`,async()=>request('/episodes/'+id+'/approve-social','POST',{revision:e.revision,reviewed:true,clipUrl:e.clipUrl}));
      }
      if(action==='reconcile'&&confirm('Você verificou no provedor que esta tarefa NÃO foi executada e NÃO gerou cobrança? Um resultado incerto não deve ser reenviado sem essa verificação.')){await request('/jobs/'+id+'/reconcile','POST',{confirmNotExecuted:true});await load();}
    }catch(error){notice(error.message);}finally{button.disabled=false;}
  });
  load().catch(error=>notice(error.message));
})();
