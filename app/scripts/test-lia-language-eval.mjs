import test from 'node:test';
import assert from 'node:assert/strict';
import {contextualBrowserInstruction,isPlaybackRequest,isRequestedBrowserInstruction,isSearchRequest,resolveRequestedBrowserUrl} from '../vitriny-neural/browser-target.js';
import {classifyOperationInstruction} from '../../ops/lia-work/gateway/operations-router.mjs';
import {liaLanguageEval as suite} from './fixtures/lia-language-eval-cases.mjs';

function verdict(item,effective=item.input){
  const plan=classifyOperationInstruction(effective),url=plan.url?new URL(plan.url):null;
  const failures=[];
  if(item.kind&&plan.kind!==item.kind)failures.push(`kind=${plan.kind}`);
  if(item.host&&url?.hostname!==item.host)failures.push(`host=${url?.hostname||'none'}`);
  if(item.query&&url?.searchParams.get('search_query')!==item.query)failures.push(`query=${url?.searchParams.get('search_query')||'none'}`);
  if(item.playback!==undefined&&Boolean(plan.playback)!==item.playback)failures.push(`playback=${Boolean(plan.playback)}`);
  if(item.search!==undefined&&isSearchRequest(item.input)!==item.search)failures.push(`search=${isSearchRequest(item.input)}`);
  return failures;
}

test('language calibration cases meet the deterministic gate',()=>{
  const failed=suite.calibration.flatMap(item=>verdict(item).map(reason=>`${item.id}:${reason}`));
  assert.deepEqual(failed,[]);
});

test('independent language holdout meets the deterministic gate',()=>{
  const failed=suite.holdout.flatMap(item=>verdict(item).map(reason=>`${item.id}:${reason}`));
  assert.deepEqual(failed,[]);
});

test('conversation context is reused only for explicit continuations',()=>{
  const failed=[];
  for(const item of suite.context){
    const effective=contextualBrowserInstruction(item.input,item.previous);
    if(item.unchanged&&effective!==item.input)failed.push(`${item.id}:unexpected-context`);
    failed.push(...verdict(item,effective).map(reason=>`${item.id}:${reason}`));
  }
  assert.deepEqual(failed,[]);
});

test('fuzzy matching keeps a zero false-action gate for the negative cases',()=>{
  const negatives=[...suite.calibration,...suite.holdout].filter(item=>item.kind==='unsupported');
  assert.equal(negatives.some(item=>isRequestedBrowserInstruction(item.input)),false);
  assert.equal(isPlaybackRequest('explique reprodução automática'),false);
  assert.equal(resolveRequestedBrowserUrl('faça um site para a loja'), '');
});
