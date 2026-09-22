import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveRequestedBrowserUrl} from '../vitriny-neural/browser-target.js';
import {classifyOperationInstruction} from '../../ops/lia-work/gateway/operations-router.mjs';

test('Lia routes named public sites to the browser worker',()=>{
  const command='vc pode acessar youtube e colocar uma musica eletronica para tocar';
  assert.equal(resolveRequestedBrowserUrl(command),'https://www.youtube.com/results?search_query=musica%20eletronica');
  const remote=classifyOperationInstruction(command);
  assert.equal(remote.kind,'browser');
  assert.equal(remote.url,'https://www.youtube.com/results?search_query=musica%20eletronica');
});

test('Lia accepts explicit domains and keeps explanatory text as chat',()=>{
  assert.equal(resolveRequestedBrowserUrl('entre no exemplo.com/agora'),'https://exemplo.com/agora');
  assert.equal(classifyOperationInstruction('entre no exemplo.com/agora').kind,'browser');
  assert.equal(classifyOperationInstruction('explique o que é o YouTube').kind,'unsupported');
});
