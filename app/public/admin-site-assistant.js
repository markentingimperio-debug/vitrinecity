const root=document.querySelector('#site-assistant-admin');
const endpoint='/api/admin/site-assistant/experiments';
const money=n=>(Number(n||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=value=>value?new Date(value).toLocaleString('pt-BR'):'Ainda não disponível';
const approaches={helpful_question:'Pergunta acolhedora',simple_choices:'Escolhas simples',direct_product:'Produto relacionado',checkout_help:'Ajuda para comprar'};
const reasons={initial:'Primeira abordagem',few_opens:'Poucas conversas abertas',few_messages:'Poucas respostas ao convite',few_offer_clicks:'Poucos cliques nas opções',no_attributed_payment:'Sem pagamento atribuído',signups_without_paid_orders:'Houve cadastros; a orientação de compra continua em avaliação'};
const statuses={collecting:'Coletando resultados',no_traffic:'Sem visitas suficientes para revisar',conversion_observed:'Conversão observada; abordagem mantida',awaiting_payment:'Aguardando pagamento de pedidos',trial_low_traffic:'Nova tentativa com pouco tráfego',trial_started:'Nova abordagem em avaliação',manual_rollback:'Abordagem anterior restaurada'};
const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
let snapshot;
function render(data,learning=null,contacts=null){
  snapshot=data;root.replaceChildren();
  root.append(el('h2','Atendimento no site'),el('p',`Versão ${data.current.number} · ${approaches[data.current.approach]||'Em avaliação'}`));
  const explanation=el('p','O chat acolhe visitantes e indica opções relacionadas ao que procuram. Cada nova abordagem é uma tentativa: a melhoria precisa ser demonstrada pelos resultados.');
  root.append(explanation);
  const metrics=el('div',undefined,'site-assistant-metrics');
  for(const [label,value] of [['Visitas atendidas',data.metrics.sessions],['Convites exibidos',data.metrics.invitations],['Conversas abertas',data.metrics.opens],['Mensagens',data.metrics.messages],['Cliques nas opções',data.metrics.offerClicks],['Cadastros confirmados',data.metrics.signups],['Compras pagas',data.metrics.paidOrders],['Receita atribuída',money(data.metrics.revenueCents)]]){
    const item=el('div');item.append(el('strong',String(value??0)),el('span',label));metrics.append(item);
  }
  root.append(metrics,el('p',`Janela: ${date(data.metrics.windowStart)} a ${date(data.metrics.windowEnd)}.`),el('p',`${statuses[data.review.status]||'Em avaliação'}. Próxima revisão: ${date(data.review.nextAt)}.`),el('p','Compras de afiliados em sites externos não são confirmadas por um clique. Os resultados de vendas externas ficam como desconhecidos.','site-assistant-note'));
  const list=el('div',undefined,'site-assistant-versions');
  for(const version of data.versions){
    const item=el('article');item.append(el('h3',`Versão ${version.number} · ${approaches[version.approach]||version.approach}`));
    const reason=reasons[version.reasonCode]||(version.reasonCode.startsWith('rollback_version_')?'Restauração de uma abordagem anterior':'Revisão registrada');
    item.append(el('p',`${reason}. ${version.confidence==='low'?'Amostra pequena; resultado ainda incerto.':''}`),el('p',`${version.paidOrders||0} compras pagas · ${version.signups||0} cadastros · ${money(version.revenueCents)}`));
    if(version.id===data.current.id)item.append(el('strong','Em uso'));
    else {
      const button=el('button','Restaurar esta abordagem');button.type='button';button.addEventListener('click',async()=>{
        button.disabled=true;
        try{const response=await fetch(endpoint+'/rollback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({versionId:version.id,revision:snapshot.revision})});const result=await response.json();if(!response.ok)throw Error(result.error||'Não foi possível restaurar.');render(result);status.textContent='Abordagem restaurada. As conversas já iniciadas continuam com sua versão original.';}
        catch(error){status.textContent=error.message;button.disabled=false;}
      });item.append(button);
    }
    list.append(item);
  }
  const history=el('details');history.append(el('summary','Ver revisões registradas'));
  for(const review of data.history||[])history.append(el('p',`${date(review.windowEnd)} · ${statuses[review.status]||review.status} · ${review.metrics.sessions} visitas, ${review.metrics.paidOrders} compras.`));
  const neural=el('aside',undefined,'site-assistant-learning');
  neural.append(el('h3','Aprendizado agregado'),el('p',learning?.enabled?'A Lia envia somente métricas agregadas para candidatos de revisão. Conversas, nomes e contatos ficam fora do aprendizado.':'Aprendizado agregado pausado nesta instalação.'),el('p',`Candidatos: ${learning?.candidateLessons??0} · Sincronizações: ${learning?.syncedReviews??0} · Promoções automáticas: 0`));
  const contactsPanel=el('details','', 'site-assistant-contacts');contactsPanel.append(el('summary',`Contatos com consentimento (${contacts?.items?.length??0} exibidos)`));
  contactsPanel.append(el('p','Os números ficam protegidos. Esta lista mostra apenas pessoas que autorizaram convite, conteúdo ou ofertas; cancelamentos permanecem registrados.'));
  for(const item of (contacts?.items||[]).slice(0,50))contactsPanel.append(el('p',`${item.phone} · ${item.purpose} · ${item.followupStatus==='sent'?'acompanhamento enviado':item.followupStatus==='cancelled'?'cancelado':'acompanhamento pendente'}`));
  root.append(list,history,neural,contactsPanel,status);
}
const status=el('p');status.setAttribute('role','status');
async function load(){try{const [response,learningResponse,contactsResponse]=await Promise.all([fetch(endpoint,{cache:'no-store'}),fetch('/api/admin/site-assistant/learning',{cache:'no-store'}),fetch('/api/admin/site-assistant/contacts?limit=50',{cache:'no-store'})]);if(!response.ok)throw Error('Não foi possível carregar os resultados do atendimento.');render(await response.json(),learningResponse.ok?await learningResponse.json():null,contactsResponse.ok?await contactsResponse.json():null);}catch(error){status.textContent=error.message;root.append(status);}}
if(root){load();setInterval(()=>{if(!document.hidden&&!root.contains(document.activeElement))load();},60000);}
