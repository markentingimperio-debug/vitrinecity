import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
const dataDir=mkdtempSync(path.join(tmpdir(),'vitriny-ads-')),port=35000+Math.floor(Math.random()*1500),origin=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,DATA_DIR:dataDir,PORT:String(port),SITE_URL:origin,MERCADOPAGO_ACCESS_TOKEN:'TEST-token',MERCADOPAGO_WEBHOOK_SECRET:'test-webhook'},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
async function wait(){for(let i=0;i<80;i++){try{if((await fetch(origin+'/api/health')).ok)return}catch{}await new Promise(resolve=>setTimeout(resolve,100))}throw new Error(output)}
const request=(url,options={})=>fetch(origin+url,{...options,headers:{origin,'Content-Type':'application/json',...(options.headers||{})}});
try{
  await wait();const email=`ads-${port}@example.com`;
  const registration=await request('/api/auth/register',{method:'POST',body:JSON.stringify({name:'Anunciante Teste',email,password:'senha-segura-123',adultConfirmed:true,termsAccepted:true})});assert.equal(registration.status,201);const cookie=registration.headers.get('set-cookie').split(';')[0];
  let response=await request('/api/credits/quote',{method:'POST',headers:{cookie},body:JSON.stringify({dailyCredits:288,durationDays:30})});assert.equal(response.status,200);const quote=(await response.json()).quote;
  assert.deepEqual(quote,{dailyCredits:288,durationDays:30,dailyBudgetCents:3000,requestedNetUnits:864000,amountCents:105883,feeCents:15882,mediaCents:90001,grossCreditUnits:1016477,managementCreditUnits:152472,netCreditUnits:864005,creditsPerReal:9.6,managementRatePercent:15,validityDays:90});
  response=await request('/api/credits/quote',{method:'POST',headers:{cookie},body:JSON.stringify({dailyCredits:47,durationDays:30})});assert.equal(response.status,400);
  response=await request('/api/credits/checkout',{method:'POST',headers:{cookie},body:JSON.stringify({termsAccepted:true,amountCents:105882,dailyCredits:288,dailyBudgetCents:3000,durationDays:30,objective:'visits',destinationType:'site',destinationUrl:'https://example.com',creativeTitle:'Anúncio teste',creativeText:'Texto completo para o anúncio de teste.',keywords:'produto, teste'})});assert.equal(response.status,409);const mismatch=await response.json();assert.equal(mismatch.quote.amountCents,105883);
  const checkoutBase={termsAccepted:true,amountCents:105883,dailyCredits:288,dailyBudgetCents:3000,durationDays:30,objective:'visits',destinationType:'site',destinationUrl:'https://example.com',creativeTitle:'Anúncio teste',creativeText:'Texto completo para o anúncio de teste.',keywords:'produto, teste',targetCity:'Anápolis',startsOn:new Date().toISOString().slice(0,10)};
  response=await request('/api/credits/checkout',{method:'POST',headers:{cookie},body:JSON.stringify({...checkoutBase,reachKm:10})});assert.equal(response.status,400);assert.match((await response.json()).error,/público/i);
  response=await request('/api/credits/checkout',{method:'POST',headers:{cookie},body:JSON.stringify({...checkoutBase,targetAudience:'Pessoas interessadas no produto',reachKm:101})});assert.equal(response.status,400);assert.match((await response.json()).error,/alcance/i);
  const walletHtml=readFileSync(new URL('../public/carteira.html',import.meta.url),'utf8');for(const id of ['targetAudience','targetCity','reachKm','startsOn','creativeTitle','destinationUrl'])assert.match(walletHtml,new RegExp(`id=["']${id}["']`));
  console.log('ads-pricing: ok');
}finally{child.kill();await new Promise(resolve=>child.once('exit',resolve));await new Promise(resolve=>setTimeout(resolve,300));try{rmSync(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:100})}catch(error){if(error.code!=='EPERM')throw error}}
