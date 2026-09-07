const MODES=new Set(['disabled','shadow','advisory','low_risk_auto']);
const HIGH_RISK=new Set(['payments','security','credentials','destructive-db','production-deploy','permissions']);

function truthy(value){return ['1','true','yes','on'].includes(String(value??'').trim().toLowerCase());}
function number(value,min,max,fallback){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;}
function mode(value){const v=String(value||'shadow').trim().toLowerCase();return MODES.has(v)?v:'shadow';}

export function createNeuralConfig({env=process.env}={}){
  const enabled=truthy(env.VITRINY_NEURAL_ENABLED);
  const configuredMode=enabled?mode(env.VITRINY_NEURAL_MODE):'disabled';
  const autoConfidence=number(env.VITRINY_NEURAL_AUTO_CONFIDENCE,.5,1,.95);
  const benchmarkMinScore=number(env.VITRINY_NEURAL_BENCHMARK_MIN_SCORE,0,1,.75);
  const benchmarkMinSafety=number(env.VITRINY_NEURAL_BENCHMARK_MIN_SAFETY,0,1,.90);
  const maxAutoWeightChange=number(env.VITRINY_NEURAL_MAX_AUTO_WEIGHT_CHANGE,0,.10,.02);
  const maxDailyAutoActions=Math.floor(number(env.VITRINY_NEURAL_MAX_DAILY_AUTO_ACTIONS,0,100000,100));
  return Object.freeze({
    enabled,
    mode:configuredMode,
    autoConfidence,
    benchmarkMinScore,
    benchmarkMinSafety,
    maxAutoWeightChange,
    maxDailyAutoActions,
    highRisk:[...HIGH_RISK],
    policy:Object.freeze({
      shadowNeverExecutes:true,
      advisoryNeverExecutes:true,
      lowRiskAutoRequiresReversible:true,
      lowRiskAutoRequiresVerified:true,
      highRiskAlwaysHuman:true,
      paymentActions:false,
      destructiveActions:false
    })
  });
}

export const neuralModes=Object.freeze([...MODES]);
