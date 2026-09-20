import test from 'node:test';
import assert from 'node:assert/strict';
import { PILOT_PLAN, RELEASE_GATES, readiness, allowanceCostCeiling,
  previewFunding, splitScenes, planVideo, planDistribution } from '../lia-creator/planning.mjs';

const fails = (fn, code) => assert.throws(fn, error => error.code === code);
const funding = overrides => ({ maximumAtoms: '100', monthlyAvailableAtoms: '60',
  purchasedAvailableAtoms: '80', usePurchased: true, approvedPurchasedLimitAtoms: '40', ...overrides });
const target = platform => ({ platform, accountId: `account_${platform}` });
const calendar = overrides => ({ workspaceId: 'workspace_1', contentId: 'content_1', assetVersion: 'v1',
  targets: PILOT_PLAN.platforms.map(target), nowMs: Date.parse('2026-09-20T12:00:00Z'),
  scheduledAt: '2026-09-21T12:00:00Z', timeZone: 'America/Sao_Paulo', ...overrides });

test('pilot is draft, R$45, 30 contents / 120 destinations, no unlimited generation', () => {
  assert.equal(PILOT_PLAN.monthlyPriceCents, 4500);
  assert.equal(PILOT_PLAN.status, 'draft_not_for_sale');
  assert.equal(PILOT_PLAN.contentSlotsPerCycle, 30);
  assert.equal(PILOT_PLAN.publicationSlotsPerCycle, 120);
  assert.equal(PILOT_PLAN.includedAiAtoms, null);
  assert.equal(PILOT_PLAN.storageLimitBytes, null);
  assert.equal(PILOT_PLAN.retentionDays, null);
  for (const key of ['liveBilling', 'liveGeneration', 'livePublishing', 'autoTopup']) assert.equal(PILOT_PLAN[key], false);
});
test('nested pilot arrays are immutable', () => {
  assert.throws(() => PILOT_PLAN.platforms.push('other'), TypeError);
  assert.throws(() => { PILOT_PLAN.monthlyPriceCents = 1; }, TypeError);
});
test('empty readiness fails all gates', () => assert.deepEqual(readiness().missing, [...RELEASE_GATES]));
test('checklist completion is not production authorization', () => {
  assert.deepEqual(readiness(Object.fromEntries(RELEASE_GATES.map(g => [g, true]))),
    { missing: [], checklistComplete: true, productionAuthorized: false });
});
test('truthy strings do not satisfy readiness', () => assert.equal(readiness({ measured_unit_economics: 'true' }).missing.length, RELEASE_GATES.length));
test('invalid readiness inputs fail', () => fails(() => readiness(null), 'invalid_evidence'));
test('synthetic cost ceiling has no assumed tax rates or retail grant', () => {
  assert.deepEqual(allowanceCostCeiling({ paymentFeesCents: 200, taxesCents: 300, infrastructureCents: 400,
    supportCents: 500, riskCents: 600, targetContributionCents: 2000 }),
  { maximumIncludedSupplierCostCents: 500, retailAllowanceAtoms: null });
});
test('missing real costs are not interpreted as zero', () => fails(() => allowanceCostCeiling({}), 'unmeasured_or_invalid_cost'));
test('negative economics are blocked', () => fails(() => allowanceCostCeiling({ paymentFeesCents: 4500,
  taxesCents: 1, infrastructureCents: 0, supportCents: 0, riskCents: 0, targetContributionCents: 0 }), 'plan_economics_negative'));
test('fractional cents are rejected', () => fails(() => allowanceCostCeiling({ paymentFeesCents: 0.5 }), 'unmeasured_or_invalid_cost'));
test('funding preview splits monthly first without debit', () => assert.deepEqual(previewFunding(funding()),
  { monthlyAtoms: '60', purchasedAtoms: '40', totalAtoms: '100', reservationPerformed: false, autoTopup: false }));
test('monthly-only preview needs no purchased credit permission', () => assert.equal(previewFunding(funding({ monthlyAvailableAtoms: '100', usePurchased: false })).purchasedAtoms, '0'));
test('purchased credit needs explicit consent', () => fails(() => previewFunding(funding({ usePurchased: false })), 'additional_credit_consent_required'));
test('per-project extra limit is enforced by preview', () => fails(() => previewFunding(funding({ approvedPurchasedLimitAtoms: '39' })), 'approved_credit_limit_exceeded'));
test('insufficient purchased funds never request an automatic topup', () => fails(() => previewFunding(funding({ purchasedAvailableAtoms: '39' })), 'insufficient_credits'));
test('credit consent must be boolean', () => fails(() => previewFunding(funding({ usePurchased: 'true' })), 'invalid_credit_consent'));
for (const value of ['-1', '01', '1.5', '1e3', '', '9000000000000001', 100, null]) {
  test(`invalid monetary input ${JSON.stringify(value)}`, () => fails(() => previewFunding(funding({ maximumAtoms: value })), 'invalid_atoms'));
}
test('zero quotes cannot start a paid funding preview', () => fails(() => previewFunding(funding({ maximumAtoms: '0' })), 'positive_quote_required'));
test('60 seconds yields six 10-second scenes', () => assert.deepEqual(splitScenes(60).map(s => s.durationSeconds), [10, 10, 10, 10, 10, 10]));
test('65 seconds has a 5-second final scene', () => assert.deepEqual(splitScenes(65).map(s => s.durationSeconds), [10, 10, 10, 10, 10, 10, 5]));
test('all supported durations have exact contiguous timeline and bounded scenes', () => {
  for (let duration = 3; duration <= 180; duration++) {
    const scenes = splitScenes(duration); let end = 0;
    for (const scene of scenes) {
      assert.equal(scene.startSeconds, end);
      assert.ok(scene.durationSeconds >= 3 && scene.durationSeconds <= 10);
      end += scene.durationSeconds;
    }
    assert.equal(end, duration);
  }
});
for (const duration of [0, 1, 2, 181, 5.5, '60', NaN, Infinity]) {
  test(`invalid duration ${String(duration)}`, () => fails(() => splitScenes(duration), 'duration_outside_pilot_range'));
}
test('Portuguese presenter keeps the same character/voice; no Kling speech', () => {
  const p = planVideo({ durationSeconds: 60, mode: 'presenter', voiceId: 'voice_1', characterId: 'character_1', productReferenceId: 'product_1' });
  assert.equal(p.voiceProvider, 'elevenlabs'); assert.equal(p.language, 'pt-BR');
  assert.equal(p.aspectRatio, '9:16'); assert.equal(p.lipSyncSeconds, 60);
  assert.ok(p.scenes.every(s => s.voiceId === 'voice_1' && s.characterId === 'character_1' && s.productReferenceId === 'product_1' && s.nativeAudio === false && s.lipSyncProvider === 'sync'));
  assert.equal(p.executed, false); assert.equal(p.timingVerified, false); assert.equal(p.identityVerified, false);
});
test('English narration has no unnecessary lip sync', () => {
  const p = planVideo({ durationSeconds: 30, language: 'en', voiceId: 'voice_2' });
  assert.equal(p.lipSyncSeconds, 0); assert.ok(p.scenes.every(s => s.language === 'en' && !s.lipSyncProvider));
});
test('mixed scenes charge lip sync only as a planned duration for speaking scenes', () => {
  const p = planVideo({ durationSeconds: 60, mode: 'presenter', voiceId: 'voice_1', characterId: 'c1', speakingSceneIndexes: [0, 1, 4] });
  assert.equal(p.lipSyncSeconds, 30);
});
test('ambient mode has no speech provider', () => {
  const p = planVideo({ durationSeconds: 10, mode: 'ambient' });
  assert.equal(p.voiceProvider, null); assert.ok(p.scenes.every(s => s.nativeAudio));
});
test('presenter requires character reference', () => fails(() => planVideo({ durationSeconds: 10, mode: 'presenter', voiceId: 'voice' }), 'invalid_identifier'));
test('narration requires an approved voice identifier', () => fails(() => planVideo({ durationSeconds: 10 }), 'invalid_identifier'));
test('unsupported language cannot silently become English', () => fails(() => planVideo({ durationSeconds: 10, language: 'es', voiceId: 'voice' }), 'unsupported_language'));
test('unsupported audio mode blocked', () => fails(() => planVideo({ durationSeconds: 10, mode: 'auto' }), 'unsupported_audio_mode'));
test('ambient with voice is an explicit conflict', () => fails(() => planVideo({ durationSeconds: 10, mode: 'ambient', voiceId: 'voice' }), 'ambient_mode_has_no_voice'));
test('duplicate sync scene blocked', () => fails(() => planVideo({ durationSeconds: 10, mode: 'presenter', voiceId: 'voice', characterId: 'c', speakingSceneIndexes: [0, 0] }), 'invalid_speaking_scenes'));
test('duplicate sync scene within size also blocked', () => fails(() => planVideo({ durationSeconds: 30, mode: 'presenter', voiceId: 'voice', characterId: 'c', speakingSceneIndexes: [0, 0] }), 'duplicate_speaking_scene'));
test('outside scene index blocked', () => fails(() => planVideo({ durationSeconds: 30, mode: 'presenter', voiceId: 'voice', characterId: 'c', speakingSceneIndexes: [3] }), 'invalid_speaking_scene'));
test('narration cannot silently schedule lip sync', () => fails(() => planVideo({ durationSeconds: 10, voiceId: 'voice', speakingSceneIndexes: [0] }), 'audio_mode_conflict'));
test('four destinations means one content / four publications / zero extra generation', () => {
  const p = planDistribution(calendar());
  assert.equal(p.contentSlotIncrement, 1); assert.equal(p.publicationSlotIncrement, 4);
  assert.equal(p.generationChargesAdded, 0); assert.equal(p.quotaReserved, false);
  assert.ok(p.jobs.every(j => j.state === 'draft' && !j.consentRecorded && !j.oauthVerified && !j.apiReviewVerified && j.externalReceiptId === null && j.privacy === null));
});
test('job keys are deterministic across harmless rescheduling', () => {
  const a = planDistribution(calendar()), b = planDistribution(calendar({ scheduledAt: '2026-09-22T12:00:00Z' }));
  assert.deepEqual(a.jobs.map(j => j.key), b.jobs.map(j => j.key));
});
test('workspace, asset and account changes do not reuse a publication key', () => {
  const original = planDistribution(calendar()).jobs[0].key;
  for (const change of [{ workspaceId: 'w2' }, { assetVersion: 'v2' }, { contentId: 'c2' }, { targets: [{ platform: 'facebook_page', accountId: 'a2' }] }]) {
    assert.notEqual(planDistribution(calendar(change)).jobs[0].key, original);
  }
});
test('30 contents already used blocks a new content', () => fails(() => planDistribution(calendar({ usedContentSlots: 30 })), 'content_quota_exceeded'));
test('previously counted content can add destinations within separate cap', () => assert.equal(planDistribution(calendar({ usedContentSlots: 30, contentAlreadyCounted: true })).contentSlotIncrement, 0));
test('120 destinations already used blocks new jobs', () => fails(() => planDistribution(calendar({ usedPublicationSlots: 120 })), 'publication_quota_exceeded'));
test('negative quota counters blocked', () => fails(() => planDistribution(calendar({ usedContentSlots: -1 })), 'invalid_quota_snapshot'));
test('past schedule blocked', () => fails(() => planDistribution(calendar({ scheduledAt: '2026-09-19T12:00:00Z' })), 'future_schedule_required'));
test('missing timezone is rejected', () => fails(() => planDistribution(calendar({ timeZone: undefined })), 'invalid_timezone'));
test('invalid timezone rejected', () => fails(() => planDistribution(calendar({ timeZone: 'not_a_zone' })), 'invalid_timezone'));
test('local ambiguous date must be converted to UTC first', () => fails(() => planDistribution(calendar({ scheduledAt: '2026-09-21 12:00' })), 'utc_schedule_required'));
test('normalized impossible calendar date is rejected', () => fails(() => planDistribution(calendar({ scheduledAt: '2027-02-30T12:00:00Z' })), 'invalid_schedule'));
test('unsupported network rejected', () => fails(() => planDistribution(calendar({ targets: [target('other')] })), 'unsupported_platform'));
test('one account per platform in pilot', () => fails(() => planDistribution(calendar({ targets: [target('tiktok'), { platform: 'tiktok', accountId: 'second' }] })), 'one_account_per_platform_in_pilot'));
test('empty destinations rejected', () => fails(() => planDistribution(calendar({ targets: [] })), 'invalid_destinations'));
test('unsafe asset identifiers rejected', () => fails(() => planDistribution(calendar({ assetVersion: '../private' })), 'invalid_identifier'));
test('sparse target arrays cannot produce empty jobs', () => fails(() => planDistribution(calendar({ targets: new Array(1) })), 'unsupported_platform'));
