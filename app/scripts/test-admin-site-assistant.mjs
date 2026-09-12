import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/admin-site-assistant.js',import.meta.url),'utf8');
const page=readFileSync(new URL('../public/admin-sales-agents.html',import.meta.url),'utf8');
class Node {
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attrs={};this.listeners={};this.className='';this._text='';}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set innerHTML(value){throw Error('Admin data must be rendered as text');}
  append(...nodes){for(const node of nodes){if(node.parent)node.parent.children=node.parent.children.filter(child=>child!==node);node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
  setAttribute(key,value){this.attrs[key]=String(value);}
  addEventListener(type,handler){this.listeners[type]=handler;}
  contains(node){return this===node||this.children.some(child=>child.contains(node));}
  matches(selector){return selector.startsWith('.')?this.className.split(' ').includes(selector.slice(1)):this.tagName===selector.toUpperCase();}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
const order=(overrides={})=>({orderType:'course',orderReference:'course_ABC123',title:'Canva para iniciantes',paymentStatus:'pending',amountCents:2399,createdAt:'2026-09-11T11:15:00Z',approvedAt:null,versionNumber:1,...overrides});
function snapshot(overrides={}){
  return {revision:7,current:{id:2,number:2,approach:'helpful_question'},metrics:{sessions:21,invitations:12,opens:9,messages:14,offerClicks:6,signups:2,paidOrders:1,pendingOrders:3,revenueCents:2399,windowStart:'2026-09-11T10:00:00Z',windowEnd:'2026-09-11T12:00:00Z'},review:{status:'awaiting_payment',nextAt:'2026-09-12T10:00:00Z'},versions:[{id:2,number:2,approach:'helpful_question',reasonCode:'initial',paidOrders:1,signups:2,revenueCents:2399},{id:1,number:1,approach:'simple_choices',reasonCode:'initial',paidOrders:9,signups:12,revenueCents:89999}],history:[],recentOrders:[order()],...overrides};
}
const flush=async()=>{for(let n=0;n<15;n++)await Promise.resolve();};
async function harness(data=snapshot(),{present=true,fail=false}={}){
  const root=new Node('section'),requests=[],intervals=[];
  const document={hidden:false,activeElement:null,querySelector:()=>present?root:null,createElement:tag=>new Node(tag)};
  const context=vm.createContext({document,setInterval:fn=>intervals.push(fn),fetch:async(url,options)=>{
    requests.push({url,options});
    if(url.endsWith('/rollback'))return {ok:true,json:async()=>snapshot({revision:8,current:{id:1,number:1,approach:'simple_choices'}})};
    if(url.endsWith('/experiments'))return {ok:!fail,json:async()=>data};
    return {ok:true,json:async()=>url.endsWith('/learning')?{enabled:true,candidateLessons:2,syncedReviews:1}:{items:[]}};
  }});
  vm.runInContext(source+'\nglobalThis.renderSnapshot=render;',context);await flush();
  return {root,document,requests,intervals,render:context.renderSnapshot};
}

test('Lia is the primary panel; the former matrix remains in its own closed section with its endpoints',()=>{
  assert.match(page,/<h1>Lia na VitrineCity<\/h1>/);
  assert.ok(page.indexOf('id="site-assistant-admin"')<page.indexOf('<details class="legacy-sales-agents"'));
  const legacy=page.match(/<details class="legacy-sales-agents">([\s\S]*?)<\/main>/)?.[1];assert.ok(legacy);
  for(const id of ['live','rain','network','agents','stream'])assert.ok(legacy.includes(`id="${id}"`),id);
  assert.match(legacy,/não são somados aos resultados da Lia/);
  for(const endpoint of ['/api/admin/sales-agents','/api/admin/integrations/readiness'])assert.ok(page.includes(endpoint));
});

test('Lia counts preserve the backend window and never add older versions or order-list amounts',async()=>{
  const h=await harness(snapshot({recentOrders:[order({paymentStatus:'approved',amountCents:900000,versionNumber:1}),order({amountCents:400000})]}));
  const metrics=h.root.querySelector('.site-assistant-sales-metrics').children;
  assert.deepEqual(metrics.map(item=>item.querySelector('strong').textContent),['1','3',(23.99).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})]);
  assert.deepEqual(metrics.map(item=>item.querySelector('span').textContent),['Vendas pagas','Pedidos pendentes','Receita de pagamentos aprovados']);
  const scope=h.root.querySelector('.site-assistant-scope').textContent;
  assert.match(scope,/Versão 2 · janela de até 24 horas/);
  for(const value of [snapshot().metrics.windowStart,snapshot().metrics.windowEnd])assert.ok(scope.includes(new Date(value).toLocaleString('pt-BR')));
  assert.match(h.root.querySelector('.site-assistant-version-history').textContent,/9 compras pagas/);
  assert.match(h.root.querySelector('.site-assistant-version-history').textContent,/sem o limite de 24 horas/);
});

test('order history distinguishes pending, authorized, paid and refunded without treating any as new revenue',async()=>{
  const h=await harness(snapshot({recentOrders:['pending','in_process','authorized','approved','refunded','charged_back','unrecognized'].map((paymentStatus,i)=>order({orderReference:'REF'+i,paymentStatus,approvedAt:'2026-09-11T11:50:00Z'}))}));
  const history=h.root.querySelector('.site-assistant-order-history');
  assert.match(history.textContent,/de todas as versões/);
  const badges=history.querySelectorAll('.site-assistant-payment-status');
  assert.deepEqual(badges.map(node=>node.textContent),['Aguardando pagamento','Pagamento em análise','Autorizado · pagamento não confirmado','Pagamento aprovado','Pagamento reembolsado','Pagamento estornado','Pagamento a confirmar']);
  assert.equal(history.querySelectorAll('.site-assistant-payment-paid').length,1);
  const paid=history.querySelectorAll('li')[3];assert.match(paid.textContent,/Pagamento aprovado em/);assert.ok(paid.textContent.includes(new Date('2026-09-11T11:50:00Z').toLocaleString('pt-BR')));
  assert.match(history.querySelectorAll('li')[0].textContent,/Pedido criado em/);
  assert.match(history.querySelector('summary').textContent,/Ver mais 2 pedidos/);
});

test('history only renders selected fields as safe text and caps the visible dataset',async()=>{
  const title='<img src=x onerror=alert(1)>',ref='<script>attack()</script>';
  const data=snapshot({recentOrders:Array.from({length:25},(_,i)=>order({title,orderReference:ref+i,buyerEmail:'private@example.test',phone:'5511999999999',sessionId:'secret-session',paymentId:'secret-payment',accessToken:'secret-token'}))});
  const h=await harness(data),history=h.root.querySelector('.site-assistant-order-history');
  assert.equal(history.querySelectorAll('li').length,20);assert.equal(history.querySelectorAll('img').length,0);assert.equal(history.querySelectorAll('script').length,0);
  assert.ok(history.textContent.includes(title));assert.ok(history.textContent.includes(ref));
  for(const value of ['private@example.test','5511999999999','secret-session','secret-payment','secret-token'])assert.equal(history.textContent.includes(value),false);
});

test('missing history is different from an empty history and missing metrics do not invent zero',async()=>{
  const data=snapshot();delete data.recentOrders;delete data.metrics.pendingOrders;
  const h=await harness(data);assert.match(h.root.querySelector('.site-assistant-order-history').textContent,/ainda não está disponível/);
  assert.equal(h.root.querySelector('.site-assistant-sales-metrics').children[1].querySelector('strong').textContent,'Não disponível');
  h.render(snapshot({recentOrders:[]}));assert.match(h.root.querySelector('.site-assistant-order-history').textContent,/Nenhum pedido atribuído à Lia/);
  assert.doesNotMatch(h.root.textContent,/Invalid Date|NaN/);
});

test('existing review, consent and rollback tools remain functional with the snapshot revision',async()=>{
  const h=await harness();
  assert.equal(h.requests.length,3);assert.ok(h.requests.every(request=>request.options.cache==='no-store'));
  assert.ok(h.root.querySelector('.site-assistant-learning'));assert.ok(h.root.querySelector('.site-assistant-contacts'));
  const button=h.root.querySelector('button');assert.equal(button.textContent,'Restaurar esta abordagem');
  await button.listeners.click();await flush();
  const request=h.requests.find(item=>item.url.endsWith('/rollback'));
  assert.equal(request.options.method,'POST');assert.deepEqual(JSON.parse(request.options.body),{versionId:1,revision:7});
  assert.match(h.root.textContent,/Abordagem restaurada/);assert.match(h.root.querySelector('.site-assistant-scope').textContent,/Versão 1/);
});

test('refresh does not replace focused tools, and loading failure is explicit',async()=>{
  const h=await harness();h.document.activeElement=h.root.querySelector('button');h.intervals[0]();await flush();assert.equal(h.requests.length,3);
  h.document.activeElement=null;h.intervals[0]();await flush();assert.equal(h.requests.length,6);
  const failed=await harness(snapshot(),{fail:true});assert.match(failed.root.textContent,/Não foi possível carregar/);assert.equal(failed.root.querySelector('.site-assistant-sales-metrics'),null);
  const absent=await harness(snapshot(),{present:false});assert.equal(absent.requests.length,0);assert.equal(absent.intervals.length,0);
});
