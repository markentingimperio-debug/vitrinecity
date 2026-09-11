export const PLANTS_STORAGE_KEY = 'vitrinecity-cultiva-plants-v1';
export const MAX_PLANTS = 100;
export const CARE_TYPES = Object.freeze({regar:'Regar',revisar:'Revisar a planta',adubar:'Adubar',outro:'Outro cuidado'});
const LIMITS = {name:80,location:120,note:2000,custom:100};
const own = (value, key) => Object.hasOwn(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
export const emptyPlants = () => ({version:1,revision:0,plants:[]});
export function validPlantDate(value) {
  if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T12:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function localPlantDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function validCare(care) {
  return object(care)&&own(CARE_TYPES,care.type)&&text(care.custom,LIMITS.custom)
    &&(care.type!=='outro'||care.custom.trim().length>0)&&validPlantDate(care.date);
}
export function validPlants(state) {
  if(!object(state)||state.version!==1||!Number.isSafeInteger(state.revision)||state.revision<0||!Array.isArray(state.plants)||state.plants.length>MAX_PLANTS)return false;
  const ids=new Set();
  return state.plants.every(plant=>{
    if(!object(plant)||typeof plant.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(plant.id)||ids.has(plant.id))return false;
    ids.add(plant.id);
    return text(plant.name,LIMITS.name)&&plant.name.trim().length>0&&text(plant.location,LIMITS.location)&&text(plant.note,LIMITS.note)
      &&validPlantDate(plant.createdOn)&&(plant.care===null||validCare(plant.care))&&Array.isArray(plant.history)&&plant.history.length<=8
      &&plant.history.every(care=>validCare(care)&&validPlantDate(care.completedOn));
  });
}
export function readPlants(storage) {
  try {
    const raw=storage.getItem(PLANTS_STORAGE_KEY);
    if(raw===null)return{state:emptyPlants(),status:'empty'};
    if(typeof raw!=='string'||raw.length>500000)return{state:emptyPlants(),status:'corrupt'};
    const state=JSON.parse(raw);return validPlants(state)?{state,status:'ok'}:{state:emptyPlants(),status:'corrupt'};
  }catch(error){return{state:emptyPlants(),status:error instanceof SyntaxError?'corrupt':'unavailable'};}
}
export function writePlants(storage,state) {
  if(!validPlants(state))return false;
  try{storage.setItem(PLANTS_STORAGE_KEY,JSON.stringify(state));return true;}catch{return false;}
}
function clean(value,key,required=false) {
  const normalized=typeof value==='string'?value.trim():'';
  if(!text(normalized,LIMITS[key])||(required&&!normalized))throw Error(key==='name'?'Dê um nome à planta (até 80 caracteres).':'Confira o tamanho e o conteúdo dos campos.');
  return normalized;
}
export function plantFields(input) {
  const fields={name:clean(input?.name,'name',true),location:clean(input?.location,'location'),note:clean(input?.note,'note'),care:null};
  if(input?.date){
    if(!validPlantDate(input.date)||!own(CARE_TYPES,input.type))throw Error('Escolha um cuidado e uma data válida.');
    const custom=input.type==='outro'?clean(input.custom,'custom',true):'';
    fields.care={type:input.type,custom,date:input.date};
  }
  return fields;
}
function nextState(state,plants) {
  const next={version:1,revision:state.revision+1,plants};
  if(!validPlants(next))throw Error('Não foi possível salvar esta alteração.');return next;
}
export function changePlants(state,action,today=localPlantDay()) {
  if(!validPlants(state)||!validPlantDate(today))throw Error('Não foi possível ler sua lista de plantas.');
  if(action?.type==='add'){
    if(state.plants.length>=MAX_PLANTS)throw Error('Você já tem 100 plantas nesta lista.');
    const plant={id:action.id,...plantFields(action.fields),createdOn:today,history:[]};
    return nextState(state,[...state.plants,plant]);
  }
  const index=state.plants.findIndex(plant=>plant.id===action?.id);
  if(index<0)throw Error('Esta planta não está mais na lista. Atualize a página.');
  const plants=state.plants.slice(),plant=plants[index];
  if(action.type==='edit')plants[index]={...plant,...plantFields(action.fields)};
  else if(action.type==='delete')plants.splice(index,1);
  else if(action.type==='complete'){
    if(!plant.care)throw Error('Esta planta não tem um cuidado agendado.');
    const nextDate=action.nextDate||'';
    if(nextDate&&(!validPlantDate(nextDate)||nextDate<today))throw Error('Escolha hoje ou uma data futura para o próximo cuidado.');
    plants[index]={...plant,care:nextDate?{...plant.care,date:nextDate}:null,history:[{...plant.care,completedOn:today},...plant.history].slice(0,8)};
  }else throw Error('Alteração não reconhecida.');
  return nextState(state,plants);
}
export function plantCareLabel(care) { return care?.type==='outro'?care.custom:CARE_TYPES[care?.type]||'Sem cuidado agendado'; }
export function pendingPlantCare(state,today=localPlantDay()) {
  if(!validPlants(state)||!validPlantDate(today))return[];
  return state.plants.filter(plant=>plant.care&&plant.care.date<=today)
    .sort((a,b)=>a.care.date.localeCompare(b.care.date)||a.name.localeCompare(b.name,'pt-BR'));
}
