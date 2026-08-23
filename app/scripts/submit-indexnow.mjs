import { submitIndexNow } from '../indexnow.js';

const key = process.env.INDEXNOW_KEY || 'a96a29ed202d3e9fd1ec526aed6422cb5818432b1aca1bf1';
try {
  const result = await submitIndexNow({ key, siteUrl: process.env.SITE_URL || 'https://vitrinecity.com' });
  console.log(`indexnow: ${result.submitted} URLs aceitas (HTTP ${result.status})`);
} catch (error) {
  console.error(`indexnow: falha (${String(error?.message || 'unknown')})`);
  process.exitCode = 1;
}
