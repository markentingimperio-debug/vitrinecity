import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyLiaChatOperation,verifiedCodeFiles} from '../vitriny-neural/lia-chat-operations.js';

test('natural requests for a coding task reach the private Codex worker',()=>{
  for(const instruction of [
    'vc pode criar um site para minha loja',
    'você consegue corrigir o código desta página?',
    'tem como você desenvolver um aplicativo para a loja?',
    'preciso que vc faça uma página web para o produto'
  ])assert.equal(classifyLiaChatOperation(instruction).kind,'code',instruction);
});

test('discussion and unrelated browser actions are not dispatched as coding tasks',()=>{
  for(const instruction of [
    'como criar um site para loja?',
    'qual site devo usar para minha loja?',
    'vc pode abrir o YouTube?'
  ])assert.notEqual(classifyLiaChatOperation(instruction).kind,'code',instruction);
});

test('code completion needs a changed file in the private workspace',()=>{
  assert.deepEqual(verifiedCodeFiles({result:{git:{after:{changedFiles:[]}}}}),[]);
  assert.deepEqual(verifiedCodeFiles({result:{git:{after:{changedFiles:['index.html','../../secret.txt','.env','assets/site.css']}}}}),
    ['index.html','assets/site.css']);
});
