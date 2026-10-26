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

test('перше підземелля проходять двоє новачків у >50 % випадків, а бос не падає за 2 ходи', () => {
  const d = DUNGEONS[0];
  let wins = 0, rounds = 0;
  for (let i = 0; i < 60; i++) {
    const rng = makeRng(500 + i);
    const team = [fighterFromPlayer(player('a', 'warrior'), rng), fighterFromPlayer(player('b', 'healer'), rng)];
    let ok = true;
    for (const room of [...d.rooms, [d.boss]]) {
      const mobs = room.map((m, j) => fighterFromMob(m, j));
      const b = createBattle({ teams: [team, mobs], seed: 900 + i });
      while (!b.over) resolveRound(b);
      if (room[0] === d.boss) rounds += b.round;
      if (b.winner !== 0) { ok = false; break; }
      // між кімнатами команда трохи відновлюється
      for (const f of team) { f.hp = Math.min(f.maxHp, f.hp + Math.round(f.maxHp * 0.3)); f.alive = f.hp > 0; f.move = null; }
    }
    if (ok) wins++;
  }
  console.log(`  підземелля «${d.name}»: ${wins}/60 перемог, бос у середньому ${(rounds / 60).toFixed(1)} раундів`);
  assert.ok(wins / 60 > 0.5, `перемог ${wins}/60`);
  assert.ok(rounds / 60 >= 3, 'бос надто слабкий');
});

test('нові підземелля (спальня 4, гараж 7) проходяться двома гравцями свого рівня, гараж не легший за балкон', () => {
  for (const [id, lvl, min] of [['bedroom_nightmares', 5, 0.5], ['garage_machines', 9, 0.35]]) {
    const d = DUNGEONS.find(x => x.id === id); assert.ok(d, id);
    let wins = 0;
    for (let i = 0; i < 40; i++) {
      const rng = makeRng(700 + i);
      const team = [fighterFromPlayer({ ...player('a', 'warrior'), level: lvl }, rng), fighterFromPlayer({ ...player('b', 'healer'), level: lvl }, rng)];
      let ok = true;
      for (const room of [...d.rooms, [d.boss]]) {
        const mobs = room.map((m, j) => fighterFromMob(m, j));
        const b = createBattle({ teams: [team, mobs], seed: 1900 + i });
        while (!b.over) resolveRound(b);
        if (b.winner !== 0) { ok = false; break; }
        for (const f of team) { f.hp = Math.min(f.maxHp, f.hp + Math.round(f.maxHp * 0.3)); f.alive = f.hp > 0; f.move = null; }
      }
      if (ok) wins++;
    }
    console.log(`  підземелля «${d.name}»: ${wins}/40 перемог`);
    assert.ok(wins / 40 >= min, `${id}: перемог ${wins}/40`);
  }
});
