import assert from 'node:assert/strict';
import {createSkillRegistry} from '../vitriny-neural/skills/registry.js';
import {createMediaSkill} from '../vitriny-neural/skills/media.js';
import {createCodeSkill} from '../vitriny-neural/skills/code.js';
import {createGrowthSkill} from '../vitriny-neural/skills/growth.js';
import {createResearchSkill} from '../vitriny-neural/skills/research.js';

const registry=createSkillRegistry();
registry.registerSkill(createMediaSkill());
registry.registerSkill(createCodeSkill());
registry.registerSkill(createGrowthSkill());
registry.registerSkill(createResearchSkill());

registry.registerProvider({
  id:'primary-broken',capabilities:['image.generate','video.generate','audio.generate'],priority:10,
  available:async()=>true,invoke:async()=>{throw new Error('provider offline');}
});
registry.registerProvider({
  id:'backup-local',capabilities:['image.generate','video.generate','audio.generate'],priority:20,local:true,
  available:async()=>true,invoke:async({capability,input})=>({url:`local://${capability}`,prompt:input.prompt})
});
registry.registerProvider({
  id:'teacher',capabilities:['code.analyze','growth.diagnose','research.collect'],priority:30,
  available:async()=>true,invoke:async({capability,input})=>({capability,input,summary:'ok'})
});

const image=await registry.run('media.generate',{type:'image',prompt:'produto sobre fundo limpo',aspectRatio:'1:1'});
assert.equal(image.provider,'backup-local');
assert.equal(image.attempts[0].provider,'primary-broken');
assert.equal(image.attempts[0].ok,false);
assert.equal(image.attempts[1].ok,true);

const audio=await registry.run('media.generate',{type:'audio',prompt:'Olá Vitrine City',voice:'br-feminina'});
assert.equal(audio.provider,'backup-local');

const code=await registry.run('code.engineer',{action:'analyze',task:'analisar gargalo da rota Express',repository:'vitrinecity'});
assert.equal(code.provider,'teacher');
const growth=await registry.run('growth.optimizer',{action:'diagnose',objective:'aumentar conversão',metrics:{ctr:0.04,conversion:0.02}});
assert.equal(growth.provider,'teacher');
const research=await registry.run('research.supervised',{action:'collect',question:'quais sinais indicam melhoria real de retenção?'});
assert.equal(research.provider,'teacher');
assert.equal(research.requiresReview,true);

const status=registry.status();
assert.equal(status.skills.length,4);
assert.equal(status.providers.find(p=>p.id==='primary-broken').stats.fail>=1,true);
assert.equal(status.providers.find(p=>p.id==='backup-local').stats.success>=2,true);
assert.equal(status.providers.find(p=>p.id==='teacher').stats.success>=3,true);
console.log(JSON.stringify({ok:true,status}));
