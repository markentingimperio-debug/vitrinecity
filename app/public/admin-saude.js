const $=id=>document.getElementById(id);
function renderIntegrations(items){
 const labels={completed:'Última operação concluída',failed:'Atenção necessária',unverified:'Sem verificação',running:'Em andamento',stale:'Resultado antigo',stalled:'Execução sem conclusão'};
 $('integrations').replaceChildren(...items.map(item=>{
  const card=document.createElement('article');card.className='card integration';
  const title=document.createElement('h3');title.textContent=item.label;
  const badge=document.createElement('span');const state=Object.hasOwn(labels,item.status)?item.status:'unverified';badge.className='badge '+state;badge.textContent=labels[state];
  const detail=document.createElement('p');detail.textContent=item.guidance;
  const time=document.createElement('p');time.className='muted';time.textContent=item.observedAt?'Último registro: '+new Date(item.observedAt).toLocaleString('pt-BR'):'Ainda sem registro.';
  const link=document.createElement('a');link.href=item.source==='sync_history'?'/admin-metricas-externas.html':'/admin-integracoes.html';link.textContent='Revisar integração';
  card.append(title,badge,detail,time,link);return card;
 }));
 if(!items.length)$('integrations').textContent='Diagnóstico de integrações indisponível nesta versão.';
}
async function load(){try{$('status').textContent='Atualizando…';const r=await fetch('/api/admin/platform-health',{cache:'no-store'});if(!r.ok)throw Error();const data=await r.json(),metrics=Object.fromEntries(data.metrics.map(m=>[m.metric,m]));
renderIntegrations(data.integrations||[]);
const total=metrics.search?.count||0,empty=metrics.search_empty?.count||0,loads=metrics.page_load_ms;
const cards=[['Falhas do servidor',metrics.server_error?.count||0],['Buscas internas',total],['Buscas sem resultado',total?Math.round(empty/total*100)+'%':'Sem amostras'],['Carregamento médio',loads?(loads.total/loads.count/1000).toFixed(2)+' s':'Sem amostras'],['Erros no navegador',metrics.js_error?.count||0],['Cliques de afiliados (acumulados)',data.affiliates.reduce((n,a)=>n+(a.clicks||0),0)]];
$('cards').replaceChildren(...cards.map(([label,value])=>{const a=document.createElement('article');a.className='card';const b=document.createElement('strong');b.textContent=value;const p=document.createElement('span');p.textContent=label;a.append(b,p);return a;}));
$('links').replaceChildren(...data.linksToReview.map(item=>{const li=document.createElement('li'),a=document.createElement('a');a.href='/admin-vendas-afiliadas.html';a.textContent=item.title+' — '+({broken:'link com erro',review:'precisa de revisão',unchecked:'ainda não verificado'}[item.health]||item.health);li.append(a);return li;}));if(!data.linksToReview.length)$('links').textContent='Nenhuma oferta sinalizada neste momento.';
$('indexnow').textContent=data.indexnow.lastSubmittedAt?data.indexnow.pages+' páginas registradas. Último envio aceito: '+new Date(data.indexnow.lastSubmittedAt).toLocaleString('pt-BR'):'Nenhum envio registrado ainda.';$('status').textContent='Atualizado às '+new Date().toLocaleTimeString('pt-BR');
}catch{$('status').textContent='Não foi possível carregar. Confira seu acesso administrativo e tente novamente.';}}
$('refresh').addEventListener('click',load);load();
