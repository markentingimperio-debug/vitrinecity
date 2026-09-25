/** Review-only post-production planner. No network, files, queue, debit or provider calls.
 * The caller must resolve ownership and capabilities, persist approval, and supply
 * a durable executor separately. A plan/fingerprint is NEVER an authorization.
 */
import {createHash} from 'node:crypto';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
function fail(code) { throw Object.assign(new Error(code), {code}); }
function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).some(key => !keys.includes(key))) fail('audio_edit_shape_invalid');
}
function integer(value, low, high) {
  if (!Number.isSafeInteger(value) || value < low || value > high) fail('audio_edit_duration_invalid');
  return value;
}
function identifier(value) {
  if (typeof value !== 'string' || !ID.test(value)) fail('audio_edit_identifier_invalid');
  return value;
}
function text(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail('audio_edit_speech_invalid');
  return value; // Never silently rewrite an approved spoken script.
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** A measured long narration must be revised, not cut or arbitrarily accelerated. */
export function checkLiaNarrationFit(sceneDurationMs, audioDurationMs) {
  integer(sceneDurationMs, 1000, 15000);
  integer(audioDurationMs, 1, 60000);
  return freeze(audioDurationMs > sceneDurationMs
    ? {fits: false, state: 'script_revision_required', trimSpeech: false, paidRetryAuthorized: false}
    : {fits: true, state: 'ready_to_pad', paddingMs: sceneDurationMs-audioDurationMs, trimSpeech: false, paidRetryAuthorized: false});
}

export function planLiaAudioEditing(input) {
  record(input, ['projectRevisionId','durationSeconds','aspectRatio','language','audioMode',
    'voiceProfileId','captions','scenes']);
  const projectRevisionId=identifier(input.projectRevisionId);
  const durationSeconds=integer(input.durationSeconds, 10, 3600);
  if (!['pt-BR','en'].includes(input.language)) fail('audio_edit_language_invalid');
  if (!['9:16','16:9','1:1'].includes(input.aspectRatio)) fail('audio_edit_aspect_invalid');
  if (!['narration','character_speech'].includes(input.audioMode)) fail('audio_edit_mode_invalid');
  if (!['none','burn_in','burn_in_and_srt'].includes(input.captions)) fail('audio_edit_captions_invalid');
  const voiceProfileId=identifier(input.voiceProfileId);
  if (!Array.isArray(input.scenes) || !input.scenes.length || input.scenes.length>450) fail('audio_edit_scenes_invalid');
  const used=new Set();
  const scenes=input.scenes.map(scene=>{
    record(scene,['id','durationMs','speech','speakerVisible','source','sourceAssetId']);
    const id=identifier(scene.id);
    if (used.has(id)) fail('audio_edit_scene_duplicate');
    used.add(id);
    const durationMs=integer(scene.durationMs,1000,15000),speech=text(scene.speech);
    if (typeof scene.speakerVisible !== 'boolean') fail('audio_edit_speaker_invalid');
    if (!['generated_scene','existing_video'].includes(scene.source)) fail('audio_edit_source_invalid');
    if (scene.source==='existing_video') identifier(scene.sourceAssetId);
    else if (scene.sourceAssetId!==undefined) fail('audio_edit_source_invalid');
    if (input.audioMode==='narration' && scene.speakerVisible) fail('audio_edit_speaker_mode_conflict');
    return {id,durationMs,speech,speakerVisible:scene.speakerVisible,source:scene.source,
      ...(scene.source==='existing_video'?{sourceAssetId:scene.sourceAssetId}:{})};
  });
  if (scenes.reduce((sum,s)=>sum+s.durationMs,0)!==durationSeconds*1000) fail('audio_edit_total_mismatch');
  if (input.audioMode==='character_speech' && !scenes.some(s=>s.speakerVisible)) fail('audio_edit_speaker_missing');
  const specification={projectRevisionId,durationSeconds,aspectRatio:input.aspectRatio,language:input.language,
    audioMode:input.audioMode,voiceProfileId,captions:input.captions,scenes};
  const fingerprint=createHash('sha256').update(JSON.stringify(specification)).digest('hex');
  const steps=[];
  for (let i=0;i<scenes.length;i++) {
    const scene=scenes[i],key=scene.id;
    steps.push({id:key+':voice',kind:'generate_speech',provider:'elevenlabs',voiceProfileId,
      language:input.language,text:scene.speech,previousText:scenes[i-1]?.speech||'',nextText:scenes[i+1]?.speech||'',
      automaticPaidRetry:false});
    steps.push({id:key+':fit',kind:'measure_speech',provider:'ffprobe',targetMs:scene.durationMs,
      onTooLong:'script_revision_required',cutSpeech:false});
    steps.push({id:key+':visual',kind:scene.source==='existing_video'?'load_owned_video':'generate_scene',
      ...(scene.source==='existing_video'?{assetId:scene.sourceAssetId}:{}),nativeSpeech:false,targetMs:scene.durationMs});
    if (scene.speakerVisible) steps.push({id:key+':prepare-sync',kind:'prepare_sync_inputs',provider:'ffmpeg',
      targetMs:scene.durationMs,measureWith:'ffprobe',padSilence:true,cutSpeech:false,requireCompatibleSpeaker:true});
    if (scene.speakerVisible) steps.push({id:key+':lipsync',kind:'synchronize_lips',provider:'sync',
      precondition:'single_visible_speaker_and_equal_measured_durations',automaticPaidRetry:false});
    steps.push({id:key+':edit',kind:'edit_scene',provider:'ffmpeg',targetMs:scene.durationMs,
      originalSpeech:'replace',narrationSpeed:1,padSilence:true});
  }
  steps.push({id:'final:assemble',kind:'assemble',provider:'ffmpeg',transition:'cut',captions:input.captions,
    aspectRatio:input.aspectRatio,targetMs:durationSeconds*1000,output:'mp4',preserveOriginal:true});
  steps.push({id:'final:verify',kind:'verify',checks:['decode','duration','dimensions','audio_stream',
    'spoken_language_and_text_review','lip_sync_review_if_requested']});
  steps.push({id:'final:deliver',kind:'private_delivery',publicationAuthorized:false});
  return freeze({schemaVersion:1,state:'planning_only',productionAuthorized:false,requiresApproval:true,
    approvalFingerprint:fingerprint,specification,steps,
    requirements:{elevenlabs:true,sync:scenes.some(s=>s.speakerVisible),ffmpeg:true,ffprobe:true,
      sceneGenerator:scenes.some(s=>s.source==='generated_scene')},
    billingInputs:{speechCharacters:scenes.reduce((n,s)=>n+Array.from(s.speech).length,0),
      syncMilliseconds:scenes.filter(s=>s.speakerVisible).reduce((n,s)=>n+s.durationMs,0)},
    monetaryQuote:null,serverMustResolve:['account_and_asset_ownership','voice_license_and_capabilities',
      'provider_model_limits','fresh_tariffs_and_budget','plan_or_coin_reservation','durable_stage_ledger',
      'explicit_revision_bound_approval']});
}
