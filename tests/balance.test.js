// Баланс перевіряється симуляцією ботів, не руками: кожен клас у дуелі перемагає 35–65 %,
// підземелля 1 рівня проходить команда з 2 новачків частіше, ніж програє.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/engine/rng.js';
import { createBattle, fighterFromPlayer, fighterFromMob, resolveRound } from '../src/engine/combat.js';
import { starterDeck, CLASSES, DUNGEONS } from '../src/engine/content.js';

const player = (id, cls, lvl = 1) => ({ id, name: id, class: cls, level: lvl, deck: starterDeck(cls) });
const N = 300;

test('дуелі класів збалансовані (35–65 % перемог)', () => {
  const wins = Object.fromEntries(CLASSES.map(c => [c.id, 0]));
  const games = Object.fromEntries(CLASSES.map(c => [c.id, 0]));
  let seed = 100;
  for (let i = 0; i < N; i++) {
    for (const a of CLASSES) for (const d of CLASSES) {
      if (a.id === d.id) continue;
      const rng = makeRng(seed++);
      const b = createBattle({ teams: [[fighterFromPlayer(player('a', a.id), rng)], [fighterFromPlayer(player('d', d.id), rng)]], seed: seed++ , mode: 'duel' });
      while (!b.over) resolveRound(b);
      games[a.id]++; games[d.id]++;
      wins[b.winner === 0 ? a.id : d.id]++;
      if (i >= N / 10) break;
    }
    if (i >= N / 10) break;
  }
  const report = CLASSES.map(c => `${c.id}: ${(100 * wins[c.id] / games[c.id]).toFixed(0)}%`).join(', ');
  console.log('  дуелі:', report);
  for (const c of CLASSES) {
    const r = wins[c.id] / games[c.id];
    assert.ok(r >= 0.35 && r <= 0.65, `${c.id} виграє ${(r * 100).toFixed(0)}%`);
  }
});

const bonusGear = { atk: 4, def: 2, hp: 20, mana: 0, crit: 0.02 };   // ≈ 2 предмети незвичайної якості
function runDungeon(id, lvl, bonus, n = 60) {
  const d = DUNGEONS.find(x => x.id === id); assert.ok(d, id);
  let wins = 0, bossRounds = 0;
  for (let i = 0; i < n; i++) {
    const rng = makeRng(500 + i);
    const team = [fighterFromPlayer({ ...player('a', 'warrior', lvl), bonus }, rng), fighterFromPlayer({ ...player('b', 'healer', lvl), bonus }, rng)];
    let ok = true;
    for (const room of [...d.rooms, [d.boss]]) {
      const mobs = room.map((m, j) => fighterFromMob(m, j, room[0] === d.boss ? 1.1 : 1));
      const b = createBattle({ teams: [team, mobs], seed: 900 + i });
      while (!b.over) resolveRound(b);
      if (room[0] === d.boss) bossRounds += b.round;
      if (b.winner !== 0) { ok = false; break; }
      // між кімнатами команда трохи відновлюється
      for (const f of team) { f.hp = Math.min(f.maxHp, f.hp + Math.round(f.maxHp * 0.3)); f.alive = f.hp > 0; f.move = null; f.shield = 0; f.buffs = []; f.effects = {}; f.minions = []; }
    }
    if (ok) wins++;
  }
  const r = { wins: wins / n, bossRounds: bossRounds / n };
  console.log(`  «${d.name}» lvl${lvl}${bonus ? '+спорядження' : ''}: ${(100 * r.wins).toFixed(0)} % перемог, бос ${r.bossRounds.toFixed(1)} раундів`);
  return r;
}

// Складність (рішення Віктора 30.10: «перемагати має коштувати зусиль, або доки не станеш сильнішим чи не вдінеш шмотку»):
// двоє новачків без спорядження проходять перше підземелля приблизно в половині спроб, зі спорядженням і +2 рівні майже завжди;
// підземелля свого рівня без спорядження дають 15–60 %, бос падає за 4–12 раундів (щоб показ на ТБ не тягнувся).
test('перше підземелля: двоє новачків ≈50 %, зі спорядженням ≥85 %, бос 4–8 раундів', () => {
  const fresh = runDungeon('kitchen_caves', 1);
  assert.ok(fresh.wins >= 0.4 && fresh.wins <= 0.72, `новачки: ${(100 * fresh.wins).toFixed(0)} %`);
  assert.ok(fresh.bossRounds >= 4 && fresh.bossRounds <= 8, 'бос: ' + fresh.bossRounds);
  const geared = runDungeon('kitchen_caves', 3, bonusGear);
  assert.ok(geared.wins >= 0.85, `зі спорядженням: ${(100 * geared.wins).toFixed(0)} %`);
  assert.ok(geared.wins - fresh.wins >= 0.2, 'спорядження має відчуватись');
});

test('підземелля свого рівня без спорядження: 10–85 % перемог, боси ≤ 12 раундів', () => {
  for (const [id, lvl] of [['lego_castle', 2], ['wardrobe_shadows', 3], ['bedroom_nightmares', 5], ['dad_office', 7], ['garage_machines', 9], ['balcony_citadel', 10]]) {
    const r = runDungeon(id, lvl, undefined, 40);
    assert.ok(r.wins >= 0.1 && r.wins <= 0.85, `${id}: перемог ${(100 * r.wins).toFixed(0)} %`);   // пізні підземелля без спорядження лишаються стіною
    assert.ok(r.bossRounds <= 12, `${id}: бос ${r.bossRounds} раундів`);
  }
});
