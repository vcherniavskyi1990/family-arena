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

test('2×2: дві команди по двоє, бій іде до кінця', () => {
  const g = makeGame();
  const ps = [['Тато', 'warrior', 40, 'admin'], ['Віктор', 'archer', 10, 'kid'], ['Мама', 'healer', 38, 'parent'], ['Олександр', 'mage', 7, 'kid']]
    .map(([name, classId, age, role], i) => g.createPlayer({ name, classId, age, pin: '111' + i, role }));
  g.setMode(ps[0], { mode: 'duel' });
  for (const p of ps) g.join(p);
  g.setTeam(ps[0], 0); g.setTeam(ps[1], 0); g.setTeam(ps[2], 1); g.setTeam(ps[3], 1);
  for (const p of ps) g.ready(p, true);
  assert.ok(g.battle);
  assert.deepEqual(g.battle.fighters.map(f => f.team), [0, 0, 1, 1]);
  let guard = 0;
  while (g.battle && guard++ < 300) { g.fire('round'); }
  assert.equal(g.results.mode, 'duel');
  assert.equal(g.results.winners.length, 2);
  assert.ok(g.history.lastReplay.frames.length >= 2, 'повтор записано');
});

test('розумні карти: правильна відповідь підсилює удар, неправильна ні', () => {
  const g = makeGame();
  const a = g.createPlayer({ name: 'Віктор', classId: 'warrior', age: 10, pin: '1111' });
  const b = g.createPlayer({ name: 'Олександр', classId: 'mage', age: 7, pin: '2222' });
  g.setMode(a, { mode: 'duel' }); g.join(a); g.join(b); g.ready(a, true); g.ready(b, true);
  const st = g.playerState(a);
  assert.ok(st.battle.me.quiz && st.battle.me.quiz.choices.length === 3, 'є питання');
  const fa = g.battle.fighters.find(f => f.id === a.id);
  const right = fa.quiz.a;
  g.move(a, { attack: 'head', blocks: ['chest', 'belt'], cards: [], quiz: right });
  assert.equal(fa.move.smart, true);
  assert.equal(g.players[a.id].stats.smart, 1);
  const fb = g.battle.fighters.find(f => f.id === b.id);
  g.move(b, { attack: 'head', blocks: ['chest', 'belt'], cards: [], quiz: 'не знаю' });
  // після ходу обох раунд уже розіграно
  const ev = g.lastRound.events;
  assert.ok(ev.some(e => e.t === 'smart' && e.who === a.id), 'подія smart для Віктора');
  assert.ok(!ev.some(e => e.t === 'smart' && e.who === b.id));
  assert.equal(g.players[b.id].stats.smart, 0);
  // без розумних карт питання немає
  g.updateSettings({ smartCards: false });
  g.fire('round');
  if (g.battle) assert.equal(g.playerState(a).battle.me.quiz, null);
});

test('сезон: очки за бої, закриття сезону дає чемпіона й титул', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'admin' });
  const a = g.createPlayer({ name: 'Віктор', classId: 'warrior', age: 10, pin: '1111' });
  const b = g.createPlayer({ name: 'Олександр', classId: 'mage', age: 7, pin: '2222' });
  g.setMode(a, { mode: 'duel' }); g.join(a); g.join(b); g.ready(a, true); g.ready(b, true);
  let guard = 0; while (g.battle && guard++ < 300) g.fire('round');
  const v = g.seasonView();
  assert.equal(v.n, 1);
  const pts = v.top.map(p => p.points);
  assert.ok(pts.includes(3) && pts.includes(1), `очки ${pts}`);
  assert.throws(() => g.endSeason(a, 'x'), /батьки/);
  const past = g.endSeason(dad, 'Сезон 2: Зима');
  assert.equal(past.n, 1); assert.ok(past.winner);
  const champ = g.playerList.find(p => p.name === past.winner);
  assert.equal(champ.title, 'Чемпіон сезону 1');
  assert.ok(champ.achievements.includes('season_1'));
  assert.equal(g.seasonView().n, 2);
  assert.equal(g.settings.season, 'Сезон 2: Зима');
  assert.ok(g.seasonView().top.every(p => p.points === 0));
});

test('повтор останнього бою на ТБ: кадри йдуть по таймеру', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'admin' });
  const a = g.createPlayer({ name: 'Віктор', classId: 'archer', age: 10, pin: '1111' });
  assert.throws(() => g.startReplay(dad), /немає бою/);
  g.join(dad); g.join(a); g.ready(dad, true); g.ready(a, true);
  let guard = 0; while (g.battle && guard++ < 400) g.fire('round');
  g.fire('results');
  const n = g.history.lastReplay.frames.length;
  assert.ok(n >= 3);
  g.startReplay(dad);
  const tv = g.tvState();
  assert.equal(tv.phase, 'replay');
  assert.equal(tv.battle.replay, true);
  assert.ok(tv.battle.roomIntro, 'перший кадр: вступ кімнати');
  g.fire('replay');
  assert.equal(g.tvState().battle.round, 1);
  for (let i = 0; i < n; i++) g.fire('replay');
  assert.equal(g.replay, null);
  assert.equal(g.tvState().phase, 'idle');
});

test('рейд: лише у вихідні, мінімум двоє, епічний лут кожному, раз на тиждень', () => {
  const g = makeGame(Date.UTC(2026, 9, 24, 10, 0)); // субота 13:00 Київ
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'admin' });
  const a = g.createPlayer({ name: 'Віктор', classId: 'healer', age: 10, pin: '1111' });
  assert.ok(g.lobbyView().raids.length >= 2);
  g.setMode(dad, { dungeonId: 'raid_titan' });
  g.join(dad); g.ready(dad, true);
  assert.equal(g.battle, null, 'рейд не стартує з одним гравцем');
  g.join(a); g.ready(a, true);
  assert.ok(g.battle, 'рейд почався з двома');
  assert.equal(g.battle.meta.raid, true);
  // бос рейду має кликати підмогу; дамо команді читерські хп, щоб дійти до боса
  let guard = 0, reinforced = false;
  while (g.battle && guard++ < 400) {
    for (const f of g.battle.fighters) if (f.kind === 'player') f.hp = f.maxHp;
    g.fire('round');
    if (g.lastRound && g.lastRound.events.some(e => e.t === 'reinforce')) reinforced = true;
  }
  assert.ok(reinforced, 'бос кликав підмогу');
  assert.equal(g.results.raid, true);
  assert.equal(g.results.won, true);
  const mine = g.results.loot.filter(l => l.pid === a.id && l.item);
  assert.ok(mine.some(l => ['epic', 'legendary'].includes(l.item.rarity)), 'епічний лут');
  assert.equal(g.players[a.id].stats.raids, 1);
  assert.ok(g.players[a.id].achievements.includes('raid_1'));
  g.fire('results');
  assert.throws(() => g.setMode(dad, { dungeonId: 'raid_titan' }), /цього тижня/);
  // понеділок: рейд знову є, але лише у вихідні, доки батьки не дозволять
  g.advance(2 * 24 * 3600 * 1000);
  assert.throws(() => g.setMode(dad, { dungeonId: 'raid_titan' }), /вихідні/);
  g.updateSettings({ raidAnyDay: true });
  g.setMode(dad, { dungeonId: 'raid_titan' });
});

test('тато-ведучий: підмога, зцілення, лють, скарб, слово', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'admin' });
  const a = g.createPlayer({ name: 'Віктор', classId: 'archer', age: 10, pin: '1111' });
  assert.throws(() => g.dmAction(a, { kind: 'heal' }), /батьки/);
  g.dmAction(dad, { kind: 'say', text: 'Увага, зараз буде страшно' });
  assert.equal(g.tvState().announce.text, 'Увага, зараз буде страшно');
  assert.throws(() => g.dmAction(dad, { kind: 'heal' }), /не йде/);
  g.join(a); g.ready(a, true);
  assert.ok(g.battle);
  const n = g.battle.fighters.length;
  g.dmAction(dad, { kind: 'spawn', mobId: 'creeper' });
  assert.equal(g.battle.fighters.length, n + 1);
  assert.equal(g.battle.fighters[n].team, 1);
  const f = g.battle.fighters.find(x => x.id === a.id); f.hp = 10;
  g.dmAction(dad, { kind: 'heal' }); assert.equal(f.hp, 35);
  assert.throws(() => g.dmAction(dad, { kind: 'rage' }), /боса/);
  g.dmAction(dad, { kind: 'treasure', playerId: a.id });
  assert.equal(g.run.loot.length, 1);
  assert.ok(g.playerState(dad).dm.mobs.length > 5);
  assert.equal(g.playerState(a).dm, null);
});

test('свої карти: дитина створює, батько підтверджує, карта грає в бою', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'admin' });
  const a = g.createPlayer({ name: 'Віктор', classId: 'archer', age: 10, pin: '1111' });
  assert.throws(() => g.createCustomCard(a, { name: 'X', template: 'strike' }), /назва/);
  assert.throws(() => g.createCustomCard(a, { name: 'Супер', template: 'nuke' }), /шаблон/);
  const c = g.createCustomCard(a, { name: 'Крипер-бум', template: 'big_strike' });
  assert.equal(c.approved, false);
  assert.equal(g.playerState(dad).pendingCards.length, 1);
  assert.ok(!g.players[a.id].collection.includes(c.id));
  assert.throws(() => g.approveCustomCard(a, c.id), /батьки/);
  g.approveCustomCard(dad, c.id, true);
  assert.ok(g.players[a.id].collection.includes(c.id));
  assert.ok(g.allowedCards(a).some(x => x.id === c.id), 'карта доступна для колоди');
  assert.ok(!g.allowedCards(dad).some(x => x.id === c.id), 'чужа карта не доступна');
  const deck = g.players[a.id].deck.slice(0, 18).concat([c.id, c.id]);
  g.setDeck(a, deck);
  // відхилена карта зникає
  const c2 = g.createCustomCard(a, { name: 'Слабка', template: 'shield' });
  g.approveCustomCard(dad, c2.id, false);
  assert.equal(g.customCardsOf(a).length, 1);
  for (let i = 0; i < 2; i++) g.createCustomCard(a, { name: 'Ще ' + i, template: 'heal' });
  assert.throws(() => g.createCustomCard(a, { name: 'Четверта', template: 'heal' }), /не більше/);
  // у бою карта розігрується
  g.setMode(dad, { mode: 'duel' }); g.join(dad); g.join(a); g.ready(dad, true); g.ready(a, true);
  const f = g.battle.fighters.find(x => x.id === a.id);
  f.hand = [c.id]; f.mana = 4;
  g.move(a, { attack: 'head', blocks: ['chest', 'belt'], cards: [c.id] });
  g.fire('round');
  assert.ok(g.lastRound.events.some(e => e.t === 'card' && e.card === c.id && e.name === 'Крипер-бум'));
});

test('тривога з дому: пауза і відбій', () => {
  const g = makeGame();
  const a = g.createPlayer({ name: 'Віктор', classId: 'archer', age: 10, pin: '1111' });
  g.join(a); g.ready(a, true);
  g.setAlert(true);
  assert.equal(g.paused, true); assert.equal(g.pauseReason, 'alert');
  assert.match(g.tvState().announce.text, /Тривога/);
  g.setAlert(true); // повтор нічого не ламає
  g.setAlert(false);
  assert.equal(g.paused, false);
  assert.equal(g.players[a.id].stats.alertPauses, 1);
  // ручну паузу відбій не знімає
  g.setPaused(true, 'manual'); g.setAlert(false); assert.equal(g.paused, true);
});
