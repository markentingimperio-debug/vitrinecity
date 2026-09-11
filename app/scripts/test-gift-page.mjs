import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountGiftPage,selectedGiftId,validGift,validGiftReceipt,giftEmailMessage} from '../public/presente.js';

const gift={id:'zamioculca',title:'Guia prático da zamioculca: cultivo e cuidados em casa',summary:'Conheça o cultivo e os cuidados.',coverUrl:'/assets/editorial/zamioculca.png',topic:'plants',amountCents:0,requiresAccount:true,available:true,readerUrl:'/ler-livro/guia-pratico-da-zamioculca',libraryUrl:'/meus-cursos.html',version:'lia-gift-zamioculca-v1'};
const receipt={ok:true,giftId:gift.id,claimed:true,accessGranted:true,alreadyOwned:false,readerUrl:gift.readerUrl,libraryUrl:gift.libraryUrl,email:{status:'pending',confirmation:'queued',needsReview:false}};
const absent={ok:true,giftId:gift.id,claimed:false,accessGranted:false,alreadyOwned:false,readerUrl:gift.readerUrl,libraryUrl:gift.libraryUrl,email:null};
const ok=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
class Element{
  constructor(){this.hidden=false;this.disabled=false;this.checked=false;this.value='';this.textContent='';this.listeners={};this.attributes={};}
  setAttribute(name,value){this.attributes[name]=value;}
  addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
  async fire(type){for(const fn of this.listeners[type]||[])await fn({preventDefault(){}});}
  reportValidity(){return true;}
}
function harness({logged=false,search='?guia=zamioculca',publicGift=gift,authPost,statusGet,claimPost,meGet,initialReceipt=null}={}){
  const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},requests=[],redirects=[],events=[];
  let current={name:'Pessoa Teste',email:'pessoa@example.test'},connected=logged,claimed=initialReceipt,giftReads=0;
  const doc={getElementById:get,dispatchEvent:event=>events.push(event)},win={location:{origin:'https://vitrinecity.com',search,assign:url=>redirects.push(url)}};
  get('register-name').value=current.name;
  for(const mode of ['register','login']){get(mode+'-email').value=current.email;get(mode+'-password').value='test-password-only';}
  const fetchImpl=async(path,options={})=>{
    requests.push({path,...options});
    if(path==='/api/gifts/zamioculca'){giftReads++;return ok({gift:typeof publicGift==='function'?publicGift(giftReads):publicGift});}
    if(path==='/api/auth/me')return meGet?meGet(connected,current):connected?ok({authenticated:true,user:current}):ok({authenticated:false},401);
    if(path==='/api/gifts/zamioculca/status')return statusGet?statusGet(claimed):ok(claimed||absent);
    if(['/api/auth/register','/api/auth/login'].includes(path)){
      const body=JSON.parse(options.body),result=authPost?await authPost(path,body):ok({ok:true},path.endsWith('register')?201:200);
      if(result.ok){connected=true;current={name:body.name||current.name,email:body.email};}return result;
    }
    if(path==='/api/gifts/zamioculca/claim'){
      const result=claimPost?await claimPost(JSON.parse(options.body),value=>{claimed=value;}):ok(receipt,201);
      if(result.ok){const data=await result.json();claimed=data;return ok(data,result.status);}return result;
    }
    throw Error('Unexpected request: '+path);
  };
  return {get,doc,win,fetchImpl,requests,redirects,events,posts:()=>requests.filter(r=>r.method==='POST'),claims:()=>requests.filter(r=>r.path.endsWith('/claim'))};
}
async function accept(h){h.get('account-consent').checked=true;await h.get('account-consent').fire('change');}

test('only the exact public free guide and server receipt contract are accepted',()=>{
  assert.equal(selectedGiftId('?guia=zamioculca&lia=1'),'zamioculca');
  for(const query of ['','?guia=../admin','?guia=zamioculca&guia=zamioculca','?guia=paid-book'])assert.equal(selectedGiftId(query),'');
  assert.equal(validGift({gift}),gift);assert.equal(validGiftReceipt(receipt),true);
  for(const patch of [{amountCents:1},{version:'unreviewed'},{readerUrl:'https://evil.test/book'},{libraryUrl:'/admin'},{requiresAccount:false}])assert.equal(validGift({gift:{...gift,...patch}}),null);
  for(const patch of [{ok:false},{giftId:'other'},{accessGranted:false},{readerUrl:'https://evil.test/book'},{libraryUrl:'/admin'},{email:null},{claimed:false},{claimed:undefined}])assert.equal(validGiftReceipt({...receipt,...patch}),false);
});

test('public summary loads before account creation and never assumes a gift or an email was delivered',async()=>{
  const h=harness(),controller=mountGiftPage(h);await controller.ready;
  assert.equal(h.get('gift-title').textContent,gift.title);assert.equal(h.get('gift-cover').hidden,false);assert.equal(h.get('gift-receipt').hidden,true);
  assert.equal(h.get('gift-button').disabled,true);assert.equal(h.get('account-consent').checked,false);assert.equal(h.get('marketing-consent').checked,false);assert.equal(h.get('optional-fields').hidden,false);
  assert.equal(h.posts().length,0);assert.deepEqual(h.redirects,[]);assert.deepEqual(h.events,[]);
});

test('new visitors create a lightweight account in place then explicitly claim without payment or marketing',async()=>{
  const h=harness();await mountGiftPage(h).ready;await accept(h);await h.get('gift-form').fire('submit');
  assert.deepEqual(h.posts().map(r=>r.path),['/api/auth/register','/api/gifts/zamioculca/claim']);
  assert.deepEqual(JSON.parse(h.posts()[0].body),{email:'pessoa@example.test',password:'test-password-only',name:'Pessoa Teste',whatsapp:'',adultConfirmed:true,termsAccepted:true,communications:{email:false,whatsapp:false}});
  assert.deepEqual(JSON.parse(h.claims()[0].body),{accepted:true,version:gift.version});
  assert.equal(h.get('gift-receipt').hidden,false);assert.equal(h.get('gift-access').href,'/meus-cursos.html');assert.match(h.get('gift-email-status').textContent,/aguarda confirmação/);assert.equal(h.get('gift-form').hidden,true);
  assert.equal(h.get('register-password').value,'');assert.equal(h.get('login-password').value,'');assert.deepEqual(h.redirects,[]);assert.equal(h.events.length,0);
});

test('WhatsApp is optional and a promotional opt-in is recorded only by explicit registration consent',async()=>{
  for(const consent of [false,true]){
    const h=harness();await mountGiftPage(h).ready;await accept(h);h.get('gift-whatsapp').value='(11) 99999-0000';h.get('marketing-consent').checked=consent;await h.get('gift-form').fire('submit');
    const body=JSON.parse(h.posts()[0].body);assert.equal(body.whatsapp,'(11) 99999-0000');assert.deepEqual(body.communications,{email:false,whatsapp:consent});
    assert.equal(h.posts().length,2);assert.ok(h.posts().every(r=>r.path==='/api/auth/register'||r.path.endsWith('/claim')));
  }
  const h=harness();await mountGiftPage(h).ready;await accept(h);h.get('marketing-consent').checked=true;await h.get('gift-form').fire('submit');assert.equal(h.posts().length,0);assert.match(h.get('gift-message').textContent,/ou desmarque/);
  h.get('marketing-consent').checked=false;await h.get('gift-form').fire('submit');assert.equal(h.claims().length,1);
});

test('login and an existing session hide optional registration fields and never modify preferences',async()=>{
  for(const logged of [false,true]){
    const h=harness({logged});await mountGiftPage(h).ready;
    if(!logged){await h.get('choose-login').fire('click');h.get('login-password').value='test-password-only';}
    assert.equal(h.get('optional-fields').hidden,true);assert.equal(h.get('optional-fields').disabled,true);assert.equal(h.get('register-fields').disabled,true);
    await h.get('gift-form').fire('submit');assert.equal(h.claims().length,1);assert.equal(h.posts().length,logged?1:2);
    for(const request of h.posts())assert.ok(!Object.hasOwn(JSON.parse(request.body),'communications'));
  }
});

test('an existing email stays on the same guide and switches to login without claiming or exposing the password',async()=>{
  const h=harness({authPost:()=>ok({error:'Este e-mail já possui uma conta.'},409)});await mountGiftPage(h).ready;await accept(h);await h.get('gift-form').fire('submit');
  assert.equal(h.claims().length,0);assert.equal(h.get('login-fields').hidden,false);assert.equal(h.get('login-email').value,'pessoa@example.test');assert.equal(h.get('gift-title').textContent,gift.title);assert.equal(h.get('register-password').value,'');assert.deepEqual(h.redirects,[]);
});

test('invalid, disabled, priced or withdrawn gifts cannot create an account or claim',async()=>{
  for(const options of [{search:'?guia=unknown'},{publicGift:{...gift,available:false}},{publicGift:{...gift,amountCents:100}},{publicGift:count=>({...gift,available:count===1})}]){
    const h=harness(options);await mountGiftPage(h).ready;await accept(h);await h.get('gift-form').fire('submit');assert.equal(h.posts().length,0);assert.equal(h.get('gift-receipt').hidden,true);
  }
});

test('verified identity must match the chosen email before claim, including after a successful auth response',async()=>{
  const h=harness({meGet:connected=>connected?ok({authenticated:true,user:{name:'Outra pessoa',email:'other@example.test'}}):ok({authenticated:false},401)});
  await mountGiftPage(h).ready;await accept(h);await h.get('gift-form').fire('submit');assert.equal(h.claims().length,0);assert.match(h.get('gift-message').textContent,/Confirme seu acesso/);assert.equal(h.get('login-fields').hidden,false);
});

test('a paid existing enrollment still requires an explicit claim before requesting the gift email',async()=>{
  const h=harness({logged:true,statusGet:claimed=>ok(claimed||{...absent,accessGranted:true,alreadyOwned:true}),claimPost:()=>ok({...receipt,alreadyOwned:true},200)});await mountGiftPage(h).ready;
  assert.equal(h.posts().length,0);assert.equal(h.get('gift-receipt').hidden,true);await h.get('gift-form').fire('submit');assert.equal(h.claims().length,1);assert.match(h.get('gift-receipt-detail').textContent,/já tem acesso/);
});

test('confirmed grants survive reload and email status refresh never repeats the claim',async()=>{
  const h=harness({logged:true,initialReceipt:receipt}),controller=mountGiftPage(h);await controller.ready;
  assert.equal(h.get('gift-receipt').hidden,false);assert.equal(h.get('retry-load').hidden,false);await h.get('retry-load').fire('click');await h.get('gift-form').fire('submit');assert.equal(h.posts().length,0);assert.equal(h.get('gift-access').href,gift.libraryUrl);
});

test('an uncertain response is recovered with a read-only status request without another claim or email',async()=>{
  const h=harness({logged:true,claimPost:(_body,save)=>{save(receipt);throw Error('connection lost');}}),controller=mountGiftPage(h);await controller.ready;
  await h.get('gift-form').fire('submit');assert.equal(h.get('gift-receipt').hidden,true);assert.equal(h.get('gift-button').disabled,true);assert.match(h.get('gift-message').textContent,/não foi possível confirmar/);
  await h.get('gift-form').fire('submit');assert.equal(h.claims().length,1);await h.get('retry-load').fire('click');assert.equal(h.get('gift-receipt').hidden,false);assert.equal(h.claims().length,1);
});

test('an incomplete status response cannot be interpreted as no prior claim',async()=>{
  for(const statusGet of [()=>ok({}),()=>ok({error:'unavailable'},503),()=>ok({error:'not found'},404)]){
    const h=harness({logged:true,statusGet});await mountGiftPage(h).ready;await h.get('gift-form').fire('submit');assert.equal(h.posts().length,0);assert.equal(h.get('gift-button').disabled,true);assert.equal(h.get('gift-receipt').hidden,true);
  }
});

test('pending purchases and invalid grant receipts cannot create a false present confirmation',async()=>{
  const h=harness({logged:true,claimPost:()=>ok({code:'gift_purchase_pending'},409)});await mountGiftPage(h).ready;await h.get('gift-form').fire('submit');assert.match(h.get('gift-message').textContent,/já iniciou uma compra/);assert.equal(h.get('gift-receipt').hidden,true);await h.get('gift-form').fire('submit');assert.equal(h.claims().length,1);
  const invalid=harness({logged:true,claimPost:()=>ok({...receipt,libraryUrl:'https://evil.test'})});await mountGiftPage(invalid).ready;await invalid.get('gift-form').fire('submit');assert.equal(invalid.get('gift-receipt').hidden,true);assert.equal(invalid.redirects.length,0);
});

test('email copy distinguishes accepted delivery request from pending, missing configuration and unknown results',()=>{
  assert.match(giftEmailMessage({status:'sent',confirmation:'accepted'}),/encaminhado por e-mail/);
  for(const email of [null,{status:'pending',confirmation:'queued'},{status:'sent',confirmation:'unknown'},{status:'pending',confirmation:'not_configured'},{status:'failed',confirmation:'not_submitted'}])assert.doesNotMatch(giftEmailMessage(email),/foi enviado|encaminhado por e-mail/);
});

test('mobile form has explicit labels, separate unchecked consent and no payment, tracking or storage code',()=>{
  const html=readFileSync(new URL('../public/presente.html',import.meta.url),'utf8'),css=readFileSync(new URL('../public/presente.css',import.meta.url),'utf8'),script=readFileSync(new URL('../public/presente.js',import.meta.url),'utf8');
  assert.match(html,/minlength="10"/);assert.match(html,/Tenho 18 anos/);assert.match(html,/WhatsApp <span class="muted">\(opcional\)/);assert.match(html,/id="marketing-consent" type="checkbox">/);assert.doesNotMatch(html,/<input[^>]+checked/);
  assert.match(html,/id="gift-message"[^>]+aria-live="polite"/);assert.match(css,/min-height:44px/);assert.match(css,/focus-visible/);assert.match(css,/@media\(max-width:750px\)/);
  assert.doesNotMatch(script,/localStorage|sessionStorage|postMessage|location\.assign|mercadopago|\/checkout|\/contacts|innerHTML/);assert.doesNotMatch(html,/<input[^>]+(?:cpf|address|card)/i);
});
