// Isolated visual preview only: an in-memory catalog, disabled monitors and no real accounts.
import express from 'express';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setupAffiliateCatalog } from '../affiliate-catalog.js';
const app = express(), db = new Database(':memory:');
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const catalog = setupAffiliateCatalog({ app, db, siteUrl: 'http://localhost:4300', publicDir, startMonitor: false,
  requireAdmin: (_req,res) => res.status(401).end(), sameOriginOnly: (_req,res) => res.status(403).end(),
  fetcher: () => { throw new Error('Preview never contacts affiliate platforms'); } });
// Preview clicks stay local and cannot navigate to an affiliate or register a conversion.
if (process.env.AFFILIATE_PREVIEW_DIGITAL === '1') {
  const rows=JSON.parse(fs.readFileSync(new URL('../affiliate-batches/darkplanner-20260908.json',import.meta.url),'utf8'));
  for(const row of rows)db.prepare(`INSERT INTO affiliate_catalog (slug,platform,title,description,category,keywords,image,affiliate_url,status,availability,evidence)
    VALUES (@slug,@platform,@title,@description,@category,@keywords,@image,@affiliate_url,@status,@availability,@evidence)`).run(row);
}
db.prepare('UPDATE affiliate_catalog SET affiliate_url=?').run('#preview-only');
app.use(express.static(publicDir));
const server = app.listen(4300, process.env.PREVIEW_BIND_ALL === '1' ? '0.0.0.0' : '127.0.0.1', () => console.log('Isolated affiliate preview ready on port 4300'));
process.on('SIGTERM', () => { catalog.close(); server.closeAllConnections(); server.close(() => { db.close(); process.exit(0); }); });
