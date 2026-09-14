import {createHash} from 'node:crypto';
import {atomsFromLegacyAdsUnits,atomsFromMicroBRL,atomsFromRewardPoints,VITRINE_COINS_POLICY,coinAtoms} from './public/vitrine-coins-contract.js';

export const COIN_MIGRATION_ID='legacy-coins-v1';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validInteger=value=>Number.isSafeInteger(value)&&value>=0;
function timestamp(value){
  if(validInteger(value)&&value<=8_640_000_000_000_000)return value;
  if(typeof value!=='string'||! /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?$/.test(value))throw Error('legacy_timestamp_invalid');
  const valueUTC=value.replace(' ','T')+(/[Zz]$|[+-]\d{2}:\d{2}$/.test(value)?'':'Z'),parsed=Date.parse(valueUTC);
  if(!validInteger(parsed))throw Error('legacy_timestamp_invalid');return parsed;
}

/** Additive one-time cutover. A dry run performs SELECTs only. A committed
 * migration never deletes or rebalances legacy rows and never imports again on
 * restart: after the marker, all new money must use the unified wallet paths.
 * Unsupported old reservations/refundable local allocations stop the cutover.
 */
export function migrateLegacyCoins({db,wallet,now=Date.now,dryRun=true}={}){
  if(!db?.transaction)throw new TypeError('Coin migration requires SQLite');
  const exists=table=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
  const completed=()=>exists('vitrine_coin_migrations')?db.prepare('SELECT * FROM vitrine_coin_migrations WHERE migration_id=?').get(COIN_MIGRATION_ID):null;
  const previous=completed();
  if(previous){if(previous.policy_version!==VITRINE_COINS_POLICY.version)throw Error('coin_migration_policy_conflict');return {...JSON.parse(previous.report_json),dryRun,completed:true,duplicate:true};}
  function preflight(){
    const issues=[],lots=[],sources=[],summary={adsLots:0,rewardLots:0,aiLots:0,sourceRows:0,totalAtoms:'0',activeAtoms:'0',expiredAtoms:'0',pendingCreditOrders:0},time=now();
    if(!validInteger(time))throw Error('coin_migration_time_invalid');
    const issue=(code,details={})=>issues.push({code,...details});
    const userExists=user=>validInteger(user)&&user>0&&exists('users')&&!!db.prepare('SELECT 1 FROM users WHERE id=?').get(user);
    const seen=new Set(),payments=new Set(),totals=new Map();
    function add(sourceTable,sourceKey,raw,grant){
      const sourceId=grant.sourceId,metadataHash=hash({sourceTable,sourceKey,raw,grant});summary.sourceRows++;
      if(!userExists(grant.userId)){issue('legacy_owner_unproven',{sourceTable,sourceKey});return;}
      if(seen.has(sourceId)){issue('legacy_source_duplicate',{sourceId});return;}seen.add(sourceId);
      if(! /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/.test(sourceId)){issue('legacy_source_invalid',{sourceTable,sourceKey});return;}
      if([grant.origin,grant.termsVersion,...(grant.paymentReference?[grant.paymentReference]:[])].some(value=>typeof value!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/.test(value))){issue('legacy_terms_or_payment_invalid',{sourceId});return;}
      let atoms;try{atoms=coinAtoms(grant.amountAtoms);timestamp(grant.createdAt);timestamp(grant.expiresAt);if(grant.expiresAt<grant.createdAt||grant.createdAt>time)throw Error();}catch{issue('legacy_amount_or_expiry_invalid',{sourceId});return;}
      if(grant.paymentReference){if(payments.has(grant.paymentReference)){issue('legacy_payment_duplicate',{sourceId});return;}payments.add(grant.paymentReference);}
      const total=(totals.get(grant.userId)||0n)+atoms;totals.set(grant.userId,total);
      try{coinAtoms(String(total));}catch{issue('legacy_owner_capacity',{userId:grant.userId});return;}
      sources.push({sourceId,sourceTable,sourceKey:String(sourceKey),userId:grant.userId,amountAtoms:String(atoms),metadataHash,metadata:raw});
      if(!atoms)return;
      // A nonempty unified ledger without the completed marker is not silently
      // merged with a legacy balance; provenance needs explicit investigation.
      if(exists('vitrine_coin_lots')&&db.prepare('SELECT 1 FROM vitrine_coin_lots WHERE source_id=? OR (? IS NOT NULL AND payment_reference=?)').get(sourceId,grant.paymentReference||null,grant.paymentReference||null)){issue('legacy_unmarked_target_conflict',{sourceId});return;}
      lots.push(grant);summary.totalAtoms=String(BigInt(summary.totalAtoms)+atoms);
      const bucket=grant.expiresAt>time?'activeAtoms':'expiredAtoms';summary[bucket]=String(BigInt(summary[bucket])+atoms);
    }
    const ads=exists('credit_batches')?db.prepare('SELECT * FROM credit_batches ORDER BY id').all():[];
    const wallets=exists('wallets')?db.prepare('SELECT user_id,balance_units FROM wallets ORDER BY user_id').all():[];
    const active=new Map();
    for(const row of ads){if(!validInteger(row.original_units)||!validInteger(row.remaining_units)||row.remaining_units>row.original_units){issue('legacy_ads_amount_invalid',{batchId:row.id});continue;}if(row.status==='active')active.set(row.user_id,(active.get(row.user_id)||0n)+BigInt(row.remaining_units));else if(row.remaining_units>0)issue('legacy_ads_inactive_remainder',{batchId:row.id});}
    const walletOwners=new Set();
    for(const row of wallets){walletOwners.add(row.user_id);if(!userExists(row.user_id))issue('legacy_owner_unproven',{sourceTable:'wallets',sourceKey:row.user_id});if(!validInteger(row.balance_units)||BigInt(row.balance_units)!==(active.get(row.user_id)||0n))issue('legacy_ads_coverage_mismatch',{userId:row.user_id});}
    for(const [userId,balance] of active)if(balance>0n&&!walletOwners.has(userId))issue('legacy_ads_wallet_missing',{userId});
    if(exists('credit_orders')){
      summary.pendingCreditOrders=db.prepare("SELECT COUNT(*) n FROM credit_orders WHERE status IN ('created','pending','authorized','in_process','in_mediation','review_required')").get().n;
      const references=new Set(ads.map(row=>row.order_reference));
      for(const order of db.prepare('SELECT reference,credited_units FROM credit_orders WHERE credited_units>0').all())if(!references.has(order.reference))issue('legacy_ads_credited_order_without_batch',{reference:order.reference});
    }
    for(const row of ads){
      const order=exists('credit_orders')?db.prepare('SELECT * FROM credit_orders WHERE reference=?').get(row.order_reference):null;
      if(!order||order.user_id!==row.user_id){issue('legacy_ads_order_unproven',{batchId:row.id});continue;}
      if(!validInteger(order.amount_cents)||!validInteger(order.fee_cents)||order.fee_cents>order.amount_cents||!validInteger(order.credit_units)||!validInteger(order.credited_units)||order.credited_units>order.credit_units||row.original_units>order.credit_units){issue('legacy_ads_terms_invalid',{batchId:row.id});continue;}
      if(row.remaining_units>0&&(order.status!=='approved'||order.credited_units<row.remaining_units)){issue('legacy_ads_payment_unproven',{batchId:row.id});continue;}
      if(!validInteger(row.remaining_units))continue;
      try{add('credit_batches',row.id,{batch:row,order},{userId:row.user_id,sourceId:`legacy-ads:${row.order_reference}`,amountAtoms:atomsFromLegacyAdsUnits(String(row.remaining_units)),origin:'legacy_ads',createdAt:timestamp(row.created_at),expiresAt:timestamp(row.expires_at),termsVersion:order.terms_version,paymentReference:order.mp_payment_id?`mercadopago:${order.mp_payment_id}`:null});summary.adsLots++;}
      catch{issue('legacy_ads_conversion_invalid',{batchId:row.id});}
    }
    for(const [table,allocations,key] of [['social_posts','social_credit_allocations','post_id'],['social_stories','social_story_credit_allocations','story_id']]){
      if(!exists(allocations))continue;
      if(!exists(table)){if(db.prepare(`SELECT 1 FROM ${allocations} LIMIT 1`).get())issue('legacy_refund_owner_unproven',{table:allocations});continue;}
      if(db.prepare(`SELECT 1 FROM ${allocations} a LEFT JOIN ${table} p ON p.id=a.${key} WHERE a.units>0 AND (p.id IS NULL OR p.cta_charge_status NOT IN ('refunded','not_required')) LIMIT 1`).get())issue('legacy_local_refund_unsupported',{table});
      if(db.prepare(`SELECT 1 FROM ${table} WHERE cta_charge_units>0 AND cta_charge_status='paid' LIMIT 1`).get())issue('legacy_local_paid_unsupported',{table});
    }
    if(exists('city_reward_orders')&&db.prepare("SELECT 1 FROM city_reward_orders WHERE points>0 AND (debited=1 OR status IN ('created','creating','pending','review_required','payment_unknown')) LIMIT 1").get())issue('legacy_reward_reservation_unsupported');
    const rewards=exists('city_reward_batches')?db.prepare('SELECT * FROM city_reward_batches ORDER BY id').all():[];
    const rate=exists('city_reward_settings')?db.prepare('SELECT coins_per_real FROM city_reward_settings WHERE id=1').get()?.coins_per_real:null;
    if(rewards.length&&(!validInteger(rate)||rate<1))issue('legacy_reward_rate_unproven');
    if(rewards.length&&exists('city_reward_audit')&&db.prepare('SELECT 1 FROM city_reward_audit WHERE coins_per_real<>? LIMIT 1').get(rate))issue('legacy_reward_historical_rate_review_required');
    for(const row of rewards){
      if(!validInteger(row.points)||!validInteger(row.remaining)||row.remaining>row.points){issue('legacy_reward_amount_invalid',{batchId:row.id});continue;}
      try{add('city_reward_batches',row.id,{batch:row,pointsPerBRL:rate},{userId:row.user_id,sourceId:`legacy-reward:${row.id}`,amountAtoms:atomsFromRewardPoints(String(row.remaining),String(rate)),origin:'legacy_rewards',createdAt:timestamp(row.created_ms),expiresAt:timestamp(row.expires_ms),termsVersion:'city-rewards-2026-09-10'});summary.rewardLots++;}
      catch{issue('legacy_reward_conversion_inexact',{batchId:row.id});}
    }
    if(exists('neural_ai_credit_reservations')&&db.prepare("SELECT 1 FROM neural_ai_credit_reservations WHERE state NOT IN ('settled','released') LIMIT 1").get())issue('legacy_ai_reservation_unsupported');
    if(exists('neural_paid_chat_requests')&&db.prepare("SELECT 1 FROM neural_paid_chat_requests WHERE phase<>'finished' LIMIT 1").get())issue('legacy_ai_job_inflight');
    if(exists('neural_ai_credit_scope_holds')&&db.prepare('SELECT 1 FROM neural_ai_credit_scope_holds LIMIT 1').get())issue('legacy_ai_frozen_scope_unsupported');
    for(const row of exists('neural_ai_credit_lots')?db.prepare('SELECT * FROM neural_ai_credit_lots ORDER BY id').all():[]){
      if(!validInteger(row.amount_micro)||!validInteger(row.charged_micro)||!validInteger(row.reserved_micro)||row.charged_micro+row.reserved_micro>row.amount_micro){issue('legacy_ai_amount_invalid',{lotId:row.id});continue;}
      if(row.reserved_micro!==0){issue('legacy_ai_reservation_unsupported',{lotId:row.id});continue;}
      // Only the already-explicit user scope is an unambiguous personal owner.
      // Store/admin portal credentials are not upgraded to personal funds.
      const match=/^user:([1-9]\d*)$/.exec(row.scope);
      if(!match){issue('legacy_ai_owner_unproven',{lotId:row.id});continue;}
      try{add('neural_ai_credit_lots',row.id,row,{userId:Number(match[1]),sourceId:`legacy-ai:${row.id}`,amountAtoms:atomsFromMicroBRL(String(row.amount_micro-row.charged_micro)),origin:'legacy_ai',createdAt:timestamp(row.created_at),expiresAt:timestamp(row.expires_at),termsVersion:row.terms_version,paymentReference:row.payment_reference});summary.aiLots++;}
      catch{issue('legacy_ai_conversion_invalid',{lotId:row.id});}
    }
    const snapshotHash=hash({sources,summary,policyVersion:VITRINE_COINS_POLICY.version});
    return {report:{ok:issues.length===0,blocked:issues.length>0,issues,summary,snapshotHash,policyVersion:VITRINE_COINS_POLICY.version,migrationId:COIN_MIGRATION_ID,dryRun,completed:false,duplicate:false},lots,sources};
  }
  if(dryRun)return db.transaction(()=>preflight().report)();
  if(!wallet?.enabled)throw Error('coin_wallet_disabled');
  return db.transaction(()=>{
    const prior=completed();if(prior)return {...JSON.parse(prior.report_json),dryRun:false,completed:true,duplicate:true};
    const {report,lots,sources}=preflight();
    if(!report.ok)throw Object.assign(Error('coin_migration_blocked'),{code:'coin_migration_blocked',status:409,report});
    db.exec(`CREATE TABLE IF NOT EXISTS vitrine_coin_migrations(migration_id TEXT PRIMARY KEY,policy_version TEXT NOT NULL,snapshot_hash TEXT NOT NULL,completed_at INTEGER NOT NULL,report_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS vitrine_coin_migration_sources(source_id TEXT PRIMARY KEY,migration_id TEXT NOT NULL,source_table TEXT NOT NULL,source_key TEXT NOT NULL,user_id INTEGER NOT NULL,amount_atoms INTEGER NOT NULL,metadata_hash TEXT NOT NULL,metadata_json TEXT NOT NULL,lot_id TEXT);`);
    const granted=new Map();for(const lot of lots){const {userId,...input}=lot;granted.set(lot.sourceId,wallet.grant(userId,input).id);}
    for(const source of sources)db.prepare('INSERT INTO vitrine_coin_migration_sources VALUES(?,?,?,?,?,?,?,?,?)').run(source.sourceId,COIN_MIGRATION_ID,source.sourceTable,source.sourceKey,source.userId,Number(coinAtoms(source.amountAtoms)),source.metadataHash,JSON.stringify(source.metadata),granted.get(source.sourceId)||null);
    const final={...report,completed:true};db.prepare('INSERT INTO vitrine_coin_migrations VALUES(?,?,?,?,?)').run(COIN_MIGRATION_ID,VITRINE_COINS_POLICY.version,report.snapshotHash,now(),JSON.stringify(final));return final;
  }).immediate();
}
