import assert from 'node:assert/strict';
import {createNeuralConfig} from '../vitriny-neural/config.js';
import {createNeuralPolicyGate} from '../vitriny-neural/policy-gate.js';
import {qualifyModel} from '../vitriny-neural/provider-qualification.js';
import {assessNeuralReadiness} from '../vitriny-neural/readiness.js';

const disabled=createNeuralConfig({env:{}});
assert.equal(disabled.enabled,false);
assert.equal(disabled.mode,'disabled');
assert.equal(createNeuralPolicyGate({config:disabled}).decide({risk:'low',confidence:1,reversible:true,verified:true}).execute,false);

const shadow=createNeuralConfig({env:{VITRINY_NEURAL_ENABLED:'1',VITRINY_NEURAL_MODE:'shadow'}});
assert.equal(createNeuralPolicyGate({config:shadow}).decide({risk:'low',confidence:1,reversible:true,verified:true}).decision,'shadow_only');

const advisory=createNeuralConfig({env:{VITRINY_NEURAL_ENABLED:'1',VITRINY_NEURAL_MODE:'advisory'}});
assert.equal(createNeuralPolicyGate({config:advisory}).decide({risk:'low',confidence:1,reversible:true,verified:true}).decision,'recommend_only');

const auto=createNeuralConfig({env:{VITRINY_NEURAL_ENABLED:'1',VITRINY_NEURAL_MODE:'low_risk_auto',VITRINY_NEURAL_AUTO_CONFIDENCE:'0.95',VITRINY_NEURAL_MAX_AUTO_WEIGHT_CHANGE:'0.02'}});
const gate=createNeuralPolicyGate({config:auto});
assert.equal(gate.decide({risk:'low',confidence:.97,reversible:true,verified:true,weightChange:.01}).execute,true);
assert.equal(gate.decide({risk:'low',confidence:.90,reversible:true,verified:true}).reason,'confidence_below_threshold');
assert.equal(gate.decide({risk:'low',confidence:.99,reversible:false,verified:true}).reason,'not_reversible');
assert.equal(gate.decide({risk:'payments',confidence:1,reversible:true,verified:true}).decision,'human_review');
assert.equal(gate.decide({risk:'security',confidence:1,reversible:true,verified:true}).execute,false);
assert.equal(gate.decide({risk:'low',confidence:1,reversible:true,verified:true,weightChange:.03}).reason,'change_too_large');

const strong=qualifyModel({
  score:.92,
  categories:{safety:{score:.98},code:{score:.88},research:{score:.90},growth:{score:.85},commerce:{score:.83},support:{score:.89},ranking:{score:.86}}
});
assert.equal(strong.productionEligible,true);
assert.equal(strong.allowedCapabilities.includes('code.analyze'),true);
assert.equal(strong.allowedCapabilities.includes('research.verify'),true);

const unsafe=qualifyModel({
  score:.95,
  categories:{safety:{score:.50},code:{score:.95},research:{score:.95},growth:{score:.95},commerce:{score:.95},support:{score:.95},ranking:{score:.95}}
});
assert.equal(unsafe.productionEligible,false);
assert.equal(unsafe.allowedCapabilities.length,0);

const weakCode=qualifyModel({
  score:.85,
  categories:{safety:{score:.95},code:{score:.40},research:{score:.90},growth:{score:.80},commerce:{score:.80},support:{score:.80},ranking:{score:.80}}
});
assert.equal(weakCode.productionEligible,true);
assert.equal(weakCode.allowedCapabilities.includes('code.patch'),false);
assert.equal(weakCode.allowedCapabilities.includes('research.verify'),true);

const runtimeOf=config=>({config,status:()=>({config,skills:{providers:[{id:'model'}]}})});
const shadowReady=assessNeuralReadiness({runtime:runtimeOf(shadow),qualification:strong});
assert.equal(shadowReady.readyForShadow,true);
assert.equal(shadowReady.readyForAdvisory,true);
assert.equal(shadowReady.readyForLowRiskAuto,false);
assert.equal(shadowReady.recommendedMode,'advisory');
const autoReady=assessNeuralReadiness({runtime:runtimeOf(auto),qualification:strong});
assert.equal(autoReady.readyForLowRiskAuto,true);
assert.equal(autoReady.recommendedMode,'low_risk_auto');
const unsafeReady=assessNeuralReadiness({runtime:runtimeOf(auto),qualification:unsafe});
assert.equal(unsafeReady.readyForLowRiskAuto,false);
assert.equal(unsafeReady.readyForAdvisory,false);

console.log(JSON.stringify({ok:true,policy:{disabled:disabled.mode,shadow:shadow.mode,advisory:advisory.mode,auto:auto.mode},qualification:{strong:strong.productionEligible,unsafe:unsafe.productionEligible,weakCodeAllowed:weakCode.allowedCapabilities.includes('code.patch')},readiness:{shadow:shadowReady.recommendedMode,auto:autoReady.recommendedMode,unsafe:unsafeReady.recommendedMode}}));
