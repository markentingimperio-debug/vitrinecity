import test from 'node:test';
import assert from 'node:assert/strict';
import {viralQueueCapacity, distinctViralThemes, CURATED_VIDEO_TOPICS} from '../viral-factory-policy.js';
import fs from 'node:fs';

test('a stalled queue cannot allocate more scripts, including a forced run', () => {
  assert.equal(viralQueueCapacity(21,3),0);
  assert.equal(viralQueueCapacity(6,3),0);
  assert.equal(viralQueueCapacity(5,3),1);
  assert.equal(viralQueueCapacity(0,3),3);
});
test('exclude generic labels and previously produced themes despite accents or punctuation', () => {
  const result=distinctViralThemes([
    {topic:'geral',category:'plants'},
    {topic:'Adubação correta para plantas em vasos!',category:'plants'},
    {topic:'Como ler a embalagem do adubo',category:'plants'},
    {topic:'COMO LER A EMBALAGEM DO ADUBO',category:'plants'},
    {topic:'Organização de materiais de jardinagem',category:'plants'}
  ],{existing:['adubacao correta para plantas em vasos'],capacity:1});
  assert.deepEqual(result,[{topic:'Como ler a embalagem do adubo',category:'plants'}]);
});
test('candidate filtering preserves separate category quotas and rejects unknown categories', () => {
  const result=distinctViralThemes([
    {topic:'Tema de curiosidades A',category:'curiosities'},
    {topic:'Tema de curiosidades B',category:'curiosities'},
    {topic:'Tema de plantas A',category:'plants'},
    {topic:'Tema de plantas B',category:'plants'},
    {topic:'Uma categoria inválida',category:'news'}
  ]);
  assert.equal(result.length,3);
  assert.equal(result.filter(x=>x.category==='curiosities').length,1);
});
test('selected topics contain complete questions and topic-specific destinations',()=>{
  for(const topic of CURATED_VIDEO_TOPICS){
    assert.equal(topic.source,'editorial_selected');
    assert.equal(topic.questions.length,3);
    for(const q of topic.questions)assert.ok(q.options[q.answer]);
    assert.equal(new URL(topic.destinationUrl).origin,'https://vitrinecity.com');
  }
  assert.match(CURATED_VIDEO_TOPICS.find(t=>t.category==='curiosities').destinationUrl,/organizar-petiscos/);
});
test('factory execution never fetches trends or automatically starts paid video generation',()=>{
  const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('async function runViralFactory('),source.indexOf('function runFfmpeg('));
  assert.doesNotMatch(body,/await viralTrendTopics\(|await chooseViralThemes\(|approveViralQuiz\(/);
  assert.match(body,/CURATED_VIDEO_TOPICS/);
});
