import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {setupAdminAnalytics} from '../admin-analytics.js';
import {setupBuildingSubscriptions} from '../building-subscriptions.js';

function fixture(t, {legacy = false, legacyBilling = false} = {}) {
  const db = new Database(':memory:'), routes = new Map();
  db.exec(`CREATE TABLE lot_orders(reference TEXT PRIMARY KEY,amount_cents INTEGER,status TEXT,updated_at TEXT${legacy ? legacyBilling ? ',billing_type TEXT,plan_code TEXT,mp_subscription_id TEXT' : '' : ',billing_type TEXT,plan_code TEXT,mp_subscription_id TEXT,mp_payment_id TEXT,created_at TEXT'});
    CREATE TABLE store_profiles(order_reference TEXT PRIMARY KEY,review_status TEXT,updated_at TEXT);
    CREATE TABLE users(id INTEGER PRIMARY KEY,created_at TEXT);
    CREATE TABLE leads(id INTEGER PRIMARY KEY,name TEXT,email TEXT,whatsapp TEXT,interest TEXT,created_at TEXT);
    CREATE TABLE affiliates(id INTEGER PRIMARY KEY,created_at TEXT);
    CREATE TABLE course_orders(reference TEXT PRIMARY KEY,amount_cents INTEGER,status TEXT,updated_at TEXT);
    CREATE TABLE credit_orders(reference TEXT PRIMARY KEY,amount_cents INTEGER,status TEXT,updated_at TEXT);
    CREATE TABLE service_orders(reference TEXT PRIMARY KEY,amount_cents INTEGER,status TEXT,updated_at TEXT);`);
  const app = {get(path,...handlers) {routes.set(path,handlers.at(-1));},post() {},patch() {}};
  setupAdminAnalytics({app,db,requireAdmin:()=>{},publicDir:'.'});
  let clock = Date.parse('2026-10-15T12:00:00Z');
  // The receipt table deliberately initializes after analytics, as in server.js.
  const billing = legacy ? null : setupBuildingSubscriptions({db,siteUrl:'https://vitrinecity.test',
    now:()=>clock,request:async()=>{throw Error('Unexpected provider request');}});
  t.after(()=>{billing?.close();db.close();});
  const dashboard = (from='2026-10-01',to='2026-10-31') => {
    let result; routes.get('/api/admin/dashboard')({query:{from,to}},{json(value) {result=value;}}); return result;
  };
  const order = (reference,changes={}) => {
    const values={reference,amount_cents:1000,status:'approved',updated_at:'2026-10-15T10:00:00Z',
      billing_type:'recurring',plan_code:'basic_monthly_trial',mp_subscription_id:'mp-'+reference,created_at:'2026-09-11T10:00:00Z',...changes};
    db.prepare(`INSERT INTO lot_orders(${Object.keys(values).join(',')}) VALUES(${Object.keys(values).map(()=>'?').join(',')})`).run(...Object.values(values));
  };
  const attribute = (reference,orderType='lot_subscription',source='facebook') => db.prepare(`INSERT INTO analytics_order_attribution(order_reference,order_type,utm_source,utm_medium,utm_campaign,created_at)
    VALUES(?,?,?,'paid','lojas','2026-09-11T10:00:00Z')`).run(reference,orderType,source);
  const pay = (reference,id,changes={}) => billing.recordPayment({id,external_reference:reference,currency_id:'BRL',transaction_amount:10,status:'approved',date_approved:'2026-10-11T12:00:00Z',...changes});
  return {db,billing,dashboard,order,attribute,pay,setClock:value=>clock=Date.parse(value)};
}

test('free trials and legacy authorizations create no dashboard revenue, sale or attributed revenue', t=>{
  const f=fixture(t);f.order('trial',{trial_version:'building-trial-30d-v1',trial_until:'2026-11-11T10:00:00Z'});
  f.order('legacy-authorization',{plan_code:'basic_monthly'});f.attribute('trial');f.attribute('legacy-authorization');
  const result=f.dashboard();assert.equal(result.summary.sales,0);assert.equal(result.summary.revenueCents,0);
  assert.deepEqual(result.assets.find(row=>row.asset==='Lotes'),{asset:'Lotes',sales:0,revenue:0});
  assert.deepEqual(result.sources,[]);assert.ok(result.daily.every(row=>row.revenueCents===0));
});

test('verified recurring receipts count once, retain campaign attribution, and use approval dates', t=>{
  const f=fixture(t);f.order('store');f.attribute('store');
  f.pay('store','one');f.pay('store','one');f.pay('store','two',{date_approved:'2026-11-11T12:00:00Z'});
  const october=f.dashboard();assert.equal(october.summary.sales,1);assert.equal(october.summary.revenueCents,1000);
  assert.deepEqual(october.sources,[{source:'facebook',medium:'paid',campaign:'lojas',orders:1,revenue_cents:1000}]);
  assert.equal(october.daily.find(row=>row.date==='2026-10-11').revenueCents,1000);
  assert.equal(october.daily.find(row=>row.date==='2026-10-15').revenueCents,0);
  const both=f.dashboard('2026-10-01','2026-11-30');assert.equal(both.summary.sales,2);assert.equal(both.summary.revenueCents,2000);
  assert.equal(both.assets.find(row=>row.asset==='Lotes').revenue,2000);assert.equal(both.sources[0].revenue_cents,2000);
  f.db.prepare("UPDATE lot_orders SET updated_at='2026-12-01T10:00:00Z',status='cancelled' WHERE reference='store'").run();
  assert.equal(f.dashboard().summary.revenueCents,1000,'Cancelling access does not refund a verified receipt or move its financial date');
});

test('refunds and chargebacks disappear from all financial views while unrelated revenue remains', t=>{
  const f=fixture(t);f.order('store');f.attribute('store');f.pay('store','one');f.pay('store','two');
  f.order('founder',{billing_type:'one_time',plan_code:'founder',mp_subscription_id:null,amount_cents:1500});f.attribute('founder','lot','direct');
  f.db.prepare("INSERT INTO course_orders VALUES('course',2500,'approved','2026-10-14T10:00:00Z')").run();f.attribute('course','course','search');
  assert.equal(f.dashboard().summary.revenueCents,6000);
  f.pay('store','one',{status:'refunded'});f.pay('store','two',{status:'charged_back'});
  const result=f.dashboard();assert.equal(result.summary.sales,2);assert.equal(result.summary.revenueCents,4000);
  assert.equal(result.assets.find(row=>row.asset==='Lotes').revenue,1500);
  assert.equal(result.daily.find(row=>row.date==='2026-10-11').revenueCents,0);
  assert.equal(result.sources.find(row=>row.source==='facebook'),undefined);
  assert.equal(result.sources.reduce((sum,row)=>sum+row.revenue_cents,0),4000);
});

test('a pending receipt becomes revenue only on its first verified approval date', t=>{
  const f=fixture(t);f.order('store');f.attribute('store','lot');
  f.setClock('2026-09-30T12:00:00Z');f.pay('store','one',{status:'pending',date_approved:null});
  assert.equal(f.dashboard('2026-09-01','2026-09-30').summary.revenueCents,0);
  f.setClock('2026-10-02T12:00:00Z');f.pay('store','one',{date_approved:'2026-10-01T12:00:00Z'});
  f.setClock('2026-10-20T12:00:00Z');f.pay('store','one',{date_approved:'2026-10-01T12:00:00Z'});
  assert.equal(f.dashboard('2026-09-01','2026-09-30').summary.revenueCents,0);
  const result=f.dashboard();assert.equal(result.summary.revenueCents,1000);assert.equal(result.sources[0].revenue_cents,1000);
  assert.equal(result.daily.find(row=>row.date==='2026-10-01').revenueCents,1000);
});

test('legacy one-time schemas remain readable and recurring markers never become assumed historical payments', t=>{
  const f=fixture(t,{legacy:true});f.db.prepare("INSERT INTO lot_orders VALUES('founder',1500,'approved','2026-10-15')").run();
  assert.equal(f.dashboard().summary.revenueCents,1500);
  const old=fixture(t,{legacy:true,legacyBilling:true});
  const insert=old.db.prepare("INSERT INTO lot_orders VALUES(?,1000,'approved','2026-10-15',?,?,?)");
  insert.run('recurring','recurring','basic_monthly','mp1');insert.run('plan-only',null,'basic_monthly',null);insert.run('receipt-id-only',null,null,'mp2');
  assert.equal(old.dashboard().summary.revenueCents,0);assert.equal(old.dashboard().summary.sales,0);
});
