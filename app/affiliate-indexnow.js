import { createHash } from 'node:crypto';

// Ownership file already published for this site; other deployments must supply a key.
const siteKey = 'a96a29ed202d3e9fd1ec526aed6422cb5818432b1aca1bf1';
export function setupAffiliateIndexNow({ db, siteUrl, rows, fetcher = fetch, start = true,
  key = process.env.INDEXNOW_KEY || (new URL(siteUrl).origin === 'https://vitrinecity.com' ? siteKey : '') }) {
  const origin = new URL(siteUrl).origin;
  const enabled = origin.startsWith('https://') && /^[A-Za-z0-9-]{8,128}$/.test(key);
  db.exec(`CREATE TABLE IF NOT EXISTS affiliate_indexnow_state (
    url TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, submitted_at TEXT NOT NULL);`);
  let running = false, lastError = null;
  async function flush() {
    if (!enabled || running) return { submitted: 0 };
    running = true;
    try {
      const current = new Map(rows().filter(p => p.status !== 'draft').map(p => [origin+'/ofertas/'+p.slug,
        createHash('sha256').update(JSON.stringify([p.title,p.description,p.category,p.image,p.affiliate_url,
          p.status,p.availability,p.health === 'broken',p.evidence])).digest('hex')]));
      const previous = new Map(db.prepare('SELECT url,fingerprint FROM affiliate_indexnow_state').all().map(p => [p.url,p.fingerprint]));
      const changed = [...current].filter(([url,hash]) => previous.get(url) !== hash);
      for (const [url] of previous) if (!current.has(url)) changed.push([url,null]);
      if (!changed.length) return { submitted: 0 };
      const urlList = [origin+'/ofertas',...changed.map(([url]) => url)];
      const response = await fetcher('https://api.indexnow.org/indexnow', {
        method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({host:new URL(origin).hostname,key,keyLocation:origin+'/'+key+'.txt',urlList}),
        signal:AbortSignal.timeout(15000)
      });
      if (![200,202].includes(response.status)) throw new Error('HTTP '+response.status);
      // Persist only the snapshot accepted by the service. An edit during the request is sent next time.
      db.transaction(() => {
        for (const [url,hash] of changed) {
          if (hash === null) db.prepare('DELETE FROM affiliate_indexnow_state WHERE url=?').run(url);
          else db.prepare(`INSERT INTO affiliate_indexnow_state VALUES (?,?,?)
            ON CONFLICT(url) DO UPDATE SET fingerprint=excluded.fingerprint,submitted_at=excluded.submitted_at`)
            .run(url,hash,new Date().toISOString());
        }
      })();
      lastError = null;
      console.log(`affiliate-indexnow: ${urlList.length} URLs received (HTTP ${response.status})`);
      return { submitted:urlList.length, status:response.status };
    } catch (error) {
      lastError = String(error?.message || 'request failed').slice(0,150);
      console.warn('affiliate-indexnow: submission failed; retry at next interval');
      return { submitted:0, error:lastError };
    } finally { running = false; }
  }
  const initial = start && enabled ? setTimeout(flush,90000) : null;
  const timer = start && enabled ? setInterval(flush,900000) : null;
  initial?.unref(); timer?.unref();
  return { flush, status:() => ({enabled,running,lastError,
    lastSubmittedAt:db.prepare('SELECT MAX(submitted_at) AS value FROM affiliate_indexnow_state').get().value}),
    close:() => {clearTimeout(initial);clearInterval(timer);} };
}
