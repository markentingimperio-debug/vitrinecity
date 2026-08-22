import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import Database from 'better-sqlite3';

const dataDir=mkdtempSync(path.join(tmpdir(),'vitriny-seller-'));
const port=33000+Math.floor(Math.random()*2000),origin=`http://127.0.0.1:${port}`,secret='seller-test-secret';
const child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,DATA_DIR:dataDir,PORT:String(port),SITE_URL:origin,STORE_PORTAL_SECRET:secret,MERCADOPAGO_MARKETPLACE_CLIENT_ID:'123456',MERCADOPAGO_MARKETPLACE_CLIENT_SECRET:'test-client-secret',MERCADOPAGO_MARKETPLACE_TOKEN_ENCRYPTION_KEY:'test-encryption-key-with-32-characters'},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
const request=(url,options={})=>fetch(origin+url,{...options,headers:{origin,'Content-Type':'application/json',...(options.headers||{})}});
async function wait(){for(let i=0;i<80;i++){try{const response=await fetch(origin+'/api/health');if(response.ok)return}catch{}await new Promise(resolve=>setTimeout(resolve,100))}throw new Error(`Servidor de teste não iniciou: ${output}`)}
try{
  await wait();
  const register=await request('/api/auth/register',{method:'POST',body:JSON.stringify({name:'Comprador Teste',email:`seller-${port}@example.com`,password:'senha-segura-123',adultConfirmed:true,termsAccepted:true})});
  assert.equal(register.status,201);const cookie=register.headers.get('set-cookie').split(';')[0];
  const db=new Database(path.join(dataDir,'vitrinecity.db'));
  const user=db.prepare('SELECT id FROM users WHERE email=?').get(`seller-${port}@example.com`);
  const store='seller-test-store',foreignStore='seller-test-foreign';
  for(const reference of [store,foreignStore]){
    db.prepare(`INSERT INTO lot_orders(reference,name,email,amount_cents,status,business_name,fulfillment_status) VALUES (?,?,?,100,'approved',?,'published')`).run(reference,'Loja Teste',`${reference}@example.com`,'Loja Teste');
    db.prepare(`INSERT INTO store_profiles(order_reference,business_name,review_status) VALUES (?,?,'published')`).run(reference,'Loja Teste');
  }
  const address=Number(db.prepare(`INSERT INTO customer_addresses(user_id,label,recipient_name,postal_code,street,number,neighborhood,city,state,is_default) VALUES (?,'Casa','Comprador','01310100','Avenida Teste','1','Centro','São Paulo','SP',1)`).run(user.id).lastInsertRowid);
  const insertOrder=reference=>db.prepare(`INSERT INTO marketplace_orders(reference,buyer_user_id,store_reference,address_id,products_cents,shipping_cents,platform_percent_cents,platform_fixed_cents,return_operation_cents,total_cents,payment_status,fulfillment_status) VALUES (?,?,?,?,10000,1000,1000,200,50,11000,'approved','fiscal_pending')`).run(reference,user.id,store,address);
  insertOrder('seller-order-ship');insertOrder('seller-order-cancel');
  db.prepare(`INSERT INTO marketplace_payment_reconciliation(order_reference,expected_gross_cents,expected_marketplace_fee_cents,expected_seller_net_cents,split_mode) VALUES ('seller-order-ship',11000,1250,9750,'central')`).run();
  const token=createHmac('sha256',secret).update(`store:${store}`).digest('base64url'),sellerHeaders={'x-store-token':token};
  let response=await request(`/api/store-portal/${store}/seller-profile`,{method:'PUT',body:JSON.stringify({token,sellerType:'cpf',taxId:'11111111111',legalName:'Vendedor Teste',termsAccepted:true,adultConfirmed:true})});assert.equal(response.status,400);
  response=await request(`/api/store-portal/${store}/seller-profile`,{method:'PUT',body:JSON.stringify({token,sellerType:'cpf',taxId:'52998224725',legalName:'Vendedor Teste',termsAccepted:true})});assert.equal(response.status,400);
  response=await request(`/api/store-portal/${store}/seller-profile`,{method:'PUT',body:JSON.stringify({token,sellerType:'cpf',taxId:'529.982.247-25',legalName:'Vendedor Teste',tradeName:'Loja CPF',termsAccepted:true,adultConfirmed:true})});assert.equal(response.status,200);const submittedProfile=(await response.json()).sellerProfile;assert.equal(submittedProfile.complianceStatus,'pending');assert.equal(submittedProfile.taxIdMasked,'***.***.***-25');const storedProfile=db.prepare('SELECT * FROM marketplace_seller_profiles WHERE store_reference=?').get(store);assert.notEqual(storedProfile.tax_id_hash,'52998224725');assert.equal(JSON.stringify(storedProfile).includes('52998224725'),false);
  response=await request(`/api/store-portal/${store}/mercadopago/connect?token=${encodeURIComponent(token)}`,{redirect:'manual'});assert.equal(response.status,409);db.prepare("UPDATE marketplace_seller_profiles SET compliance_status='verified' WHERE store_reference=?").run(store);
  response=await request(`/api/store-portal/${store}/mercadopago/connect?token=${encodeURIComponent(token)}`,{redirect:'manual'});assert.equal(response.status,302);const authorization=new URL(response.headers.get('location'));assert.equal(authorization.origin,'https://auth.mercadopago.com.br');assert.equal(authorization.searchParams.get('client_id'),'123456');assert.ok(authorization.searchParams.get('state'));
  response=await request(`/api/store-portal/${store}/orders/seller-order-ship/operations`,{method:'PATCH',headers:sellerHeaders,body:JSON.stringify({action:'mark_shipped'})});assert.equal(response.status,409);
  response=await request(`/api/store-portal/${store}/orders/seller-order-ship/fiscal`,{method:'PATCH',headers:sellerHeaders,body:JSON.stringify({invoiceKey:'1'.repeat(44)})});assert.equal(response.status,200);
  response=await request(`/api/store-portal/${store}/orders/seller-order-ship/operations`,{method:'PATCH',headers:sellerHeaders,body:JSON.stringify({action:'set_label',labelUrl:'https://example.com/label.pdf',trackingCode:'TEST12345'})});assert.equal(response.status,200);
  response=await request(`/api/store-portal/${store}/orders/seller-order-ship/operations`,{method:'PATCH',headers:sellerHeaders,body:JSON.stringify({action:'mark_shipped'})});assert.equal(response.status,200);
  response=await request('/api/marketplace/orders/seller-order-ship/returns',{method:'POST',headers:{cookie},body:JSON.stringify({reason:'Produto recebido com avaria relevante.'})});assert.equal(response.status,201);const returnId=(await response.json()).id;
  const foreignToken=createHmac('sha256',secret).update(`store:${foreignStore}`).digest('base64url');
  response=await request(`/api/store-portal/${foreignStore}/returns/${returnId}`,{method:'PATCH',headers:{'x-store-token':foreignToken},body:JSON.stringify({action:'approve'})});assert.equal(response.status,404);
  response=await request(`/api/store-portal/${store}/returns/${returnId}`,{method:'PATCH',headers:sellerHeaders,body:JSON.stringify({action:'approve',note:'Envie o produto com a embalagem.'})});assert.equal(response.status,200);
  response=await request(`/api/store-portal/${store}/returns/${returnId}`,{method:'PATCH',headers:sellerHeaders,body:JSON.stringify({action:'receive'})});assert.equal(response.status,200);
  response=await request(`/api/store-portal/${store}/returns/${returnId}`,{method:'PATCH',headers:sellerHeaders,body:JSON.stringify({action:'reject'})});assert.equal(response.status,409);
  response=await request(`/api/store-portal/${store}/orders/seller-order-cancel/operations`,{method:'PATCH',headers:sellerHeaders,body:JSON.stringify({action:'request_cancel'})});assert.equal(response.status,200);
  response=await request(`/api/store-portal/${store}/orders/seller-order-cancel/operations`,{method:'PATCH',headers:sellerHeaders,body:JSON.stringify({action:'request_cancel'})});assert.equal(response.status,409);
  response=await request(`/api/store-portal/${store}/marketplace?token=${encodeURIComponent(token)}`);assert.equal(response.status,200);const panel=await response.json();assert.equal(panel.orders.length,2);assert.equal(panel.returns[0].status,'received');const shipped=panel.orders.find(order=>order.reference==='seller-order-ship');assert.equal(shipped.payoutStatus,'scheduled');assert.equal(shipped.payoutCents,8750);assert.equal(shipped.reconciliation_status,'pending');assert.equal(panel.sellerProfile.complianceStatus,'verified');assert.deepEqual(panel.paymentSplit,{configured:true,account:null});assert.deepEqual(panel.fees,{percent:10,fixedCents:200,returnProvisionPerOrderCents:50});
  db.close();console.log('seller-operations-api: ok');
}finally{
  child.kill();await new Promise(resolve=>child.once('exit',resolve));await new Promise(resolve=>setTimeout(resolve,500));
  try{rmSync(dataDir,{recursive:true,force:true,maxRetries:10,retryDelay:100})}catch(error){if(error.code!=='EPERM')throw error}
}
