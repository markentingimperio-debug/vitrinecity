export const CROPS=Object.freeze({
  carrot:{name:'Cenoura',icon:'🥕',level:1,cost:2,reward:6,xp:6,seconds:30,color:'#e59b40'},
  corn:{name:'Milho',icon:'🌽',level:2,cost:4,reward:12,xp:10,seconds:60,color:'#e7c958'},
  strawberry:{name:'Morango',icon:'🍓',level:3,cost:6,reward:18,xp:15,seconds:90,color:'#d96169'}
});
export const ANIMALS=Object.freeze({chicken:{name:'Galinhas',icon:'🐔',product:'ovos',level:2,cost:4,reward:10,xp:8,seconds:45},cow:{name:'Vaquinha',icon:'🐄',product:'leite',level:4,cost:9,reward:22,xp:16,seconds:90}});
export const PHASES=Object.freeze([{name:'Primeiras sementes',xp:0,plots:3},{name:'Quintal vivo',xp:24,plots:6},{name:'Horta florescente',xp:64,plots:9},{name:'Fazenda do Cerrado',xp:130,plots:12},{name:'Refúgio do futuro',xp:230,plots:12}]);
export function farmLevel(state){let level=1;PHASES.forEach((phase,index)=>{if(state.xp>=phase.xp)level=index+1;});return level;}
export function newFarm(){return {version:1,coins:60,xp:0,harvests:0,plots:Array.from({length:12},()=>null),animals:{chicken:null,cow:null}};}
const integer=(value,max=1e7)=>Number.isSafeInteger(value)&&value>=0?Math.min(value,max):0;
export function restoreFarm(raw,now=Date.now()){
  if(!raw||raw.version!==1)return null;
  const state=newFarm();state.coins=integer(raw.coins);state.xp=integer(raw.xp);state.harvests=integer(raw.harvests);
  for(let i=0;i<12;i++){const plot=raw.plots?.[i];if(plot&&Object.hasOwn(CROPS,plot.crop)&&Number.isFinite(plot.readyAt)&&Number.isFinite(plot.plantedAt)){state.plots[i]={crop:plot.crop,plantedAt:Math.max(0,Math.min(now,plot.plantedAt)),readyAt:Math.max(0,Math.min(now+CROPS[plot.crop].seconds*1000,plot.readyAt)),watered:plot.watered===true};}}
  for(const id of Object.keys(ANIMALS)){const animal=raw.animals?.[id];if(animal&&Number.isFinite(animal.readyAt))state.animals[id]={readyAt:Math.max(0,Math.min(now+ANIMALS[id].seconds*1000,animal.readyAt))};}
  return state;
}
export function farmAction(current,action,now=Date.now()){
  const state=structuredClone(current),level=farmLevel(state);let message='';
  const fail=message=>({state:current,changed:false,message});
  if(['plant','water','harvest'].includes(action.type)){
    if(!Number.isInteger(action.plot)||action.plot<0||action.plot>=PHASES[level-1].plots)return fail('Esse canteiro será liberado na próxima fase.');
    const plot=state.plots[action.plot];
    if(action.type==='plant'){
      const crop=Object.hasOwn(CROPS,action.crop)?CROPS[action.crop]:null;
      if(!crop||crop.level>level)return fail('Essa semente ainda não foi liberada.');
      if(plot)return fail('Este canteiro já está plantado.');
      if(state.coins<crop.cost)return fail('Você precisa de mais moedas da fazenda.');
      state.coins-=crop.cost;state.plots[action.plot]={crop:action.crop,plantedAt:now,readyAt:now+crop.seconds*1000,watered:false};message=`${crop.name} plantada. Regue para crescer mais rápido!`;
    }else{
      if(!plot)return fail('Plante uma semente primeiro.');
      const crop=CROPS[plot.crop];
      if(action.type==='water'){
        if(plot.watered||now>=plot.readyAt)return fail('Esse canteiro já recebeu os cuidados necessários.');
        plot.watered=true;plot.readyAt=Math.max(now,plot.readyAt-crop.seconds*350);message='Canteiro regado! O tempo de crescimento diminuiu.';
      }else{
        if(now<plot.readyAt)return fail('Sua plantação ainda está crescendo.');
        state.coins+=crop.reward;state.xp+=crop.xp;state.harvests++;state.plots[action.plot]=null;message=`Colheita feita! +${crop.reward} moedas e +${crop.xp} experiência.`;
      }
    }
  }else if(['feed','collect'].includes(action.type)){
    const animal=Object.hasOwn(ANIMALS,action.animal)?ANIMALS[action.animal]:null;if(!animal||animal.level>level)return fail('Esse animal será liberado em outra fase.');
    const care=state.animals[action.animal];
    if(action.type==='feed'){
      if(care)return fail('Seu animal já foi alimentado.');if(state.coins<animal.cost)return fail('Você precisa de mais moedas para a ração.');
      state.coins-=animal.cost;state.animals[action.animal]={readyAt:now+animal.seconds*1000};message='Alimento e água servidos. Seu animal está bem cuidado!';
    }else{
      if(!care||now<care.readyAt)return fail('Ainda não está na hora de recolher.');
      state.coins+=animal.reward;state.xp+=animal.xp;state.animals[action.animal]=null;message=`Você recolheu ${animal.product}! +${animal.reward} moedas e +${animal.xp} experiência.`;
    }
  }else return fail('Escolha um cuidado para sua fazenda.');
  if(farmLevel(state)>level)message=`Nova fase: ${PHASES[farmLevel(state)-1].name}! Novidades liberadas na fazenda.`;
  return {state,changed:true,message};
}
