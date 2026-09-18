import test from 'node:test';
import assert from 'node:assert/strict';
import { storySourceCta } from '../web-story-cta.js';

test('kind product keeps the explicit offer CTA even with receita group', () => {
  assert.equal(
    storySourceCta({ kind: 'product', group: 'receitas' }),
    'Ver oferta',
  );
});

test('empty kind falls back to sourceKind course', () => {
  assert.equal(storySourceCta({ kind: '', sourceKind: 'course' }), 'Ver curso');
});

test('unknown kind still maps receita group to preparation CTA', () => {
  assert.equal(
    storySourceCta({ kind: 'unknown', group: 'receitas' }),
    'Ver modo de preparo',
  );
});

test('unknown sourceKind still maps receita portal to preparation CTA', () => {
  assert.equal(
    storySourceCta({ sourceKind: 'unknown', portal: 'receitas' }),
    'Ver modo de preparo',
  );
});

test('unknown sourceKind alone falls back to full article CTA', () => {
  assert.equal(storySourceCta({ sourceKind: 'unknown' }), 'Ler matéria completa');
});
