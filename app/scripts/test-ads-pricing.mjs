import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import Database from 'better-sqlite3';
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
  const testDb=new Database(path.join(dataDir,'vitrinecity.db'));const userId=testDb.prepare('SELECT id FROM users WHERE email=?').get(email).id;
  testDb.prepare("INSERT INTO credit_orders(reference,user_id,amount_cents,fee_cents,credit_units,status) VALUES ('report_order',?,?,?,?, 'approved')").run(userId,105883,15882,864005);
  testDb.prepare('UPDATE wallets SET balance_units=100000 WHERE user_id=?').run(userId);
  testDb.prepare("INSERT INTO credit_batches(user_id,order_reference,original_units,remaining_units,expires_at,status) VALUES (?,'report_order',100000,100000,?,'active')").run(userId,Date.now()+86400000);
  const campaignId=Number(testDb.prepare(`INSERT INTO ad_campaigns
    (user_id,order_reference,objective,destination_type,destination_url,daily_budget_cents,duration_days,gross_credits,management_credits,net_credits,status,creative_title,creative_text,keywords)
    VALUES (?,'report_order','sales','site','https://example.com',3000,30,1016477,152472,864005,'active','Produto teste','Conheça este produto especial','produto, especial')`).run(userId).lastInsertRowid);
  const insertEvent=testDb.prepare('INSERT INTO ad_delivery_events(campaign_id,event_type,event_token,visitor_key,query_text,cost_units,event_day) VALUES (?,?,?,?,?,?,?)');
  for(let i=0;i<10;i++)insertEvent.run(campaignId,'impression',`imp-${i}`,`visitor-${i}`,'produto',0,'2026-08-22');
  insertEvent.run(campaignId,'click','imp-0','visitor-0','produto',480,'2026-08-22');insertEvent.run(campaignId,'click','imp-1','visitor-1','produto',480,'2026-08-22');
  testDb.prepare("INSERT INTO ad_campaign_conversions(campaign_id,order_reference,event_token,value_cents,status) VALUES (?,'sale-1','imp-0',5000,'approved')").run(campaignId);testDb.close();
  response=await request('/api/ads/campaigns',{headers:{cookie}});assert.equal(response.status,200);const report=(await response.json()).campaigns[0];
  assert.deepEqual({impressions:report.impressions,reach:report.reach,clicks:report.clicks,ctrPercent:report.ctrPercent,spentCredits:report.spentCredits,spentCents:report.spentCents,conversions:report.conversions,salesCents:report.sales_cents,conversionRatePercent:report.conversionRatePercent,roas:report.roas,returnPercent:report.returnPercent},{impressions:10,reach:10,clicks:2,ctrPercent:20,spentCredits:9.6,spentCents:100,conversions:1,salesCents:5000,conversionRatePercent:50,roas:50,returnPercent:4900});
  response=await request('/api/ads/serve?q=produto',{headers:{cookie}});assert.equal((await response.json()).ads.length,0,'o anunciante não recebe o próprio anúncio');
  response=await request('/api/ads/serve?q=produto',{headers:{'User-Agent':'Googlebot/2.1'}});assert.equal((await response.json()).ads.length,0,'robôs conhecidos não recebem anúncios');
  response=await request('/api/ads/serve?q=produto');const served=(await response.json()).ads[0];assert.ok(served?.clickUrl);
  response=await request(served.clickUrl,{redirect:'manual',headers:{'User-Agent':'browser-diferente'}});assert.equal(response.headers.get('location'),'/buscar.html','token não vale em outro navegador');
  response=await request(served.clickUrl,{redirect:'manual'});assert.equal(response.headers.get('location'),'https://example.com');assert.match(response.headers.get('set-cookie')||'',/vc_ad_attr=/);
  await request(served.clickUrl,{redirect:'manual'});response=await request('/api/ads/campaigns',{headers:{cookie}});const protectedReport=(await response.json()).campaigns[0];assert.equal(protectedReport.spentCredits,14.4,'o mesmo token cobra uma única vez');
  console.log('ads-pricing: ok');
}finally{child.kill();await new Promise(resolve=>child.once('exit',resolve));await new Promise(resolve=>setTimeout(resolve,300));try{rmSync(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:100})}catch(error){if(error.code!=='EPERM')throw error}}
