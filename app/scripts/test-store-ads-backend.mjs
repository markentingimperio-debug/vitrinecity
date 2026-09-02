import assert from 'node:assert/strict';import fs from 'node:fs';
const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
for(const pattern of [/CREATE TABLE IF NOT EXISTS store_ad_campaigns/,/CREATE TABLE IF NOT EXISTS store_ad_weight_audit/,/CREATE TABLE IF NOT EXISTS platform_promotion_slots/,/\/api\/store-portal\/:reference\/vitrine-ads/,/\/api\/admin\/vitrine-ads/,/\/api\/marketplace\/sponsored/,/c\.store_reference=\?/,/s\.review_status='published'/])assert.match(source,pattern);
assert.match(source,/management_fee_cents/);assert.match(source,/quality_threshold/);assert.match(source,/store_ad_events/);assert.match(source,/event_type='conversion'/);
const publicRoute=source.match(/app\.get\('\/api\/marketplace\/sponsored'[\s\S]*?\}\);/s)?.[0]||'';assert.ok(publicRoute&&!/access_token|tax_id|provider_user_id/.test(publicRoute));
console.log('store ads backend tests passed');
