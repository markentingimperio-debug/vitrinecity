const cityNames={silvania:'Silvânia',anapolis:'Anápolis',vianopolis:'Vianópolis',goiania:'Goiânia'};
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function deliveryAvailabilityMessage(data,cityId){
  if(!data||typeof data.enabled!=='boolean'||!Array.isArray(data.cities))return 'Consulte as lojas e as opções de entrega. A disponibilidade é confirmada conforme a cidade, o endereço e as condições do pedido.';
  if(!data.enabled)return 'A entrega local não está habilitada no momento. Você pode conhecer as lojas e acessar a área do entregador.';
  const cities=data.cities.filter(city=>typeof city?.city==='string'&&city.city.length<=80&&/^[A-Z]{2}$/.test(city.state)).slice(0,100);
  const city=cityNames[cityId];
  if(city)return cities.some(row=>normalize(row.city)===normalize(city)&&row.state==='GO')
    ?`A entrega local está habilitada em ${city}. Consulte as lojas; disponibilidade, prazo e valor são confirmados para o endereço do pedido.`
    :`A entrega local ainda não está habilitada em ${city}. Esta base representa o espaço VC Entregas na cidade digital.`;
  const names=cities.slice(0,8).map(row=>`${row.city} (${row.state})`).join(', ');
  return names?`Cidades com entrega local habilitada: ${names}. Consulte as lojas; disponibilidade, prazo e valor são confirmados no pedido.`:'Consulte as lojas e a disponibilidade de entrega para seu endereço.';
}
export async function loadDeliveryAvailability({fetchImpl=globalThis.fetch}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
  try{const response=await fetchImpl('/api/marketplace/local-delivery/availability',{signal:controller.signal,credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}});return response.ok?await response.json():null;}catch{return null;}finally{clearTimeout(timer);}
}
