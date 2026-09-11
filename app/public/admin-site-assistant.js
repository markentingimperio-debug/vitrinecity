const root=document.querySelector('#site-assistant-admin');
const endpoint='/api/admin/site-assistant/experiments';
const money=n=>n!==null&&n!==undefined&&Number.isFinite(Number(n))?(Number(n)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'Não disponível';
const date=value=>value&&Number.isFinite(new Date(value).getTime())?new Date(value).toLocaleString('pt-BR'):'Ainda não disponível';
const approaches={helpful_question:'Pergunta acolhedora',simple_choices:'Escolhas simples',direct_product:'Produto relacionado',checkout_help:'Ajuda para comprar'};
const reasons={initial:'Primeira abordagem',few_opens:'Poucas conversas abertas',few_messages:'Poucas respostas ao convite',few_offer_clicks:'Poucos cliques nas opções',no_attributed_payment:'Sem pagamento atribuído',signups_without_paid_orders:'Houve cadastros; a orientação de compra continua em avaliação'};
const statuses={collecting:'Coletando resultados',no_traffic:'Sem visitas suficientes para revisar',conversion_observed:'Conversão observada; abordagem mantida',awaiting_payment:'Aguardando pagamento de pedidos',trial_low_traffic:'Nova tentativa com pouco tráfego',trial_started:'Nova abordagem em avaliação',manual_rollback:'Abordagem anterior restaurada'};
const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
const paymentStatuses={approved:['Pagamento aprovado','paid'],pending:['Aguardando pagamento','pending'],in_process:['Pagamento em análise','pending'],authorized:['Autorizado · pagamento não confirmado','pending'],rejected:['Pagamento recusado','closed'],cancelled:['Pedido cancelado','closed'],refunded:['Pagamento reembolsado','closed'],charged_back:['Pagamento estornado','closed'],in_mediation:['Pagamento em mediação','pending']};
function metric(label,value){const item=el('div');item.append(el('strong',String(value??'Não disponível')),el('span',label));return item;}
function renderOrder(order){
  const item=el('li'),heading=el('div',undefined,'site-assistant-order-heading');
  const identity=el('div');identity.append(el('strong',order.title||'Item do pedido'),el('span',`${order.orderType==='course'?'Curso':order.orderType==='marketplace'?'Loja':'Pedido'} · ${order.orderReference||'Referência não disponível'}`));
  const [label,tone]=paymentStatuses[order.paymentStatus]||['Pagamento a confirmar','unknown'];
  heading.append(identity,el('span',label,`site-assistant-payment-status site-assistant-payment-${tone}`));
  const fields=el('dl');
  for(const [name,value] of [['Valor do pedido',money(order.amountCents)],[order.paymentStatus==='approved'?'Pagamento aprovado em':'Pedido criado em',date(order.paymentStatus==='approved'?order.approvedAt:order.createdAt)],['Atendimento',order.versionNumber?`Lia · versão ${order.versionNumber}`:'Versão não disponível']]){
    const field=el('div');field.append(el('dt',name),el('dd',value));fields.append(field);
  }
  item.append(heading,fields);return item;
}
function renderOrders(orders){
  const section=el('section',undefined,'site-assistant-order-history');section.setAttribute('aria-label','Histórico de pedidos atribuídos à Lia');
  section.append(el('h3','Pedidos atribuídos à Lia'));
  if(!Array.isArray(orders)){section.append(el('p','O histórico de pedidos ainda não está disponível nesta atualização. Os indicadores acima continuam mostrando os resultados registrados.','site-assistant-note'));return section;}
  section.append(el('p','Até 20 pedidos mais recentes, de todas as versões da Lia. Esta lista tem um período diferente dos indicadores acima. Pedido pendente ainda não é venda paga.','site-assistant-note'));
  if(!orders.length){section.append(el('p','Nenhum pedido atribuído à Lia foi registrado ainda.'));return section;}
  const visible=orders.slice(0,20),list=el('ol',undefined,'site-assistant-orders');
  for(const order of visible.slice(0,5))list.append(renderOrder(order));section.append(list);
  if(visible.length>5){const more=el('details'),remaining=el('ol',undefined,'site-assistant-orders');remaining.start=6;more.append(el('summary',`Ver mais ${visible.length-5} pedidos recentes`));for(const order of visible.slice(5))remaining.append(renderOrder(order));more.append(remaining);section.append(more);}
  return section;
}
let snapshot;
function render(data,learning=null,contacts=null){
  snapshot=data;root.replaceChildren();
  root.append(el('h2','Resultados da Lia'),el('p',`Assistente de atendimento e vendas no site · versão ${data.current.number}`));
  const scope=el('div',undefined,'site-assistant-scope');
  scope.append(el('strong',`Versão ${data.current.number} · janela de até 24 horas`),el('p',`${date(data.metrics.windowStart)} até ${date(data.metrics.windowEnd)}`),el('p','Os indicadores consideram somente esta versão, desde sua ativação ou nas últimas 24 horas. Pedidos e resultados das outras versões aparecem no histórico abaixo.'));
  const sales=el('div',undefined,'site-assistant-metrics site-assistant-sales-metrics');
  sales.append(metric('Vendas pagas',data.metrics.paidOrders),metric('Pedidos pendentes',data.metrics.pendingOrders),metric('Receita de pagamentos aprovados',money(data.metrics.revenueCents)));
  root.append(scope,sales,el('p','Pedidos pendentes aguardam pagamento ou análise e não entram na receita. Cliques em lojas de afiliados não confirmam uma compra externa.','site-assistant-note'),renderOrders(data.recentOrders));
  const activity=el('details',undefined,'site-assistant-activity');activity.append(el('summary','Ver visitas e conversas desta mesma janela'));
  const metrics=el('div',undefined,'site-assistant-metrics');
  for(const [label,value] of [['Visitas atendidas',data.metrics.sessions],['Convites exibidos',data.metrics.invitations],['Conversas abertas',data.metrics.opens],['Mensagens',data.metrics.messages],['Cliques nas opções',data.metrics.offerClicks],['Cadastros confirmados',data.metrics.signups]]){
    metrics.append(metric(label,value));
  }
  activity.append(metrics);root.append(activity,el('p',`${statuses[data.review.status]||'Em avaliação'}. Próxima revisão: ${date(data.review.nextAt)}.`));
  const versions=el('details',undefined,'site-assistant-version-history');versions.append(el('summary','Histórico de versões e resultados acumulados'),el('p','Cada versão mantém seus totais desde que foi criada, sem o limite de 24 horas dos indicadores do topo. Uma conversa já iniciada continua atribuída à sua versão original.','site-assistant-note'));
  const list=el('div',undefined,'site-assistant-versions');
  for(const version of data.versions){
    const item=el('article');item.append(el('h3',`Versão ${version.number} · ${approaches[version.approach]||version.approach}`));
    const reason=reasons[version.reasonCode]||(String(version.reasonCode||'').startsWith('rollback_version_')?'Restauração de uma abordagem anterior':'Revisão registrada');
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
  versions.append(list,history);
  const neural=el('aside',undefined,'site-assistant-learning');
  neural.append(el('h3','Aprendizado agregado'),el('p',learning?.enabled?'A Lia envia somente métricas agregadas para candidatos de revisão. Conversas, nomes e contatos ficam fora do aprendizado.':'Aprendizado agregado pausado nesta instalação.'),el('p',`Candidatos: ${learning?.candidateLessons??0} · Sincronizações: ${learning?.syncedReviews??0} · Promoções automáticas: 0`));
  const contactsPanel=el('details','', 'site-assistant-contacts');contactsPanel.append(el('summary',`Contatos com consentimento (${contacts?.items?.length??0} exibidos)`));
  contactsPanel.append(el('p','Os números ficam protegidos. Esta lista mostra apenas pessoas que autorizaram convite, conteúdo ou ofertas; cancelamentos permanecem registrados.'));
  for(const item of (contacts?.items||[]).slice(0,50))contactsPanel.append(el('p',`${item.phone} · ${item.purpose} · ${item.followupStatus==='sent'?'acompanhamento enviado':item.followupStatus==='cancelled'?'cancelado':'acompanhamento pendente'}`));
  root.append(versions,neural,contactsPanel,status);
}
const status=el('p');status.setAttribute('role','status');
async function load(){try{const [response,learningResponse,contactsResponse]=await Promise.all([fetch(endpoint,{cache:'no-store'}),fetch('/api/admin/site-assistant/learning',{cache:'no-store'}),fetch('/api/admin/site-assistant/contacts?limit=50',{cache:'no-store'})]);if(!response.ok)throw Error('Não foi possível carregar os resultados do atendimento.');render(await response.json(),learningResponse.ok?await learningResponse.json():null,contactsResponse.ok?await contactsResponse.json():null);}catch(error){status.textContent=error.message;root.append(status);}}
if(root){load();setInterval(()=>{if(!document.hidden&&!root.contains(document.activeElement))load();},60000);}
