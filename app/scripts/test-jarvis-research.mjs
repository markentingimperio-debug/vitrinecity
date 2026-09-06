// Acceptance tests: synthetic documents, in-memory SQLite and mocked transport only.
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createJarvis} from '../jarvis-core.js';
import {createJarvisResearch, safeResearchUrl, RESEARCH_TOPICS} from '../jarvis-research.js';

const HOUR = 60 * 60 * 1000, DAY = 24 * HOUR;
const ACTOR = 7;
const approvedTopics = ['ia', 'seo', 'marketing'];
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error('Unmocked network is forbidden in research acceptance tests.'); };
let passed = 0;
const rejectStatus = (fn, allowed = [400]) => assert.throws(fn, error => allowed.includes(error.status));
const ready = results => Response.json({status:'ready', results, unavailable:[]});
const seo = (id, extra = {}) => ({
  url:`https://developers.google.com/search/docs/fundamentals/fixture-${id}`,
  title:`Pesquisa editorial ${id}`,
  description:`Documento sintético sobre organização editorial, clareza de conteúdo e pesquisa responsável. Referência exclusiva ${id}.`,
  ...extra
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};
async function until(predicate) {
  for (let i = 0; i < 30 && !predicate(); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(predicate(), 'Expected asynchronous worker state was not reached.');
}

function fixture() {
  const db = new Database(':memory:');
  let clock = Date.parse('2026-09-06T00:00:00.000Z');
  const core = createJarvis(db, {now:() => clock, env:{JARVIS_LOCAL_MODEL:'0'}, fetchImpl:async () => { throw Error('Research must not invoke a model.'); }});
  const seedSnapshot = db.prepare('SELECT * FROM jarvis_documents ORDER BY id').all();
  const calls = [], workers = new Set(), gates = [];
  let respond = () => ready([seo(`round-${calls.length}`)]);
  const fetchImpl = async (value, options = {}) => {
    const url = new URL(String(value));
    assert.equal(url.origin, 'http://127.0.0.1:3000');
    assert.equal(url.pathname, '/api/search/web');
    assert.equal(url.username, ''); assert.equal(url.password, ''); assert.equal(url.hash, '');
    assert.equal(url.searchParams.get('type'), 'web'); assert.equal(url.searchParams.get('page'), '1');
    assert.ok(url.searchParams.get('q')?.trim());
    assert.equal(options.method ?? 'GET', 'GET');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    calls.push({url:url.href, options});
    return respond(value, options);
  };
  const instantiate = () => {
    const worker = createJarvisResearch({db, core, fetchImpl, now:() => clock, schedule:false});
    workers.add(worker); return worker;
  };
  let worker = instantiate();
  const api = {
    db, core, calls, seedSnapshot,
    get worker() { return worker; },
    get now() { return clock; },
    set respond(fn) { respond = fn; },
    advance(ms) { clock += ms; },
    instantiate,
    configure(change = {}) {
      const status = worker.status();
      return worker.setSettings({enabled:status.enabled, topicIds:status.topicIds, revision:status.revision, ...change}, ACTOR);
    },
    enable() { return api.configure({enabled:true, topicIds:['seo']}); },
    documents() { return db.prepare('SELECT * FROM jarvis_documents ORDER BY id').all(); },
    additions() { return api.documents().filter(doc => !seedSnapshot.some(seed => seed.id === doc.id)); },
    assertSeedsPreserved() { assert.deepEqual(api.documents().filter(doc => seedSnapshot.some(seed => seed.id === doc.id)), seedSnapshot); },
    pending() {
      const gate = deferred(); gates.push(gate); respond = () => gate.promise; return gate;
    },
    async run() {
      const started = worker.start({}, ACTOR);
      assert.equal(started.status, 'running'); assert.equal(typeof started.id, 'string'); assert.ok(started.id);
      assert.equal(typeof started.then, 'undefined', 'start must return before transport completes.');
      await worker.done(); return started;
    },
    async restart() { await worker.close(); workers.delete(worker); worker = instantiate(); },
    async close() {
      for (const current of workers) await current.close();
      for (const gate of gates) gate.resolve(ready([]));
      for (const current of workers) await current.done();
      db.close();
    }
  };
  return api;
}
async function check(name, fn) {
  await fn(); passed++; console.log(`research acceptance PASS: ${name}`);
}
async function using(fn) {
  const f = fixture(); try { await fn(f); } finally { await f.close(); }
}
function archiveDrafts(f) {
  for (const doc of f.additions().filter(row => row.status === 'draft')) {
    f.core.transition(doc.id, {status:'archived', revision:doc.revision}, ACTOR);
  }
}

try {
  await check('fixed topics and canonical topic-specific source allowlists', async () => {
    const exportedIds = Array.isArray(RESEARCH_TOPICS) ? RESEARCH_TOPICS.map(topic => typeof topic === 'string' ? topic : topic.id) : Object.keys(RESEARCH_TOPICS);
    assert.deepEqual([...exportedIds].sort(), [...approvedTopics].sort());
    const valid = [
      ['https://learn.microsoft.com/pt-br/azure/ai-services/openai/concepts/retrieval-augmented-generation', 'ia'],
      ['https://learn.microsoft.com/en-us/training/modules/introduction-generative-ai/', 'ia'],
      ['https://developers.google.com/search/docs/fundamentals/seo-starter-guide', 'seo'],
      ['https://sebrae.com.br/sites/PortalSebrae/artigos/marketing-de-conteudo', 'marketing'],
      ['https://meuatendimento.sebrae.com.br/sites/PortalSebrae/artigos/marketing-de-conteudo', 'marketing'],
      ['https://sebrae.com.br/sites/PortalSebrae/ufs/sp/artigos/marketing-de-conteudo', 'marketing']
    ];
    for (const [url, topic] of valid) {
      assert.equal(safeResearchUrl(url, topic), url);
      assert.equal(safeResearchUrl(url + '?utm_source=fixture#section', topic), url);
      for (const other of approvedTopics.filter(id => id !== topic)) assert.ok(!safeResearchUrl(url, other));
    }
    assert.equal(safeResearchUrl('https://developers.google.com:443/search/docs/fixture', 'seo'), 'https://developers.google.com/search/docs/fixture');
    for (const value of [
      '', null, {}, 'javascript:alert(1)', 'data:text/html,fixture', 'file:///etc/passwd',
      '//developers.google.com/search/docs/fixture', 'http://developers.google.com/search/docs/fixture',
      'https://127.0.0.1/search/docs/fixture', 'https://[::1]/search/docs/fixture', 'https://localhost/search/docs/fixture',
      'https://developers.google.com.evil.example/search/docs/fixture', 'https://user:pass@developers.google.com/search/docs/fixture',
      'https://developers.google.com:8443/search/docs/fixture',
      'https://developers.google.com/search/docs/../../admin', 'https://developers.google.com/search/docs/%2e%2e/fixture',
      'https://developers.google.com/search/docs/%252e%252e/fixture', 'https://developers.google.com/search/docs/%2fadmin',
      'https://developers.google.com/search/docs/\\evil', 'https://developers.google.com/search/docs/fixture\n',
      'https://developers.google.com/accounts/fixture', 'https://developers.google.com/search/docs/' + 'x'.repeat(2500)
    ]) assert.ok(!safeResearchUrl(value, 'seo'), 'Unsafe research source accepted: ' + String(value));
    assert.ok(!safeResearchUrl(valid[0][0], 'unknown'));
  });

  await check('disabled default, explicit versioned settings and no implicit fetch', () => using(async f => {
    const initial = f.worker.status();
    assert.equal(initial.enabled, false); assert.equal(initial.topicIds[0], 'seo');
    assert.ok(initial.topicIds.every(id => approvedTopics.includes(id)));
    assert.ok(Number.isSafeInteger(initial.revision)); assert.equal(initial.active, null);
    assert.equal(initial.dailyAttempts, 0); assert.equal(initial.pendingDrafts, 0); assert.equal(initial.knownSources, 0);
    assert.deepEqual(initial.limits, {dailyAttempts:2, cooldownHours:6, perRun:3, pendingDrafts:20, totalSources:100});
    await f.worker.tick(); assert.equal(f.calls.length, 0);
    rejectStatus(() => f.worker.start({}, ACTOR), [503]);
    rejectStatus(() => f.worker.setSettings({enabled:true, topicIds:['seo']}, ACTOR), [400, 409]);
    for (const value of [null, [], {enabled:'true', topicIds:['seo'], revision:initial.revision},
      {enabled:true, topicIds:['unknown'], revision:initial.revision}, {enabled:true, topicIds:[], revision:initial.revision},
      {enabled:true, topicIds:['seo'], revision:initial.revision, url:'https://evil.example'}]) {
      rejectStatus(() => f.worker.setSettings(value, ACTOR));
    }
    rejectStatus(() => f.worker.start({query:'arbitrary external instructions'}, ACTOR));
    f.enable(); assert.equal(f.worker.status().enabled, true); assert.equal(f.worker.status().revision, initial.revision + 1);
    rejectStatus(() => f.worker.setSettings({enabled:false, topicIds:['seo'], revision:initial.revision}, ACTOR), [409]);
    assert.equal(f.calls.length, 0); f.assertSeedsPreserved();
  }));

  await check('at most three text-only drafts; approved memory is never modified or queried as new knowledge', () => using(async f => {
    f.enable();
    f.respond = () => ready(Array.from({length:8}, (_, i) => seo(`safe-${i}`, i === 0 ? {
      title:'<b>Pesquisa editorial única</b>', description:'<p>Conteúdo sintético editorial original para planejamento responsável.</p><iframe src="https://evil.example"></iframe><script>UNTRUSTED_SCRIPT()</script>'
    } : {})));
    await f.run();
    const docs = f.additions(); assert.equal(docs.length, 3); assert.equal(f.calls.length, 1);
    assert.ok(docs.every(doc => doc.status === 'draft' && doc.revision === 1));
    assert.ok(docs.every(doc => doc.body.length <= 6000 && doc.title.length <= 140));
    for (const doc of docs) {
      assert.doesNotMatch(doc.title + doc.body, /<\/?(?:iframe|script|p|b)\b/i);
      assert.match(doc.source, /https:\/\/developers\.google\.com\/search\/docs\//);
      assert.match(doc.source + ' ' + doc.body, /2026-09-06/);
      assert.match((doc.source + ' ' + doc.body).normalize('NFD'), /licen[cç]|licenc/i);
      assert.match((doc.source + ' ' + doc.body).normalize('NFD'), /revis|verific|confer/i);
      assert.ok(!f.core.retrieve(doc.title).some(source => source.id === doc.id), 'Draft became available to answers.');
    }
    assert.equal(f.worker.status().pendingDrafts, 3); assert.equal(f.worker.status().active, null); f.assertSeedsPreserved();
  }));

  await check('unsafe, wrong-topic and credential-bearing results create no knowledge', () => using(async f => {
    f.enable(); f.respond = () => ready([
      seo('private', {url:'https://127.0.0.1/private'}),
      seo('wrong-topic', {url:'https://learn.microsoft.com/pt-br/azure/ai-services/'}),
      seo('credentials', {description:'Synthetic secret must be rejected: ghp_abcdefghijklmnopqrstuvwx'}),
      seo('valid')
    ]);
    await f.run(); const docs = f.additions(); assert.equal(docs.length, 1);
    assert.match(docs[0].source, /fixture-valid/); assert.equal(docs[0].status, 'draft');
    assert.ok(!JSON.stringify(f.worker.status()).includes('ghp_abcdefghijklmnopqrstuvwx')); f.assertSeedsPreserved();
  }));

  await check('URL deduplication survives parameters, admin editing, archival and worker restart', () => using(async f => {
    f.enable(); const original = seo('same');
    f.respond = () => ready([original, {...original, url:original.url + '?utm_source=other#heading'}]);
    await f.run(); assert.equal(f.additions().length, 1); assert.equal(f.worker.status().knownSources, 1);
    let doc = f.additions()[0];
    doc = f.core.save({title:'Revisão administrativa sintética', body:'Texto revisto pelo administrador que não deve ser substituído pelo pesquisador.', source:doc.source, expiresAt:doc.expires_at, revision:doc.revision}, ACTOR, doc.id);
    doc = f.core.transition(doc.id, {status:'archived', revision:doc.revision}, ACTOR);
    const preserved = {...doc}; await f.restart(); f.advance(DAY);
    await f.run(); assert.deepEqual(f.core.get(doc.id), preserved);
    assert.equal(f.additions().length, 1); assert.equal(f.worker.status().knownSources, 1); assert.equal(f.worker.status().pendingDrafts, 0);
  }));

  await check('six-hour cooldown and two attempts per UTC day persist across restarts and toggles', () => using(async f => {
    f.enable(); await f.run(); assert.equal(f.worker.status().dailyAttempts, 1);
    assert.ok(Date.parse(f.worker.status().nextAt) >= f.now + 6 * HOUR);
    await f.restart(); assert.equal(f.worker.status().dailyAttempts, 1);
    f.configure({enabled:false}); f.enable();
    rejectStatus(() => f.worker.start({}, ACTOR), [409, 429]);
    f.advance(6 * HOUR - 1); rejectStatus(() => f.worker.start({}, ACTOR), [409, 429]);
    f.advance(1); await f.run(); assert.equal(f.worker.status().dailyAttempts, 2);
    f.advance(6 * HOUR); rejectStatus(() => f.worker.start({}, ACTOR), [409, 429]);
    assert.equal(f.calls.length, 2); await f.restart(); assert.equal(f.worker.status().dailyAttempts, 2);
    f.advance(12 * HOUR); await f.run(); assert.equal(f.worker.status().dailyAttempts, 1); assert.equal(f.calls.length, 3);
  }));

  await check('one DB lease across two worker instances; start is non-blocking', () => using(async f => {
    f.enable(); const gate = f.pending(), first = f.worker.start({}, ACTOR);
    assert.equal(first.status, 'running'); assert.equal(typeof first.then, 'undefined');
    await until(() => f.calls.length === 1);
    const second = f.instantiate(); assert.equal(second.status().active.id, first.id);
    rejectStatus(() => second.start({}, ACTOR), [409, 429]);
    gate.resolve(ready([seo('lease')])); await f.worker.done();
    assert.equal(f.additions().length, 1); assert.equal(second.status().active, null); assert.equal(f.calls.length, 1);
  }));

  for (const action of ['cancel', 'pause-and-resume', 'settings-revision']) {
    await check(`${action} rejects a late response even when transport ignores abort`, () => using(async f => {
      f.enable(); const gate = f.pending(), started = f.worker.start({}, ACTOR);
      await until(() => f.calls.length === 1);
      if (action === 'cancel') f.worker.cancel({id:started.id}, ACTOR);
      if (action === 'pause-and-resume') { f.configure({enabled:false}); f.enable(); }
      if (action === 'settings-revision') f.configure({topicIds:['ia']});
      gate.resolve(ready([seo('late')])); await f.worker.done();
      assert.equal(f.additions().length, 0); assert.equal(f.worker.status().pendingDrafts, 0);
      assert.equal(f.worker.status().active, null); f.assertSeedsPreserved();
    }));
  }

  await check('global Jarvis pause blocks starting and discards a pending research response', () => using(async f => {
    f.enable(); f.core.setEnabled({enabled:false}, ACTOR);
    rejectStatus(() => f.worker.start({}, ACTOR), [503]); assert.equal(f.calls.length, 0);
    f.core.setEnabled({enabled:true}, ACTOR);
    const gate = f.pending(); f.worker.start({}, ACTOR); await until(() => f.calls.length === 1);
    f.core.setEnabled({enabled:false}, ACTOR);
    gate.resolve(ready([seo('after-core-pause')])); await f.worker.done();
    assert.equal(f.additions().length, 0); assert.equal(f.worker.status().active, null); f.assertSeedsPreserved();
  }));

  await check('global Jarvis pause followed by resume permanently invalidates the pending claim', () => using(async f => {
    f.enable(); const gate = f.pending(); f.worker.start({}, ACTOR);
    await until(() => f.calls.length === 1);
    f.core.setEnabled({enabled:false}, ACTOR);
    f.core.setEnabled({enabled:true}, ACTOR);
    gate.resolve(ready([seo('after-core-pause-resume')])); await f.worker.done();
    assert.equal(f.additions().length, 0, 'Resuming Jarvis must not resurrect a research claim invalidated by pause.');
    assert.equal(f.worker.status().pendingDrafts, 0); assert.equal(f.worker.status().knownSources, 0);
    assert.equal(f.worker.status().active, null); assert.equal(f.worker.status().last.status, 'cancelled');
    assert.equal(f.worker.status().dailyAttempts, 1, 'Cancellation must not refund the already issued search.');
    f.assertSeedsPreserved();
  }));

  await check('failed, malformed, redirected and oversized responses never approve or partially save', async () => {
    const replies = [
      () => { throw Error('Synthetic provider failure; private diagnostic must not leak.'); },
      () => new Response('upstream failed', {status:503}),
      () => new Response('', {status:302, headers:{location:'https://evil.example'}}),
      () => new Response('<html>invalid payload</html>'),
      () => ready([seo('oversized', {description:'x'.repeat(1024 * 1024 + 1)})])
    ];
    for (const reply of replies) await using(async f => {
      f.enable(); f.respond = reply; await f.run();
      assert.equal(f.additions().length, 0); assert.equal(f.worker.status().active, null);
      assert.ok(!JSON.stringify(f.worker.status()).includes('private diagnostic')); f.assertSeedsPreserved();
    });
  });

  await check('fifteen-second timeout aborts and ignores the late body without waiting in real time', async () => {
    const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout, realAbortTimeout = AbortSignal.timeout;
    const timers = new Map();
    globalThis.setTimeout = (fn, ms, ...args) => {
      if (ms !== 15000) return realSetTimeout(fn, ms, ...args);
      const handle = {unref() { return this; }}; timers.set(handle, () => fn(...args)); return handle;
    };
    globalThis.clearTimeout = handle => { if (!timers.delete(handle)) realClearTimeout(handle); };
    AbortSignal.timeout = ms => {
      if (ms !== 15000) return realAbortTimeout(ms);
      const controller = new AbortController(), handle = {};
      timers.set(handle, () => controller.abort(new DOMException('Synthetic deadline', 'TimeoutError'))); return controller.signal;
    };
    try {
      await using(async f => {
        f.enable(); const gate = f.pending(); f.worker.start({}, ACTOR);
        await until(() => f.calls.length === 1);
        assert.ok(timers.size > 0, 'No 15-second deadline installed.');
        for (const fire of [...timers.values()]) fire();
        assert.equal(f.calls[0].options.signal.aborted, true);
        gate.resolve(ready([seo('after-timeout')])); await f.worker.done();
        assert.equal(f.additions().length, 0); assert.equal(f.worker.status().active, null);
      });
    } finally { globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout; AbortSignal.timeout = realAbortTimeout; }
  });

  await check('three consecutive transport failures disable the researcher and tick never leaks exceptions', () => using(async f => {
    f.enable(); f.respond = () => { throw Error('Synthetic service unavailable.'); };
    for (let i = 0; i < 3; i++) {
      if (i) f.advance(DAY);
      await f.worker.tick(); await f.worker.done();
    }
    assert.equal(f.calls.length, 3); assert.equal(f.worker.status().enabled, false);
    await f.worker.tick(); assert.equal(f.calls.length, 3); assert.equal(f.additions().length, 0);
    await f.restart(); assert.equal(f.worker.status().enabled, false);
  }));

  await check('empty partial responses count as failures but useful partial results remain eligible', () => using(async f => {
    f.enable();
    f.respond = () => Response.json({status:'partial', results:[], unavailable:['google','bing']});
    await f.run(); assert.equal(f.worker.status().last.status, 'failed');
    f.advance(DAY);
    f.respond = () => Response.json({status:'partial', results:[seo('partial-useful')], unavailable:['google']});
    await f.run(); assert.equal(f.worker.status().last.status, 'completed');
    assert.equal(f.additions().length, 1); assert.equal(f.additions()[0].status, 'draft');
    assert.equal(f.worker.status().enabled, true);
    f.respond = () => Response.json({status:'partial', results:[], unavailable:['google','bing']});
    for (let i = 0; i < 3; i++) {
      f.advance(DAY); await f.run();
      assert.equal(f.worker.status().last.status, 'failed');
      assert.equal(f.worker.status().enabled, i < 2, 'Only three consecutive failures must pause research.');
    }
    assert.equal(f.calls.length, 5); assert.equal(f.additions().length, 1);
    assert.equal(f.worker.status().active, null); f.assertSeedsPreserved();
    await f.restart(); assert.equal(f.worker.status().enabled, false);
  }));

  await check('manual drafts do not consume the twenty pending research slots', () => using(async f => {
    for (let i = 0; i < 20; i++) f.core.save({title:`Manual fixture ${i}`, body:`Conhecimento manual sintético número ${i}, aguardando revisão humana.`, source:`Manual control ${i}`}, ACTOR);
    f.enable(); assert.equal(f.worker.status().pendingDrafts, 0);
    f.respond = () => ready(Array.from({length:3}, (_, i) => seo(`pending-${f.calls.length}-${i}`)));
    for (let i = 0; i < 7; i++) { if (i) f.advance(DAY); await f.run(); }
    assert.equal(f.worker.status().pendingDrafts, 20);
    assert.equal(f.additions().filter(d => d.status === 'draft').length, 40);
    f.advance(DAY); const before = f.calls.length;
    rejectStatus(() => f.worker.start({}, ACTOR), [409, 429]); assert.equal(f.calls.length, before); f.assertSeedsPreserved();
  }));

  await check('one hundred known sources remain bounded even after drafts are archived', () => using(async f => {
    f.enable(); f.respond = () => ready(Array.from({length:3}, (_, i) => seo(`source-${f.calls.length}-${i}`)));
    for (let i = 0; i < 34; i++) {
      if (i) f.advance(DAY); await f.run(); archiveDrafts(f);
      assert.ok(f.worker.status().knownSources <= 100); assert.equal(f.worker.status().pendingDrafts, 0);
    }
    assert.equal(f.worker.status().knownSources, 100); assert.equal(f.additions().length, 100);
    await f.restart(); f.advance(DAY); const before = f.calls.length;
    rejectStatus(() => f.worker.start({}, ACTOR), [409, 429]); assert.equal(f.calls.length, before); f.assertSeedsPreserved();
  }));

  await check('the existing five-hundred-document global cap is not bypassed', () => using(async f => {
    for (let i = 0; i < 497; i++) f.core.save({title:`Global cap fixture ${i}`, body:`Conhecimento sintético de capacidade global número ${i}, sem publicação.`, source:`Global cap source ${i}`}, ACTOR);
    const before = f.documents(); f.enable();
    try { await f.run(); } catch (error) { assert.ok([409, 429, 503].includes(error.status)); }
    assert.deepEqual(f.documents(), before); assert.equal(f.documents().length, 500);
    assert.equal(f.worker.status().pendingDrafts, 0); f.assertSeedsPreserved();
  }));

  console.log(JSON.stringify({suite:'jarvis-research acceptance', passed, production:false, externalNetwork:false, modelCalls:0}));
} finally { globalThis.fetch = originalFetch; }
