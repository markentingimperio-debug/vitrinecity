const API = '/api/admin/commerce';
export const COST_TEMPLATE = 'plataforma;loja;sku;variacao;produto;preco;custo;embalagem;data_base\r\n';
export const MAX_CSV_BYTES = 512 * 1024;
const LABELS = Object.freeze({needs_setup:'Configuração pendente',needs_approval:'Autorização pendente',manual_import:'Importação por arquivo',connected:'Conectado',expired:'Autorização expirada'});
const MODES = Object.freeze({manual_import:'Importação por arquivo',file_import:'Importação por arquivo',manual:'Importação por arquivo',historical:'Referência histórica',historical_snapshot:'Referência histórica',api:'Conexão oficial',oauth:'Conexão oficial',linked:'Fonte vinculada',read_only:'Acesso somente para leitura',approval_required:'Aguardando liberação oficial',authorized_read:'Leitura autorizada',authorized_account:'Conta autorizada; dados não sincronizados',reference_only:'Vínculo de referência'});
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list = value => Array.isArray(value) ? value : [];
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const amount = value => numeric(value) ? value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) : 'Não informado';
export const money = cents => numeric(cents) ? amount(cents / 100) : 'Não informado';
const count = value => numeric(value) && value >= 0 ? value.toLocaleString('pt-BR') : 'Não informado';
export function when(value) {
  if (!value) return 'Data não informada';
  const raw=String(value);
  const date=new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00Z` : raw.includes('T') ? raw : raw.replace(' ','T')+'Z');
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}) : 'Data não informada';
}
export function safeUrl(value,{sheet=false,authorization=false,shopeeAuthorization=false}={}) {
  if (typeof value !== 'string' || !value.trim() || value.length>4096) return '';
  try {
    const url=new URL(value,'https://vitrinecity.com');
    if(url.username || url.password || url.port || url.protocol!=='https:')return '';
    if(shopeeAuthorization)return url.hostname==='open.shopee.com.br' && url.pathname==='/auth' ? url.href : '';
    if(authorization)return url.hostname==='accounts.google.com' && /^\/o\/oauth2(?:\/v2)?\/auth$/.test(url.pathname) ? url.href : '';
    if(sheet)return url.hostname==='docs.google.com' && /^\/spreadsheets\/d\/[-\w]+(?:\/|$)/.test(url.pathname) ? url.href : '';
    if(value.startsWith('/') && !value.startsWith('//'))return /^\/admin(?:[-/\w.]|$)/.test(url.pathname) ? url.pathname+url.search+url.hash : '';
    const domains=['shopee.com','shopee.com.br','kwai.com','kwai.com.br','kwai-shop.com','upseller.com','docs.google.com'];
    return domains.some(domain=>url.hostname===domain || url.hostname.endsWith('.'+domain)) ? url.href : '';
  }catch{return '';}
}
const externalLink=(url,label)=>url ? `<a class="text-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)} <span aria-hidden="true">↗</span><span class="source"> (nova aba)</span></a>` : '';
export function observationValue(item) {
  if(item.value === null || item.value === undefined || item.value === '')return 'Não informado';
  if(!numeric(item.value))return escapeHtml(item.value);
  const unit=String(item.unit || '').toLowerCase();
  if(['brl','r$','reais'].includes(unit))return escapeHtml(amount(item.value));
  if(['cents','centavos','brl_cents'].includes(unit))return escapeHtml(money(item.value));
  if(['ratio','fraction','percent_fraction'].includes(unit))return (item.value*100).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
  if(['%','percent','percentage','percentual'].includes(unit))return item.value.toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
  return escapeHtml(item.value.toLocaleString('pt-BR',{maximumFractionDigits:2})+(unit==='roas'?'×':unit && !['count','number','integer','pedidos','itens'].includes(unit)?' '+String(item.unit):''));
}
export function costRow(item,{historical=false}={}) {
  const cell=value=>numeric(value)?escapeHtml(money(value)):'<span class="missing">Não informado</span>';
  return `<tr><td><strong>${escapeHtml(item.product || 'Produto não informado')}</strong><small>${escapeHtml(item.variation || 'Variação não informada')}</small></td><td>${escapeHtml(item.store || 'Loja não informada')}<small>${escapeHtml(item.platform || 'Plataforma não informada')} · ${escapeHtml(item.sku || 'Sem código confirmado')}</small></td><td class="numeric">${cell(item.priceCents)}</td><td class="numeric">${cell(item.costCents)}</td><td class="numeric">${cell(item.packagingCents)}</td><td>${escapeHtml(item.sourceLabel || (historical?'Referência histórica':'Arquivo de custos'))}<small>Data-base: ${escapeHtml(when(item.observedAt))}${historical?' · Histórico':''}</small></td></tr>`;
}
function sourceHtml(item) {
  return `<p class="source">Fonte: ${escapeHtml(item.sourceLabel || 'Não informada')}<br>Conferido em: ${escapeHtml(when(item.observedAt))}</p>`;
}
export function connectionsHtml(connections) {
  const direct=list(connections).filter(item=>!/upseller|google|sheets|planilha/i.test(String(item.id)+' '+String(item.name))).sort((a,b)=>{
    const rank=item=>/shopee/i.test(String(item.id)+' '+String(item.name))?0:/kwai/i.test(String(item.id)+' '+String(item.name))?1:2;
    return rank(a)-rank(b);
  });
  if(!direct.length)return '<p class="empty">O estado das conexões diretas ainda não foi informado.</p>';
  return direct.map(item=>{
    const status=Object.hasOwn(LABELS,item.status)?item.status:'needs_setup';
    const official=safeUrl(item.actionUrl);
    const channel=String(item.id || item.name || '').toLowerCase();
    const marketplace=channel.includes('shopee') || channel.includes('kwai');
    return `<article class="connection"><div class="connection-top"><h3>${escapeHtml(item.name || 'Fonte de dados')}</h3><span class="badge ${status}">${LABELS[status]}</span></div><p>${escapeHtml(item.detail || 'Os detalhes desta conexão ainda não foram informados.')}</p><span class="source">${escapeHtml(MODES[item.sourceMode] || 'Modo de consulta não informado')}<br>${item.lastSyncAt?'Última sincronização: '+escapeHtml(when(item.lastSyncAt)):'Nenhuma sincronização informada'}</span>${channel.includes('shopee') && item.configured===true && item.connected!==true?'<button type="button" data-action="shopee-connect">Autorizar loja</button>':''}${marketplace?`<details><summary>Preparar conexão</summary><p>A conexão exige autorização oficial da loja e uma integração habilitada para esta plataforma.</p><ul><li>Conferir a conta vendedora e a loja de destino.</li><li>Disponibilizar o aplicativo aprovado e a autorização para leitura dos pedidos.</li><li>Validar o primeiro recebimento de dados antes de indicar conexão ativa.</li></ul>${externalLink(official,'Abrir portal oficial')}<p>Enquanto a conexão está pendente, você pode <a href="/admin-recompra#importar">importar o arquivo de pedidos</a>.</p></details>`:externalLink(official,'Abrir fonte') }</article>`;
  }).join('');
}
const issueCount=value=>Array.isArray(value)?value.length:numeric(value)?value:0;
export function previewEligible(preview,checked) {
  return Boolean(checked && preview && typeof preview.digest==='string' && preview.digest.trim() && list(preview.items).length>0 && issueCount(preview.errors)===0 && issueCount(preview.duplicates)===0);
}
function issueText(issue) {
  if(typeof issue==='string')return escapeHtml(issue);
  return `${issue?.line || issue?.row ? 'Linha '+escapeHtml(issue.line || issue.row)+': ' : ''}${escapeHtml(issue?.message || issue?.detail || 'Revise esta linha antes de salvar.')}`;
}
export function createCommercePage({document:doc,fetch:fetcher,location:pageLocation,download}={}) {
  const $=id=>doc.getElementById(id);
  let overviewData=null,preview=null,revision=0,saving=false,loading=false,authVersion=0;
  $('sheetAction').disabled=true;$('confirmCosts').disabled=true;
  function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
  function clearPrivate() {
    authVersion++;overviewData=null;invalidate();
    for(const id of ['connections','observations','findings','historicalRows','previewRows','previewErrors','previewSummary','sheetLink','importedHistory'])$(id).innerHTML='';
    $('summary').innerHTML='<p class="empty">Acesso administrativo necessário. Nenhum dado privado está disponível nesta tela.</p>';
    $('costRows').innerHTML='<tr><td colspan="6" class="empty">Acesso administrativo necessário.</td></tr>';
    $('costCoverage').textContent='Entre no painel administrativo para consultar os custos.';$('costResultCount').textContent='';
    $('historicalSection').hidden=true;$('historicalCount').textContent='';$('historicalPeriod').textContent='';
    $('sheetTitle').textContent='Planilha de custos';$('sheetDetail').textContent='Acesso administrativo necessário para consultar a conexão.';
    $('sheetLastSync').textContent='';$('sheetStatus').textContent='Acesso necessário';$('sheetStatus').className='badge';
    $('sheetAction').disabled=true;$('sheetAction').textContent='Autorizar leitura';$('sheetAction').dataset.mode='';
    $('costContent').value='';$('costFile').value='';
    $('updatedAt').textContent='Consulta indisponível sem autorização.';
  }
  async function request(path,body) {
    const startedAuthVersion=authVersion;
    let response;
    try{response=await fetcher(API+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
    catch{throw new Error('Não foi possível consultar a central. Confira sua conexão e tente atualizar.');}
    if(response.status===401 || response.status===403){
      clearPrivate();if(response.status===401)pageLocation.href='/admin-login.html';
      throw Object.assign(new Error(response.status===401?'Entre no painel administrativo para acessar estes dados.':'Esta área está disponível apenas para administradores autorizados.'),{auth:true,status:response.status});
    }
    let data;try{data=await response.json();}catch{throw new Error('A central não retornou uma resposta válida. Tente novamente mais tarde.');}
    if(startedAuthVersion!==authVersion)throw Object.assign(new Error('O acesso mudou durante a consulta. Entre no painel novamente.'),{auth:true,status:403});
    if(!response.ok)throw new Error(typeof data.error==='string'?data.error:typeof data.message==='string'?data.message:'Não foi possível concluir a operação.');
    return data;
  }
  function invalidate() {
    revision++;preview=null;$('costPreview').hidden=true;$('confirmChecked').checked=false;$('confirmCosts').disabled=true;
  }
  function renderCosts() {
    if(!overviewData){$('costResultCount').textContent='';return;}
    const costs=overviewData.costs || {},items=list(costs.items),search=$('costSearch').value.trim().toLocaleLowerCase('pt-BR');
    const matching=items.filter(item=>[item.product,item.variation,item.platform,item.store,item.sku].some(value=>String(value || '').toLocaleLowerCase('pt-BR').includes(search)));
    $('costRows').innerHTML=matching.length?matching.map(item=>costRow(item)).join(''):`<tr><td colspan="6" class="empty">${search?'Nenhum custo corresponde à busca.':'Nenhum custo por produto foi confirmado. Importe um arquivo para começar.'}</td></tr>`;
    const sampleOnly=costs.truncated===true && costs.count>(numeric(costs.limit)?costs.limit:1000);
    $('costResultCount').textContent=`Mostrando ${count(matching.length)} entre ${count(items.length)} carregados · ${count(costs.count)} cadastrados no total${sampleOnly?' · A busca consulta apenas esta amostra, não todos os custos cadastrados.':''}`;
  }
  function render(data) {
    overviewData=data;
    const costs=data.costs || {},orders=data.orders || {},references=list(costs.references),connections=list(data.connections);
    $('summary').innerHTML=[
      ['Fontes conectadas',connections.filter(item=>item.status==='connected').length,'Demais fontes podem aguardar autorização ou arquivo.'],
      ['Custos por produto confirmados',costs.count,'Referências históricas aparecem separadamente.'],
      ['Custos incompletos',costs.count===0?null:costs.missingCount,costs.count===0?'Sem base por SKU ainda.':'Dados ausentes impedem calcular a rentabilidade.'],
      ['Pedidos no histórico',orders.count,'Quantidade importada, sem presumir pagamento.']
    ].map(([label,value,detail])=>`<div class="stat"><span>${escapeHtml(label)}</span><strong>${value===null?'—':count(value)}</strong><small>${escapeHtml(detail)}</small></div>`).join('');
    $('connections').innerHTML=connectionsHtml(connections);
    const imported=connections.find(item=>/upseller/i.test(String(item.id)+' '+String(item.name)));
    $('importedHistory').innerHTML=`<div><strong>Histórico importado${imported?' · UpSeller':''}</strong><p>${escapeHtml(imported?.detail || 'Arquivos recebidos anteriormente permanecem como uma fonte separada das conexões diretas.')}</p><span class="source">${orders.lastImportAt?'Última importação de pedidos: '+escapeHtml(when(orders.lastImportAt)):'Data da última importação não informada.'}</span></div><a class="text-link" href="/admin-recompra#importar">Ver importação de pedidos</a>`;
    const sheet=data.sheet || {},google=connections.find(item=>/google|sheets|planilha/i.test(String(item.id)+' '+String(item.name)));
    const connected=sheet.status==='connected' || (!sheet.status && google?.status==='connected');
    $('sheetTitle').textContent=sheet.title || 'Planilha de custos';
    $('sheetStatus').textContent=LABELS[sheet.status] || 'Autorização pendente';$('sheetStatus').className='badge '+(connected?'connected':sheet.status==='expired'?'expired':'');
    $('sheetDetail').textContent=connected?'Leitura autorizada. A sincronização consulta a planilha vinculada.':sheet.url?'Planilha vinculada. A leitura e a sincronização ainda precisam ser autorizadas.':'Vinculação e autorização da planilha pendentes.';
    $('sheetLastSync').textContent=sheet.lastSyncAt?`Última sincronização informada: ${when(sheet.lastSyncAt)}`:'Nenhuma sincronização informada. Referências importadas de períodos antigos mantêm a data original.';
    $('sheetLink').innerHTML=externalLink(safeUrl(sheet.url,{sheet:true}),'Abrir planilha vinculada');
    $('sheetAction').textContent=connected?'Sincronizar planilha':'Autorizar leitura';$('sheetAction').dataset.mode=connected?'sync':'connect';$('sheetAction').disabled=false;
    $('observations').innerHTML=list(data.observations).length?data.observations.map(item=>`<article class="observation"><h3>${escapeHtml(item.label || 'Resultado informado')}</h3><strong class="observation-value">${observationValue(item)}</strong><p class="period">Período: ${escapeHtml(item.periodLabel || 'Não informado')}</p>${sourceHtml(item)}${item.warning?`<p class="notice">${escapeHtml(item.warning)}</p>`:''}</article>`).join(''):'<p class="empty">Ainda não há resultados com origem e período disponíveis nesta central.</p>';
    $('costCoverage').textContent=!numeric(costs.count) || costs.count===0?'Nenhum custo por produto foi confirmado. As referências históricas não substituem custos atuais por loja e variação.':costs.missingCount>0?`${count(costs.missingCount)} itens com custos incompletos. Complete os dados antes de calcular rentabilidade ou decidir sobre anúncios.`:'Custos cadastrados. Confira a data-base, a variação, o preço praticado e os demais custos da venda antes de usar a margem.';
    renderCosts();$('historicalSection').hidden=references.length===0;$('historicalCount').textContent=`(${count(references.length)})`;$('historicalPeriod').textContent='Período da referência: '+(costs.referencePeriod || 'Não informado');$('historicalRows').innerHTML=references.map(item=>costRow(item,{historical:true})).join('');
    $('findings').innerHTML=list(data.findings).length?data.findings.map((item,i)=>`<article class="finding"><span class="badge ${['critical','error','high'].includes(item.severity)?'expired':''}">${['critical','error','high'].includes(item.severity)?'Atenção prioritária':item.severity==='info'?'Para conferir':'Atenção'} · ${i+1}</span><h3>${escapeHtml(item.title || 'Ponto de atenção')}</h3><p>${escapeHtml(item.detail || 'Confira os dados de origem antes de decidir.')}</p></article>`).join(''):'<p class="empty">Nenhum ponto de atenção informado. Isso não substitui a conferência dos custos e dos pagamentos.</p>';
    $('updatedAt').textContent=`Consulta da central: ${when(data.updatedAt)}${orders.lastImportAt?' · Última importação de pedidos: '+when(orders.lastImportAt):''}`;
  }
  async function refresh({quiet=false}={}) {
    if(loading)return;loading=true;$('refreshOverview').disabled=true;$('summary').setAttribute('aria-busy','true');
    try{render(await request('/overview'));if(!quiet)message('Dados da central atualizados. As datas-base permanecem indicadas em cada fonte.');return true;}
    catch(error){message(error.message+(overviewData?' A leitura anterior continua exibida; os dados não foram atualizados.':''),true);if(!overviewData && !error.auth){$('summary').innerHTML='<p class="empty">Não foi possível carregar os dados. Use Atualizar dados para tentar novamente.</p>';$('updatedAt').textContent='Consulta não concluída.';}return false;}
    finally{loading=false;$('refreshOverview').disabled=false;$('summary').setAttribute('aria-busy','false');}
  }
  function showPreview(data) {
    preview=data;const items=list(data.items),errors=list(data.errors),duplicates=issueCount(data.duplicates);
    $('costPreview').hidden=false;$('confirmChecked').checked=false;$('confirmCosts').disabled=true;
    $('previewSummary').textContent=`${count(items.length)} produtos na prévia. Nenhum custo deste lote foi salvo ainda.`;
    $('previewRows').innerHTML=items.length?items.map(item=>costRow(item)).join(''):'<tr><td colspan="6" class="empty">Nenhum produto válido para importar.</td></tr>';
    const problems=[...errors.map(issueText),...(duplicates?[`${count(duplicates)} registros duplicados. Confira a loja, o código e a variação; mantenha uma linha por produto e data-base.`]:[]),...(!data.digest && !errors.length?['A prévia não foi autorizada para salvamento. Confira os dados e gere uma nova prévia.']:[])];
    $('previewErrors').hidden=problems.length===0;$('previewErrors').innerHTML=problems.length?'<strong>Confira antes de continuar</strong><ul>'+problems.map(item=>`<li>${item}</li>`).join('')+'</ul>':'';
    $('previewTitle').focus();message(problems.length?'A prévia tem pendências. Corrija o arquivo e confira novamente.':'Prévia pronta. Confira os produtos e marque a confirmação para salvar.',problems.length>0);
  }
  $('costFile').addEventListener('change',()=>{invalidate();$('costContent').value='';});
  $('costContent').addEventListener('input',()=>{invalidate();$('costFile').value='';});
  $('costSearch').addEventListener('input',renderCosts);
  $('confirmChecked').addEventListener('change',()=>{$('confirmCosts').disabled=saving || !previewEligible(preview,$('confirmChecked').checked);});
  $('cancelPreview').addEventListener('click',()=>{if(saving)return;invalidate();message('Prévia descartada. Nenhum custo foi salvo.');$('previewCosts').focus();});
  $('refreshOverview').addEventListener('click',()=>refresh());
  $('costImportForm').addEventListener('submit',async event=>{
    event.preventDefault();if(saving)return;invalidate();const requestRevision=revision;$('previewCosts').disabled=true;
    try{
      const file=$('costFile').files?.[0];
      if(file && (!/\.csv$/i.test(file.name) || file.size>MAX_CSV_BYTES))throw new Error('Escolha um arquivo CSV de até 512 KB.');
      const content=file?await file.text():$('costContent').value;
      if(!String(content).trim())throw new Error('Escolha um arquivo CSV ou cole os dados com os cabeçalhos.');
      if(new TextEncoder().encode(content).length>MAX_CSV_BYTES)throw new Error('Divida os dados em arquivos de até 512 KB.');
      if(revision!==requestRevision)return;
      const data=await request('/costs/preview',{content});
      if(revision===requestRevision)showPreview(data);
    }catch(error){if(revision===requestRevision)message(error.message,true);}
    finally{$('previewCosts').disabled=false;}
  });
  $('confirmCosts').addEventListener('click',async()=>{
    if(saving || !previewEligible(preview,$('confirmChecked').checked))return;
    const digest=preview.digest;saving=true;
    for(const id of ['confirmCosts','previewCosts','costFile','costContent','confirmChecked','cancelPreview'])$(id).disabled=true;
    try{await request('/costs/confirm',{digest,confirmed:true});invalidate();message('Custos salvos na central. Os preços das lojas permanecem como estavam.');if(!await refresh({quiet:true}))message('Custos salvos na central. A atualização da lista não foi concluída; use Atualizar dados para consultá-los.',true);}
    catch(error){message(error.message+(error.auth?'':' Consulte os dados atualizados antes de repetir o salvamento.'),true);invalidate();}
    finally{saving=false;for(const id of ['previewCosts','costFile','costContent','confirmChecked','cancelPreview'])$(id).disabled=false;$('confirmCosts').disabled=true;}
  });
  $('sheetAction').addEventListener('click',async()=>{
    const button=$('sheetAction');if(button.disabled)return;button.disabled=true;
    try{
      if(button.dataset.mode==='sync'){const data=await request('/sheets/sync',{});message(typeof data.message==='string'?data.message:'Consulta da planilha concluída. Confira o estado e a data de sincronização.');await refresh({quiet:true});}
      else{const data=await request('/sheets/connect',{}),url=safeUrl(data.authorizationUrl,{authorization:true});if(!url)throw new Error('A autorização do Google ainda não está disponível. Confira a configuração da conexão.');pageLocation.href=url;}
    }catch(error){message(error.message,true);}
    finally{button.disabled=!overviewData;}
  });
  $('connections').addEventListener('click',async event=>{
    const button=event.target?.closest?.('[data-action="shopee-connect"]');
    if(!button || button.disabled || !overviewData)return;
    const connection=list(overviewData.connections).find(item=>String(item.id).toLowerCase()==='shopee');
    if(connection?.configured!==true || connection.connected===true)return;
    button.disabled=true;
    try{const data=await request('/shopee/connect',{}),url=safeUrl(data.authorizationUrl,{shopeeAuthorization:true});if(!url)throw new Error('A autorização oficial da Shopee ainda não está disponível. Confira a configuração da conexão.');pageLocation.href=url;}
    catch(error){message(error.message,true);}
    finally{button.disabled=!overviewData;}
  });
  $('downloadTemplate').addEventListener('click',()=>download(COST_TEMPLATE));
  return {start:()=>refresh({quiet:true}),refresh,render,invalidate,getPreview:()=>preview};
}
if(typeof document!=='undefined') {
  const page=createCommercePage({document,fetch:window.fetch.bind(window),location:window.location,download:content=>{
    const url=URL.createObjectURL(new Blob(['\uFEFF',content],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');
    link.href=url;link.download='modelo-custos-vitrinecity.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }});
  void page.start();
}
