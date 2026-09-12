import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {runInNewContext} from 'node:vm';
import express from 'express';
import {DAILY_PRAYERS, PRAYER_COLLECTIONS, PRAYER_COUNT, prayerDayInBrazil, getDailyPrayer, renderDailyPrayer, createPrayerDailyHandler} from '../prayer-daily.js';
import {prayerShareUrl} from '../public/oracao-do-dia.js';

const template=readFileSync(new URL('../public/oracao-do-dia.html',import.meta.url),'utf8');
function invoke(query={}, instant='2026-09-11T03:00:00Z', readTemplate=()=>template){
  const result={status:200,headers:{}};
  const res={set(name,value){result.headers[name]=value;return this;},status(value){result.status=value;return this;},type(value){result.type=value;return this;},send(value){result.html=value;return this;}};
  createPrayerDailyHandler({readTemplate,now:()=>new Date(instant)})({query},res,error=>{result.error=error;});
  return result;
}

test('Brazil date changes at its midnight, independently from the UTC calendar',()=>{
  assert.equal(prayerDayInBrazil(new Date('2026-09-11T02:59:59Z')),'2026-09-10');
  assert.equal(prayerDayInBrazil(new Date('2026-09-11T03:00:00Z')),'2026-09-11');
  assert.equal(prayerDayInBrazil(new Date('2028-03-01T02:59:59Z')),'2028-02-29');
  assert.throws(()=>prayerDayInBrazil(new Date('invalid')));
});

test('dated collections preserve the original entries and supply 66 complete distinct prayers',()=>{
  assert.equal(DAILY_PRAYERS.length,31);
  assert.equal(new Set(DAILY_PRAYERS.map(p=>p.id)).size,31);
  assert.equal(new Set(DAILY_PRAYERS.map(p=>p.title)).size,31);
  assert.equal(PRAYER_COUNT,66);
  assert.equal(new Set(PRAYER_COLLECTIONS.at(-1).prayers.map(p=>p.title)).size,66);
  for(const prayer of PRAYER_COLLECTIONS.at(-1).prayers){
    assert.equal(prayer.paragraphs.length,4);
    assert.ok(prayer.paragraphs.join(' ').length>480);
    assert.ok(prayer.reflection.length>70);
    assert.ok(prayer.prompt.endsWith('?'));
    assert.equal(prayer.paragraphs.at(-1),'Em nome de Jesus, amém.');
    assert.ok(Object.isFrozen(prayer.paragraphs));
  }
  assert.equal(getDailyPrayer('2026-09-12').id,getDailyPrayer('2026-11-17').id);
  assert.equal(getDailyPrayer('2026-09-10').id,'prayer-v1-01');
  assert.equal(getDailyPrayer('2026-09-11').id,'prayer-v1-02');
  assert.equal(getDailyPrayer('2026-09-12').id,'prayer-v2-01');
  assert.notEqual(getDailyPrayer('2026-09-10').id,getDailyPrayer('2026-09-11').id);
  assert.equal(getDailyPrayer('2028-02-29').day,'2028-02-29');
  for(const day of ['2026-09-09','2026-02-30','2027-02-29','2026-9-10','bad',null])assert.throws(()=>getDailyPrayer(day));
});

test('SSR provides the entire edition, reflection, dates and unchanged support controls without client fetch',()=>{
  const result=invoke();
  assert.equal(result.status,200);assert.equal(result.error,undefined);
  assert.equal(result.headers['Cache-Control'],'no-store');
  assert.ok(result.html.includes('datetime="2026-09-11"'));
  assert.ok(result.html.includes('Gratidão pelas pequenas coisas'));
  assert.ok(result.html.includes('A quem você pode agradecer por um gesto concreto?'));
  assert.ok(!result.html.includes('10 de setembro de 2026'));
  assert.ok(result.html.includes('id="sharePrayer"'));
  assert.ok(result.html.includes('A oração é gratuita e continuará aberta a todos.'));
  assert.match(result.html,/collection-count:start -->66<!--/);
  assert.match(result.html,/Oração de sexta-feira/);
  assert.match(result.html,/aria-current="date"/);
});

test('dated sharing preserves the exact edition later and removes unrelated payment identifiers',()=>{
  const url=prayerShareUrl('https://vitrinecity.com/oracao-do-dia.html?apoio=retorno&ref=private#support','2026-09-10');
  assert.equal(url,'https://vitrinecity.com/oracao-do-dia.html?dia=2026-09-10#oracao');
  const archive=invoke({dia:'2026-09-10'},'2026-12-01T12:00:00Z');
  assert.equal(archive.status,200);
  assert.ok(archive.html.includes('Um coração mais tranquilo'));
  assert.ok(archive.html.includes('datetime="2026-09-10"'));
  assert.ok(!prayerShareUrl(url,'2026-02-30').includes('?'));
});

test('out-of-range, duplicate, injected and impossible query dates cannot impersonate an edition',()=>{
  for(const dia of ['2028-09-12','2026-09-09','2026-02-30',['2026-09-10','2026-09-11'],{},'<script>alert(1)</script>','']){
    const result=invoke({dia});assert.equal(result.status,400);
    assert.ok(result.html.includes('Ler a oração de hoje'));
    assert.ok(!result.html.includes('<script>'));
  }
});

test('rendering escapes content and fails closed if the template slots are absent or duplicated',()=>{
  const prayer={...getDailyPrayer('2026-09-10'),title:'<script>alert("x")</script>',paragraphs:['<img onerror=x>'],prompt:'<b>texto</b>'};
  const html=renderDailyPrayer(template,prayer);
  assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<img onerror=x>'));
  assert.throws(()=>renderDailyPrayer(template.replace('<!-- prayer:text:start -->',''),prayer));
  assert.throws(()=>renderDailyPrayer(`${template}<!-- prayer:edition:start -->`,prayer));
  assert.ok(invoke({},undefined,()=>{throw new Error('read failed');}).error);
});

// Execute the three actual registrations from server.js, in their actual order,
// against Express and real public files. Importing all of server.js would open
// the production database and start unrelated workers. Fail explicitly if these
// registrations are refactored instead of silently testing a copied fixture.
function productionPrayerRegistrations(){
  const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
  const registrations=source.split(/\r?\n/).map(line=>line.trim()).filter(line=>/^app\.(get|use)\(/.test(line)&&(
    line.includes('createPrayerDailyHandler(')
    ||line.includes("const candidates=relative.endsWith('.html')")
    ||line.includes("express.static(path.join(dir, 'public'), { extensions: ['html'] })")
  ));
  assert.equal(registrations.length,3,'Update the routing harness after a public-route refactor; all three production registrations are required.');
  assert.equal(registrations.filter(line=>line.includes('createPrayerDailyHandler(')).length,1);
  assert.equal(registrations.filter(line=>line.includes('const candidates=relative.endsWith')).length,1);
  assert.equal(registrations.filter(line=>line.includes('express.static(')).length,1);
  return registrations;
}

async function prayerHttpServer(t,{reproduceOldOrder=false}={}){
  let registrations=productionPrayerRegistrations();
  if(reproduceOldOrder){
    // Negative control: the old catchall really serves the stale template and
    // ignores ?dia, so this fixture demonstrates the reported failure.
    registrations=[registrations.find(line=>line.includes('const candidates=relative.endsWith')),registrations.find(line=>line.includes('createPrayerDailyHandler(')),registrations.find(line=>line.includes('express.static('))];
  }
  const app=express();
  runInNewContext(registrations.join('\n'),{
    app,express,fs,path,dir:fileURLToPath(new URL('../',import.meta.url)),
    createPrayerDailyHandler:options=>createPrayerDailyHandler({...options,now:()=>new Date('2026-09-11T12:00:00Z')}),
  },{timeout:1000,filename:'server-public-prayer-routing.fixture.js'});
  const server=app.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
  const base=`http://127.0.0.1:${server.address().port}`;
  return async route=>{
    const response=await fetch(`${base}${route}`,{signal:AbortSignal.timeout(5000)});
    return {status:response.status,cache:response.headers.get('cache-control'),contentType:response.headers.get('content-type'),html:await response.text()};
  };
}

test('actual server route order returns daily and archived editions over HTTP before HTML/static fallbacks',async t=>{
  const request=await prayerHttpServer(t);
  for(const route of ['/oracao-do-dia','/oracao-do-dia.html']){
    const today=await request(route);
    assert.equal(today.status,200,route);assert.equal(today.cache,'no-store',route);assert.match(today.contentType,/text\/html/);
    assert.match(today.html,/datetime="2026-09-11"/);assert.match(today.html,/Gratidão pelas pequenas coisas/);
    assert.ok(!today.html.includes('10 de setembro de 2026'),`${route} must not return the static fallback's date`);
    const archive=await request(`${route}?dia=2026-09-10&utm_source=test`);
    assert.equal(archive.status,200);assert.equal(archive.cache,'no-store');
    assert.match(archive.html,/datetime="2026-09-10"/);assert.match(archive.html,/Um coração mais tranquilo/);
    for(const query of ['dia=2028-09-12','dia=2026-02-30','dia=2026-09-10&dia=2026-09-11']){
      const invalid=await request(`${route}?${query}`);
      assert.equal(invalid.status,400,`${route}?${query}`);assert.equal(invalid.cache,'no-store');
      assert.match(invalid.html,/Ler a oração de hoje/);
    }
  }
  const script=await request('/oracao-do-dia.js');
  assert.equal(script.status,200);assert.match(script.contentType,/javascript/);assert.match(script.html,/buildPrayerShareText/);
});

test('regression control: moving the daily handler after the real HTML catchall reproduces the stale edition',async t=>{
  const request=await prayerHttpServer(t,{reproduceOldOrder:true});
  for(const route of ['/oracao-do-dia','/oracao-do-dia.html']){
    const response=await request(`${route}?dia=2026-09-11`);
    assert.equal(response.status,200);assert.notEqual(response.cache,'no-store');
    assert.match(response.html,/datetime="2026-09-10"/);
    assert.ok(!response.html.includes('Gratidão pelas pequenas coisas'));
    const invalid=await request(`${route}?dia=impossivel`);
    assert.equal(invalid.status,200,'The old catchall incorrectly ignored the invalid edition.');
  }
});

 test('the calendar browses upcoming weekdays, leap days and month boundaries',()=>{
for(const [day,weekday] of [['2026-09-12','sábado'],['2026-09-13','domingo'],['2026-09-14','segunda-feira'],['2027-01-01','sexta-feira']]){const result=invoke({dia:day});assert.equal(result.status,200);assert.ok(result.html.includes('Oração de '+weekday));assert.match(result.html,/Oração programada/);assert.ok(result.html.includes('name="dia"'));}
assert.equal(getDailyPrayer('2028-02-29').weekday,'terça-feira');
const start=invoke({dia:'2026-09-10'});assert.ok(!start.html.includes('← Dia anterior'));
});
