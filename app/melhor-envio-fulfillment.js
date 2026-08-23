function clean(value,limit=160){return String(value||'').trim().slice(0,limit);}
function digits(value,limit=20){return String(value||'').replace(/\D/g,'').slice(0,limit);}
function required(value,code){if(!value)throw new Error(code);return value;}
function money(cents){return Number((Math.max(0,Number(cents)||0)/100).toFixed(2));}

export function melhorEnvioShipmentPayload({order,items,address,buyer,sender,dimensions}){
  const service=Number(order?.shipping_service_id);
  if(!Number.isInteger(service)||service<1)throw new Error('shipping_service_invalid');
  const senderDocument=digits(sender?.companyDocument||sender?.document,14);
  const recipientPhone=digits(buyer?.whatsapp,15),senderPhone=digits(sender?.phone,15);
  if(recipientPhone.length<10)throw new Error('recipient_phone_required');
  if(senderPhone.length<10||![11,14].includes(senderDocument.length))throw new Error('sender_identity_required');
  const products=(items||[]).map(item=>({name:required(clean(item.product_name),'product_name_required'),
    quantity:Math.max(1,Math.floor(Number(item.quantity)||1)),unitary_value:money(item.unit_price_cents)}));
  if(!products.length)throw new Error('shipment_items_required');
  const from={name:required(clean(sender.name),'sender_name_required'),phone:senderPhone,email:required(clean(sender.email),'sender_email_required'),
    address:required(clean(sender.street),'sender_address_required'),number:required(clean(sender.number,30),'sender_number_required'),
    complement:clean(sender.complement),district:required(clean(sender.neighborhood),'sender_neighborhood_required'),
    city:required(clean(sender.city),'sender_city_required'),state_abbr:required(clean(sender.state,2).toUpperCase(),'sender_state_required'),
    country_id:'BR',postal_code:required(digits(sender.postalCode,8),'sender_postal_required')};
  if(senderDocument.length===14){from.company_document=senderDocument;if(clean(sender.stateRegister,30))from.state_register=clean(sender.stateRegister,30);}
  else from.document=senderDocument;
  return {service,from,to:{name:required(clean(address?.recipient_name),'recipient_name_required'),phone:recipientPhone,
    email:required(clean(buyer?.email),'recipient_email_required'),address:required(clean(address?.street),'recipient_address_required'),
    number:required(clean(address?.number,30),'recipient_number_required'),complement:clean(address?.complement),
    district:required(clean(address?.neighborhood),'recipient_neighborhood_required'),city:required(clean(address?.city),'recipient_city_required'),
    state_abbr:required(clean(address?.state,2).toUpperCase(),'recipient_state_required'),country_id:'BR',
    postal_code:required(digits(address?.postal_code,8),'recipient_postal_required')},products,
    volumes:[{height:Number(dimensions.height),width:Number(dimensions.width),length:Number(dimensions.length),weight:Number(dimensions.weight)}],
    options:{platform:'VitrineCity',insurance_value:money(order.products_cents),receipt:false,own_hand:false,reverse:false,
      invoice:{key:required(digits(order.invoice_key,44),'invoice_key_required')},tags:[{tag:clean(order.reference,50),url:null}]}};
}

async function request(config,path,body,fetchImpl=fetch){
  let response;try{response=await fetchImpl(`${config.endpoint}${path}`,{method:'POST',headers:{accept:'application/json',
    'content-type':'application/json',authorization:`Bearer ${config.accessToken}`,'user-agent':config.userAgent},
    body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});}catch{throw new Error('melhor_envio_unreachable');}
  const payload=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(`melhor_envio_api_${Number(response.status)||502}`);
  return payload;
}
export async function createMelhorEnvioShipment(config,payload,fetchImpl){const result=await request(config,'/api/v2/me/cart',payload,fetchImpl);const id=clean(result?.id,100);if(!id)throw new Error('melhor_envio_cart_invalid');return {id,tracking:clean(result?.tracking,100)};}
export async function checkoutMelhorEnvioShipment(config,id,fetchImpl){await request(config,'/api/v2/me/shipment/checkout',{orders:[required(clean(id,100),'shipment_id_required')]},fetchImpl);return {ok:true};}
export async function generateMelhorEnvioShipment(config,id,fetchImpl){await request(config,'/api/v2/me/shipment/generate',{orders:[required(clean(id,100),'shipment_id_required')]},fetchImpl);return {ok:true};}
export async function printMelhorEnvioShipment(config,id,fetchImpl){const result=await request(config,'/api/v2/me/shipment/print',{mode:'public',orders:[required(clean(id,100),'shipment_id_required')]},fetchImpl);const url=clean(result?.url,500);if(!/^https:\/\//i.test(url))throw new Error('melhor_envio_print_invalid');return {url};}
