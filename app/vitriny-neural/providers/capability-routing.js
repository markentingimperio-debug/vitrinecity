const DEFAULT_SPECIALIST_CAPABILITIES=Object.freeze([
  'code.analyze','code.plan','code.patch','code.review','code.test-plan',
  'growth.diagnose','growth.campaign-plan','growth.content-plan','growth.seo-plan','growth.experiment','growth.metric-review',
  'ranking.evaluate','ranking.rerank-plan','ranking.feature-review','ranking.experiment-plan'
]);

const DEFAULT_TEACHER_CAPABILITIES=Object.freeze([
  'code.analyze','code.plan','code.patch','code.review','code.test-plan',
  'growth.diagnose','growth.campaign-plan','growth.content-plan','growth.seo-plan','growth.experiment','growth.metric-review',
  'research.collect','research.compare','research.summarize','research.verify',
  'commerce.catalog-review','commerce.pricing-review','commerce.inventory-review','commerce.offer-plan','commerce.seller-diagnose',
  'support.draft-reply','support.classify','support.summarize','support.next-best-action','support.quality-review',
  'ranking.evaluate','ranking.rerank-plan','ranking.feature-review','ranking.experiment-plan'
]);

const ID=/^[a-z][a-z0-9._-]{1,63}$/;
export function parseCapabilityList(value,fallback=[]){
  const raw=String(value||'').split(',').map(v=>v.trim()).filter(Boolean);
  const source=raw.length?raw:fallback;
  return [...new Set(source.filter(item=>ID.test(item)))];
}

export const specialistDefaultCapabilities=DEFAULT_SPECIALIST_CAPABILITIES;
export const teacherDefaultCapabilities=DEFAULT_TEACHER_CAPABILITIES;
