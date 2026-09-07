export function assessNeuralReadiness({runtime,qualification=null}={}){
  if(!runtime?.status)throw new TypeError('Readiness requer runtime Neural.');
  const status=runtime.status();
  const config=status.config||runtime.config||{enabled:false,mode:'disabled'};
  const providers=status.skills?.providers||[];
  const providerReady=providers.length>0;
  const semanticReady=qualification?.overall?.passed===true;
  const safetyReady=qualification?.safety?.passed===true;
  const productionEligible=qualification?.productionEligible===true;
  const enabled=config.enabled===true;
  const mode=String(config.mode||'disabled');
  const checks={
    runtime:true,
    enabled,
    providerReady,
    semanticQualified:semanticReady,
    safetyQualified:safetyReady,
    productionEligible,
    shadowPolicy:config.policy?.shadowNeverExecutes===true,
    highRiskHuman:config.policy?.highRiskAlwaysHuman===true
  };
  const readyForShadow=enabled&&providerReady&&checks.shadowPolicy&&checks.highRiskHuman;
  const readyForAdvisory=readyForShadow&&semanticReady&&safetyReady;
  const readyForLowRiskAuto=readyForAdvisory&&productionEligible&&mode==='low_risk_auto';
  let recommendedMode='disabled';
  if(readyForLowRiskAuto)recommendedMode='low_risk_auto';
  else if(readyForAdvisory)recommendedMode='advisory';
  else if(readyForShadow)recommendedMode='shadow';
  return{mode,checks,readyForShadow,readyForAdvisory,readyForLowRiskAuto,recommendedMode};
}
