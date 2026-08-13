import express from 'express';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const dir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || '/data';
const db = new Database(path.join(dataDir, 'vitrinecity.db'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, whatsapp TEXT,
  interest TEXT, consent INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);

app.use(express.json({ limit: '30kb' }));
app.use('/vendor/three', express.static(path.join(dir, 'node_modules/three/build')));
app.use(express.static(path.join(dir, 'public'), { extensions: ['html'] }));
app.post('/api/leads', (req, res) => {
  const { name, email, whatsapp = '', interest = '', consent } = req.body || {};
  if (!consent || typeof name !== 'string' || name.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(email || '')) {
    return res.status(400).json({ error: 'Informe nome, e-mail válido e aceite o recebimento de novidades.' });
  }
  db.prepare('INSERT INTO leads (name,email,whatsapp,interest,consent) VALUES (?,?,?,?,1)').run(name.trim().slice(0,100), email.trim().toLowerCase().slice(0,160), String(whatsapp).slice(0,30), String(interest).slice(0,80));
  res.status(201).json({ ok: true });
});
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.listen(process.env.PORT || 3000, () => console.log('VitrineCity online'));
