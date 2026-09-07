import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createVitrinyNeuralService} from '../vitriny-neural/service.js';

let clock=Date.parse('2026-09-07T13:30:00.000Z');const now=()=>clock+=60000;
const db=new Database(':memory:');
db.exec(`
  CREATE TABLE social_post_views(post_id TEXT,visitor_key TEXT,view_day TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE social_likes(post_id TEXT,user_id INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE social_comments(post_id TEXT,status TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE social_shares(post_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE social_saves(post_id TEXT,user_id INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE social_reports(post_id TEXT,status TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE social_engagement_events(post_id TEXT,actor_key TEXT,event_day TEXT,impressions INTEGER DEFAULT 0,watch_ms INTEGER DEFAULT 0,completions INTEGER DEFAULT 0);
`);
const service=createVitrinyNeuralService({db,providers:[],now,pseudonymSalt:'observer-test-private-salt',env:{VITRINY_NEURAL_ENABLED:'1',VITRINY_NEURAL_MODE:'shadow',VITRINY_NEURAL_OBSERVER_INTERVAL_MS:'10000'},logger:{warn(){}}});
try{
  const baseline=service.observer.sample();assert.equal(baseline.probeCount>=9,true);assert.deepEqual(baseline.deltas,{});
  db.prepare("INSERT INTO social_post_views(post_id,visitor_key,view_day) VALUES('p1','v1','2026-09-07'),('p1','v2','2026-09-07')").run();
  db.prepare("INSERT INTO social_likes(post_id,user_id) VALUES('p1',1)").run();
  db.prepare("INSERT INTO social_comments(post_id,status) VALUES('p1','published'),('p1','hidden')").run();
  db.prepare("INSERT INTO social_shares(post_id) VALUES('p1')").run();
  db.prepare("INSERT INTO social_saves(post_id,user_id) VALUES('p1',2)").run();
  db.prepare("INSERT INTO social_reports(post_id,status) VALUES('p1','open'),('p1','closed')").run();
  db.prepare("INSERT INTO social_engagement_events(post_id,actor_key,event_day,impressions,watch_ms,completions) VALUES('p1','a1','2026-09-07',2,12000,1)").run();
  const sampled=service.observer.sample();
  assert.equal(sampled.deltas['social.views.delta'],2);
  assert.equal(sampled.deltas['social.likes.delta'],1);
  assert.equal(sampled.deltas['social.comments.delta'],1);
  assert.equal(sampled.deltas['social.impressions.delta'],2);
  assert.equal(sampled.deltas['social.watch_ms.delta'],12000);
  assert.equal(sampled.deltas['social.completions.delta'],1);
  const signals=db.prepare('SELECT metric,value,metadata_json FROM neural_signals ORDER BY id').all();
  assert.equal(signals.some(x=>x.metric==='social.avg_watch_ms'&&Number(x.value)===6000),true);
  assert.equal(signals.some(x=>x.metric==='social.completion_rate'&&Number(x.value)===0.5),true);
  assert.equal(signals.every(x=>!String(x.metadata_json).includes('visitor_key')&&!String(x.metadata_json).includes('actor_key')),true);
  console.log(JSON.stringify({ok:true,observer:service.observer.status(),signals:signals.length,deltas:sampled.deltas}));
}finally{service.observer.stop();db.close();}
