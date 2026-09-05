import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';

const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
assert.match(source,/status='offered' AND expires_at>/);
assert.match(source,/WHERE id=\? AND status='available' AND courier_id IS NULL/);
assert.match(source,/buyer_user_id=\?/);
assert.match(source,/store_reference=\?/);
const dispatchRoute=source.match(/app\.get\('\/api\/courier\/dispatch'[\s\S]*?\}\);/s)?.[0]||'';
assert.ok(dispatchRoute&&!/recipient_name|delivery_address|customer_whatsapp/.test(dispatchRoute),'oferta não pode revelar cliente');

const db=new Database(':memory:');
db.exec(`CREATE TABLE jobs(id INTEGER PRIMARY KEY,status TEXT,courier_id INTEGER);
CREATE TABLE offers(id INTEGER PRIMARY KEY,job_id INTEGER,courier_id INTEGER,status TEXT);
CREATE UNIQUE INDEX one_offer ON offers(job_id) WHERE status='offered';
INSERT INTO jobs VALUES(1,'available',NULL);INSERT INTO offers VALUES(1,1,10,'offered');`);
assert.throws(()=>db.prepare("INSERT INTO offers VALUES(2,1,11,'offered')").run());
assert.equal(db.prepare("UPDATE jobs SET courier_id=?,status='assigned' WHERE id=? AND status='available' AND courier_id IS NULL").run(10,1).changes,1);
assert.equal(db.prepare("UPDATE jobs SET courier_id=?,status='assigned' WHERE id=? AND status='available' AND courier_id IS NULL").run(11,1).changes,0);
console.log('live delivery backend tests passed');
