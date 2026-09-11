import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {setupCourseLandingPages, renderCourseLanding, AD_COURSES} from '../course-landing-pages.js';
import {originalCourse} from '../course-content.js';
import {COURSE_DEMONSTRATIONS, COURSE_LANDING_SLUGS} from '../course-demonstrations.js';
import {injectPublicMeasurement} from '../public-measurement.js';
const fixture={slug:'canva-para-lojas',title:'Canva para Lojas',description:'Design para a loja',audience:'Lojistas',priceCents:2399,status:'active'};

test('each public sample belongs to a real private lesson without exposing the full lesson',()=>{
  for (const slug of COURSE_LANDING_SLUGS) {
    const original=originalCourse(slug),demo=COURSE_DEMONSTRATIONS[slug];
    const lesson=original.lessons.find(item=>item.slug===demo.lessonSlug);
    assert.ok(lesson,slug+' has the matching private module');
    assert.equal(lesson.sections.filter(s=>s.title.startsWith('Exemplo resolvido:')).length,demo.scenarios.length);
    const html=renderCourseLanding({...fixture,slug},original,'https://vitrinecity.com');
    assert.ok(html.includes('id="demonstracao"'));
    assert.ok(html.includes('AULA GRATUITA · SEM CADASTRO'));
    assert.ok(html.includes('href="/portfolio"'));
    assert.ok(html.includes(encodeURIComponent('/cursos/'+slug+'#inscricao')));
    for(const item of original.lessons) for(const section of item.sections) {
      if(section.title.startsWith('Exemplo resolvido:'))continue;
      assert.ok(!html.includes(section.paragraphs[0]),slug+' does not reveal a complete private section');
    }
    assert.deepEqual(originalCourse(slug).lessons,original.lessons,'rendering never duplicates private examples');
  }
});

test('expanded catalog lists only active ready courses and keeps unavailable courses private',()=>{
  const routes=new Map();
  const unavailable='shopee-do-zero';
  const api=setupCourseLandingPages({app:{get:(path,handler)=>routes.set(path,handler)},managedCourse:slug=>({...fixture,slug}),courseReady:slug=>slug!==unavailable,originalCourse,origin:'https://vitrinecity.com'});
  assert.equal(api.sitemapPaths().length,COURSE_LANDING_SLUGS.length);
  assert.ok(!api.sitemapPaths().includes('/cursos/'+unavailable));
  let code,body;
  const res={status(value){code=value;return this},type(){return this},set(){return this},send(value){body=value;return this}};
  routes.get('/cursos/:slug')({params:{slug:unavailable}},res);
  assert.equal(code,404);assert.ok(!body.includes('id="demonstracao"'));
  routes.get('/cursos')({},res);
  assert.ok(!body.includes('href="/cursos/'+unavailable+'"'));
});
test('course page uses current price, actual curriculum, correct format and safely escaped metadata',()=>{
  const html=renderCourseLanding({...fixture,title:'Canva <script> & loja'},originalCourse(fixture.slug),'https://vitrinecity.com');
  assert.ok(html.includes('R$&nbsp;') || /R\$\s*23,99/.test(html));
  assert.ok(html.includes('Identidade visual sem complicação'));
  assert.ok(html.includes('Aulas em texto, exercícios e checklists'));
  assert.ok(html.includes('name="viewport"'));
  assert.ok(html.includes('Canva &lt;script&gt; &amp; loja'));
  assert.ok(!html.includes('Canva <script>'));
  const schema=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(schema.offers.price,'23.99');
  assert.equal(schema.identifier,'course-canva-para-lojas');
  assert.ok(!html.includes('O kit mínimo'),'paid lesson body stays private');
});
test('unavailable and unselected courses are not listed, indexed or sold',()=>{
  const routes=new Map();
  const api=setupCourseLandingPages({app:{get:(path,handler)=>routes.set(path,handler)},managedCourse:slug=>slug===fixture.slug?{...fixture,status:'paused'}:null,courseReady:()=>true,originalCourse,origin:'https://vitrinecity.com'});
  assert.deepEqual(api.sitemapPaths(),['/cursos']);
  let status,body;
  const res={status(n){status=n;return this},type(){return this},send(s){body=s;return this}};
  routes.get('/cursos/:slug')({params:{slug:fixture.slug}},res);
  assert.equal(status,404);assert.ok(!body.includes('data-course-checkout'));
});
test('measurement only enters public approved routes, idempotently',()=>{
  const html='<!doctype html><html><body>page</body></html>';
  for(const route of ['/cursos',...AD_COURSES.map(s=>'/cursos/'+s),'/ofertas/darkplanner-gestao-canais-youtube-basic']) {
    const result=injectPublicMeasurement(html,route);
    assert.ok(result.includes('data-vc-openai-ads="enabled"'));
    assert.equal(injectPublicMeasurement(result,route),result);
  }
  for(const route of ['/admin','/meus-cursos.html','/carteira.html','/api/courses/canva/checkout'])assert.equal(injectPublicMeasurement(html,route),html);
});
function browserFixture(path,{kind='Product',title='Oferta',slug='',accepted=false}={}) {
  const handlers={},scripts=[],storage=new Map(accepted?[['vc_analytics_consent','accepted'],['vc_openai_ads_consent_v1','accepted']]:[]);
  const link={dataset:{affiliateId:slug},textContent:'Ver oferta',matches:s=>s==='a.purchase-link[data-affiliate-id]'};
  const context={location:{pathname:path},localStorage:{getItem:k=>storage.get(k)},window:{},document:{readyState:'complete',head:{appendChild:s=>scripts.push(s)},createElement:()=>({}),querySelectorAll:()=>[{textContent:JSON.stringify({'@type':kind,name:title})}],querySelector:s=>s==='h1'?{textContent:title}:link,addEventListener:(event,fn)=>handlers[event]=fn}};
  vm.runInNewContext(fs.readFileSync(new URL('../public/openai-product-events.js',import.meta.url),'utf8'),context);
  return {context,handlers,scripts,storage,link,calls:()=>Array.from(context.window.oaiq?.q||[],a=>Array.from(a))};
}
test('affiliate views and exact outbound CTA require consent; navigation never becomes a sale',()=>{
  const f=browserFixture('/ofertas/air-fryer',{slug:'air-fryer'});
  assert.equal(f.scripts.length,0);
  f.storage.set('vc_analytics_consent','accepted'); f.handlers['vc:measurement-consent'](); assert.equal(f.scripts.length,0);
  f.storage.set('vc_openai_ads_consent_v1','accepted');f.handlers['vc:measurement-consent']();
  assert.equal(f.scripts.length,1);
  assert.deepEqual(f.calls().filter(c=>c[0]==='measure').map(c=>c[1]),['page_viewed','contents_viewed']);
  f.handlers.click({target:{closest:()=>({...f.link,matches:()=>false})}});
  assert.equal(f.calls().filter(c=>c[1]==='custom').length,0);
  f.handlers.click({target:{closest:()=>f.link}});
  const event=f.calls().at(-1);
  assert.equal(event[3].custom_event_name,'affiliate_offer_clicked'); assert.equal(event[3].opt_out,true);
  assert.equal(event[2].contents[0].id,'affiliate-air-fryer'); assert.equal(event[2].amount,undefined);
  assert.ok(!f.calls().some(c=>c[1]==='order_created'));
  const count=f.calls().length;
  f.storage.set('vc_openai_ads_consent_v1','essential');f.handlers['vc:measurement-consent']();f.handlers.click({target:{closest:()=>f.link}});
  assert.equal(f.calls().length,count+1);assert.deepEqual(f.calls().at(-1),['consent',false]);
});
test('course measurement uses course ID and only a successful matching checkout signal',()=>{
  const f=browserFixture('/cursos/canva-para-lojas',{kind:'Course',accepted:true});
  assert.equal(f.calls().at(-1)[2].contents[0].id,'course-canva-para-lojas');
  f.handlers['vc:course-checkout']({detail:{slug:'another',amount:2399}});
  assert.ok(!f.calls().some(c=>c[1]==='checkout_started'));
  f.handlers['vc:course-checkout']({detail:{slug:'canva-para-lojas',amount:2399}});
  assert.equal(f.calls().at(-1)[1],'checkout_started');assert.equal(f.calls().at(-1)[2].amount,2399);
  assert.ok(!f.calls().some(c=>c[1]==='order_created'));
});
test('course checkout never sends requests without valid terms or reports success on failure',async()=>{
  let submit,valid=false,requests=0,redirect='',events=[],links=[];
  const button={textContent:'Comprar',disabled:false},status={textContent:'',appendChild(link){links.push(link)}},form={dataset:{courseCheckout:fixture.slug,coursePrice:'2399'},reportValidity:()=>valid,querySelector:s=>s.startsWith('button')?button:status,addEventListener:(_,fn)=>submit=fn};
  const context={document:{querySelector:()=>form,createElement:()=>({}),dispatchEvent:event=>events.push(event)},CustomEvent:function(name,options){this.type=name;this.detail=options.detail},location:{pathname:'/cursos/'+fixture.slug,assign:s=>redirect=s},fetch:async()=>{requests++;return{status:401,ok:false,json:async()=>({error:'Login'})}}};
  vm.runInNewContext(fs.readFileSync(new URL('../public/course-landing.js',import.meta.url),'utf8'),context);
  await submit({preventDefault(){}});assert.equal(requests,0);
  valid=true;await submit({preventDefault(){}});assert.equal(requests,1);assert.equal(events.length,0);assert.equal(redirect,'');assert.equal(button.disabled,false);
  assert.equal(new URL(links[0].href,'https://vitrinecity.com').searchParams.get('returnTo'),'/cursos/'+fixture.slug+'#inscricao');
  context.fetch=async()=>({status:201,ok:true,json:async()=>({checkoutUrl:'https://www.mercadopago.com.br/checkout/test'})});
  await submit({preventDefault(){}});assert.equal(events[0].type,'vc:course-checkout');assert.equal(events[0].detail.amount,2399);assert.ok(redirect.startsWith('https://www.mercadopago.com.br/'));
});
