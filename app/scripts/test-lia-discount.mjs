import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import express from 'express';
import Database from 'better-sqlite3';
import {priceLiaItems,courseLiaQuote,marketplaceLiaQuote,publicLiaQuote,assertLiaQuoteAccepted,isLiaOwnedProduct} from '../lia-discount.js';

const source=readFileSync(new URL('../server.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const extract=(start,end)=>{const begin=source.indexOf(start),finish=source.indexOf(end,begin+start.length);assert.ok(begin>=0&&finish>begin,start);return source.slice(begin,finish);};
const routes=extract('function liaDiscountEligible(',"\napp.post('/api/marketplace/orders/:reference/delivery-review'")+extract("app.get('/api/courses/:slug/quote'",'\nconst buyCourseWithCoins =');

async function fixture(t){
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1);CREATE TABLE affiliates(id INTEGER PRIMARY KEY);
    CREATE TABLE store_profiles(order_reference TEXT PRIMARY KEY,business_name TEXT,review_status TEXT);
    INSERT INTO store_profiles VALUES('official_agrotecnica','Agrotécnica','published'),('other_store','Outra loja','published');
    CREATE TABLE customer_addresses(id INTEGER PRIMARY KEY,user_id INTEGER,postal_code TEXT,street TEXT,number TEXT);
    INSERT INTO customer_addresses VALUES(7,1,'12345678','Rua teste','10');
    CREATE TABLE store_products(id INTEGER PRIMARY KEY,store_reference TEXT,name TEXT,sku TEXT,price_cents INTEGER,stock_quantity INTEGER,active INTEGER DEFAULT 1,marketplace_enabled INTEGER DEFAULT 1,product_url TEXT DEFAULT '');
    INSERT INTO store_products(id,store_reference,name,sku,price_cents,stock_quantity) VALUES(1,'official_agrotecnica','Adubo','AD1',33,50),(2,'official_agrotecnica','Substrato','SU2',2399,50),(3,'other_store','Produto de parceiro','P3',2399,50);
    CREATE TABLE product_option_groups(id INTEGER PRIMARY KEY,product_id INTEGER,name TEXT,min_select INTEGER,max_select INTEGER);
    CREATE TABLE product_options(id INTEGER PRIMARY KEY,group_id INTEGER,name TEXT,price_delta_cents INTEGER,active INTEGER);
    CREATE TABLE marketplace_payment_reconciliation(order_reference TEXT PRIMARY KEY,expected_gross_cents INTEGER,expected_marketplace_fee_cents INTEGER,expected_seller_net_cents INTEGER,split_mode TEXT);`);
  db.exec(extract('CREATE TABLE IF NOT EXISTS course_orders (','CREATE TABLE IF NOT EXISTS managed_courses ('));
  db.exec(extract('CREATE TABLE IF NOT EXISTS marketplace_orders (','`);\nensureColumn(\'marketplace_orders\'').replace(/\r/g,''));
  const ensureColumn=(table,name,definition)=>{if(!db.prepare(`PRAGMA table_info(${table})`).all().some(row=>row.name===name))db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);};
  vm.runInNewContext(source.split(/\r?\n/).filter(line=>/^ensureColumn\('(marketplace_orders|marketplace_order_items)'/.test(line)).join('\n'),{ensureColumn});
  const app=express();app.use(express.json());const provider=[],captures=[],analytics=[];
  const course={slug:'canva-para-lojas',title:'Canva para Lojas',status:'active',priceCents:2399};let eligible=true,shipping=100,afterShipping=()=>{};
  const context={app,db,courseLiaQuote,marketplaceLiaQuote,publicLiaQuote,assertLiaQuoteAccepted,randomUUID,AbortSignal,console,
    siteSalesExperience:{canApplyLiaDiscount:()=>eligible},
    requireUser:(req,res,next)=>{if(req.headers.authorization==='none')return res.sendStatus(401);req.user={id:1,name:'Fixture',email:'fixture@example.test'};next();},sameOriginOnly:(_req,_res,next)=>next(),
    managedCourse:slug=>slug===course.slug?course:null,activeEnrollment:()=>false,courseReady:()=>true,
    process:{env:{MERCADOPAGO_ACCESS_TOKEN:'fixture',MERCADOPAGO_WEBHOOK_SECRET:'fixture'}},
    checkoutAttempts:new Map(),allowAttempt:()=>true,referralAffiliate:()=>null,recordConsent:()=>{},readAdAttribution:()=>null,readStoreAdAttribution:()=>null,
    MARKETPLACE_COMMISSION_BPS:1000,MARKETPLACE_FIXED_FEE_CENTS:200,MARKETPLACE_RETURN_PROVISION_CENTS:50,
    officialMarketplaceShippingQuote:async()=>{afterShipping();return {shippingCents:shipping,provider:'fixture',service:'Entrega teste'};},
    localDeliveryQuote:async()=>{throw Error('No local delivery in this fixture');},
    mpHeaders:()=>({}),SITE_URL:'https://vitrinecity.test',marketplaceWebhookRouteSignature:()=> 'fixture',conversionHeader:()=>{},
    adminAnalytics:{recordOrderAttribution:()=>{},recordCheckout:(...args)=>analytics.push(args)},recordSiteSales:(...args)=>captures.push(args),
    fetch:async(url,options)=>{assert.equal(url,'https://api.mercadopago.com/checkout/preferences');provider.push(JSON.parse(options.body));return {ok:true,json:async()=>({id:'fixture-preference',init_point:'https://www.mercadopago.com.br/checkout/fixture'})};}
  };
  vm.runInNewContext(routes,context);
  const listener=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
  t.after(async()=>{await new Promise(resolve=>listener.close(resolve));db.close();});
  const request=async(path,body,headers={})=>{const response=await fetch(`http://127.0.0.1:${listener.address().port}${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json(),headers:response.headers};};
  return {db,provider,captures,analytics,request,course,setEligible:value=>{eligible=value;},setAfterShipping:fn=>{afterShipping=fn;}};
}

test('five percent rounds once for the whole cart; unit splitting conserves cents and quantities',()=>{
  for(let unit=1;unit<=199;unit++)for(const quantity of [1,2,3,7,50]){
    const quote=priceLiaItems([{id:1,unitPriceCents:unit,quantity}],true);
    assert.equal(quote.discountCents,Math.round(unit*quantity/20));
    assert.equal(quote.lines.reduce((sum,line)=>sum+line.quantity,0),quantity);
    assert.equal(quote.lines.reduce((sum,line)=>sum+line.quantity*line.unitPriceCents,0),quote.amountCents);
    assert.equal(quote.lines.reduce((sum,line)=>sum+line.discountCents,0),quote.discountCents);
    assert.ok(quote.lines.length<=2);
  }
  const quote=priceLiaItems([{id:1,unitPriceCents:33,quantity:3}],true);assert.equal(quote.discountCents,5);assert.equal(quote.amountCents,94);
  const small=priceLiaItems([{id:1,unitPriceCents:1,quantity:1}],true);assert.equal(small.amountCents,1);assert.equal(small.couponCode,'LIA5');
});

test('ownership is exact and a forged coupon cannot bypass server eligibility or a changed amount',()=>{
  assert.equal(isLiaOwnedProduct({store_reference:'official_agrotecnica'}),true);
  for(const row of [{store_reference:'other_store'},{store_reference:'official_agrotecnica',product_url:'https://partner.test'},{store_reference:'OFFICIAL_AGROTECNICA'}])assert.equal(isLiaOwnedProduct(row),false);
  const original=courseLiaQuote({slug:'a',title:'Curso',priceCents:2399},false),discounted=courseLiaQuote({slug:'a',title:'Curso',priceCents:2399},true);
  assert.throws(()=>assertLiaQuoteAccepted({couponCode:'LIA5',expectedAmountCents:2279},original),error=>error.code==='lia_quote_changed');
  assert.throws(()=>assertLiaQuoteAccepted({expectedAmountCents:2399},discounted),error=>error.status===409);
  assert.throws(()=>assertLiaQuoteAccepted({couponCode:'ANOTHER'},discounted),error=>error.status===400);
  assert.doesNotThrow(()=>assertLiaQuoteAccepted({couponCode:'LIA5',expectedAmountCents:2379},discounted,100));
});

test('course quote and checkout charge only the discounted amount and persist original value',async t=>{
  const f=await fixture(t),preview=await f.request('/api/courses/canva-para-lojas/quote');
  assert.equal(preview.status,200);assert.match(preview.headers.get('cache-control'),/no-store/);
  assert.deepEqual(preview.body.quote,{couponCode:'LIA5',eligible:true,percent:5,originalAmountCents:2399,discountCents:120,amountCents:2279});
  const checkout=await f.request('/api/courses/canva-para-lojas/checkout',{termsAccepted:true,couponCode:'LIA5',expectedAmountCents:2279,priceCents:1,discountCents:2398});
  assert.equal(checkout.status,201);assert.equal(f.provider.length,1);assert.equal(f.provider[0].items[0].unit_price,22.79);
  const order=f.db.prepare('SELECT amount_cents,original_amount_cents,lia_discount_cents,lia_coupon_code,status FROM course_orders').get();
  assert.deepEqual(order,{amount_cents:2279,original_amount_cents:2399,lia_discount_cents:120,lia_coupon_code:'LIA5',status:'pending'});
  assert.equal(f.captures[0][0],'captureOrder');assert.equal(f.analytics[0][3],2279);
});

test('expired or newly available course discount requires a new confirmation before any preference',async t=>{
  const f=await fixture(t);f.setEligible(false);
  const expired=await f.request('/api/courses/canva-para-lojas/checkout',{termsAccepted:true,couponCode:'LIA5',expectedAmountCents:2279});
  assert.equal(expired.status,409);assert.equal(expired.body.quote.amountCents,2399);assert.equal(f.provider.length,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM course_orders').get().n,0);
  f.setEligible(true);const appeared=await f.request('/api/courses/canva-para-lojas/checkout',{termsAccepted:true,expectedAmountCents:2399});assert.equal(appeared.status,409);assert.equal(f.provider.length,0);
});

test('marketplace uses authoritative products, keeps shipping whole and reconciles exact net item amounts',async t=>{
  const f=await fixture(t),items=[{productId:1,quantity:3,priceCents:1},{productId:2,quantity:2}];
  const preview=await f.request('/api/marketplace/checkout/quote',{items,couponCode:'FREE',eligible:true});
  assert.equal(preview.status,200);const q=preview.body.quote;assert.equal(q.originalAmountCents,4897);assert.equal(q.discountCents,245);assert.equal(q.amountCents,4652);
  const result=await f.request('/api/marketplace/checkout',{items,addressId:7,termsAccepted:true,couponCode:'LIA5',expectedAmountCents:q.amountCents+100});assert.equal(result.status,201);
  const order=f.db.prepare('SELECT * FROM marketplace_orders').get(),rows=f.db.prepare('SELECT * FROM marketplace_order_items').all();
  assert.equal(order.products_cents,4652);assert.equal(order.shipping_cents,100);assert.equal(order.total_cents,4752);assert.equal(order.original_products_cents,4897);assert.equal(order.lia_discount_cents,245);assert.equal(order.lia_coupon_code,'LIA5');
  assert.equal(rows.reduce((sum,row)=>sum+row.quantity*row.unit_price_cents,0),order.products_cents);assert.equal(rows.filter(row=>row.product_id===1).reduce((sum,row)=>sum+row.quantity,0),3);
  assert.equal(rows.reduce((sum,row)=>sum+row.platform_percent_cents,0),order.platform_percent_cents);
  const sent=f.provider[0];assert.equal(Math.round(sent.items.reduce((sum,item)=>sum+item.quantity*item.unit_price,0)*100),4752);assert.equal(sent.items.find(item=>item.id==='shipping').unit_price,1);
  const reconciliation=f.db.prepare('SELECT * FROM marketplace_payment_reconciliation').get();assert.equal(reconciliation.expected_gross_cents,order.total_cents);assert.equal(reconciliation.expected_marketplace_fee_cents,order.platform_percent_cents+250);assert.equal(reconciliation.expected_seller_net_cents,order.total_cents-reconciliation.expected_marketplace_fee_cents);
  assert.equal(f.captures[0][0],'captureOrder');
});

test('other sellers and external purchase products never get Lia discounts',async t=>{
  const f=await fixture(t);
  for(const productId of [2,3]){
    if(productId===2)f.db.prepare('UPDATE store_products SET product_url=? WHERE id=2').run('https://partner.test/item');
    const preview=await f.request('/api/marketplace/checkout/quote',{items:[{productId,quantity:1}]});assert.equal(preview.body.quote.eligible,false);assert.equal(preview.body.quote.amountCents,2399);
    const attempt=await f.request('/api/marketplace/checkout',{items:[{productId,quantity:1}],addressId:7,termsAccepted:true,couponCode:'LIA5',expectedAmountCents:2379});assert.equal(attempt.status,409);
  }
  assert.equal(f.provider.length,0);
  const ordinary=await f.request('/api/marketplace/checkout',{items:[{productId:3,quantity:1}],addressId:7,termsAccepted:true,couponCode:'',expectedAmountCents:2499});assert.equal(ordinary.status,201);assert.equal(f.db.prepare('SELECT lia_discount_cents FROM marketplace_orders').get().lia_discount_cents,0);
});

test('marketplace revalidates interest after shipping and validates stock and options in its quote',async t=>{
  const f=await fixture(t);
  f.setAfterShipping(()=>f.setEligible(false));
  const expired=await f.request('/api/marketplace/checkout',{items:[{productId:2,quantity:1}],addressId:7,termsAccepted:true,couponCode:'LIA5',expectedAmountCents:2379});assert.equal(expired.status,409);assert.equal(f.provider.length,0);
  for(const items of [[{productId:99,quantity:1}],[{productId:2,quantity:51}],[{productId:2,quantity:1,optionIds:[999]}],[{productId:2,quantity:1},{productId:3,quantity:1}]]){const r=await f.request('/api/marketplace/checkout/quote',{items});assert.ok([400,409].includes(r.status));}
  f.db.exec("INSERT INTO product_option_groups VALUES(1,2,'Tamanho',1,1);INSERT INTO product_options VALUES(1,1,'Maior',100,1)");
  const missing=await f.request('/api/marketplace/checkout/quote',{items:[{productId:2,quantity:1}]});assert.equal(missing.status,400);
  f.setEligible(true);const selected=await f.request('/api/marketplace/checkout/quote',{items:[{productId:2,quantity:1,optionIds:[1]}]});assert.equal(selected.body.quote.originalAmountCents,2499);assert.equal(selected.body.quote.amountCents,2374);
});

test('compensating item price changes during shipping cannot pass only because the cart total stayed equal',async t=>{
  const f=await fixture(t),items=[{productId:1,quantity:1},{productId:2,quantity:1}];
  const preview=await f.request('/api/marketplace/checkout/quote',{items});
  f.setAfterShipping(()=>f.db.exec('UPDATE store_products SET price_cents=price_cents+10 WHERE id=1;UPDATE store_products SET price_cents=price_cents-10 WHERE id=2;'));
  const result=await f.request('/api/marketplace/checkout',{items,addressId:7,termsAccepted:true,couponCode:'LIA5',expectedAmountCents:preview.body.quote.amountCents+100});
  assert.equal(result.status,409);assert.equal(result.body.code,'lia_quote_changed');assert.equal(result.body.quote.amountCents,preview.body.quote.amountCents);assert.equal(f.provider.length,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM marketplace_orders').get().n,0);
});
