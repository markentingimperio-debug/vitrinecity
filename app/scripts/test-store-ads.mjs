import assert from 'node:assert/strict';import {storeAdQuote,rankSponsored} from '../store-ads.js';
assert.deepEqual(storeAdQuote('city_top',500,10),{planCode:'city_top',dailyBudgetCents:500,durationDays:10,mediaBudgetCents:5000,managementFeeCents:750,totalCents:5750,managementFeeBps:1500,placement:'city_top'});
assert.throws(()=>storeAdQuote('city_top',100,2));
const ranked=rankSponsored([{id:1,qualityScore:90,impressions:1000,clicks:20},{id:2,qualityScore:90,impressions:1,clicks:0},{id:3,qualityScore:20,impressions:0,clicks:0}],{rotationSeed:1});assert.equal(ranked[0].id,2);assert.equal(ranked.some(x=>x.id===3),false);
console.log('store ads tests passed');
