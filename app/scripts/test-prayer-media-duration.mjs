import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PRAYER_FORMATS, generatePrayerMedia, mediaHash } from '../prayer-media.js';

test('new TikTok renders target 65 seconds without regenerating a ready historical edition', async () => {
  assert.equal(PRAYER_FORMATS.tiktok, 65);
  assert.equal(PRAYER_FORMATS.short, 30);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prayer-duration-'));
  try {
    const day = '2026-09-13', directory = path.join(root, 'prayer-media', day, 'tiktok');
    await fs.mkdir(directory, { recursive: true });
    const videoPath = path.join(directory, 'video.mp4'), bytes = Buffer.from('existing completed video fixture');
    const script = { day, format: 'tiktok', text: 'Existing reviewed prayer' };
    const ready = { day, format: 'tiktok', videoPath, durationSeconds: 61, script, binding: mediaHash(JSON.stringify(script)), sha256: mediaHash(bytes) };
    await fs.writeFile(videoPath, bytes);
    await fs.writeFile(path.join(directory, 'ready.json'), JSON.stringify(ready));
    const actual = await generatePrayerMedia({ day, format: 'tiktok', dataDir: root, publicDir: root, apiKey: '', fetchImpl: () => { throw Error('must not generate again'); } });
    assert.deepEqual(actual, ready);
    assert.deepEqual(await fs.readFile(videoPath), bytes);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
