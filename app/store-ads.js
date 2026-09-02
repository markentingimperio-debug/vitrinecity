export const STORE_AD_PLANS=Object.freeze({
  city_top:{name:'Topo da cidade',placement:'city_top',managementFeeBps:1500,minDailyBudgetCents:500},
  category_top:{name:'Topo da categoria',placement:'category_top',managementFeeBps:1500,minDailyBudgetCents:500},
  premium_banner:{name:'Banner premium',placement:'premium_banner',managementFeeBps:2000,minDailyBudgetCents:1000},
  managed_traffic:{name:'Tráfego gerenciado',placement:'managed_traffic',managementFeeBps:1500,minDailyBudgetCents:2000}
  ,complete:{name:'Plano completo',placement:'all',managementFeeBps:2000,minDailyBudgetCents:2500}
});

export function storeAdQuote(planCode,dailyBudgetCents,durationDays){const plan=STORE_AD_PLANS[planCode],daily=Math.trunc(Number(dailyBudgetCents)),days=Math.trunc(Number(durationDays));if(!plan||daily<plan.minDailyBudgetCents||daily>10000000||days<1||days>365)throw new Error('invalid_plan');const mediaBudgetCents=daily*days,managementFeeCents=Math.round(mediaBudgetCents*plan.managementFeeBps/10000);return {planCode,dailyBudgetCents:daily,durationDays:days,mediaBudgetCents,managementFeeCents,totalCents:mediaBudgetCents+managementFeeCents,managementFeeBps:plan.managementFeeBps,placement:plan.placement};}

export function sponsoredScore(item,{rotationSeed=0}={}){const quality=Math.max(0,Math.min(100,Number(item.qualityScore)||0)),impressions=Math.max(0,Number(item.impressions)||0),clicks=Math.max(0,Number(item.clicks)||0),ctr=impressions>=20?clicks/impressions:.02;const fairness=1/Math.sqrt(impressions+1);const rotation=((Number(item.id)*2654435761+Number(rotationSeed))>>>0)/2**32;return quality*.5+Math.min(10,ctr*100)+fairness*20+rotation*2;}
export function rankSponsored(items,options={}){return items.filter(item=>Number(item.qualityScore)>=40).map(item=>({...item,rankScore:sponsoredScore(item,options)})).sort((a,b)=>b.rankScore-a.rankScore||Number(a.id)-Number(b.id));}
