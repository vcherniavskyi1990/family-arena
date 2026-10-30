// Фаз-тест: випадкові дії гравців багато разів поспіль. Падати може лише помилкою гри (err зі status), не винятком.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { Game } from '../src/game.js';
import { makeRng } from '../src/engine/rng.js';
import { DUNGEONS, ZONES } from '../src/engine/content.js';

test('1500 випадкових дій: жодного винятку, стан цілісний і серіалізується', () => {
  let now = Date.UTC(2026, 9, 24, 10, 0); // субота
  const g = new Game({ store: new Store(mkdtempSync(join(tmpdir(), 'soak-'))), now: () => now, realTimers: false, seed: 7 });
  g.updateSettings({ raidAnyDay: true });
  const rng = makeRng(2026);
  const dad = g.createPlayer({ name: 'Тато', classId: 'paladin', age: 40, pin: '1234', role: 'admin' });
  const ps = [dad, g.createPlayer({ name: 'Віктор', classId: 'engineer', age: 10, pin: '1111' }), g.createPlayer({ name: 'Олександр', classId: 'mage', age: 7, pin: '2222' }), g.createPlayer({ name: 'Мама', classId: 'healer', age: 38, pin: '3333', role: 'parent' })];
  let gameErrors = 0, battles = 0;
  const safe = (fn) => { try { fn(); } catch (e) { if (!e.status) throw e; gameErrors++; } };
  for (let i = 0; i < 1500 || (g.history.battles.length < 3 && i < 8000); i++) {
    const p = rng.pick(ps); const P = g.players[p.id];
    const action = g.battle ? rng.pick([4, 4, 4, 5, 5, 5, 11, 12, 6]) : (rng.chance(0.4) ? rng.pick([1, 1, 2, 2, 0]) : rng.int(0, 14));
    safe(() => {
      switch (action) {
        case 0: g.setMode(p, { mode: rng.chance(0.5) ? 'duel' : 'dungeon', dungeonId: rng.pick(DUNGEONS).id }); break;
        case 1: g.join(p); break;
        case 2: g.ready(p, true); break;
        case 3: g.setTeam(p, rng.int(0, 1)); break;
        case 4: if (g.battle) { const f = g.battle.fighters.find(x => x.id === p.id); const cards = f && f.hand.length && rng.chance(0.7) ? [f.hand[0]] : []; g.move(p, { attack: rng.pick(ZONES), blocks: [rng.pick(ZONES), rng.pick(ZONES)], cards, quiz: f && f.quiz ? (rng.chance(0.5) ? f.quiz.a : 'x') : undefined }); } break;
        case 5: g.fire('round'); g.fire('round'); break;
        case 6: if (P.inventory.length) g.equip(p, rng.pick(P.inventory).id); break;
        case 7: g.buyChest(p, rng.chance(0.5) ? 'common' : 'rare'); break;
        case 8: if (P.inventory.length >= 3) g.craft(p, P.inventory.slice(0, 3).map(x => x.id)); break;
        case 9: g.questDone(p, 'bed'); break;
        case 10: g.questApprove(dad, p.id, 'bed', rng.chance(0.8)); break;
        case 11: g.dmAction(dad, { kind: rng.pick(['spawn', 'heal', 'rage', 'treasure', 'say']), mobId: 'zombie', playerId: p.id, text: 'йо' }); break;
        case 12: g.setPaused(rng.chance(0.3), 'manual'); if (g.paused) g.setPaused(false); break;
        case 13: if (rng.chance(0.3)) g.endSeason(dad, 'Новий'); else g.startReplay(dad); g.fire('replay'); g.stopReplay(); break;
        case 14: now += rng.int(1, 6) * 3600 * 1000; g.fire('results'); break;
      }
    });
    // інваріанти
    for (const q of ps) { const Q = g.players[q.id]; assert.ok(Q.gold >= 0, 'золото не від’ємне'); assert.equal(Q.deck.length, 12); assert.ok(Q.level >= 1 && Q.level <= 20); }
    if (g.battle) for (const f of g.battle.fighters) assert.ok(f.hp >= 0 && f.hp <= f.maxHp + 1, `hp ${f.hp}/${f.maxHp}`);
    JSON.stringify(g.tvState()); for (const q of ps) JSON.stringify(g.playerState(g.players[q.id]));
  }
  battles = g.history.battles.length;
  console.log(`  soak: ${battles} боїв, ${gameErrors} ігрових відмов`);
  assert.ok(battles >= 3, 'бої відбувались');
});
