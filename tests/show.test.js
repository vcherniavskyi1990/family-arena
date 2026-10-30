// v0.56: читабельний бій. Удари йдуть двома хвилями (герої, потім монстри), кожна подія несе тривалість показу `ms`,
// карта на ворога знає ціль, а раунд на сервері чекає рівно стільки, скільки грає ТБ.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/engine/rng.js';
import { createBattle, fighterFromPlayer, fighterFromMob, resolveRound, submitMove } from '../src/engine/combat.js';
import { starterDeck, cardById } from '../src/engine/content.js';
import { showMs, showTotal, SHOW_CAP_MS } from '../src/engine/show.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { Game } from '../src/game.js';
const makeGame = () => { let now = Date.UTC(2026, 9, 26, 15, 0); const g = new Game({ store: new Store(mkdtempSync(join(tmpdir(), 'arena-'))), now: () => now, realTimers: false, seed: 11 }); g.advance = (ms) => { now += ms; }; return g; };

const player = (id, cls) => ({ id, name: id, class: cls, level: 1, deck: starterDeck(cls) });

test('удари двома хвилями: спершу всі герої, потім усі монстри, прислужники окремо', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rng = makeRng(seed);
    const b = createBattle({ teams: [[fighterFromPlayer(player('a', 'warrior'), rng), fighterFromPlayer(player('b', 'rogue'), rng)], [fighterFromMob('zombie', 0), fighterFromMob('zombie', 1)]], seed });
    const ev = resolveRound(b);
    const waves = ev.map((e, i) => e.t === 'wave' ? i : -1).filter(i => i >= 0);
    assert.ok(waves.length >= 2, 'є дві хвилі');
    assert.equal(ev[waves[0]].team, 0); assert.equal(ev[waves[1]].team, 1);
    const teamOf = (id) => (b.fighters.find(f => f.id === id) || {}).team;
    ev.forEach((e, i) => {
      if (e.t !== 'dmg' || e.kind !== 'hit') return;
      const wave = i > waves[1] ? 1 : 0;
      assert.equal(teamOf(e.by), wave, `удар ${e.by} у хвилі ${wave}`);
    });
    const blocks = ev.map((e, i) => e.t === 'block' ? [i, teamOf(e.by)] : null).filter(Boolean);
    for (const [i, team] of blocks) assert.equal(i > waves[1] ? 1 : 0, team);
  }
});

test('карта на ворога несе ціль, масова карта позначена aoe', () => {
  const rng = makeRng(7);
  const a = fighterFromPlayer(player('a', 'mage'), rng); a.mana = 10; a.hand = ['fireball', 'arcane_blast'];
  const b = createBattle({ teams: [[a], [fighterFromMob('zombie', 0), fighterFromMob('zombie', 1)]], seed: 7 });
  assert.equal(submitMove(b, 'a', { target: 'zombie#1', attack: 'head', blocks: ['chest', 'legs'], cards: ['fireball', 'arcane_blast'] }), null);
  const ev = resolveRound(b);
  const fb = ev.find(e => e.t === 'card' && e.card === 'fireball'); assert.equal(fb.target, 'zombie#1'); assert.equal(fb.aoe, false);
  const ab = ev.find(e => e.t === 'card' && e.card === 'arcane_blast'); assert.equal(ab.aoe, !!cardById.arcane_blast.aoe);
  const hit = ev.find(e => e.t === 'dmg' && e.card === 'fireball'); assert.ok(hit, 'шкода від карти позначена картою');
});

test('тривалість показу: кожна подія має ms, сума обмежена стелею', () => {
  assert.ok(showMs({ t: 'dmg', kind: 'hit' }) >= 1200, 'удар не коротший за 1,2 с');
  assert.ok(showMs({ t: 'dmg', kind: 'hit', crit: true }) > showMs({ t: 'dmg', kind: 'hit' }));
  assert.ok(showMs({ t: 'death', boss: true }) > showMs({ t: 'death' }));
  assert.equal(showTotal(Array.from({ length: 100 }, () => ({ t: 'dmg', kind: 'hit' }))), SHOW_CAP_MS);
  assert.ok(showTotal([]) < 1000);
});

test('у грі події раунду мають ms, імена цілі й карти, а наступний раунд чекає показ на ТБ', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'mage', age: 40, pin: '1234', role: 'admin' });
  const kid = g.createPlayer({ name: 'Малий', classId: 'warrior', age: 9, pin: '1111' });
  g.setMode(dad, { mode: 'dungeon' }); g.join(dad); g.join(kid); g.ready(dad, true); g.ready(kid, true);
  g.tvOnline = () => true;
  const f = g.battle.fighters.find(x => x.id === dad.id); f.mana = 5; f.hand = ['fireball', 'magic_missile'];
  const en = g.battle.fighters.find(x => x.team === 1);
  g.move(dad, { target: en.id, attack: 'head', blocks: ['chest', 'legs'], cards: ['fireball'] });
  g.fire('round');
  const ev = g.lastRound.events;
  assert.ok(ev.every(e => e.ms > 0), 'усі події мають ms');
  const card = ev.find(e => e.t === 'card' && e.card === 'fireball'); assert.equal(card.targetName, en.name);
  const dmg = ev.find(e => e.t === 'dmg' && e.card === 'fireball'); if (dmg) assert.equal(dmg.cardName, 'Вогняна куля');
  assert.ok(ev.some(e => e.t === 'wave'));
  const wait = g.pending.round && g.pending.round.ms;
  assert.equal(wait, showTotal(ev), 'таймер наступного раунду = тривалість показу');
});
