import test from 'node:test';
import assert from 'node:assert/strict';
import {planLiaAudioEditing,checkLiaNarrationFit} from '../lia-video-audio-editing-plan.mjs';
const original=()=>({projectRevisionId:'draft-1',durationSeconds:60,aspectRatio:'9:16',language:'pt-BR',
  audioMode:'narration',voiceProfileId:'saved-voice',captions:'burn_in_and_srt',
  scenes:Array.from({length:6},(_,i)=>({id:'scene-'+i,durationMs:10000,speech:'Conheça este produto.',
    speakerVisible:false,source:'generated_scene'}))});
test('60 seconds: six scenes, ElevenLabs voice, no Sync for narration',()=>{
  const p=planLiaAudioEditing(original());
  assert.equal(p.steps.filter(s=>s.kind==='generate_speech').length,6);
  assert.equal(p.requirements.sync,false);
  assert.equal(p.billingInputs.syncMilliseconds,0);
  assert.equal(p.steps.at(-3).targetMs,60000);
  assert.equal(p.productionAuthorized,false);assert.equal(p.monetaryQuote,null);
});
test('speaker scenes only: two Sync steps, same saved voice in all scenes',()=>{
  const d=original();d.audioMode='character_speech';d.scenes[0].speakerVisible=true;d.scenes[4].speakerVisible=true;
  const p=planLiaAudioEditing(d);
  assert.equal(p.steps.filter(s=>s.provider==='sync').length,2);
  assert.equal(p.billingInputs.syncMilliseconds,20000);
  const syncAt=p.steps.findIndex(s=>s.provider==='sync');
  assert.equal(p.steps[syncAt-1].kind,'prepare_sync_inputs');
  assert.equal(p.steps[syncAt-1].cutSpeech,false);
  assert.equal(p.steps.filter(s=>s.kind==='prepare_sync_inputs').length,2);
  assert.ok(p.steps.filter(s=>s.provider==='elevenlabs').every(s=>s.voiceProfileId===d.voiceProfileId));
});
test('English preference retained without rewriting approved text',()=>{
  const d=original();d.language='en';d.scenes[0].speech='  Discover this product.  ';
  const p=planLiaAudioEditing(d);assert.equal(p.steps[0].language,'en');assert.equal(p.steps[0].text,d.scenes[0].speech);
});
test('continuity uses preceding and following speech',()=>{
  const d=original();d.scenes[0].speech='Primeiro.';d.scenes[1].speech='Segundo.';
  const voices=planLiaAudioEditing(d).steps.filter(s=>s.provider==='elevenlabs');
  assert.equal(voices[0].previousText,'');assert.equal(voices[0].nextText,'Segundo.');
  assert.equal(voices[1].previousText,'Primeiro.');
});
test('existing video is edited, not generated again',()=>{
  const d=original();for(const [i,s] of d.scenes.entries()){s.source='existing_video';s.sourceAssetId='asset-'+i;}
  const p=planLiaAudioEditing(d);assert.equal(p.requirements.sceneGenerator,false);
  assert.equal(p.steps.filter(s=>s.kind==='generate_scene').length,0);
  assert.equal(p.steps.filter(s=>s.kind==='load_owned_video').length,6);
  assert.equal(p.steps.at(-3).preserveOriginal,true);
});
test('durations compatible with PR216: seven 8s scenes plus 4s',()=>{
  const d=original();d.scenes=Array.from({length:8},(_,i)=>({...d.scenes[0],id:'s'+i,durationMs:i===7?4000:8000}));
  assert.equal(planLiaAudioEditing(d).specification.scenes.length,8);
});
test('65 seconds can be planned without truncating the closing line',()=>{
  const d=original();d.durationSeconds=65;d.scenes.push({...d.scenes[0],id:'last',durationMs:5000});
  assert.equal(planLiaAudioEditing(d).steps.at(-3).targetMs,65000);
});
test('input is not mutated and returned plan is immutable',()=>{
  const d=original(),copy=structuredClone(d),p=planLiaAudioEditing(d);
  assert.deepEqual(d,copy);assert.equal(Object.isFrozen(p.specification.scenes[0]),true);
});
test('fingerprint reproducible, not consent',()=>{
  assert.equal(planLiaAudioEditing(original()).approvalFingerprint,planLiaAudioEditing(original()).approvalFingerprint);
  assert.equal(planLiaAudioEditing(original()).requiresApproval,true);
});
for(const [name,edit] of [
  ['language',d=>d.language='en'],['voice',d=>d.voiceProfileId='other'],
  ['script',d=>d.scenes[0].speech='Uma nova fala.'],['aspect',d=>d.aspectRatio='16:9'],
  ['captions',d=>d.captions='none'],['speaker mode',d=>{d.audioMode='character_speech';d.scenes[0].speakerVisible=true;}],
  ['scene duration',d=>{d.scenes[0].durationMs=9000;d.scenes[1].durationMs=11000;}]
])test('changed '+name+' invalidates previous fingerprint',()=>{
  const d=original(),before=planLiaAudioEditing(d).approvalFingerprint;edit(d);
  assert.notEqual(planLiaAudioEditing(d).approvalFingerprint,before);
});
for(const [name,edit] of [
  ['unknown account',d=>d.userId=10],['client approval',d=>d.approved=true],['client price',d=>d.price=0],
  ['API key',d=>d.apiKey='secret'],['unknown language',d=>d.language='es'],['coerced duration',d=>d.durationSeconds='60'],
  ['missing voice',d=>delete d.voiceProfileId],['raw voice path',d=>d.voiceProfileId='../../secret'],
  ['external source',d=>d.scenes[0].sourceAssetId='https://example.com/video.mp4'],
  ['wrong source',d=>d.scenes[0].source='external_url'],
  ['missing existing source',d=>d.scenes[0].source='existing_video'],
  ['unknown scene field',d=>d.scenes[0].token='x'],['duplicate scene',d=>d.scenes[1].id=d.scenes[0].id],
  ['no scenes',d=>d.scenes=[]],['wrong total',d=>d.scenes[0].durationMs=9000],
  ['empty speech',d=>d.scenes[0].speech=' '],['speech too long',d=>d.scenes[0].speech='x'.repeat(2001)],
  ['invalid controls',d=>d.scenes[0].speech='x\x01'],['unbound speaker mode',d=>d.audioMode='character_speech'],
  ['narration with speaker marked',d=>d.scenes[0].speakerVisible=true],
  ['unknown audio mode',d=>d.audioMode='native'],['unknown format',d=>d.aspectRatio='4:3'],
  ['unknown captions',d=>d.captions='auto'],['scene too long',d=>d.scenes[0].durationMs=16000],
  ['missing speaker flag',d=>delete d.scenes[0].speakerVisible],['overflow duration',d=>d.durationSeconds=Infinity]
])test('rejects '+name,()=>{const d=original();edit(d);assert.throws(()=>planLiaAudioEditing(d));});
test('audio longer than scene requires revision, not clipping or paid retry',()=>{
  assert.deepEqual(checkLiaNarrationFit(10000,11000),{fits:false,state:'script_revision_required',trimSpeech:false,paidRetryAuthorized:false});
});
test('short audio is padded, not sped up',()=>{
  assert.deepEqual(checkLiaNarrationFit(10000,9200),{fits:true,state:'ready_to_pad',paddingMs:800,trimSpeech:false,paidRetryAuthorized:false});
});
test('exact length does not add silence',()=>{assert.equal(checkLiaNarrationFit(10000,10000).paddingMs,0);});
for(const value of [0,-1,NaN,Infinity,'1000',undefined])test('invalid measured duration '+String(value),()=>{
  assert.throws(()=>checkLiaNarrationFit(10000,value));
});
