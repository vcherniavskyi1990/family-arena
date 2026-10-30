import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/engine/rng.js';
import { createBattle, fighterFromPlayer, fighterFromMob, submitMove, resolveRound, handicap } from '../src/engine/combat.js';
import { starterDeck, CARDS, CLASSES, MOBS, DUNGEONS, cardById, mobById } from '../src/engine/content.js';

const player = (id, cls, extra = {}) => ({ id, name: id, class: cls, level: 1, deck: starterDeck(cls), ...extra });

test('контент цілісний: карти класів, моби підземель', () => {
  for (const c of CARDS) assert.ok(c.class === 'all' || CLASSES.some(k => k.id === c.class), c.id);
  for (const d of DUNGEONS) { for (const r of d.rooms) for (const m of r) assert.ok(mobById[m], m); assert.ok(mobById[d.boss] && mobById[d.boss].boss, d.boss); }
  for (const k of CLASSES) assert.equal(starterDeck(k.id).length, 12, k.id);
});

test('дуель детермінована за зерном і завершується', () => {
  const run = () => {
    const rng = makeRng(7);
    const b = createBattle({ teams: [[fighterFromPlayer(player('a', 'warrior'), rng)], [fighterFromPlayer(player('b', 'mage'), rng)]], seed: 7, mode: 'duel' });
    while (!b.over) resolveRound(b);
    return [b.winner, b.round, b.fighters.map(f => f.hp)];
  };
  assert.deepEqual(run(), run());
  assert.ok(run()[1] < 40);
});

test('блок зони зупиняє удар, карта з pierce ні', () => {
  const rng = makeRng(3);
  const a = fighterFromPlayer(player('a', 'warrior'), rng);
  const d = fighterFromPlayer(player('d', 'warrior'), rng);
  const b = createBattle({ teams: [[a], [d]], seed: 3 });
  a.hand = ['netherite_axe']; a.mana = 20; a.crit = 0; d.crit = 0; a.dodge = 0; d.dodge = 0;
  assert.equal(submitMove(b, 'a', { target: 'd', attack: 'head', blocks: ['head', 'chest'], cards: ['netherite_axe'] }), null);
  assert.equal(submitMove(b, 'd', { target: 'a', attack: 'head', blocks: ['head', 'chest'], cards: [] }), null);
  const ev = resolveRound(b);
  assert.ok(ev.some(e => e.t === 'block' && e.who === 'a'), 'удар d у голову заблоковано');
  assert.ok(ev.some(e => e.t === 'block' && e.who === 'd'), 'удар a у голову заблоковано');
  assert.ok(ev.some(e => e.t === 'dmg' && e.who === 'd' && e.card === 'netherite_axe'), 'сокира пройшла крізь блок');
});

test('хід перевіряється: мана, карти в руці', () => {
  const rng = makeRng(1);
  const a = fighterFromPlayer(player('a', 'mage'), rng);
  const b = createBattle({ teams: [[a], [fighterFromMob('zombie', 0)]], seed: 1 });
  a.hand = ['fireball', 'fireball']; a.mana = 5;
  assert.match(submitMove(b, 'a', { cards: ['fireball'] }), /мани/);
  a.mana = 6;
  assert.match(submitMove(b, 'a', { cards: ['lightning'] }), /немає в руці/);
  assert.equal(submitMove(b, 'a', { cards: ['fireball'] }), null);
});

test('відсутній хід робиться автоматично, мана росте, рука добирається', () => {
  const rng = makeRng(5);
  const a = fighterFromPlayer(player('a', 'archer'), rng);
  const b = createBattle({ teams: [[a], [fighterFromMob('slime', 0)]], seed: 5 });
  assert.equal(a.mana, 2);
  resolveRound(b);
  assert.equal(a.mana >= 1, true);
  assert.ok(a.hand.length >= 3 && a.hand.length <= 4, 'рука до 4');
});

test('бос лютує на половині здоров’я, а крипер вибухає', () => {
  const rng = makeRng(9);
  const boss = fighterFromMob('boss_ravager', 0);
  const a = fighterFromPlayer(player('a', 'warrior'), rng);
  const b = createBattle({ teams: [[a], [boss]], seed: 9 });
  boss.hp = Math.floor(boss.maxHp * 0.45); resolveRound(b);
  assert.equal(boss.raged, true);
  const c = fighterFromMob('creeper', 0); c.hp = 1;
  const p = fighterFromPlayer(player('p', 'warrior'), rng); p.crit = 0;
  const b2 = createBattle({ teams: [[p], [c]], seed: 9 });
  submitMove(b2, 'p', { attack: 'chest', blocks: ['head', 'legs'], cards: [] });
  submitMove(b2, c.id, { attack: 'legs', blocks: ['head', 'legs'], cards: [] });
  const ev = resolveRound(b2);
  assert.ok(ev.some(e => e.t === 'dmg' && e.kind === 'explode'));
});

test('гандикап за віком: молодшому більше здоров’я', () => {
  assert.ok(handicap(7).hp > handicap(10).hp && handicap(10).hp > handicap(40).hp);
  const rng = makeRng(2);
  const kid = fighterFromPlayer(player('k', 'warrior', { age: 7 }), rng);
  const dad = fighterFromPlayer(player('d', 'warrior', { age: 40 }), rng);
  assert.ok(kid.maxHp > dad.maxHp);
});

test('усі карти зіграються без помилок', () => {
  for (const c of CARDS) {
    const rng = makeRng(11);
    const a = fighterFromPlayer(player('a', c.class === 'all' ? 'warrior' : c.class), rng);
    const b = createBattle({ teams: [[a], [fighterFromMob('zombie', 0), fighterFromMob('skeleton', 1)]], seed: 11 });
    a.hand = [c.id]; a.mana = 20;
    assert.equal(submitMove(b, 'a', { cards: [c.id] }), null, c.id);
    resolveRound(b);
    assert.ok(b.log[0].some(e => e.t === 'card' && e.card === c.id), c.id);
  }
});
