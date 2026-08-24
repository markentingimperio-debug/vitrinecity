import assert from 'node:assert/strict';
import fs from 'node:fs';
import { automaticMarketplaceShipping, marketplaceShippingQuote, melhorEnvioConfig,
  quoteMelhorEnvio } from '../marketplace-shipping.js';

const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8'),store=fs.readFileSync(new URL('../public/loja.html',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../public/admin-logistica.html',import.meta.url),'utf8');
assert.match(server,/marketplaceShippingQuote/);
assert.match(server,/\/api\/marketplace\/shipping\/quote/);
assert.match(server,/shippingCents = shippingQuote\.shippingCents/);
assert.match(server,/shippingCents, shippingQuote\.provider, shippingQuote\.providerServiceId\|\|'',shippingQuote\.service\|\|'',platformPercentCents/);
assert.match(server,/totalCents = productsCents \+ shippingCents/);
assert.match(server,/id:'shipping'/);
assert.match(store,/id="postalCode"/);
assert.match(store,/async function calculateShipping/);
assert.match(store,/deliveryMinDays/);
assert.match(store,/subtotal\+\(shippingQuote\?\.shippingCents\|\|0\)/);
assert.match(server,/CREATE TABLE IF NOT EXISTS melhor_envio_oauth/);
assert.match(server,/CREATE TABLE IF NOT EXISTS melhor_envio_sender_settings/);
assert.match(server,/\/api\/admin\/marketplace\/shipping\/sender/);
assert.match(server,/documentMasked/);
assert.match(server,/\/api\/admin\/marketplace\/shipping\/connect/);
assert.match(server,/\/api\/admin\/marketplace\/shipping\/callback/);
assert.match(server,/shipping-calculate shipping-companies/);
assert.match(server,/grant_type:'refresh_token'/);
assert.match(server,/createCipheriv\('aes-256-gcm'/);
assert.match(admin,/Conectar Melhor Envio/);
assert.match(admin,/CPF ou CNPJ é criptografado/);
assert.match(admin,/noindex,nofollow/);

const products=[{id:7,name:'Produto',price_cents:5000,weight_grams:750,delivery_min_days:3,delivery_max_days:6}];
const quantities=new Map([[7,2]]);
const config=melhorEnvioConfig({MELHOR_ENVIO_ACCESS_TOKEN:'secret-token',MELHOR_ENVIO_ORIGIN_POSTAL_CODE:'74000000',
  MELHOR_ENVIO_SANDBOX:'true',MARKETPLACE_FREE_SHIPPING_CENTS:'0'});
assert.equal(config.configured,true);
assert.match(config.endpoint,/sandbox/);
let request;
const official=await quoteMelhorEnvio({products,quantities,destinationPostalCode:'01018-020',config,
  fetchImpl:async(url,options)=>{request={url,options};return {ok:true,status:200,json:async()=>[
    {id:2,name:'SEDEX',price:'41.00',delivery_time:2,company:{name:'Correios'}},
    {id:1,name:'PAC',custom_price:'23.45',custom_delivery_time:5,company:{name:'Correios'}},
    {id:99,error:'Serviço indisponível'}]};}});
assert.equal(official.provider,'melhor_envio');
assert.equal(official.shippingCents,2345);
assert.equal(official.providerServiceId,'1');
assert.equal(official.deliveryMaxDays,5);
assert.equal(request.url,'https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate');
assert.equal(request.options.headers.authorization,'Bearer secret-token');
assert(!request.options.body.includes('secret-token'));
const sent=JSON.parse(request.options.body);
assert.equal(sent.from.postal_code,'74000000');
assert.equal(sent.to.postal_code,'01018020');
assert.equal(sent.products[0].weight,0.75);
assert.equal(sent.products[0].quantity,2);

await assert.rejects(quoteMelhorEnvio({products,quantities,destinationPostalCode:'01018020',config,
  fetchImpl:async()=>({ok:false,status:401,json:async()=>({message:'secret-token'})})}),
  error=>error.message==='melhor_envio_api_401'&&!error.message.includes('secret-token'));
const fallback=await marketplaceShippingQuote(products,quantities,'01018020',{config,
  env:{MARKETPLACE_FREE_SHIPPING_CENTS:'0'},fetchImpl:async()=>{throw new Error('offline')}});
assert.equal(fallback.provider,'vitriny_table');
assert.equal(fallback.provisional,true);
assert.equal(automaticMarketplaceShipping(products,quantities,'01018020',{MARKETPLACE_FREE_SHIPPING_CENTS:'0'}).totalWeightGrams,1500);
console.log('marketplace-shipping: ok');
