import { createHash } from 'node:crypto';

/** Offline planning only. Not imported by server.js; no IO or wallet mutations.
 * Trusted server snapshots must be rechecked in a transaction by future adapters.
 * A successful preview is NOT authorization to debit, render, or publish.
 */
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const need = (ok, code) => {
  if (!ok) throw Object.assign(new Error(code), { code });
};
const integer = (value, min, max, code) => {
  need(Number.isSafeInteger(value) && value >= min && value <= max, code);
  return value;
};
const identifier = value => {
  need(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value), 'invalid_identifier');
  return value;
};
const atoms = value => {
  need(typeof value === 'string' && /^(0|[1-9]\d{0,15})$/.test(value), 'invalid_atoms');
  const result = BigInt(value);
  need(result <= 9000000000000000n, 'invalid_atoms');
  return result;
};

export const PILOT_PLAN = freeze({
  id: 'lia-creator-start-45-v1', status: 'draft_not_for_sale', currency: 'BRL',
  monthlyPriceCents: 4500, billingPeriod: 'calendar_month_from_provider',
  workspaces: 1, socialDestinations: 4, contentSlotsPerCycle: 30,
  publicationSlotsPerCycle: 120,
  platforms: ['facebook_page', 'instagram', 'tiktok', 'youtube'],
  languages: ['pt-BR', 'en'], defaultLanguage: 'pt-BR',
  includedAiAtoms: null, storageLimitBytes: null, retentionDays: null,
  canonicalWallet: 'vitrine_coins', autoTopup: false,
  liveBilling: false, liveGeneration: false, livePublishing: false
});

export const RELEASE_GATES = freeze([
  'measured_unit_economics', 'versioned_allowance_terms', 'storage_policy',
  'authenticated_workspace_isolation', 'mp_verified_invoice_reconciliation',
  'atomic_cycle_grants', 'canonical_wallet_lot_filters', 'budget_reservations',
  'elevenlabs_contract_and_receipts', 'sync_contract_and_receipts',
  'persistent_job_reconciliation', 'render_and_voice_e2e',
  'social_oauth_and_required_reviews', 'publication_consent_and_receipts',
  'cancellation_refunds_and_privacy', 'reviewed_deploy_and_rollback'
]);

export function readiness(evidence = {}) {
  need(evidence && typeof evidence === 'object' && !Array.isArray(evidence), 'invalid_evidence');
  const missing = RELEASE_GATES.filter(gate => evidence[gate] !== true);
  return { missing, checklistComplete: missing.length === 0, productionAuthorized: false };
}

/** An upper bound for supplier allowance costs, NOT a retail credit quote.
 * Inputs must come from measured economics; no default tax/fee assumptions.
 */
export function allowanceCostCeiling(costs) {
  need(costs && typeof costs === 'object', 'costs_required');
  const keys = ['paymentFeesCents', 'taxesCents', 'infrastructureCents',
    'supportCents', 'riskCents', 'targetContributionCents'];
  const committed = keys.reduce((sum, key) => sum + integer(costs[key], 0, 4500, 'unmeasured_or_invalid_cost'), 0);
  need(committed <= PILOT_PLAN.monthlyPriceCents, 'plan_economics_negative');
  return { maximumIncludedSupplierCostCents: 4500 - committed, retailAllowanceAtoms: null };
}

/** No independent balance is stored here. Canonical lot selection does not yet
 * enforce this preview; integrating it requires atomic wallet filters + tests.
 */
export function previewFunding({ maximumAtoms, monthlyAvailableAtoms, purchasedAvailableAtoms,
  usePurchased = false, approvedPurchasedLimitAtoms = '0' }) {
  need(typeof usePurchased === 'boolean', 'invalid_credit_consent');
  const maximum = atoms(maximumAtoms), monthly = atoms(monthlyAvailableAtoms);
  const purchased = atoms(purchasedAvailableAtoms), limit = atoms(approvedPurchasedLimitAtoms);
  need(maximum > 0n, 'positive_quote_required');
  const fromMonthly = monthly < maximum ? monthly : maximum;
  const remainder = maximum - fromMonthly;
  need(remainder === 0n || usePurchased, 'additional_credit_consent_required');
  need(remainder <= limit, 'approved_credit_limit_exceeded');
  need(remainder <= purchased, 'insufficient_credits');
  return { monthlyAtoms: String(fromMonthly), purchasedAtoms: String(remainder),
    totalAtoms: String(maximum), reservationPerformed: false, autoTopup: false };
}

export function splitScenes(durationSeconds) {
  integer(durationSeconds, 3, 180, 'duration_outside_pilot_range');
  const count = Math.ceil(durationSeconds / 10);
  const durations = Array.from({ length: count }, (_, i) => Math.min(10, durationSeconds - i * 10));
  // Avoid a 1- or 2-second tail. These are editorial targets, not API promises.
  if (count > 1 && durations[count - 1] < 3) {
    const borrow = 3 - durations[count - 1];
    durations[count - 2] -= borrow;
    durations[count - 1] += borrow;
  }
  let start = 0;
  return durations.map((seconds, index) => {
    const scene = { index, startSeconds: start, durationSeconds: seconds };
    start += seconds;
    return scene;
  });
}

export function planVideo({ durationSeconds, language = 'pt-BR', mode = 'narration',
  voiceId, characterId, productReferenceId, speakingSceneIndexes } = {}) {
  need(PILOT_PLAN.languages.includes(language), 'unsupported_language');
  need(['narration', 'presenter', 'ambient'].includes(mode), 'unsupported_audio_mode');
  const scenes = splitScenes(durationSeconds), spoken = mode !== 'ambient';
  if (spoken) identifier(voiceId);
  else need(voiceId === undefined, 'ambient_mode_has_no_voice');
  if (characterId !== undefined) identifier(characterId);
  if (productReferenceId !== undefined) identifier(productReferenceId);
  const speaking = speakingSceneIndexes ?? (mode === 'presenter' ? scenes.map(s => s.index) : []);
  need(Array.isArray(speaking) && speaking.length <= scenes.length, 'invalid_speaking_scenes');
  need(new Set(speaking).size === speaking.length, 'duplicate_speaking_scene');
  for (const index of speaking) integer(index, 0, scenes.length - 1, 'invalid_speaking_scene');
  need(mode === 'presenter' ? speaking.length > 0 : speaking.length === 0, 'audio_mode_conflict');
  if (mode === 'presenter') identifier(characterId);
  const selected = new Set(speaking);
  const items = scenes.map(scene => ({ ...scene,
    characterId: characterId ?? null, productReferenceId: productReferenceId ?? null,
    voiceId: spoken ? voiceId : null, language: spoken ? language : null,
    videoProvider: 'kling', nativeAudio: !spoken, lipSyncProvider: selected.has(scene.index) ? 'sync' : null
  }));
  return {
    planningOnly: true, executed: false, durationSeconds, aspectRatio: '9:16',
    targetWidth: 1080, targetHeight: 1920, exportFormat: 'mp4', cuts: 'direct',
    mode, language, scenes: items, voiceProvider: spoken ? 'elevenlabs' : null,
    voiceStrategy: spoken ? 'approved_script_with_timestamps_then_measured_segments' : null,
    lipSyncSeconds: items.filter(s => s.lipSyncProvider).reduce((n, s) => n + s.durationSeconds, 0),
    workflow: ['script_approval', 'project_quote_approval', 'atomic_budget_reservation',
      ...(spoken ? ['speech_with_timestamps', 'measured_speech_timing_check'] : []),
      'reference_video_scenes', ...(selected.size ? ['per_scene_lip_sync'] : []),
      'ffmpeg_edit', 'output_validation', 'final_preview_approval'],
    requiresRuntimeCapabilityCheck: true, timingVerified: false, identityVerified: false,
    outputGenerated: false, providerRequestsSent: 0
  };
}

/** A draft calendar only. All quota/ownership snapshots are server inputs, not
 * trusted request-body claims. Approval and capability checks happen later.
 */
export function planDistribution({ workspaceId, contentId, assetVersion, targets,
  scheduledAt, timeZone, nowMs, usedContentSlots = 0, usedPublicationSlots = 0,
  contentAlreadyCounted = false } = {}) {
  [workspaceId, contentId, assetVersion].forEach(identifier);
  integer(nowMs, 0, 8640000000000000, 'invalid_clock');
  need(typeof scheduledAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(scheduledAt), 'utc_schedule_required');
  const when = Date.parse(scheduledAt);
  need(Number.isFinite(when) && new Date(when).toISOString().replace('.000Z', 'Z') === scheduledAt.replace('.000Z', 'Z'), 'invalid_schedule');
  need(when > nowMs, 'future_schedule_required');
  need(typeof timeZone === 'string' && timeZone.length <= 80, 'invalid_timezone');
  try { new Intl.DateTimeFormat('pt-BR', { timeZone }).format(when); }
  catch { throw Object.assign(new Error('invalid_timezone'), { code: 'invalid_timezone' }); }
  need(Array.isArray(targets) && targets.length > 0 && targets.length <= 4, 'invalid_destinations');
  need(typeof contentAlreadyCounted === 'boolean', 'invalid_content_snapshot');
  integer(usedContentSlots, 0, 30, 'invalid_quota_snapshot');
  integer(usedPublicationSlots, 0, 120, 'invalid_quota_snapshot');
  need(usedContentSlots + Number(!contentAlreadyCounted) <= 30, 'content_quota_exceeded');
  need(usedPublicationSlots + targets.length <= 120, 'publication_quota_exceeded');
  const seen = new Set();
  const jobs = Array.from(targets).map(target => {
    need(target && PILOT_PLAN.platforms.includes(target.platform), 'unsupported_platform');
    identifier(target.accountId);
    need(!seen.has(target.platform), 'one_account_per_platform_in_pilot');
    seen.add(target.platform);
    const key = createHash('sha256').update(JSON.stringify([
      'lia-publish-v1', workspaceId, contentId, assetVersion, target.platform, target.accountId
    ])).digest('hex');
    return { key, platform: target.platform, accountId: target.accountId, state: 'draft',
      scheduledAt: new Date(when).toISOString(), timeZone, privacy: null,
      consentRecorded: false, oauthVerified: false, apiReviewVerified: false,
      externalReceiptId: null, providerRequestsSent: 0 };
  });
  return { planningOnly: true, jobs, contentSlotIncrement: Number(!contentAlreadyCounted),
    publicationSlotIncrement: jobs.length, generationChargesAdded: 0, quotaReserved: false };
}
