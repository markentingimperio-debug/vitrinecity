import {randomUUID} from 'node:crypto';

const MAX_LEASE_MS=65000;

// A shared inference slot, not a queue. No prompt, answer or document is stored here.
export function createJarvisModelGate(db,{now=Date.now}={}){
  db.exec(`CREATE TABLE IF NOT EXISTS jarvis_model_lease(
    id INTEGER PRIMARY KEY CHECK(id=1),token TEXT,owner TEXT CHECK(owner IN ('admin','public')),
    expires_at INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO jarvis_model_lease(id) VALUES(1);`);
  const claim=db.prepare('UPDATE jarvis_model_lease SET token=?,owner=?,expires_at=? WHERE id=1 AND expires_at<=?');
  const release=db.prepare('UPDATE jarvis_model_lease SET token=NULL,owner=NULL,expires_at=0 WHERE id=1 AND token=?');
  return Object.freeze({
    acquire(owner,ttlMs=MAX_LEASE_MS){
      if(owner!=='admin'&&owner!=='public')throw new TypeError('Invalid model lease owner.');
      if(!Number.isSafeInteger(ttlMs)||ttlMs<=0)throw new RangeError('Invalid model lease duration.');
      const started=now(),duration=Math.min(ttlMs,MAX_LEASE_MS);
      if(!Number.isSafeInteger(started)||started<0||!Number.isSafeInteger(started+duration))throw new RangeError('Invalid model lease clock.');
      const token=randomUUID();
      try{
        // The conditional UPDATE is atomic across separate SQLite connections/processes.
        if(claim.run(token,owner,started+duration,started).changes!==1)return null;
      }catch(error){
        if(error.code==='SQLITE_BUSY')return null;
        throw error;
      }
      return Object.freeze({release(){release.run(token);}});
    }
  });
}
