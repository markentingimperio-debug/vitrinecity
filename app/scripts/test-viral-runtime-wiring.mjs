import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('viral factory workers are wired into app startup', () => {
  const listen = source.lastIndexOf('app.listen(');
  assert.ok(listen > 0, 'app.listen must exist');

  const factory = source.indexOf('setInterval(viralFactoryRun,30*60*1000)', listen);
  const video = source.indexOf('setInterval(viralVideoRun,60000)', listen);
  const initialFactory = source.indexOf('setTimeout(viralFactoryRun,45000)', listen);
  const initialVideo = source.indexOf('setTimeout(viralVideoRun,60000)', listen);

  assert.ok(factory > listen, 'daily viral factory timer must start with the app');
  assert.ok(video > listen, 'video generation/editing timer must start with the app');
  assert.ok(initialFactory > listen, 'viral factory initial run must start with the app');
  assert.ok(initialVideo > listen, 'video worker initial run must start with the app');

  assert.equal(source.indexOf('setInterval(()=>runViralFactory()'), -1,
    'legacy detached viral timer must not return');
  assert.equal(source.indexOf('setInterval(()=>processViralVideoFactory()'), -1,
    'legacy detached video timer must not return');
});

test('video factory keeps the generation, montage and publication stages wired', () => {
  assert.match(source, /async function processViralVideoFactory\(\)/);
  assert.match(source, /async function finishViralQuizVideo\(quizId\)/);
  assert.match(source, /await runFfmpeg\(/);
  assert.match(source, /await publishViralToVitrine\(quizId\)/);
  assert.match(source, /mediaPublications\.publish\(project\.id,userId,'quiz'\)/);
});
