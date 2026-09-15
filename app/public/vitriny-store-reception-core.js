import {createResidentCatalog} from './vitriny-city-residents-core.js?v=20260915-residents-2';

// Public, deterministic presentation only: no employee, task or availability inference.
export function createStoreReception(value){
  if(!value || typeof value!=='object')return null;
  // The caller supplies the already-normalized public store. Avoid importing the
  // spatial registry/session here: its browser import starts presence telemetry.
  const {reference,name,href}=value;
  if(typeof reference!=='string'||!/^[\w-]{1,100}$/.test(reference)||typeof name!=='string'||!name.trim()||name.length>120)return null;
  if(typeof href!=='string'||!href.startsWith(`/loja/${reference}/`)||!/^\/loja\/[\w-]+\/[a-z0-9-]+$/.test(href))return null;
  const store={reference,name,href};
  const catalog=createResidentCatalog([{reference:store.reference,name:store.name,href:store.href,position:{x:0,z:0}}]);
  const identity=catalog.residents.find(person=>person.id===`guide-${store.reference}`);
  if(!identity)return null;
  return Object.freeze({
    identity,storeName:store.name,storeHref:store.href,liaHref:`${store.href}#falar-com-lia`,
    label:'Guia virtual · recepção',
    greeting:`Boas-vindas à vitrine de ${store.name}. Explore os produtos ou abra a loja para falar com a Lia.`,
    notice:'Personagem virtual da VitrineCity, não um funcionário da loja. A animação não representa trabalho executado.',
    availability:'Confirme preço, estoque e prazo na página do produto. A presença deste guia não confirma disponibilidade.'
  });
}

// Keep the reception out of the central aisle and in front of the product rows.
export function storeReceptionPose(){return Object.freeze({x:-2.5,y:0.04,z:-0.5,yaw:0,action:'talk',moving:false});}
