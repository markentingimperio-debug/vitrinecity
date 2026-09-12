const labels={queued:'Pergunta na fila',draft:'Rascunho para revisar',approved:'Texto aprovado',dismissed:'Descartada'};
export async function mountLiveLia(document,fetchImpl=globalThis.fetch){
  const host=document.querySelector('main');if(!host||document.getElementById('live-lia-panel'))return;
  const make=(tag,text)=>{const node=document.createElement(tag);if(text)node.textContent=text;return node;};
  const panel=make('section');panel.id='live-lia-panel';panel.className='card';host.append(panel);
  panel.append(make('h2','Lia no estúdio'),make('p','Prepare respostas com a Lia, revise o texto e teste a voz antes de exibir. As perguntas são adicionadas por você; os chats das redes ainda não alimentam esta fila.'),make('p','A apresentação usa retrato e voz sintética. A boca da personagem não se movimenta. Preparar uma resposta não inicia uma live.'));
  panel.append(make('small','Texto com IA e voz usam as APIs já configuradas, com cobrança por uso. Os limites abaixo contam tentativas de preparação; não representam um valor fechado em reais.'));
  const status=make('p'),message=make('p');message.setAttribute('role','status');message.setAttribute('aria-live','polite');panel.append(status,message);
  const manualCopy=make('textarea');manualCopy.readOnly=true;manualCopy.hidden=true;manualCopy.rows=5;manualCopy.style.width='100%';manualCopy.setAttribute('aria-label','Mensagem e link prontos para copiar');panel.append(manualCopy);
  const form=make('form'),pathLabel=make('label','Página da VitrineCity sobre esta conversa'),context=make('input');context.type='text';context.maxLength=240;context.value='/';context.id='live-lia-context';pathLabel.htmlFor=context.id;
  const questionLabel=make('label','Pergunta selecionada da audiência'),question=make('textarea');question.id='live-lia-question';questionLabel.htmlFor=question.id;question.maxLength=600;question.rows=3;question.required=true;question.style.width='100%';
  const submit=make('button','Adicionar à fila');submit.type='submit';form.append(pathLabel,context,questionLabel,question,make('small','Não inclua telefone, e-mail, documentos nem dados privados de quem comentou.'),submit);panel.append(form);
  const refreshButton=make('button','Atualizar fila e status do estúdio');refreshButton.type='button';const list=make('div');panel.append(refreshButton,list);
  let state=null,busy=false,clientKey=globalThis.crypto.randomUUID(),poll=null,closed=false;
  const api=async(url='',body)=>{const response=await fetchImpl('/api/admin/live-studio/lia'+url,body===undefined?{headers:{accept:'application/json'}}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||([401,403].includes(response.status)?'Entre na administração para preparar a Lia.':'Não foi possível concluir. Atualize a fila para conferir o estado.'));return data;};
  const button=(label,run,disabled=false)=>{const node=make('button',label);node.type='button';node.disabled=disabled||busy;node.addEventListener('click',run);return node;};
  function render(){
    if(!state)return;const quota=state.quota;
    status.textContent=`Voz: ${quota.voice.used} de ${quota.voice.limit} preparações hoje. Texto com IA: ${quota.text.used} de ${quota.text.limit}. Rascunhos do catálogo não chamam IA. ${state.canPrepare?'Preparação disponível.':'Preparação pausada.'} ${state.voiceConfigured?'Voz configurada.':'Voz ainda não configurada.'}`;
    submit.disabled=busy||!state.canPrepare;refreshButton.disabled=busy;list.replaceChildren();
    for(const item of state.items){
      const card=make('article');card.className='card';card.append(make('h3',item.question),make('p',`${labels[item.status]||'Em conferência'} · ${item.context.title}`));
      if(!item.sourceCurrent)card.append(make('p','A página ou a oferta mudou. Adicione a pergunta novamente para usar informações atuais.'));
      if(['requesting','uncertain'].includes(item.aiState))card.append(make('p','O pedido à IA precisa de conferência. Não será repetido automaticamente; você pode escrever a resposta após a operação terminar.'));
      if(['preparing','uncertain'].includes(item.voiceState))card.append(make('p','A voz está em preparação ou precisa de conferência. Atualizar esta tela não refaz a geração.'));
      if(item.status==='dismissed'){list.append(card);continue;}
      const blocked=!state.canPrepare||!item.sourceCurrent;
      if(item.status==='queued'&&!item.aiState){
        card.append(button('Criar rascunho do catálogo',()=>mutate('/questions/'+item.id+'/draft',{revision:item.revision,mode:'catalog'}),blocked));
        card.append(button('Gerar rascunho com IA',()=>mutate('/questions/'+item.id+'/draft',{revision:item.revision,mode:'ai'}),blocked||!state.textConfigured||quota.text.remaining<=0));
      }
      const reply=make('textarea');reply.value=item.reply;reply.maxLength=600;reply.rows=5;reply.style.width='100%';reply.setAttribute('aria-label','Texto da resposta para revisão');reply.disabled=busy||Boolean(item.voiceState);card.append(reply);
      const offer=make('select');offer.setAttribute('aria-label','Oferta mostrada com esta resposta');const none=make('option','Sem oferta');none.value='';offer.append(none);
      for(const option of item.offers){const node=make('option',option.title);node.value=option.id;offer.append(node);}offer.value=item.offer?.id||'';offer.disabled=busy||Boolean(item.voiceState);card.append(offer);
      if(item.offer){const link=make('a','Conferir '+item.offer.title);link.href=item.offer.url;link.target='_blank';link.rel='noopener';card.append(link);if(item.offer.disclosure)card.append(make('small',item.offer.disclosure));}
      if(item.status==='approved'&&item.offer)card.append(button('Copiar mensagem e link do produto',()=>copyMessage(item),!item.sourceCurrent));
      if(!item.voiceState){
        const checkLabel=make('label'),reviewed=make('input');checkLabel.className='check';reviewed.type='checkbox';checkLabel.append(reviewed,document.createTextNode('Revisei esta resposta, os detalhes e os direitos do conteúdo.'));card.append(checkLabel);
        card.append(button('Aprovar este texto',()=>{if(!reviewed.checked){message.textContent='Marque a revisão do texto antes de aprovar.';return;}void mutate('/questions/'+item.id+'/review',{revision:item.revision,reply:reply.value,offerId:offer.value||null,approved:true});},blocked));
      }
      if(item.status==='approved'&&!item.voiceState)card.append(button('Preparar voz e retrato — usa 1 preparação',()=>mutate('/questions/'+item.id+'/voice',{revision:item.revision,expectedHash:item.approvedHash}),blocked||!state.voiceConfigured||quota.voice.remaining<=0));
      if(item.media&&item.voiceState==='ready'){
        const video=make('video');video.controls=true;video.preload='metadata';video.src=item.media.previewUrl;card.append(video,make('p',`Clipe pronto: ${Math.ceil(item.media.duration)} segundos. Ouça e confira antes de exibir.`));
        const active=state.studio.streaming||state.studio.recording,answerBusy=state.studio.answer?.cleanupPending||['claimed','playing'].includes(state.studio.answer?.state);
        card.append(button('Testar resposta no OBS — privado',()=>mutate('/control',{action:'preview-answer',answerId:item.id,expectedHash:item.approvedHash},true),blocked||!state.studio.online||active||answerBusy));
        card.append(button('Exibir resposta na sessão ativa',()=>mutate('/control',{action:'play-answer',answerId:item.id,expectedHash:item.approvedHash},true),blocked||!state.studio.online||!active||answerBusy));
      }
      const playback=state.studio.answer;if(playback?.answerId===item.id){const label={claimed:'Comando recebido pelo estúdio.',playing:'O estúdio está exibindo a resposta.',finished:'O estúdio terminou de exibir a resposta.',failed:'A exibição falhou. Confira o estúdio.',interrupted:'A exibição foi interrompida. Não será repetida automaticamente.'}[playback.state]||'Conferindo a exibição.';card.append(make('p',label+' Isso não confirma publicação nas redes.'));}
      card.append(button('Descartar pergunta',()=>mutate('/questions/'+item.id+'/review',{revision:item.revision,dismiss:true})));list.append(card);
    }
  }
  async function refresh(){if(closed)return;try{state=await api();if(!closed)render();}catch(error){message.textContent=error.message;submit.disabled=true;}}
  async function copyMessage(item){
    if(busy||closed)return;busy=true;render();manualCopy.hidden=true;
    try{const data=await api('/questions/'+item.id+'/share');if(data.sent!==false||data.sourceCurrent!==true||typeof data.text!=='string')throw Error('Confira a mensagem na fila antes de compartilhar.');
      try{if(typeof globalThis.navigator?.clipboard?.writeText!=='function')throw Error('clipboard_unavailable');await globalThis.navigator.clipboard.writeText(data.text);message.textContent='Mensagem e link copiados. Cole no chat desejado; nenhum envio foi feito pela plataforma.';}
      catch{manualCopy.value=data.text;manualCopy.hidden=false;manualCopy.focus?.();manualCopy.select?.();message.textContent='A mensagem está no campo abaixo para você copiar. Nenhum envio foi feito.';}
    }catch(error){message.textContent=error.message;}finally{busy=false;render();}
  }
  async function mutate(url,body,watch=false){
    if(busy||closed)return;busy=true;render();message.textContent='Preparando. Aguarde a confirmação…';
    try{const result=await api(url,body);message.textContent=result.accepted?'Comando enviado ao estúdio. Acompanhe o status abaixo; a publicação nas redes não foi confirmada.':'Etapa salva. Nenhuma transmissão foi iniciada.';if(watch){let attempts=0;clearInterval(poll);poll=setInterval(()=>{if(++attempts>12||closed){clearInterval(poll);return;}void refresh();},5000);}}
    catch(error){message.textContent=error.message;}
    finally{busy=false;await refresh();}
  }
  form.addEventListener('submit',async event=>{event.preventDefault();if(busy)return;busy=true;render();try{await api('/questions',{clientKey,contextPath:context.value,question:question.value});clientKey=globalThis.crypto.randomUUID();question.value='';message.textContent='Pergunta adicionada. Escolha como preparar a resposta.';}catch(error){message.textContent=error.message;}finally{busy=false;await refresh();}});
  refreshButton.addEventListener('click',()=>void refresh());
  globalThis.addEventListener?.('pagehide',()=>{closed=true;clearInterval(poll);},{once:true});
  await refresh();return {refresh,close(){closed=true;clearInterval(poll);}};
}
