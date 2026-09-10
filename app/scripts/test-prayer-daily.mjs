import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {DAILY_PRAYERS, prayerDayInBrazil, getDailyPrayer, renderDailyPrayer, createPrayerDailyHandler} from '../prayer-daily.js';
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

test('the stable collection supplies 31 complete distinct prayers and repeats after 31 days',()=>{
  assert.equal(DAILY_PRAYERS.length,31);
  assert.equal(new Set(DAILY_PRAYERS.map(p=>p.id)).size,31);
  assert.equal(new Set(DAILY_PRAYERS.map(p=>p.title)).size,31);
  for(const prayer of DAILY_PRAYERS){
    assert.equal(prayer.paragraphs.length,4);
    assert.ok(prayer.paragraphs.join(' ').length>480);
    assert.ok(prayer.reflection.length>70);
    assert.ok(prayer.prompt.endsWith('?'));
    assert.equal(prayer.paragraphs.at(-1),'Em nome de Jesus, amém.');
    assert.ok(Object.isFrozen(prayer.paragraphs));
  }
  assert.equal(getDailyPrayer('2026-09-10').id,getDailyPrayer('2026-10-11').id);
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
  assert.ok(result.html.includes('A oração continuará aberta a todos.'));
  assert.ok(result.html.includes('coleção de 31 orações'));
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

test('future, duplicate, injected and impossible query dates cannot impersonate an edition',()=>{
  for(const dia of ['2026-09-12','2026-09-09','2026-02-30',['2026-09-10','2026-09-11'],{},'<script>alert(1)</script>','']){
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
