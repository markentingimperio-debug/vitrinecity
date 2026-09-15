import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {COST_TEMPLATE,MAX_CSV_BYTES,createCommercePage,costRow,connectionsHtml,money,observationValue,previewEligible,safeUrl,when} from '../public/admin-commerce.js';

const html=await readFile(new URL('../public/admin-commerce.html',import.meta.url),'utf8');
const css=await readFile(new URL('../public/admin-commerce.css',import.meta.url),'utf8');
const source=await readFile(new URL('../public/admin-commerce.js',import.meta.url),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
const item={id:'fixture',product:'Produto de teste',priceCents:1290,costCents:500,packagingCents:0,sourceLabel:'Arquivo de teste',observedAt:'2026-07-03',platform:'shopee',store:'Loja de teste',sku:'TESTE-01',variation:'1 kg'};
const overview={connections:[],costs:{count:0,missingCount:0,items:[],references:[]},observations:[],findings:[],updatedAt:'2026-09-15',sheet:{status:'needs_approval'},orders:{count:0,platforms:[]}};
const preview={digest:'digest-de-teste',items:[item],errors:[],duplicates:[]};
const reply=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
class Element {
  constructor(){this.value='';this.files=[];this.hidden=false;this.checked=false;this.disabled=false;this.textContent='';this.innerHTML='';this.dataset={};this.attributes={};this.listeners={};this.classes=new Set();this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};}
  addEventListener(type,fn){(this.listeners[type] ||= []).push(fn);}
  setAttribute(key,value){this.attributes[key]=value;}
  focus(){this.focused=true;}
  async emit(type,event={}){for(const fn of this.listeners[type] || [])await fn({preventDefault(){},...event});}
}
function fixture(handler=async()=>reply(overview)) {
  const elements=new Map(ids.map(id=>[id,new Element()]));
  const calls=[],downloads=[],location={href:'/admin-commerce.html'};
  const page=createCommercePage({document:{getElementById:id=>{assert.ok(elements.has(id),`Missing HTML element ${id}`);return elements.get(id);}},fetch:async(url,options)=>{calls.push({url,options,body:options.body?JSON.parse(options.body):null});return handler(url,options);},location,download:value=>downloads.push(value)});
  const get=id=>elements.get(id);
  return{page,get,calls,downloads,location};
}

test('missing money stays missing, zero is valid, dates and units remain explicit',()=>{
  assert.equal(money(null),'Não informado');assert.equal(money(undefined),'Não informado');assert.match(money(0),/0,00/);
  assert.equal(observationValue({value:null,unit:'BRL'}),'Não informado');
  assert.equal(observationValue({value:.25,unit:'percent_fraction'}),'25%');
  assert.equal(observationValue({value:25,unit:'%'}),'25%');
  assert.match(observationValue({value:1000,unit:'BRL_cents'}),/10,00/);
  assert.equal(when('2026-07-03'),'03/07/2026');assert.equal(when('invalid'),'Data não informada');
});
test('API text is escaped and links cannot inject script or impersonate official portals',()=>{
  const row=costRow({...item,product:'<img src=x onerror=alert(1)>',store:'" onmouseover="x',costCents:null});
  assert.doesNotMatch(row,/<img|onmouseover="x/);assert.match(row,/&lt;img/);assert.match(row,/Não informado/);
  for(const url of ['javascript:alert(1)','data:text/html,test','//evil.example','https://seller.shopee.com.br.evil.example','https://user:pass@seller.shopee.com.br/'])assert.equal(safeUrl(url),'');
  assert.equal(safeUrl('https://seller.shopee.com.br/'),'https://seller.shopee.com.br/');
  assert.equal(safeUrl('https://docs.google.com/spreadsheets/d/test-id/edit',{sheet:true}),'https://docs.google.com/spreadsheets/d/test-id/edit');
  assert.equal(safeUrl('https://evil.example/spreadsheets/d/test-id/edit',{sheet:true}),'');
  assert.equal(safeUrl('https://accounts.google.com/o/oauth2/v2/auth?state=test',{authorization:true}),'https://accounts.google.com/o/oauth2/v2/auth?state=test');
  assert.equal(safeUrl('https://accounts.google.com.evil.example/o/oauth2/v2/auth',{authorization:true}),'');
  assert.equal(safeUrl('https://open.shopee.com.br/auth?partner_id=123',{shopeeAuthorization:true}),'https://open.shopee.com.br/auth?partner_id=123');
  for(const url of ['https://open.shopee.com/auth','https://open.shopee.com.br/other','https://open.shopee.com.br:444/auth'])assert.equal(safeUrl(url,{shopeeAuthorization:true}),'');
});
test('marketplace preparation exposes requirements without claiming an active connection',()=>{
  const content=connectionsHtml([{id:'shopee',name:'Shopee',status:'needs_setup',sourceMode:'manual_import',actionUrl:'https://seller.shopee.com.br/',detail:'Aguardando autorização.'}]);
  assert.match(content,/Preparar conexão/);assert.match(content,/Configuração pendente/);assert.match(content,/aplicativo aprovado/);assert.match(content,/target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(content,/>Conectado</);
  assert.doesNotMatch(connectionsHtml([{id:'upseller',name:'UpSeller',status:'manual_import'}]),/Preparar conexão|UpSeller/);
});
test('historical references remain separate, and zero cost records do not imply readiness',()=>{
  const f=fixture();f.page.render({...overview,costs:{...overview.costs,references:[item]},observations:[{label:'Resultado histórico',value:100,unit:'BRL',periodLabel:'03/06–03/07/2026',sourceLabel:'Planilha de teste',observedAt:'2026-07-03',warning:'Histórico, não é setembro.'}],findings:[{title:'<script>teste</script>',detail:'A origem deve ser conferida.',severity:'high'}]});
  assert.match(f.get('costCoverage').textContent,/Nenhum custo por produto/);
  assert.match(f.get('summary').innerHTML,/Custos incompletos<\/span><strong>—<\/strong>/);assert.match(f.get('summary').innerHTML,/Sem base por SKU ainda/);
  assert.doesNotMatch(f.get('costRows').innerHTML,/Produto de teste/);
  assert.match(f.get('historicalRows').innerHTML,/Produto de teste/);assert.equal(f.get('historicalSection').hidden,false);
  assert.match(f.get('observations').innerHTML,/03\/06–03\/07\/2026/);assert.match(f.get('observations').innerHTML,/Histórico, não é setembro/);
  assert.match(f.get('observations').innerHTML,/Conferido em:/);
  assert.doesNotMatch(f.get('findings').innerHTML,/<script>/);assert.equal(f.get('sheetAction').textContent,'Autorizar leitura');
  f.page.render({...overview,sheet:{status:'connected',lastSyncAt:'2026-09-15'}});assert.equal(f.get('sheetAction').textContent,'Sincronizar planilha');
});
test('cost search distinguishes the thousand loaded rows from the full 1001-record count',async()=>{
  const items=Array.from({length:1000},(_,index)=>({...item,id:String(index),sku:`SKU-${index+1}`}));
  const f=fixture();f.page.render({...overview,costs:{count:1001,missingCount:0,items,limit:1000,truncated:true}});
  assert.match(f.get('costResultCount').textContent,/Mostrando 1\.000 entre 1\.000 carregados · 1\.001 cadastrados no total/);
  assert.match(f.get('costResultCount').textContent,/busca consulta apenas esta amostra/);
  f.get('costSearch').value='SKU-1000';await f.get('costSearch').emit('input');
  assert.match(f.get('costResultCount').textContent,/Mostrando 1 entre 1\.000 carregados · 1\.001 cadastrados no total/);
  f.page.render({...overview,costs:{count:1000,missingCount:0,items,limit:1000,truncated:false}});
  assert.match(f.get('costResultCount').textContent,/1\.000 cadastrados no total/);assert.doesNotMatch(f.get('costResultCount').textContent,/amostra/);
  assert.equal(f.calls.length,0);
});
test('authorized marketplace account does not claim that its data was synchronized',()=>{
  const content=connectionsHtml([{id:'shopee',name:'Shopee',status:'connected',configured:true,connected:true,dataSyncAvailable:false,sourceMode:'authorized_account'}]);
  assert.match(content,/Conta autorizada; dados não sincronizados/);assert.doesNotMatch(content,/data-action="shopee-connect"/);
});
test('preview eligibility requires exact review and rejects missing data, errors and duplicates',()=>{
  assert.equal(previewEligible(preview,false),false);assert.equal(previewEligible(preview,true),true);
  for(const changed of [{digest:''},{items:[]},{errors:[{line:2,message:'inválido'}]},{duplicates:1},{duplicates:[2]}])assert.equal(previewEligible({...preview,...changed},true),false);
});
test('cost import saves only after checked confirmation and posts the reviewed digest',async()=>{
  const f=fixture(async(url)=>reply(url.endsWith('/preview')?preview:url.endsWith('/confirm')?{ok:true}:overview));
  f.get('costContent').value=COST_TEMPLATE+'shopee;Teste;TESTE-01;1kg;Teste;12,90;5;0;2026-07-03';
  await f.get('costImportForm').emit('submit');assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'/api/admin/commerce/costs/preview');
  assert.equal(f.get('confirmCosts').disabled,true);await f.get('confirmCosts').emit('click');assert.equal(f.calls.length,1);
  f.get('confirmChecked').checked=true;await f.get('confirmChecked').emit('change');assert.equal(f.get('confirmCosts').disabled,false);
  await f.get('confirmCosts').emit('click');assert.equal(f.calls[1].url,'/api/admin/commerce/costs/confirm');assert.deepEqual(f.calls[1].body,{digest:preview.digest,confirmed:true});
  assert.equal(f.calls[2].url,'/api/admin/commerce/overview');assert.equal(f.get('costPreview').hidden,true);assert.equal(f.get('confirmCosts').disabled,true);
  assert.equal(f.calls[1].options.credentials,'same-origin');assert.equal(f.calls[1].options.cache,'no-store');
});
test('editing CSV discards confirmation and rejects a late preview response',async()=>{
  let resolve;const pending=new Promise(done=>{resolve=done;});
  const f=fixture(async()=>pending);f.get('costContent').value=COST_TEMPLATE+'old';
  const submitted=f.get('costImportForm').emit('submit');await Promise.resolve();
  f.get('costContent').value=COST_TEMPLATE+'new';await f.get('costContent').emit('input');resolve(reply(preview));await submitted;
  assert.equal(f.page.getPreview(),null);assert.equal(f.get('costPreview').hidden,true);assert.equal(f.get('confirmCosts').disabled,true);
});
test('saved preview cannot be confirmed after an input change, even by programmatic click',async()=>{
  const f=fixture(async()=>reply(preview));f.get('costContent').value=COST_TEMPLATE+'row';await f.get('costImportForm').emit('submit');
  f.get('confirmChecked').checked=true;await f.get('confirmChecked').emit('change');await f.get('costContent').emit('input');
  await f.get('confirmCosts').emit('click');assert.equal(f.calls.length,1);assert.equal(f.get('confirmChecked').checked,false);
});
test('uncertain confirmation invalidates the preview and never automatically retries',async()=>{
  const f=fixture(async url=>{if(url.endsWith('/confirm'))throw new Error('network');return reply(preview);});
  f.get('costContent').value=COST_TEMPLATE+'row';await f.get('costImportForm').emit('submit');f.get('confirmChecked').checked=true;await f.get('confirmChecked').emit('change');await f.get('confirmCosts').emit('click');
  assert.equal(f.calls.length,2);assert.equal(f.page.getPreview(),null);assert.match(f.get('message').textContent,/antes de repetir/);
});
test('Google setup errors do not become connected; valid authorization uses Google only',async()=>{
  const f=fixture(async()=>reply({error:'Configuração do Google pendente.'},503));f.page.render(overview);await f.get('sheetAction').emit('click');
  assert.equal(f.location.href,'/admin-commerce.html');assert.match(f.get('message').textContent,/Configuração do Google pendente/);assert.equal(f.get('sheetAction').textContent,'Autorizar leitura');
  const g=fixture(async()=>reply({authorizationUrl:'https://evil.example/login'}));g.page.render(overview);await g.get('sheetAction').emit('click');assert.equal(g.location.href,'/admin-commerce.html');
  const h=fixture(async()=>reply({authorizationUrl:'https://accounts.google.com/o/oauth2/v2/auth?state=test'}));h.page.render(overview);await h.get('sheetAction').emit('click');assert.match(h.location.href,/^https:\/\/accounts.google.com\//);
});
test('auth errors redirect to existing admin login, other failures preserve a retry',async()=>{
  const f=fixture(async()=>reply({},401));await f.page.start();assert.equal(f.location.href,'/admin-login.html');assert.equal(f.get('refreshOverview').disabled,false);assert.match(f.get('message').textContent,/Entre no painel/);
  const g=fixture(async()=>reply({},403));await g.page.start();assert.match(g.get('message').textContent,/administradores/);assert.equal(g.get('sheetAction').disabled,true);
});
test('401 and 403 erase already displayed private data and disable authorization and confirmation',async()=>{
  for(const status of [401,403]){
    let denied=false;const f=fixture(async()=>denied?reply({},status):reply(preview));
    f.page.render({...overview,costs:{count:1,missingCount:0,items:[item],references:[item]},observations:[{label:'Valor privado',value:456.78,unit:'BRL'}],sheet:{title:'Planilha privada',status:'connected',url:'https://docs.google.com/spreadsheets/d/private/edit'}});
    f.get('costContent').value=COST_TEMPLATE+'private';await f.get('costImportForm').emit('submit');f.get('confirmChecked').checked=true;await f.get('confirmChecked').emit('change');
    denied=true;await f.page.refresh();
    assert.equal(f.page.getPreview(),null);assert.equal(f.get('costPreview').hidden,true);assert.equal(f.get('sheetAction').disabled,true);assert.equal(f.get('confirmCosts').disabled,true);
    assert.equal(f.get('observations').innerHTML,'');assert.equal(f.get('historicalRows').innerHTML,'');assert.equal(f.get('previewRows').innerHTML,'');assert.equal(f.get('sheetLink').innerHTML,'');
    assert.doesNotMatch(f.get('costRows').innerHTML,/Produto de teste/);assert.doesNotMatch(f.get('summary').innerHTML,/Custos incompletos/);assert.equal(f.get('costContent').value,'');assert.equal(f.get('sheetTitle').textContent,'Planilha de custos');
  }
});
test('a transient overview failure preserves the old timestamp and explicitly labels the old reading',async()=>{
  const f=fixture(async()=>reply({error:'Fonte indisponível.'},503));f.page.render({...overview,costs:{count:1,missingCount:0,items:[item]}});
  const previous=f.get('updatedAt').textContent;await f.page.refresh();assert.equal(f.get('updatedAt').textContent,previous);assert.match(f.get('message').textContent,/leitura anterior continua exibida/);assert.match(f.get('costRows').innerHTML,/Produto de teste/);
});
test('authorization loss prevents a concurrent pending preview from restoring private rows',async()=>{
  let resolve;const pending=new Promise(done=>{resolve=done;});const f=fixture(async url=>url.endsWith('/preview')?pending:reply({},403));f.page.render(overview);
  f.get('costContent').value=COST_TEMPLATE+'private';const submitted=f.get('costImportForm').emit('submit');await Promise.resolve();await f.page.refresh();resolve(reply(preview));await submitted;
  assert.equal(f.page.getPreview(),null);assert.equal(f.get('previewRows').innerHTML,'');assert.equal(f.get('sheetAction').disabled,true);
});
test('direct Shopee authorization is available only when configured and redirects only to its exact official endpoint',async()=>{
  const connection={id:'shopee',name:'Shopee',status:'needs_approval',configured:false,connected:false,dataSyncAvailable:false};
  assert.doesNotMatch(connectionsHtml([connection]),/data-action="shopee-connect"/);assert.match(connectionsHtml([{...connection,configured:true}]),/data-action="shopee-connect"/);
  const f=fixture(async()=>reply({authorizationUrl:'https://open.shopee.com.br/auth?partner_id=123'}));f.page.render({...overview,connections:[connection]});const button=new Element();const event={target:{closest:()=>button}};
  await f.get('connections').emit('click',event);assert.equal(f.calls.length,0);
  f.page.render({...overview,connections:[{...connection,configured:true}]});await f.get('connections').emit('click',event);
  assert.equal(f.calls[0].url,'/api/admin/commerce/shopee/connect');assert.deepEqual(f.calls[0].body,{});assert.equal(f.location.href,'https://open.shopee.com.br/auth?partner_id=123');
  assert.doesNotMatch(f.get('connections').innerHTML,/>Conectado</);
  const g=fixture(async()=>reply({authorizationUrl:'https://evil.example/auth'}));g.page.render({...overview,connections:[{...connection,configured:true}]});await g.get('connections').emit('click',{target:{closest:()=>new Element()}});assert.equal(g.location.href,'/admin-commerce.html');
});
test('download contains only the approved header and never private rows or formulas',async()=>{
  const f=fixture();await f.get('downloadTemplate').emit('click');assert.deepEqual(f.downloads,[COST_TEMPLATE]);
  assert.equal(COST_TEMPLATE.trim().split(/\r?\n/).length,1);assert.equal(COST_TEMPLATE.trim().split(';').length,9);assert.doesNotMatch(COST_TEMPLATE,/^[=+@-]/);
  assert.doesNotMatch(source,/1er693LuabDfElCPE0di9GW29YM9d6l0UIjb-IQMN7oM|106249|13733|22287/);
});
test('CSV size limit matches the server and blocks excess bytes before requesting a preview',async()=>{
  assert.equal(MAX_CSV_BYTES,512*1024);assert.match(html,/512 KB/);assert.doesNotMatch(html,/3 MB/);
  const f=fixture();f.get('costContent').value='x'.repeat(MAX_CSV_BYTES+1);await f.get('costImportForm').emit('submit');assert.equal(f.calls.length,0);assert.match(f.get('message').textContent,/512 KB/);
});
test('page has native labeled controls, no duplicate IDs, mobile reflow and clear focus',()=>{
  assert.equal(ids.length,new Set(ids).size);assert.match(html,/<html lang="pt-BR">/);assert.match(html,/role="status" aria-live="polite"/);
  assert.match(html,/<label class="confirmation" for="confirmChecked">/);assert.match(html,/<button type="button" id="confirmCosts" disabled>/);
  assert.match(html,/<a class="skip-link" href="#conteudo">/);assert.match(css,/:focus-visible/);assert.match(css,/@media\(max-width:650px\)/);assert.match(css,/prefers-reduced-motion/);
});
