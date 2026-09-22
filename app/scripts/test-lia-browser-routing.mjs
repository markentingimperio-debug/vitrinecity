import test from 'node:test';
import assert from 'node:assert/strict';
import {contextualBrowserInstruction,isRequestedBrowserInstruction,resolveRequestedBrowserUrl} from '../vitriny-neural/browser-target.js';
import {classifyOperationInstruction} from '../../ops/lia-work/gateway/operations-router.mjs';

test('Lia routes named public sites to the browser worker',()=>{
  const command='vc pode acessar youtube e colocar uma musica eletronica para tocar';
  assert.equal(resolveRequestedBrowserUrl(command),'https://www.youtube.com/results?search_query=musica%20eletronica');
  assert.equal(isRequestedBrowserInstruction(command),true);
  const remote=classifyOperationInstruction(command);
  assert.equal(remote.kind,'browser');
  assert.equal(remote.url,'https://www.youtube.com/results?search_query=musica%20eletronica');
  assert.equal(remote.playback,true);
  const colloquial='abra o youtube e coloca uma musica eletronica para tocar';
  assert.equal(resolveRequestedBrowserUrl(colloquial),'https://www.youtube.com/results?search_query=musica%20eletronica');
  assert.equal(classifyOperationInstruction(colloquial).playback,true);
});

test('Lia accepts explicit domains and keeps explanatory text as chat',()=>{
  assert.equal(resolveRequestedBrowserUrl('entre no exemplo.com/agora'),'https://exemplo.com/agora');
  assert.equal(classifyOperationInstruction('entre no exemplo.com/agora').kind,'browser');
  assert.equal(classifyOperationInstruction('explique o que é o YouTube').kind,'unsupported');
  assert.equal(isRequestedBrowserInstruction('explique o que é o YouTube'),false);
});

test('Lia keeps the previous site when the user continues the task',()=>{
  const effective=contextualBrowserInstruction('buscar a música e abrir o primeiro vídeo reproduzível',[
    'abra o youtube e coloca uma musica eletronica para tocar'
  ]);
  assert.match(effective,/youtube/i);
  const plan=classifyOperationInstruction(effective);
  assert.equal(plan.kind,'browser');
  assert.equal(plan.playback,true);
  assert.equal(plan.url,'https://www.youtube.com/results?search_query=musica%20eletronica');
});

test('Lia accepts common synonyms and small spelling mistakes without guessing a site',()=>{
  const typo='acesa o youtub e colca uma musica eletronica pra toca';
  const plan=classifyOperationInstruction(typo);
  assert.equal(plan.kind,'browser');
  assert.equal(plan.playback,true);
  assert.equal(plan.url,'https://www.youtube.com/results?search_query=musica%20eletronica');
  assert.equal(resolveRequestedBrowserUrl('entre no insta'),'https://www.instagram.com');
  assert.equal(resolveRequestedBrowserUrl('faça um site para minha loja'),'');
});
