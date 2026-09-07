import assert from 'node:assert/strict';
import {createSkillRegistry} from '../vitriny-neural/skills/registry.js';
import {createMediaSkill} from '../vitriny-neural/skills/media.js';

const registry=createSkillRegistry();
registry.registerSkill(createMediaSkill());
registry.registerProvider({
  id:'primary-broken',capabilities:['image.generate','video.generate','audio.generate'],priority:10,
  available:async()=>true,invoke:async()=>{throw new Error('provider offline');}
});
registry.registerProvider({
  id:'backup-local',capabilities:['image.generate','video.generate','audio.generate'],priority:20,local:true,
  available:async()=>true,invoke:async({capability,input})=>({url:`local://${capability}`,prompt:input.prompt})
});

const image=await registry.run('media.generate',{type:'image',prompt:'produto sobre fundo limpo',aspectRatio:'1:1'});
assert.equal(image.provider,'backup-local');
assert.equal(image.attempts[0].provider,'primary-broken');
assert.equal(image.attempts[0].ok,false);
assert.equal(image.attempts[1].ok,true);

const audio=await registry.run('media.generate',{type:'audio',prompt:'Olá Vitrine City',voice:'br-feminina'});
assert.equal(audio.provider,'backup-local');

const status=registry.status();
assert.equal(status.skills.length,1);
assert.equal(status.providers.find(p=>p.id==='primary-broken').stats.fail>=1,true);
assert.equal(status.providers.find(p=>p.id==='backup-local').stats.success>=2,true);
console.log(JSON.stringify({ok:true,status}));
