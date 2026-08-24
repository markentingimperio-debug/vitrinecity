import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildLegalReviewDossier, LEGAL_DOCUMENTS } from '../legal-review.js';

const publicDir = new URL('../public/', import.meta.url);
const dossier = buildLegalReviewDossier(publicDir, { generatedAt: '2026-08-24T12:00:00.000Z' });

assert.equal(dossier.status, 'pending_external_review');
assert.equal(dossier.legalApproval, false);
assert.equal(dossier.generatedAt, '2026-08-24T12:00:00.000Z');
assert.equal(dossier.documents.length, LEGAL_DOCUMENTS.length);
assert.equal(dossier.summary.total, LEGAL_DOCUMENTS.length);
assert(dossier.summary.total >= 10);
assert(dossier.documents.every(document => document.found));
assert(dossier.documents.every(document => /^[a-f0-9]{64}$/.test(document.sha256)));
assert(dossier.blockingReasons.some(reason => /profissional jur[ií]dico/i.test(reason)));
assert.equal(dossier.documents.find(document => document.id === 'marketplace').versionDeclared, true);
assert.equal(dossier.documents.find(document => document.id === 'marketplace').externalReviewNotice, true);
assert.equal(dossier.documents.find(document => document.id === 'privacy').url, '/privacy.html');

const server = await readFile(new URL('../server.js', import.meta.url), 'utf8');
assert.match(server, /app\.get\('\/api\/admin\/legal\/review',requireAdmin/);
assert.match(server, /buildLegalReviewDossier/);

const page = await readFile(new URL('../public/admin-juridico.html', import.meta.url), 'utf8');
assert.match(page, /noindex,nofollow/);
assert.match(page, /\/api\/admin\/legal\/review/);
assert.match(page, /não substitui a revisão jurídica/i);

console.log('legal-review: ok');
