import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { Game } from '../src/game.js';

function makeGame(ts = Date.UTC(2026, 9, 26, 15, 0)) { // 18:00 Київ, понеділок
  let now = ts;
  const g = new Game({ store: new Store(mkdtempSync(join(tmpdir(), 'arena-'))), now: () => now, realTimers: false });
  g.advance = (ms) => { now += ms; };
  return g;
}

test('гравці: створення, вхід за PIN, токен', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'admin' });
  assert.throws(() => g.createPlayer({ name: 'тато', classId: 'mage', pin: '0000' }), /вже є/);
  assert.throws(() => g.createPlayer({ name: 'X', classId: 'mage', pin: '12' }), /PIN/);
  assert.throws(() => g.login(dad.id, '9999'), /PIN/);
  const tok = g.login(dad.id, '1234');
  assert.equal(g.auth(tok).id, dad.id);
  assert.equal(g.players[dad.id].deck.length, 20);
});

test('дуель від лобі до результатів', () => {
  const g = makeGame();
  const a = g.createPlayer({ name: 'Віктор', classId: 'warrior', age: 10, pin: '1111' });
  const b = g.createPlayer({ name: 'Олександр', classId: 'mage', age: 7, pin: '2222' });
  g.setMode(a, { mode: 'duel' });
  g.join(a); g.join(b);
  assert.equal(g.lobbyView().players.length, 2);
  g.ready(a, true); g.ready(b, true);
  assert.ok(g.battle, 'бій почався');
  assert.equal(g.tvState().phase, 'battle');
  let guard = 0;
  while (g.battle && guard++ < 200) {
    const st = g.playerState(a);
    assert.ok(st.battle.me.hand.length >= 1);
    g.move(a, { attack: 'head', blocks: ['chest', 'belt'], cards: [] });
    if (g.battle && !g.battle.over) g.fire('round'); // другий гравець не встиг: автохід по таймеру
    if (g.battle) g.fire('round'); // анімація → наступний раунд або підсумки
  }
  assert.ok(g.results && g.results.mode === 'duel');
  assert.equal(g.tvState().phase, 'results');
  assert.equal(g.players[a.id].stats.duels, 1);
  assert.ok(g.players[a.id].xp + g.players[b.id].xp >= 55);
  g.fire('results');
  assert.equal(g.tvState().phase, 'idle');
});

test('підземелля: кімнати, бос, лут і досвід', () => {
  const g = makeGame();
  const a = g.createPlayer({ name: 'A', classId: 'warrior', age: 40, pin: '1111', role: 'parent' });
  const b = g.createPlayer({ name: 'B', classId: 'healer', age: 10, pin: '2222' });
  g.players[a.id].level = 5; g.players[b.id].level = 5;
  g.setMode(a, { mode: 'dungeon', dungeonId: 'kitchen_caves' });
  g.join(a); g.join(b); g.ready(a, true); g.ready(b, true);
  assert.equal(g.battle.meta.room, 1);
  let guard = 0;
  while (g.battle && guard++ < 400) { g.fire('round'); }
  assert.ok(g.results, 'є підсумки');
  assert.equal(g.results.mode, 'dungeon');
  if (g.results.won) {
    assert.ok(g.results.loot.some(l => l.guaranteed), 'бос дав предмет кожному');
    assert.ok(g.players[a.id].inventory.length >= 1);
    assert.equal(g.players[a.id].stats.bossKills, 1);
  }
  assert.ok(g.players[b.id].playedToday.minutes >= 1);
});

test('ліміти: після 21:30 дитина не заходить, батько заходить; справа повертає 10 хв', () => {
  const g = makeGame(Date.UTC(2026, 9, 26, 19, 45)); // 22:45 Київ (UTC+3 у жовтні? ні, UTC+2 після 25.10) → 21:45
  const kid = g.createPlayer({ name: 'K', classId: 'rogue', age: 7, pin: '1111' });
  const dad = g.createPlayer({ name: 'D', classId: 'rogue', age: 40, pin: '1111', role: 'parent' });
  assert.match(g.blockedReason(kid) || '', /Пізно/);
  assert.equal(g.blockedReason(dad), null);
  assert.throws(() => g.join(kid), /Пізно/);
  const g2 = makeGame();
  const k2 = g2.createPlayer({ name: 'K', classId: 'rogue', age: 7, pin: '1111' });
  const d2 = g2.createPlayer({ name: 'D', classId: 'rogue', age: 40, pin: '1111', role: 'parent' });
  g2.addMinutes(k2, 45);
  assert.match(g2.blockedReason(k2), /Ліміт/);
  g2.questDone(k2, 'bed');
  assert.equal(g2.pendingQuests().length, 1);
  assert.throws(() => g2.questApprove(k2, k2.id, 'bed'), /батьки/);
  const r = g2.questApprove(d2, k2.id, 'bed');
  assert.ok(r.item && r.gold === 10);
  assert.equal(g2.blockedReason(k2), null, '10 хв повернулось');
  assert.throws(() => g2.questDone(k2, 'bed'), /зараховано/);
});

test('пауза на тривогу зупиняє таймер раунду', () => {
  const g = makeGame();
  const a = g.createPlayer({ name: 'A', classId: 'warrior', age: 40, pin: '1111', role: 'parent' });
  g.join(a); g.ready(a, true);
  assert.ok(g.roundEnds);
  g.setPaused(true, 'alert');
  assert.equal(g.roundEnds, null);
  assert.equal(g.battle.round, 0);
  g.setPaused(false);
  assert.ok(g.roundEnds);
});

test('магазин, продаж, зміна колоди', () => {
  const g = makeGame();
  const a = g.createPlayer({ name: 'A', classId: 'archer', age: 10, pin: '1111' });
  assert.throws(() => g.buyChest(a, 'rare'), /золота/);
  const it = g.buyChest(a, 'common');
  assert.ok(a.inventory.some(i => i.id === it.id));
  const gold = a.gold; g.sell(a, it.id);
  assert.ok(a.gold > gold);
  assert.throws(() => g.setDeck(a, []), /20/);
});
