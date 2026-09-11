import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { setupSiteAssistantGiftInvitation } from '../site-assistant-gift-invitation.js';

const DAY = 86400000;
const gift = { id: 'zamioculca', title: 'Guia prático da zamioculca: cultivo e cuidados em casa', topic: 'plants', amountCents: 0, available: true };
const plants = { kind: 'article', group: 'plants', path: '/artigo/zamioculca' };
const recipe = { kind: 'recipe', group: 'recipes', path: '/artigo/bolo' };
const help = 'Você pode conferir as orientações de cultivo no conteúdo desta página.';
function fixture(t) {
  const db = new Database(':memory:'); t.after(() => db.close());
  let time = 1000, currentGift = gift;
  const create = () => setupSiteAssistantGiftInvitation({ db, getGift: () => typeof currentGift === 'function' ? currentGift() : currentGift, now: () => time });
  let controller = create();
  const call = (message, context = plants, reply = help, session = 'session-a', nav = { actions: [] }) => db.transaction(() => controller.decorate({ id: session }, context, message, nav, reply)).immediate();
  return { db, call, tick: amount => { time += amount; }, setGift: value => { currentGift = value; }, restart: () => { controller = create(); } };
}

test('opening, greeting and gratitude alone never trigger an invitation', t => {
  const f = fixture(t);
  for (const message of ['', 'Oi', 'Obrigada!', 'Entendi']) assert.equal(f.call(message), null);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM site_assistant_gift_invitations').get().n, 0);
});

test('contextual plant help followed by gratitude offers the real guide only once', t => {
  const f = fixture(t);
  assert.equal(f.call('Como cuidar da zamioculca?'), null);
  const result = f.call('Obrigada, me ajudou!');
  assert.ok(result); assert.ok(result.reply.includes(gift.title));
  assert.match(result.reply, /gratuitamente/); assert.match(result.reply, /formulário aqui na conversa/);
  assert.match(result.reply, /sem obrigação de comprar ou receber promoções/);
  assert.deepEqual(result.offers, []); assert.equal(result.contactOffer, null);
  assert.deepEqual(result.actions, [{ label: 'Receber guia gratuito', url: '/presente.html?guia=zamioculca', kind: 'internal', assetType: 'navigation', assetId: 'gift:zamioculca' }]);
  assert.doesNotMatch(result.reply, /enviado|liberado|confirmado|informe|senha|telefone|seu nome/);
  f.restart();
  for (let i = 0; i < 10; i++) assert.equal(f.call('Obrigada!'), null);
});

test('unanswered questions and unavailable answers do not count as previous help', t => {
  const f = fixture(t);
  for (const reply of ['Qual planta você cultiva?', 'Não encontrei orientações para essa planta.']) {
    assert.equal(f.call('Preciso de ajuda com plantas', plants, reply), null);
    assert.equal(f.call('Obrigada!'), null);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM site_assistant_gift_invitations').get().n, 0);
});

test('new doubt or negative feedback is not gratitude for an automatic gift', t => {
  const f = fixture(t); f.call('Como cuidar da zamioculca?');
  for (const message of ['Obrigada, mas ainda tenho dúvida', 'Não me ajudou', 'Obrigada, como faço a rega?']) assert.equal(f.call(message), null);
  assert.equal(f.db.prepare('SELECT invited_ms FROM site_assistant_gift_invitations').get().invited_ms, null);
});

test('explicit free gift requests can open immediately and can reopen the form later', t => {
  const f = fixture(t);
  for (const message of ['Quero um presente', 'Tem guia gratuito?', 'Como posso receber o guia da zamioculca?', 'Quero abrir o guia']) assert.ok(f.call(message));
  assert.equal(f.call('Obrigada!'), null);
});

test('explicit gift request remains available when a purchase was declined', t => {
  const f = fixture(t);
  assert.equal(f.call('Não quero comprar'), null);
  const result = f.call('Não quero comprar, só quero o guia grátis');
  assert.ok(result); assert.deepEqual(result.offers, []); assert.equal(result.contactOffer, null);
  assert.equal(f.db.prepare('SELECT declined_ms FROM site_assistant_gift_invitations').get().declined_ms, null);
});

test('gift refusal blocks automatic invitations until a new explicit request', t => {
  const f = fixture(t);
  f.call('Como cuidar das plantas?'); f.call('Não quero o presente');
  assert.equal(f.call('Obrigada!'), null);
  assert.equal(f.call('Não quero o guia gratuito, obrigada'), null);
  f.restart(); assert.equal(f.call('Obrigada!'), null);
  assert.ok(f.call('Agora quero receber o guia gratuito'));
  assert.equal(f.call('Obrigada!'), null);
});

test('natural refusal variants persist and contextual plant pronouns can follow real help', t => {
  const f = fixture(t);
  for (const [index, decline] of ['Agora não, obrigada', 'Não, obrigado, já tenho o livro', 'Não aceito presentes', 'Não quero mais o guia'].entries()) {
    const session = 'refusal-' + index;
    f.call('Como cuido dela?', plants, help, session);
    assert.equal(f.call(decline, plants, help, session), null);
    assert.equal(f.call('Obrigada!', plants, help, session), null);
    assert.ok(f.call('Quero o guia gratuito', plants, help, session));
  }
  f.call('Como cuido dela?'); assert.ok(f.call('Obrigada!'));
});

test('recipes, unrelated requests and prayer never receive an automatic plant guide', t => {
  const f = fixture(t); f.call('Como cuidar das plantas?');
  assert.equal(f.call('Obrigada!', recipe), null);
  for (const message of ['Quero um guia gratuito de receitas', 'Tem livro grátis de programação?', 'Quero presente']) {
    assert.equal(f.call(message, { kind: 'prayer', group: 'prayer' }), null);
  }
  assert.equal(f.call('Quero um guia gratuito de receitas', plants), null);
  assert.equal(f.call('Tem livro grátis de programação?', plants), null);
  assert.equal(f.call('Quero um presente', recipe), null);
  assert.ok(f.call('Quero o guia gratuito da zamioculca', recipe));
});

test('unavailable, wrong, paid, malformed and failing catalogs suppress the offer', t => {
  const f = fixture(t);
  for (const value of [null, { ...gift, available: false }, { ...gift, id: 'receitas' }, { ...gift, topic: 'recipes' }, { ...gift, amountCents: 500 }, { ...gift, title: ' ' }, () => { throw Error('offline'); }]) {
    f.setGift(value); assert.equal(f.call('Quero o guia gratuito'), null);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM site_assistant_gift_invitations').get().n, 0);
  f.setGift(gift); assert.equal(f.call('Obrigada!'), null);
});

test('catalog URLs cannot change the fixed first-party form and title becomes plain text', t => {
  const f = fixture(t); f.setGift({ ...gift, title: '<b>Guia da zamioculca</b>\n em casa', path: 'https://evil.test', url: 'javascript:alert(1)' });
  const result = f.call('Quero o guia grátis');
  assert.match(result.reply, /Guia da zamioculca em casa/); assert.doesNotMatch(result.reply, /<|evil/);
  assert.equal(result.actions[0].url, '/presente.html?guia=zamioculca');
});

test('state is isolated by session, expires at 24 hours and contains no conversation data', t => {
  const f = fixture(t); f.call('Não quero o presente');
  assert.ok(f.call('Quero guia gratuito', plants, help, 'session-b'));
  f.tick(DAY - 1); assert.equal(f.call('Obrigada!'), null);
  f.tick(1); assert.equal(f.call('Obrigada!'), null);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM site_assistant_gift_invitations').get().n, 0);
  f.call('Como cuidar das plantas?'); assert.ok(f.call('Obrigada!'));
  assert.deepEqual(f.db.prepare('PRAGMA table_info(site_assistant_gift_invitations)').all().map(row => row.name), ['session_id', 'helped_ms', 'invited_ms', 'declined_ms', 'expires_ms']);
});

test('caller rollback preserves invitation eligibility and does not mutate the original result', t => {
  const f = fixture(t); f.call('Como cuidar das plantas?');
  const nav = { actions: [{ url: '/produto/2/adubo' }], contactOffer: { type: 'old' } };
  assert.throws(f.db.transaction(() => { assert.ok(f.call('Obrigada!', plants, help, 'session-a', nav)); throw Error('history insert failed'); }));
  assert.deepEqual(nav, { actions: [{ url: '/produto/2/adubo' }], contactOffer: { type: 'old' } });
  assert.ok(f.call('Obrigada!'));
});
