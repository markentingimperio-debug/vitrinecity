import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createJarvisPublic} from '../jarvis-public.js';
import {createJarvisModelGate} from '../jarvis-model-gate.js';

// Synthetic acceptance tests only: no production database, network, credentials or paid API.
const PRIVATE_CANARY='PRIVATE_ENTERPRISE_CANARY_NEVER_PUBLIC_7CF3';
const QUERY_CANARY='Como funciona a fotossíntese marcadorconsultapublica?';
const ANSWER_CANARY='A fotossíntese converte a energia luminosa. MARCADORRESPOSTAPUBLICA [1]';
const ORIGIN='http://jarvis-model:8080/v1/chat/completions';
const privateTables=['jarvis_documents','jarvis_runs','jarvis_settings'];
const privateTablePattern=/\b(?:jarvis_documents|jarvis_runs|jarvis_settings)\b/i;
const failures=[];
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('Real network is forbidden in this acceptance test.');};

function web(url='https://pt.wikipedia.org/wiki/Fotoss%C3%ADntese',extra={}) {
  return {url,title:'Fotossíntese e plantas',description:'A fotossíntese usa luz, água e dióxido de carbono. As plantas produzem compostos orgânicos e liberam oxigênio.',type:'web',...extra};
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
async function rejectsStatus(fn,expected){await assert.rejects(async()=>await fn(),error=>{
  assert.ok((Array.isArray(expected)?expected:[expected]).includes(error.status),`Expected status ${expected}, received ${error.status}: ${error.message}`);
  assert.ok(!String(error.message).includes(PRIVATE_CANARY));return true;
});}
function deniedSync(fn,expected){assert.throws(fn,error=>{assert.ok((Array.isArray(expected)?expected:[expected]).includes(error.status));return true;});}

function fixture({results=[web()],model=false,lookupImpl,modelImpl}={}) {
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE jarvis_documents(id INTEGER PRIMARY KEY,title TEXT,body TEXT,status TEXT);
    CREATE TABLE jarvis_runs(id TEXT PRIMARY KEY,status TEXT,question TEXT,answer TEXT);
    CREATE TABLE jarvis_settings(id INTEGER PRIMARY KEY,enabled INTEGER);`);
  db.prepare('INSERT INTO jarvis_documents VALUES(1,?,?,?)').run('Fotossíntese e segredo empresarial',PRIVATE_CANARY,'approved');
  db.prepare('INSERT INTO jarvis_runs VALUES(?,?,?,?)').run('private-run','running',PRIVATE_CANARY,PRIVATE_CANARY);
  db.prepare('INSERT INTO jarvis_settings VALUES(1,1)').run();
  const privateSnapshot=()=>JSON.stringify(privateTables.map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY id').all()));
  const before=privateSnapshot(),lookups=[],modelCalls=[];
  let current=Date.parse('2026-09-07T12:00:00Z'),sequence=1,lookupResults=results,core;
  const guardedDb=new Proxy(db,{get(target,key){
    if(key==='prepare'||key==='exec')return (sql,...args)=>{
      assert.doesNotMatch(String(sql),privateTablePattern,'Public Jarvis must never read or mutate enterprise-memory tables.');
      return target[key](sql,...args);
    };
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  const options={db:guardedDb,env:{JARVIS_LOCAL_MODEL:model?'1':'0',OPENAI_API_KEY:'synthetic-unused',JARVIS_URL:'https://forbidden.invalid'},now:()=>current,
    lookup:async(...args)=>{
      assert.equal(typeof args[0],'string');assert.ok(!args[0].includes(PRIVATE_CANARY));lookups.push(args);
      return lookupImpl?lookupImpl(...args):{results:lookupResults,unavailable:[]};
    },fetchImpl:async(url,init)=>{
      modelCalls.push({url,init});assert.equal(url,ORIGIN,'Only the fixed local-model endpoint may be called.');
      assert.equal(init.method,'POST');assert.equal(init.redirect,'error');
      assert.equal(new Headers(init.headers).get('authorization'),null);assert.equal(new Headers(init.headers).get('cookie'),null);
      const body=JSON.parse(init.body);assert.equal(body.tools,undefined);assert.equal(body.stream,false);
      assert.ok(!init.body.includes(PRIVATE_CANARY));assert.ok(!init.body.includes('synthetic-unused'));
      if(modelImpl)return modelImpl(url,init);
      assert.ok(model,'Model-disabled requests must not invoke any model.');
      return Response.json({choices:[{message:{content:ANSWER_CANARY},finish_reason:'stop'}]});
    }};
  function instantiate(){core=createJarvisPublic(options);return core;}
  instantiate();
  return {db,lookups,modelCalls,get core(){return core;},get now(){return current;},
    advance(ms=61000){current+=ms;},setResults(value){lookupResults=value;},
    enable(){const s=core.status();return core.setSettings({enabled:true,revision:s.revision},7);},
    ask(question='Como funciona a fotossíntese?',context={}){return core.ask({question,searchConsent:true},{ip:'198.51.100.'+(sequence++),...context});},
    restart(){core.close();return instantiate();},
    publicDump(){return JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'jarvis_public_%' OR name='jarvis_model_lease') ORDER BY name").all().map(({name})=>({name,rows:db.prepare('SELECT * FROM '+name).all()})));},
    checkPrivate(){assert.equal(privateSnapshot(),before,'Enterprise-memory rows must remain byte-for-byte equivalent.');},
    close(){try{core.close();assert.equal(privateSnapshot(),before);}finally{db.close();}}
  };
}
async function scenario(name,run,options){const f=fixture(options);try{await run(f);f.checkPrivate();console.log('PASS '+name);}catch(error){failures.push(name);console.error('FAIL '+name+'\n'+error.stack);}finally{f.close();}}

try {
  await scenario('default off, explicit settings revision, public/private isolation',async f=>{
    const s=f.core.status();assert.equal(s.enabled,false);assert.equal(s.approved,0);assert.equal(s.drafts,0);assert.equal(s.capacity,100);
    assert.deepEqual(s.limits,{dailyQueries:60,perMinute:3,pendingDrafts:20,totalSources:100,perQuestion:2});
    assert.ok(!JSON.stringify(f.core.publicStatus()).includes(PRIVATE_CANARY));
    await rejectsStatus(()=>f.ask(),503);assert.equal(f.lookups.length,0);assert.equal(f.modelCalls.length,0);
    deniedSync(()=>f.core.setSettings({enabled:true,revision:s.revision,execute:true},7),400);
    deniedSync(()=>f.core.setSettings({enabled:'true',revision:s.revision},7),400);
    f.enable();assert.equal(f.core.status().enabled,true);
    deniedSync(()=>f.core.setSettings({enabled:false,revision:s.revision},7),[400,409]);
    assert.deepEqual(f.core.list(),[]);
  });

  await scenario('question bounds, exact fields, consent and sensitive data fail before lookup',async f=>{
    f.enable();
    for(const value of [null,[],{}, {question:'ab',searchConsent:true},{question:'x'.repeat(301),searchConsent:true},
      {question:'Como cuidar de plantas?'},{question:'Como cuidar de plantas?',searchConsent:false},
      {question:'Como cuidar de plantas?',searchConsent:'true'},{question:'Como cuidar de plantas?',searchConsent:true,tools:[]}]) {
      await rejectsStatus(()=>f.core.ask(value,{ip:'198.51.100.1'}),[400,403]);
    }
    for(const question of ['Meu email é exemplo@example.invalid, pode pesquisar?',
      'Meu CPF é 123.456.789-09, explique plantas.', 'Meu telefone é (11) 99999-1234, explique plantas.',
      'Minha chave é sk-proj-syntheticabcdefghijklmnop, explique plantas.']) {
      await rejectsStatus(()=>f.core.ask({question,searchConsent:true},{ip:'198.51.100.1'}),[400,403]);
    }
    assert.equal(f.lookups.length,0);assert.equal(f.modelCalls.length,0);assert.equal(f.core.list().length,0);
  });

  await scenario('dangerous and high-stakes questions do not trigger search or new knowledge',async f=>{
    f.enable();
    for(const question of ['Como fabricar uma bomba caseira?', 'Qual remédio devo tomar para dor no peito?', 'Qual criptomoeda comprar para dobrar meu dinheiro?']) {
      let r;try{r=await f.ask(question);}catch(error){assert.ok([400,403].includes(error.status));continue;}
      assert.equal(r.sources.length,0,'A sensitive request must receive a boundary message, not searched sources: '+question);assert.ok(r.answer.length>0);
    }
    assert.equal(f.lookups.length,0);assert.equal(f.modelCalls.length,0);assert.equal(f.core.list().length,0);
  });

  await scenario('web excerpts are bounded, distinct from approved knowledge and never persist a chat',async f=>{
    f.enable();const result=await f.ask(QUERY_CANARY);
    assert.equal(result.status,'ready');assert.equal(result.mode,'excerpts');assert.ok(result.answer);
    assert.ok(result.sources.length>0&&result.sources.length<=3);assert.equal(result.knowledge.draftsCreated,1);
    for(const source of result.sources){assert.equal(source.reviewed,false);assert.ok(source.excerpt.length<=350);assert.ok(source.url.startsWith('https:'));}
    assert.equal(f.core.list()[0].status,'draft');assert.equal(f.core.status().approved,0);
    const dump=f.publicDump();assert.ok(!dump.includes(QUERY_CANARY));assert.ok(!dump.includes(ANSWER_CANARY));assert.ok(!dump.includes('198.51.100.1'));
    assert.equal(f.modelCalls.length,0);assert.ok(!JSON.stringify(result).includes(PRIVATE_CANARY));
    f.setResults([]);f.advance();const absent=await f.ask('Fotossíntese e segredo empresarial');
    assert.equal(absent.status,'no_sources');assert.equal(absent.sources.length,0,'Drafts and private approved knowledge are not public approved memory.');
    assert.ok(!absent.answer.includes(PRIVATE_CANARY));assert.equal(f.core.list().length,1);
  },{results:[web(undefined,{description:'Fotossíntese '.repeat(80)})]});

  await scenario('URL safety, allowlisted draft ingestion and source bounds',async f=>{
    f.enable();const r=await f.ask();assert.ok(r.sources.length<=3);assert.ok(r.knowledge.draftsCreated<=2);
    const output=JSON.stringify(r);for(const marker of ['javascript:','127.0.0.1','user:pass@','evil.invalid'])assert.ok(!output.includes(marker));
    for(const doc of f.core.list())assert.ok(!JSON.stringify(doc).includes('outside.example'));
    for(const source of r.sources)assert.ok(source.excerpt.length<=350);
  },{results:[
    web('javascript:alert(1)'),web('http://127.0.0.1/admin'),web('https://user:pass@pt.wikipedia.org/wiki/Fotossintese'),
    web('https://pt.wikipedia.org.evil.invalid/wiki/Fotossintese'),
    web('https://pt.wikipedia.org/wiki/Fotossintese'),web('https://learn.microsoft.com/pt-br/training/modules/rag/'),
    web('https://developers.google.com/search/docs/fundamentals/creating-helpful-content'),
    web('https://outside.example/plantas')
  ]});

  await scenario('irrelevant results do not occupy the three-source limit, and strongest overlap ranks first',async f=>{
    f.enable();const r=await f.ask('SEO indexação sitemap');
    assert.equal(r.status,'ready');assert.equal(r.sources.length,3);
    assert.deepEqual(r.sources.map(s=>s.title),['SEO, indexação e sitemap','SEO e indexação','SEO para sites']);
    assert.deepEqual(r.sources.map(s=>s.id),[1,2,3]);
    assert.ok(!JSON.stringify(r).includes('WhatsApp'));
    assert.ok(!JSON.stringify(f.core.list()).includes('WhatsApp'),'Off-topic results must not enter the public draft queue.');
  },{results:[
    web('https://pt.wikipedia.org/wiki/WhatsApp',{title:'WhatsApp Web',description:'Mensagens e chamadas em computadores e dispositivos móveis.'}),
    web('https://developers.google.com/search/docs/fundamentals/seo-starter-guide',{title:'SEO para sites',description:'Boas práticas de conteúdo público e navegação acessível.'}),
    web('https://pt.wikipedia.org/wiki/Futebol',{title:'Futebol e esportes',description:'Campeonatos e partidas de equipes esportivas internacionais.'}),
    web('https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers',{title:'SEO e indexação',description:'Boas práticas de descoberta e organização de páginas.'}),
    web('https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview',{title:'SEO, indexação e sitemap',description:'Boas práticas de organização de páginas para buscadores.'})
  ]});

  await scenario('a relevant fourth result survives three unrelated initial results',async f=>{
    f.enable();const r=await f.ask('Como melhorar SEO?');
    assert.equal(r.status,'ready');assert.equal(r.sources.length,1);
    assert.equal(r.sources[0].title,'Guia de SEO');assert.equal(r.sources[0].id,1);
    assert.equal(r.knowledge.draftsCreated,1);assert.equal(f.core.list().length,1);
    assert.equal(f.core.list()[0].title,'Guia de SEO');
  },{results:[
    web('https://pt.wikipedia.org/wiki/WhatsApp',{title:'WhatsApp Web',description:'Aplicativo de mensagens e chamadas em dispositivos móveis.'}),
    web('https://pt.wikipedia.org/wiki/Musica',{title:'Música instrumental',description:'Instrumentos musicais e arranjos para apresentações artísticas.'}),
    web('https://pt.wikipedia.org/wiki/Futebol',{title:'Futebol internacional',description:'Informações de campeonatos, partidas e equipes esportivas.'}),
    web('https://developers.google.com/search/docs/fundamentals/seo-starter-guide',{title:'Guia de SEO',description:'Como melhorar SEO com conteúdo útil, títulos claros e navegação acessível.'})
  ]});

  await scenario('no topical overlap means no sources, model invocation or new drafts',async f=>{
    f.enable();const r=await f.ask('SEO indexação sitemap');
    assert.equal(r.status,'no_sources');assert.equal(r.mode,'excerpts');assert.deepEqual(r.sources,[]);
    assert.equal(r.knowledge.draftsCreated,0);assert.equal(f.core.list().length,0);
    assert.equal(f.modelCalls.length,0,'An enabled model must not receive unrelated search excerpts.');
    assert.equal(f.lookups.length,1);assert.equal(f.core.status().queriesToday,1);
    assert.ok(!r.answer.includes('WhatsApp'));assert.ok(!r.answer.includes('Futebol'));
  },{model:true,results:[
    web('https://pt.wikipedia.org/wiki/WhatsApp',{title:'WhatsApp Web',description:'Aplicativo de mensagens e chamadas em dispositivos móveis.'}),
    web('https://pt.wikipedia.org/wiki/Futebol',{title:'Futebol internacional',description:'Informações de campeonatos, partidas e equipes esportivas.'})
  ]});

  await scenario('topical overlap normalizes accents and letter case in both directions',async f=>{
    f.enable();const r=await f.ask('FOTOSSÍNTESE');
    assert.equal(r.status,'ready');assert.equal(r.sources.length,1);assert.equal(r.sources[0].title,'Fotossintese');
    f.setResults([
      web('https://pt.wikipedia.org/wiki/WhatsApp',{title:'WhatsApp Web',description:'Aplicativo de mensagens e chamadas em dispositivos móveis.'}),
      web('https://pt.wikipedia.org/wiki/Polinizacao',{title:'POLINIZAÇÃO',description:'Transferência de pólen entre flores realizada por agentes naturais.'})
    ]);f.advance();const plainQuestion=await f.ask('polinizacao');
    assert.equal(plainQuestion.status,'ready');assert.equal(plainQuestion.sources.length,1);
    assert.equal(plainQuestion.sources[0].title,'POLINIZAÇÃO');
  },{results:[
    web('https://pt.wikipedia.org/wiki/WhatsApp',{title:'WhatsApp Web',description:'Aplicativo de mensagens e chamadas em dispositivos móveis.'}),
    web(undefined,{title:'Fotossintese',description:'Processo que converte luz em compostos orgânicos nos vegetais.'})
  ]});

  await scenario('internal ranking values and raw search scores never leak into the public response',async f=>{
    f.enable();const r=await f.ask();assert.equal(r.status,'ready');assert.equal(r.sources.length,1);
    assert.deepEqual(Object.keys(r.sources[0]).sort(),['excerpt','id','reviewed','title','url']);
    assert.doesNotMatch(JSON.stringify(r),/"(?:score|hits|matches)"\s*:/);
    assert.doesNotMatch(f.publicDump(),/"(?:score|hits|matches)"\s*:/);
  },{results:[web(undefined,{score:999,hits:999,matches:999})]});

  await scenario('IA acronym retrieves a Microsoft source and the same question reuses approved public memory',async f=>{
    f.enable();const question='O que é IA?',r=await f.ask(question);
    assert.equal(r.status,'ready');assert.equal(r.mode,'excerpts');assert.equal(r.sources.length,1);
    assert.equal(r.sources[0].title,'Introdução à IA');assert.equal(r.sources[0].reviewed,false);
    assert.equal(r.knowledge.draftsCreated,1);assert.equal(f.lookups.length,1);
    let doc=f.core.list()[0];
    doc=f.core.save(doc.id,{title:'Conceitos de IA',body:'IA significa inteligência artificial: sistemas computacionais que realizam tarefas associadas à inteligência humana.',revision:doc.revision},7);
    doc=f.core.transition(doc.id,{status:'approved',revision:doc.revision,confirmedPublic:true},7);
    assert.equal(doc.status,'approved');f.setResults([]);f.advance(601000);
    const remembered=await f.ask(question);
    assert.equal(remembered.status,'ready');assert.equal(remembered.mode,'approved_memory');
    assert.equal(remembered.sources.length,1);assert.equal(remembered.sources[0].title,'Conceitos de IA');
    assert.equal(remembered.sources[0].reviewed,true);assert.equal(remembered.knowledge.draftsCreated,0);
    assert.equal(f.lookups.length,1,'An approved IA match must not launch a second search after the cache expires.');
    assert.equal(f.modelCalls.length,0);
  },{results:[web('https://learn.microsoft.com/pt-br/training/modules/ai-introduction-fixture/',{
    title:'Introdução à IA',description:'Inteligência artificial e tarefas computacionais associadas à aprendizagem e à percepção.'
  })]});

  await scenario('questions containing only stop words do not match arbitrary sources',async f=>{
    f.enable();
    for(const question of ['O que é?','de um em ao']){
      const r=await f.ask(question);
      assert.equal(r.status,'no_sources');assert.equal(r.mode,'excerpts');assert.deepEqual(r.sources,[]);
      assert.equal(r.knowledge.draftsCreated,0);assert.equal(f.core.list().length,0);
    }
    assert.equal(f.modelCalls.length,0,'Prepositions and question stop words must not enable a model call.');
  },{model:true,results:[web('https://learn.microsoft.com/pt-br/training/modules/ai-introduction-fixture/',{
    title:'O que é IA e como aprender',description:'Conceitos de aprendizagem em um curso introdutório ao estudo de sistemas computacionais.'
  })]});

  await scenario('public review, revision conflicts, edits and archival revoke approved retrieval',async f=>{
    f.enable();await f.ask();let doc=f.core.list()[0];
    deniedSync(()=>f.core.transition(doc.id,{status:'approved',revision:doc.revision},7),[400,403]);
    deniedSync(()=>f.core.transition(doc.id,{status:'approved',revision:doc.revision,confirmedPublic:false},7),[400,403]);
    deniedSync(()=>f.core.transition(doc.id,{status:'approved',revision:doc.revision,confirmedPublic:true},7),[400,403]);
    doc=f.core.save(doc.id,{title:'Fotossíntese e plantas',body:'A fotossíntese funciona utilizando energia luminosa para produzir compostos orgânicos nas plantas.',revision:doc.revision},7);
    const oldRevision=doc.revision;
    doc=f.core.transition(doc.id,{status:'approved',revision:doc.revision,confirmedPublic:true},7);
    assert.equal(doc.status,'approved');assert.equal(f.core.status().approved,1);
    deniedSync(()=>f.core.save(doc.id,{title:'Fotossíntese revisada',body:'Descrição pública revisada da fotossíntese.',revision:oldRevision},7),[400,409]);
    f.setResults([]);f.advance(601000);let r=await f.ask();assert.equal(r.mode,'approved_memory');assert.ok(r.sources.some(s=>s.reviewed));
    doc=f.core.save(doc.id,{title:'Fotossíntese revisada',body:'A fotossíntese utiliza energia luminosa e possui fontes verificadas para consulta.',revision:doc.revision},7);
    assert.equal(doc.status,'draft');f.advance(601000);r=await f.ask();assert.equal(r.status,'no_sources');
    doc=f.core.transition(doc.id,{status:'approved',revision:doc.revision,confirmedPublic:true},7);
    doc=f.core.transition(doc.id,{status:'archived',revision:doc.revision,confirmedPublic:false},7);
    assert.equal(doc.status,'archived');f.advance(601000);r=await f.ask();assert.equal(r.status,'no_sources');
    f.setResults([web()]);f.advance(601000);r=await f.ask();assert.equal(r.knowledge.draftsCreated,0);assert.equal(f.core.list().length,1,'Archived sources must not be recreated.');
    deniedSync(()=>f.core.transition(doc.id,{status:'approved',revision:doc.revision,confirmedPublic:true,execute:'shell'},7),400);
  });

  await scenario('per-question and pending-draft limits are enforced',async f=>{
    f.enable();
    for(let i=0;i<12;i++){
      f.setResults([0,1,2].map(n=>web('https://pt.wikipedia.org/wiki/Planta_fixture_'+i+'_'+n)));
      const r=await f.ask('Como cuidar de plantas rodada '+i+'?');assert.ok(r.knowledge.draftsCreated<=2);assert.ok(f.core.status().drafts<=20);f.advance();
    }
    assert.equal(f.core.status().drafts,20);assert.equal(f.core.list().length,20);
    assert.equal(f.core.status().approved,0);
  });

  await scenario('source capacity includes archived rows and never deletes old knowledge',async f=>{
    f.enable();
    for(let i=0;i<50;i++){
      f.setResults([0,1].map(n=>web('https://pt.wikipedia.org/wiki/Capacidade_fixture_'+i+'_'+n)));
      const r=await f.ask('Como cuidar de plantas capacidade '+i+'?');assert.equal(r.knowledge.draftsCreated,2);
      for(const doc of f.core.list().filter(d=>d.status==='draft'))f.core.transition(doc.id,{status:'archived',revision:doc.revision,confirmedPublic:false},7);
      f.advance();
    }
    assert.equal(f.core.list().length,100);const before=JSON.stringify(f.core.list());
    f.setResults([web('https://pt.wikipedia.org/wiki/Capacidade_extra')]);
    const r=await f.ask('Como cuidar de plantas capacidade adicional?');assert.equal(r.knowledge.draftsCreated,0);
    assert.equal(JSON.stringify(f.core.list()),before);assert.equal(f.core.status().drafts,0);
  });

  await scenario('all approved ingestion providers work, namespaces and lookalikes never enter memory',async f=>{
    f.enable();
    const allowed=[
      'https://developers.google.com/search/docs/fundamentals/seo-starter-guide',
      'https://sebrae.com.br/sites/PortalSebrae/artigos/marketing-fixture',
      'https://learn.microsoft.com/pt-br/training/modules/rag-fixture/',
      'https://pt.wikipedia.org/wiki/Fotoss%C3%ADntese',
      'https://en.wikipedia.org/wiki/Photosynthesis',
      'https://www.embrapa.br/agencia-de-informacao-tecnologica/cultivos/feijao',
      'https://www.embrapa.br/busca-de-publicacoes/-/publicacao/123456/feijao'
    ];
    for(let i=0;i<allowed.length;i++){
      f.setResults([web(allowed[i])]);const r=await f.ask('Como cuidar de plantas fonte '+i+'?');assert.equal(r.knowledge.draftsCreated,1,allowed[i]);f.advance();
    }
    const count=f.core.list().length;
    for(const [i,url] of [
      'https://pt.wikipedia.org/wiki/Especial:Busca','https://pt.wikipedia.org/wiki/Usu%C3%A1rio:Exemplo',
      'https://en.wikipedia.org/wiki/User:Example','https://www.embrapa.br/admin/configuracao',
      'https://www.embrapa.br.evil.com/agencia-de-informacao-tecnologica/cultivos/feijao',
      'https://learn.microsoft.com.evil.com/pt-br/training/modules/rag/',
      'https://developers.google.com/search/docs/%252e%252e/login'
    ].entries()){
      f.setResults([web(url)]);const r=await f.ask('Como cuidar de plantas domínio alternativo '+i+'?');assert.equal(r.knowledge.draftsCreated,0,url);f.advance();
    }
    assert.equal(f.core.list().length,count);
  });

  await scenario('editing validation and expiration do not expose stale approved facts',async f=>{
    f.enable();await f.ask();let doc=f.core.list()[0];
    for(const value of [null,[],{title:'x',body:'Texto público suficientemente longo',revision:doc.revision},
      {title:'Título público',body:'x'.repeat(2501),revision:doc.revision},
      {title:'Título público',body:'Envie para exemplo@example.invalid',revision:doc.revision},
      {title:'Título público',body:'Texto público suficientemente longo',revision:doc.revision,url:'https://evil.com'}]) {
      deniedSync(()=>f.core.save(doc.id,value,7),400);
    }
    doc=f.core.save(doc.id,{title:'Fotossíntese e plantas',body:'A fotossíntese funciona utilizando luz para produzir compostos orgânicos nas plantas.',revision:doc.revision},7);
    doc=f.core.transition(doc.id,{status:'approved',revision:doc.revision,confirmedPublic:true},7);
    f.setResults([]);f.advance(31*86400000);const r=await f.ask();assert.equal(r.status,'no_sources');assert.equal(r.sources.length,0);
    assert.equal(f.core.list().length,1,'Expired public knowledge stays available for administrative review.');
  });

  await scenario('IP minute limit, durable daily quota and UTC reset',async f=>{
    f.enable();
    for(let i=0;i<3;i++)await f.ask('Como funciona a fotossíntese?',{ip:'203.0.113.77'});
    await rejectsStatus(()=>f.ask('Como funciona a fotossíntese?',{ip:'203.0.113.77'}),429);
    assert.equal(f.lookups.length,3);assert.equal(f.core.status().queriesToday,3);
    f.advance();await f.ask('Como funciona a fotossíntese?',{ip:'203.0.113.77'});
    while(f.core.status().queriesToday<60){f.advance();await f.ask();}
    await rejectsStatus(()=>f.ask('Como funciona a fotossíntese?',{ip:'203.0.113.78'}),429);
    const calls=f.lookups.length;f.restart();assert.equal(f.core.status().queriesToday,60);
    await rejectsStatus(()=>f.ask(),429);assert.equal(f.lookups.length,calls);
    f.advance(86400000);await f.ask();assert.equal(f.core.status().queriesToday,1);
    assert.ok(!f.publicDump().includes('203.0.113.77'));
  },{results:[]});

  await scenario('only the local model receives public excerpts; generated answers are ephemeral',async f=>{
    f.enable();const r=await f.ask(QUERY_CANARY);
    assert.equal(r.mode,'local_model');assert.equal(r.answer,ANSWER_CANARY);assert.equal(f.modelCalls.length,1);
    assert.equal(f.modelCalls[0].url,ORIGIN);assert.ok(!f.publicDump().includes(ANSWER_CANARY));assert.ok(!f.publicDump().includes(QUERY_CANARY));
  },{model:true});

  for(const [name,response] of [
    ['missing citations',()=>Response.json({choices:[{message:{content:'Resposta sem fonte'},finish_reason:'stop'}]})],
    ['unknown citation',()=>Response.json({choices:[{message:{content:'Fonte inexistente [99]'},finish_reason:'stop'}]})],
    ['truncated generation',()=>Response.json({choices:[{message:{content:'Texto cortado [1]'},finish_reason:'length'}]})],
    ['HTML answer',()=>Response.json({choices:[{message:{content:'<script>alert(1)</script> [1]'},finish_reason:'stop'}]})],
    ['invented external URL',()=>Response.json({choices:[{message:{content:'Consulte https://fabricated.example.com [1]'},finish_reason:'stop'}]})],
    ['personal data in answer',()=>Response.json({choices:[{message:{content:'Contato: exemplo@example.invalid [1]'},finish_reason:'stop'}]})],
    ['oversized response',()=>new Response('x'.repeat(60001))],
    ['local failure',()=>{throw Error('synthetic-private-internal-failure');}]
  ])await scenario('safe excerpt fallback after '+name,async f=>{
    f.enable();const r=await f.ask();assert.equal(r.mode,'excerpts');assert.ok(r.answer);assert.ok(!r.answer.includes('synthetic-private-internal-failure'));assert.equal(f.modelCalls.length,1);
  },{model:true,modelImpl:response});

  await scenario('empty results, lookup failure and failed requests consume quota without inventing answers',async f=>{
    f.enable();try{const r=await f.ask();assert.equal(r.status,'no_sources');assert.equal(r.sources.length,0);}
    catch(error){assert.equal(error.status,503);assert.ok(!error.message.includes('synthetic-provider-failure'));}
    assert.equal(f.core.status().queriesToday,1);assert.equal(f.core.list().length,0);assert.equal(f.modelCalls.length,0);
  },{lookupImpl:()=>{throw Error('synthetic-provider-failure');}});

  await scenario('shared administrative model lease forces excerpts without parallel inference',async f=>{
    f.enable();const gate=createJarvisModelGate(f.db,{now:()=>f.now}),lease=gate.acquire('admin');assert.ok(lease);
    try{const r=await f.ask();assert.equal(r.mode,'excerpts');assert.equal(f.modelCalls.length,0);}
    finally{lease.release();}
    f.advance();const r=await f.ask('Explique a fotossíntese nas plantas.');assert.equal(r.mode,'local_model');assert.equal(f.modelCalls.length,1);
  },{model:true});

  await scenario('lookup timeout is bounded at 15 seconds without waiting on real time',async f=>{
    f.enable();const timer=globalThis.setTimeout,delays=[];
    globalThis.setTimeout=(callback,delay,...args)=>{delays.push(delay);return timer(callback,delay===15000?1:100,...args);};
    try{await rejectsStatus(()=>f.ask(),503);assert.ok(delays.includes(15000));assert.equal(f.core.list().length,0);assert.equal(f.core.status().queriesToday,1);}
    finally{globalThis.setTimeout=timer;}
  },{lookupImpl:()=>new Promise(()=>{})});

  await scenario('local-model timeout is 45 seconds and falls back to excerpts',async f=>{
    f.enable();const timeout=AbortSignal.timeout,delays=[];
    AbortSignal.timeout=delay=>{delays.push(delay);return timeout(1);};
    try{const r=await f.ask();assert.equal(r.mode,'excerpts');assert.ok(delays.includes(45000));assert.equal(f.modelCalls.length,1);}
    finally{AbortSignal.timeout=timeout;}
  },{model:true,modelImpl:(_url,init)=>new Promise((resolve,reject)=>{
    if(init.signal.aborted)return reject(Error('synthetic-timeout'));
    init.signal.addEventListener('abort',()=>reject(Error('synthetic-timeout')),{once:true});
  })});

  await scenario('a pre-cancelled visitor request does not reserve quota or send a query',async f=>{
    f.enable();const abort=new AbortController();abort.abort();await rejectsStatus(()=>f.ask(undefined,{signal:abort.signal}),[409,503]);
    assert.equal(f.lookups.length,0);assert.equal(f.core.status().queriesToday,0);assert.equal(f.core.list().length,0);
  });

  const lookupGate=deferred(),lookupStarted=deferred();
  await scenario('one active claim and pause discard an uncooperative late lookup',async f=>{
    f.enable();const first=f.ask();await lookupStarted.promise;
    const claim=f.db.prepare('SELECT active_id,lease_until FROM jarvis_public_settings WHERE id=1').get();
    assert.ok(claim.active_id);assert.equal(claim.lease_until-f.now,85000,'The public request lease must have a bounded 85-second lifetime.');
    await rejectsStatus(()=>f.ask(),429);
    f.core.setSettings({enabled:false,revision:f.core.status().revision},7);
    f.core.setSettings({enabled:true,revision:f.core.status().revision},7);
    const rejection=rejectsStatus(()=>first,[409,503]);lookupGate.resolve({results:[web()],unavailable:[]});await rejection;
    assert.equal(f.core.list().length,0);assert.equal(f.modelCalls.length,0);
  },{lookupImpl:()=>{lookupStarted.resolve();return lookupGate.promise;}});

  const modelGate=deferred(),modelStarted=deferred();
  await scenario('pause discards a late model answer and writes no late drafts',async f=>{
    f.enable();const first=f.ask();await modelStarted.promise;
    const before=JSON.stringify(f.core.list());
    f.core.setSettings({enabled:false,revision:f.core.status().revision},7);
    const rejection=rejectsStatus(()=>first,[409,503]);
    modelGate.resolve(Response.json({choices:[{message:{content:ANSWER_CANARY},finish_reason:'stop'}]}));await rejection;
    assert.equal(JSON.stringify(f.core.list()),before);assert.ok(!f.publicDump().includes(ANSWER_CANARY));
  },{model:true,modelImpl:()=>{modelStarted.resolve();return modelGate.promise;}});

  const disconnectGate=deferred(),disconnectStarted=deferred();
  await scenario('visitor disconnect discards a late lookup and saves no draft',async f=>{
    f.enable();const abort=new AbortController(),first=f.ask(undefined,{signal:abort.signal});await disconnectStarted.promise;abort.abort();
    const rejection=rejectsStatus(()=>first,[409,503]);disconnectGate.resolve({results:[web()],unavailable:[]});await rejection;
    assert.equal(f.core.list().length,0);assert.equal(f.modelCalls.length,0);
  },{lookupImpl:()=>{disconnectStarted.resolve();return disconnectGate.promise;}});

  const restartGate=deferred(),restartStarted=deferred();let restartLookups=0;
  await scenario('an unexpired claim survives restart, and an expired owner cannot save late data',async f=>{
    f.enable();const first=f.ask();await restartStarted.promise;f.restart();
    await rejectsStatus(()=>f.ask('Como cuidar de plantas depois do reinício?'),429);
    f.advance(85001);const r=await f.ask('Como cuidar de plantas depois do reinício?');assert.equal(r.status,'ready');
    const before=JSON.stringify(f.core.list()),rejection=rejectsStatus(()=>first,[409,503]);
    restartGate.resolve({results:[web('https://pt.wikipedia.org/wiki/Dono_antigo')],unavailable:[]});await rejection;
    assert.equal(JSON.stringify(f.core.list()),before);assert.equal(f.core.status().queriesToday,2);
  },{lookupImpl:()=>{if(++restartLookups===1){restartStarted.resolve();return restartGate.promise;}return {results:[web()],unavailable:[]};}});

  assert.deepEqual(failures,[],'All public Jarvis acceptance scenarios must pass.');
  console.log('Jarvis public acceptance: isolated memory, explicit consent/review, URL/data safety, bounded drafts, persistent quotas, local-only generation and cancellation passed.');
} finally {globalThis.fetch=originalFetch;}
