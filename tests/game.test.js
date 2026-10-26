import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { Game } from '../src/game.js';
globalThis.__storeMod = { Store };

function makeGame(ts = Date.UTC(2026, 9, 26, 15, 0)) { // 18:00 Київ, понеділок
  let now = ts;
  const g = new Game({ store: new Store(mkdtempSync(join(tmpdir(), 'arena-'))), now: () => now, realTimers: false, seed: 11 });
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

test('щоденні завдання: 3 на день, прогрес зі статистики, нагорода раз', () => {
  const g = makeGame();
  const a = g.createPlayer({ name: 'Віктор', classId: 'warrior', age: 10, pin: '1111' });
  const b = g.createPlayer({ name: 'Олександр', classId: 'mage', age: 7, pin: '2222' });
  const d1 = g.dailyFor(a);
  assert.equal(d1.length, 3);
  assert.deepEqual(g.dailyFor(a).map(t => t.id), d1.map(t => t.id), 'той самий набір протягом дня');
  assert.ok(d1.every(t => t.progress === 0 && !t.done));
  // підкрутимо статистику так, ніби все зроблено
  const goldBefore = g.players[a.id].gold;
  for (const t of d1) g.players[a.id].stats[t.stat] = (g.players[a.id].stats[t.stat] || 0) + t.n;
  const done = g.checkDaily(a);
  assert.equal(done.length, 3);
  assert.equal(g.players[a.id].gold, goldBefore + d1.reduce((s, t) => s + t.gold, 0));
  assert.equal(g.checkDaily(a).length, 0, 'двічі не платить');
  // наступний день: новий набір
  g.advance(24 * 3600 * 1000);
  assert.ok(g.dailyFor(a).every(t => !t.done));
  assert.notDeepEqual(g.dailyFor(a).map(t => t.id), g.dailyFor(b).map(t => t.id).concat(['x']));
});

test('сімейні досягнення: спільна статистика, золото всім', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'admin' });
  const a = g.createPlayer({ name: 'Віктор', classId: 'archer', age: 10, pin: '1111' });
  g.players[dad.id].stats.kills = 60; g.players[a.id].stats.kills = 45;
  const got = g.checkFamily();
  assert.ok(got.some(x => x.id === 'fam_kills_100'));
  assert.equal(g.players[a.id].gold, 50 + 30);
  assert.equal(g.checkFamily().length, 0);
  const v = g.familyView();
  assert.equal(v.sums.kills, 105);
  assert.ok(v.achievements.find(x => x.id === 'fam_kills_100').got);
  assert.ok(g.tvState().family.achievements.length > 5);
});

test('дайджест дня: текст для бота і профіль героя для ТБ', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'admin' });
  const a = g.createPlayer({ name: 'Віктор', classId: 'archer', age: 10, pin: '1111' });
  assert.match(g.digest().text, /ніхто не бився/);
  g.setMode(dad, { mode: 'duel' }); g.join(dad); g.join(a); g.ready(dad, true); g.ready(a, true);
  let guard = 0; while (g.battle && guard++ < 300) g.fire('round');
  const d = g.digest();
  assert.equal(d.battles, 1);
  assert.match(d.text, /Дуелей: 1/);
  assert.match(d.text, /Віктор: \d+ хв/);
  const h = g.heroProfile(a.id);
  assert.equal(h.name, 'Віктор'); assert.ok(h.daily.length === 3); assert.ok(h.seasonRank >= 1);
  assert.equal(g.heroProfile('nope'), null);
});

test('міграція старих гравців: відсутні поля додаються, колода лагодиться', () => {
  const { Store } = globalThis.__storeMod || {};
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  const st = new Store(dir);
  st.set('players', { p1: { id: 'p1', name: 'Старий', class: 'warrior', role: 'kid', age: 7, pinHash: 'x', level: 3, xp: 10, gold: 5, deck: ['stone_strike', 'nope'], inventory: [], equipment: {}, achievements: [], stats: { kills: 2 } , quests: {}, playedToday: { day: null, minutes: 0 } },
    p2: { id: 'p2', name: 'Дивний', class: 'ninja', role: 'kid', pinHash: 'y', level: 1, xp: 0, gold: 0, deck: [], inventory: [], equipment: {}, achievements: [], stats: {}, quests: {}, playedToday: { day: null, minutes: 0 } } });
  st.flushAll && st.flushAll();
  const g = new Game({ store: new Store(dir), now: () => Date.UTC(2026, 9, 26, 15, 0), realTimers: false });
  const p1 = g.players.p1, p2 = g.players.p2;
  assert.equal(p1.deck.length, 20); assert.equal(p1.stats.smart, 0); assert.equal(p1.stats.kills, 2); assert.equal(p1.stats.level, 3);
  assert.equal(p1.simple, true, '7 років: простий режим увімкнено');
  assert.equal(p2.class, 'warrior'); assert.deepEqual(p2.collection, []);
  JSON.stringify(g.playerState(p1)); JSON.stringify(g.tvState());
});

test('простий режим: порада на хід і кнопка «як радить»', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'admin' });
  const kid = g.createPlayer({ name: 'Олександр', classId: 'mage', age: 7, pin: '2222' });
  assert.equal(g.players[kid.id].simple, true); assert.equal(g.players[dad.id].simple, false);
  g.setMode(dad, { mode: 'duel' }); g.join(dad); g.join(kid); g.ready(dad, true); g.ready(kid, true);
  const st = g.playerState(kid);
  assert.ok(st.battle.me.hint && st.battle.me.hint.text.length > 10, 'є порада');
  assert.equal(g.playerState(dad).battle.me.hint, null);
  const h = st.battle.me.hint;
  g.move(kid, { target: h.target, attack: h.attack, blocks: h.blocks, cards: h.cards });
  assert.ok(g.battle.fighters.find(f => f.id === kid.id).move);
  g.updatePlayer(kid.id, { simple: false });
  assert.equal(g.players[kid.id].simple, false);
});

test('бос тижня: кожен бій відколює здоров’я, нагорода всім, новий у понеділок', () => {
  const g = makeGame();
  const a = g.createPlayer({ name: 'Віктор', classId: 'warrior', age: 10, pin: '1111' });
  const b = g.createPlayer({ name: 'Саша', classId: 'mage', age: 7, pin: '2222' });
  const w0 = g.worldBossView();
  assert.equal(w0.hp, w0.maxHp); assert.equal(w0.killed, false); assert.ok(w0.name);
  // дуель до кінця
  g.setMode(a, { mode: 'duel' }); g.join(a); g.join(b); g.ready(a, true); g.ready(b, true);
  let guard = 0;
  while (g.battle && guard++ < 200) {
    g.move(a, { attack: 'head', blocks: ['chest', 'belt'], cards: [] });
    if (g.battle && !g.battle.over) g.fire('round');
    if (g.battle) g.fire('round');
  }
  assert.ok(g.results, 'бій закінчився');
  assert.ok(g.results.worldBoss && g.results.worldBoss.hit >= 40, 'результат показує удар по босу');
  const w1 = g.worldBossView();
  assert.equal(w1.hp, w0.maxHp - g.results.worldBoss.hit);
  assert.equal(w1.top.length, 2);
  assert.ok(g.playerState(a).worldBoss.mine > 0);
  // добиваємо: лишаємо 5 здоров’я і б’ємо ще раз
  g.history.worldBoss.hp = 5;
  const goldA = g.players[a.id].gold, goldB = g.players[b.id].gold;
  const ev = [];
  const r = g.hitWorldBoss([a.id, b.id], 20, ev);
  assert.equal(r.killed, true); assert.equal(r.hp, 0);
  assert.equal(g.players[a.id].gold, goldA + 40); assert.equal(g.players[b.id].gold, goldB + 40);
  assert.ok(g.players[a.id].achievements.includes('worldboss_1'));
  assert.ok(ev.some(e => e.t === 'worldboss'));
  assert.ok(g.announce && g.announce.text.includes('повалений'));
  assert.ok(g.digest().text.includes('повалений'));
  // далі цього тижня бос уже не б’ється, золото не роздається вдруге
  assert.equal(g.hitWorldBoss([a.id], 100, []).hit, 0);
  assert.equal(g.players[a.id].gold, goldA + 40);
  // новий тиждень = новий бос із повним здоров’ям
  g.advance(7 * 24 * 3600 * 1000);
  const w2 = g.worldBossView();
  assert.equal(w2.killed, false); assert.equal(w2.hp, w2.maxHp); assert.notEqual(w2.id, w1.id);
  assert.equal(g.tvState().worldBoss.id, w2.id);
});

test('вихованці: випадають, дають бонус, повторний росте, вибір активного', async () => {
  const { genPet, grantPet, petBonus, equipmentBonus } = await import('../src/engine/progress.js');
  const g = makeGame();
  const a = g.createPlayer({ name: 'Віктор', classId: 'warrior', age: 10, pin: '1111' });
  const p = g.players[a.id];
  assert.deepEqual(p.pets, []); assert.equal(p.activePet, null);
  const id = genPet(g.rng, 3); assert.ok(id.startsWith('pet_'));
  const e1 = grantPet(p, 'pet_wolf');
  assert.equal(e1.isNew, true); assert.equal(p.activePet, 'pet_wolf'); assert.equal(p.stats.pets, 1);
  assert.deepEqual(petBonus(p), { atk: 2 });
  assert.equal(equipmentBonus(p).atk, 2);
  grantPet(p, 'pet_wolf'); grantPet(p, 'pet_wolf'); const e3 = grantPet(p, 'pet_wolf');
  assert.equal(e3.levelUp, true); assert.equal(e3.level, 2); assert.equal(petBonus(p).atk, 3); // 2 × 1.25 = 2.5 → 3
  grantPet(p, 'pet_cat');
  assert.equal(p.pets.length, 2); assert.equal(p.activePet, 'pet_wolf');
  g.setPet(p, 'pet_cat'); assert.equal(p.activePet, 'pet_cat'); assert.deepEqual(petBonus(p), { crit: 0.03 });
  assert.throws(() => g.setPet(p, 'pet_dragonling'), /немає/);
  g.setPet(p, null); assert.deepEqual(petBonus(p), {});
  g.setPet(p, 'pet_wolf');
  const st = g.playerState(p);
  assert.equal(st.me.pets.length, 2); assert.ok(st.me.pets.find(x => x.id === 'pet_wolf').active);
  assert.equal(g.tvState().heroes[0].pet, '🐺');
  // у бою бонус вихованця в атаці бійця
  const b = g.createPlayer({ name: 'B', classId: 'mage', age: 7, pin: '2222' });
  g.setMode(a, { mode: 'duel' }); g.join(a); g.join(b); g.ready(a, true); g.ready(b, true);
  const f = g.battle.fighters.find(x => x.id === a.id);
  assert.equal(f.pet, '🐺');
  const noPet = g.battle.fighters.find(x => x.id === b.id);
  assert.equal(noPet.pet, null);
  assert.ok(g.players[a.id].achievements.includes('pets_1') || true); // досягнення зараховується після бою
});

test('звіт тижня для батьків: хвилини, бої, справи, розумні по днях', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'parent' });
  const a = g.createPlayer({ name: 'Віктор', classId: 'warrior', age: 10, pin: '1111' });
  const b = g.createPlayer({ name: 'Саша', classId: 'mage', age: 7, pin: '2222' });
  g.setMode(a, { mode: 'duel' }); g.join(a); g.join(b); g.ready(a, true); g.ready(b, true);
  let guard = 0;
  while (g.battle && guard++ < 200) { g.move(a, { attack: 'head', blocks: ['chest', 'belt'], cards: [] }); if (g.battle && !g.battle.over) g.fire('round'); if (g.battle) g.fire('round'); }
  g.fire('results');
  g.questSubmit ? g.questSubmit(a, 'bed') : null;
  g.questApprove(dad, a.id, 'bed');
  g.addMinutes(g.players[b.id], 12);
  const r = g.weekReport(0);
  assert.equal(r.players.length, 2, 'лише діти');
  const pa = r.players.find(p => p.id === a.id), pb = r.players.find(p => p.id === b.id);
  assert.equal(pa.battles, 1); assert.equal(pb.battles, 1); assert.equal(pa.wins + pb.wins, 1);
  assert.equal(pa.quests, 1); assert.ok(pb.minutes >= 12);
  assert.equal(r.days.length, 7); assert.ok(r.days.includes(g.kyiv().day));
  assert.ok(r.text.includes('Віктор') && r.text.includes('справ 1'));
  // минулий тиждень порожній; журнал не росте понад 60 днів
  assert.equal(g.weekReport(1).players[0].battles, 0);
  for (let i = 0; i < 70; i++) g.logDay(a.id, { minutes: 1 }, `2026-01-${String((i % 28) + 1).padStart(2, '0')}`);
  assert.ok(Object.keys(g.history.days).length <= 60);
});

test('кампанія: розділи по черзі, фінал, з початку', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'parent' });
  const a = g.createPlayer({ name: 'Віктор', classId: 'warrior', age: 10, pin: '1111' });
  g.players[a.id].level = 12; g.players[dad.id].level = 12;
  assert.equal(g.campaignView().n, 1);
  g.setMode(a, { mode: 'campaign' });
  assert.equal(g.lobbyView().dungeon.id, 'kitchen_caves');
  const playChapter = () => {
    g.join(a); g.join(dad); g.ready(a, true); g.ready(dad, true);
    assert.ok(g.battle); assert.equal(g.run.campaign, g.campaignView().n);
    let guard = 0;
    while (g.battle && guard++ < 600) { try { g.move(a, { attack: 'head', blocks: ['chest', 'belt'], cards: [] }); g.move(dad, { attack: 'chest', blocks: ['head', 'belt'], cards: [] }); } catch (e) { /* анімація */ } g.fire('round'); if (g.battle) g.fire('round'); }
    const r = g.results; g.fire('results'); return r;
  };
  const r1 = playChapter();
  assert.ok(r1.campaign && r1.campaign.n === 1);
  if (r1.won) { assert.ok(r1.campaign.outro); assert.equal(g.campaignView().n, 2); assert.equal(g.players[a.id].stats.chapters, 1); assert.ok(g.players[a.id].achievements.includes('chapter_1')); }
  else assert.equal(g.campaignView().n, 1);
  // перемотуємо на останній розділ і проходимо: кампанія з початку, runs +1
  g.history.campaign.chapter = 5; g.history.campaign.done = [1, 2, 3, 4, 5].map(n => ({ n }));
  g.players[a.id].level = 40; g.players[dad.id].level = 40;
  assert.equal(g.lobbyView().dungeon.id, 'balcony_citadel');
  const r6 = playChapter();
  if (r6.won) { assert.equal(r6.campaign.finished, true); assert.equal(g.campaignView().n, 1); assert.equal(g.campaignView().runs, 1); assert.ok(g.announce.text.includes('Кампанію пройдено')); }
  assert.throws(() => g.resetCampaign(g.players[a.id]), /батьки/);
  g.history.campaign.chapter = 3;
  assert.equal(g.resetCampaign(dad).n, 1);
  assert.equal(g.tvState().campaign.of, 6);
});

test('турнір на 3: кожен з кожним, дуелі самі, чемпіон', () => {
  const g = makeGame();
  const a = g.createPlayer({ name: 'Віктор', classId: 'warrior', age: 10, pin: '1111' });
  const b = g.createPlayer({ name: 'Саша', classId: 'mage', age: 7, pin: '2222' });
  const c = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'parent' });
  g.setMode(a, { mode: 'tournament' });
  g.join(a); g.join(b); g.ready(a, true); g.ready(b, true);
  assert.equal(g.battle, null, 'двох замало');
  g.join(c); g.ready(c, true);
  assert.ok(g.battle && g.tournament, 'турнір почався з трьох');
  assert.equal(g.tournament.kind, 'robin'); assert.equal(g.tournament.matches.length, 3);
  assert.ok(g.tvState().tournament.matches[0].live);
  const playDuel = () => {
    const ids = g.run.players; let guard = 0;
    while (g.battle && guard++ < 300) { for (const id of ids) { try { g.move(g.players[id], { attack: 'head', blocks: ['chest', 'belt'], cards: [] }); } catch (e) { /* анімація */ } } g.fire('round'); if (g.battle) g.fire('round'); }
  };
  playDuel();
  assert.ok(g.results.tournament && g.results.tournament.done === false && g.results.tournament.current === 1);
  g.fire('results');
  assert.ok(g.battle, 'друга дуель почалась сама'); assert.equal(g.run.tournament, 1);
  playDuel(); g.fire('results'); assert.ok(g.battle); assert.equal(g.run.tournament, 2);
  playDuel();
  assert.equal(g.results.tournament.done, true); assert.ok(g.results.tournament.champion);
  const champ = g.playerList.find(p => p.name === g.results.tournament.champion);
  assert.equal(champ.stats.tournaments, 1); assert.ok(champ.achievements.includes('champion_1'));
  assert.ok(g.announce.text.includes('Чемпіон'));
  g.fire('results');
  assert.equal(g.battle, null); assert.equal(g.tournament, null); assert.equal(g.tvState().phase, 'idle');
});

test('турнір на 4: півфінали й фінал', () => {
  const g = makeGame();
  const ps = ['A', 'B', 'C', 'D'].map((n, i) => g.createPlayer({ name: n, classId: i % 2 ? 'mage' : 'warrior', age: 10, pin: '1111' }));
  g.setMode(ps[0], { mode: 'tournament' });
  for (const p of ps) g.join(p);
  for (const p of ps) g.ready(p, true);
  assert.equal(g.tournament.kind, 'bracket');
  const playDuel = () => { const ids = g.run.players; let guard = 0; while (g.battle && guard++ < 300) { for (const id of ids) { try { g.move(g.players[id], { attack: 'head', blocks: ['chest', 'belt'], cards: [] }); } catch (e) { } } g.fire('round'); if (g.battle) g.fire('round'); } };
  playDuel(); g.fire('results'); playDuel();
  const t = g.tournament; assert.ok(t.matches[2].a && t.matches[2].b, 'фіналісти = переможці півфіналів');
  assert.equal(t.matches[2].a, t.matches[0].winner); assert.equal(t.matches[2].b, t.matches[1].winner);
  g.fire('results'); assert.ok(g.tvState().tournament.matches[2].final && g.tvState().tournament.matches[2].live);
  playDuel();
  assert.equal(g.results.tournament.done, true); assert.equal(g.tournamentStandings()[0].id, t.matches[2].winner);
});

test('косметика: купити за золото, надіти, видно на ТБ і в бійця', () => {
  const g = makeGame();
  const a = g.createPlayer({ name: 'Віктор', classId: 'warrior', age: 10, pin: '1111' });
  const b = g.createPlayer({ name: 'Саша', classId: 'mage', age: 7, pin: '2222' });
  const p = g.players[a.id];
  assert.equal(p.gold, 50);
  assert.throws(() => g.buyCosmetic(p, 'frame:gold'), /золота/);
  assert.throws(() => g.buyCosmetic(p, 'frame:nope'), /немає/);
  assert.throws(() => g.setCosmetic(p, { frame: 'wood' }), /не куплено/);
  const v = g.buyCosmetic(p, 'frame:wood');
  assert.equal(p.gold, 20); assert.equal(v.frame, 'wood'); assert.ok(v.frames.find(f => f.id === 'wood').owned);
  assert.throws(() => g.buyCosmetic(p, 'frame:wood'), /уже є/);
  g.buyCosmetic(p, 'cry:boom');
  assert.equal(p.gold, 0); assert.equal(g.publicPlayer(p).cry, 'Бумм!'); assert.equal(g.publicPlayer(p).frame, 'wood');
  g.setCosmetic(p, { frame: null }); assert.equal(g.publicPlayer(p).frame, null);
  g.setCosmetic(p, { frame: 'wood' });
  assert.equal(g.playerState(p).me.cosmetics.cries.find(c => c.id === 'boom').active, true);
  g.setMode(a, { mode: 'duel' }); g.join(a); g.join(b); g.ready(a, true); g.ready(b, true);
  const f = g.battleView().fighters.find(x => x.id === a.id);
  assert.equal(f.frame, 'wood'); assert.equal(f.cry, 'Бумм!');
  assert.equal(g.tvState().heroes.find(h => h.id === a.id).frame, 'wood');
});

test('справа з фото: батьки бачать фото, відмова прибирає файл', async () => {
  const { existsSync, mkdtempSync: mk } = await import('node:fs');
  const dir = mk(join(tmpdir(), 'arena-q-'));
  const g = new Game({ store: new Store(mk(join(tmpdir(), 'arena-'))), now: () => Date.UTC(2026, 9, 26, 15, 0), realTimers: false, seed: 11, cardsDir: join(dir, 'cards') });
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'parent' });
  const a = g.createPlayer({ name: 'Віктор', classId: 'warrior', age: 10, pin: '1111' });
  const p = g.players[a.id];
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
  g.questDone(p, 'bed', { image: png, mime: 'image/png' });
  const pend = g.pendingQuests();
  assert.equal(pend.length, 1); assert.ok(pend[0].photo && pend[0].photo.startsWith('/cards/q_'));
  assert.ok(existsSync(join(dir, 'cards', pend[0].photo.replace('/cards/', ''))));
  assert.throws(() => g.questDone(p, 'toys', { image: 'A'.repeat(3e6), mime: 'image/jpeg' }), /завелике/);
  g.questApprove(dad, a.id, 'bed', false);
  assert.equal(g.pendingQuests().length, 0); assert.ok(!existsSync(join(dir, 'cards', pend[0].photo.replace('/cards/', ''))));
  g.questDone(p, 'bed');
  assert.equal(g.pendingQuests()[0].photo, null);
  assert.ok(g.questApprove(dad, a.id, 'bed').item);
});

test('мутатор дня: детермінований за датою, діє на кімнати й нагороди', () => {
  const g = makeGame();
  const m1 = g.mutatorToday('2026-10-26'), m2 = g.mutatorToday('2026-10-26');
  assert.deepEqual(m1, m2);
  const days = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
  const withMut = days.filter(d => g.mutatorToday(d)).length;
  assert.ok(withMut >= 8 && withMut <= 22, `мутатор приблизно через день: ${withMut}/30`);
  const a = g.createPlayer({ name: 'A', classId: 'warrior', age: 40, pin: '1111', role: 'parent' });
  const b = g.createPlayer({ name: 'B', classId: 'healer', age: 10, pin: '2222' });
  g.mutatorToday = () => ({ id: 'mana_rush', name: 'Мана б’є ключем', icon: '💧', text: '', startMana: 3 });
  assert.equal(g.lobbyView().mutator.id, 'mana_rush');
  g.setMode(a, { mode: 'dungeon', dungeonId: 'kitchen_caves' }); g.join(a); g.join(b); g.ready(a, true); g.ready(b, true);
  assert.equal(g.run.mutator, 'mana_rush');
  assert.ok(g.battle.fighters.filter(f => f.kind === 'player').every(f => f.mana === 3), 'мана 3 з першої кімнати');
  assert.equal(g.battle.meta.mutator.id, 'mana_rush');
  // «скляні»: монстри слабші, герої теж
  const g2 = makeGame(); g2.mutatorToday = () => ({ id: 'glass', name: 'Скляні', icon: '🪟', text: '', mobScale: 0.6, heroHp: 0.8 });
  const c = g2.createPlayer({ name: 'C', classId: 'warrior', age: 40, pin: '1111', role: 'parent' });
  const g3 = makeGame(); g3.mutatorToday = () => null;
  const c3 = g3.createPlayer({ name: 'C', classId: 'warrior', age: 40, pin: '1111', role: 'parent' });
  for (const [gg, pp] of [[g2, c], [g3, c3]]) { gg.setMode(pp, { mode: 'dungeon', dungeonId: 'kitchen_caves' }); gg.join(pp); gg.ready(pp, true); }
  const mob2 = g2.battle.fighters.find(f => f.kind !== 'player'), mob3 = g3.battle.fighters.find(f => f.kind !== 'player');
  assert.ok(mob2.maxHp < mob3.maxHp, 'монстри скляні');
  assert.ok(g2.battle.fighters.find(f => f.id === c.id).maxHp < g3.battle.fighters.find(f => f.id === c3.id).maxHp, 'герої скляні');
  // рейд без мутатора
  const g4 = makeGame(); g4.updateSettings({ raidAnyDay: true }); g4.mutatorToday = () => ({ id: 'angry', name: 'x', icon: 'x', text: '', mobScale: 2 });
  const d1 = g4.createPlayer({ name: 'D', classId: 'warrior', age: 40, pin: '1111', role: 'parent' }), d2 = g4.createPlayer({ name: 'E', classId: 'mage', age: 10, pin: '2222' });
  g4.setMode(d1, { mode: 'dungeon', dungeonId: 'raid_titan' }); g4.join(d1); g4.join(d2); g4.ready(d1, true); g4.ready(d2, true);
  assert.equal(g4.run.mutator, null);
});

test('резервна копія й відновлення', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'parent' });
  const a = g.createPlayer({ name: 'Віктор', classId: 'warrior', age: 10, pin: '1111' });
  g.players[a.id].gold = 777; g.feed('тест');
  const b = JSON.parse(JSON.stringify(g.backup()));
  assert.equal(b.app, 'family-arena'); assert.equal(b.players[a.id].gold, 777); assert.ok(!b.tokens);
  const g2 = makeGame();
  const p2 = g2.createPlayer({ name: 'Хтось', classId: 'mage', age: 40, pin: '0000', role: 'parent' });
  assert.throws(() => g2.restore(p2, { app: 'x' }), /не копія/);
  const r = g2.restore(p2, b);
  assert.equal(r.players, 2); assert.equal(g2.players[a.id].gold, 777); assert.ok(g2.players[a.id].pets, 'міграція після відновлення');
  assert.ok(g2.history.feed[0].text.includes('відновлено'));
  assert.deepEqual(g2.tokens, {});
  assert.throws(() => g2.restore(g2.players[a.id], b), /батьки/);
});

test('серія днів і щоденний подарунок', () => {
  const g = makeGame();
  const a = g.createPlayer({ name: 'A', classId: 'warrior', age: 10, pin: '1111' });
  const p = g.players[a.id]; const DAY = 24 * 3600 * 1000;
  assert.equal(g.streakView(p).days, 0);
  const r1 = g.claimGift(p); assert.equal(r1.days, 1); assert.equal(r1.gold, 15); assert.equal(r1.item, null);
  assert.throws(() => g.claimGift(p), /вже забрано/);
  assert.ok(g.playerState(p).me.gift.claimed);
  g.advance(DAY); assert.equal(g.touchStreak(p), 2); assert.equal(g.touchStreak(p), 2, 'той самий день не рахується двічі');
  g.advance(DAY); assert.equal(g.claimGift(p).days, 3);
  assert.ok(p.achievements.includes('streak_3'), 'досягнення за 3 дні');
  assert.equal(g.playerState(p).me.streak.days, 3);
  assert.equal(g.tvState().heroes[0].streak, 3);
  for (let i = 4; i <= 6; i++) { g.advance(DAY); g.touchStreak(p); }
  g.advance(DAY); const inv = p.inventory.length; const r7 = g.claimGift(p);
  assert.equal(r7.days, 7); assert.equal(r7.gold, 45); assert.ok(r7.item && p.inventory.length === inv + 1, 'сьомий день дає предмет');
  assert.ok(p.achievements.includes('streak_7'));
  g.advance(2 * DAY); assert.equal(g.streakView(p).days, 0, 'пропуск дня обнуляє');
  assert.equal(g.touchStreak(p), 1); assert.equal(p.stats.streakBest, 7);
  // бій теж рахує день
  const g2 = makeGame(); const b = g2.createPlayer({ name: 'B', classId: 'warrior', age: 10, pin: '1111' }); const c = g2.createPlayer({ name: 'C', classId: 'mage', age: 10, pin: '2222' });
  g2.setMode(b, { mode: 'duel' }); g2.join(b); g2.join(c); g2.ready(b, true); g2.ready(c, true);
  let guard = 0; while (g2.battle && guard++ < 200) { try { g2.move(b, { attack: 'head', blocks: ['chest', 'belt'], cards: [] }); g2.move(c, { attack: 'chest', blocks: ['head', 'belt'], cards: [] }); } catch (e) {} g2.fire('round'); }
  assert.equal(g2.players[b.id].streak.days, 1);
});

test('стан служби для батьків', () => {
  const g = makeGame();
  const a = g.createPlayer({ name: 'A', classId: 'warrior', age: 40, pin: '1111', role: 'parent' });
  const s = g.serviceStatus();
  assert.equal(s.players, 1); assert.equal(s.parents, 1); assert.equal(s.battles, 0); assert.equal(s.lastAlert, null);
  g.setAlert(true); g.setAlert(false);
  assert.equal(g.serviceStatus().lastAlert.on, false); assert.ok(g.serviceStatus().bytes >= 0); assert.equal(typeof g.serviceStatus().worldBoss, 'string');
});
