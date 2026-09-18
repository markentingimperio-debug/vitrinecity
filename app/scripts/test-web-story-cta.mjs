import test from 'node:test';
import assert from 'node:assert/strict';
import { storySourceCta } from '../web-story-cta.js';

test('returns the expected CTA for source kinds with explicit labels', () => {
  assert.equal(storySourceCta({ kind: 'product' }), 'Ver oferta');
  assert.equal(storySourceCta({ kind: 'affiliate' }), 'Ver oferta');
  assert.equal(storySourceCta({ kind: 'store' }), 'Visitar loja');
  assert.equal(storySourceCta({ kind: 'course' }), 'Ver curso');
  assert.equal(storySourceCta({ kind: 'service' }), 'Ver serviço');
  assert.equal(storySourceCta({ kind: 'city' }), 'Explorar cidade');
});

test('uses sourceKind as fallback when kind is missing', () => {
  assert.equal(storySourceCta({ sourceKind: 'product' }), 'Ver oferta');
  assert.equal(storySourceCta({ sourceKind: 'store' }), 'Visitar loja');
});

test('returns recipe CTA for recipe sources and recipe groups', () => {
  assert.equal(storySourceCta({ kind: 'recipe' }), 'Ver modo de preparo');
  assert.equal(storySourceCta({ group: 'recipes' }), 'Ver modo de preparo');
  assert.equal(storySourceCta({ group: 'receitas' }), 'Ver modo de preparo');
  assert.equal(storySourceCta({ portal: 'receitas' }), 'Ver modo de preparo');
  assert.equal(storySourceCta({ category: 'receitas' }), 'Ver modo de preparo');
});

test('falls back to the full article CTA for unknown and empty sources', () => {
  assert.equal(storySourceCta({ kind: 'unknown' }), 'Ler matéria completa');
  assert.equal(storySourceCta({}), 'Ler matéria completa');
});
