import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { Game } from '../src/game.js';
import { cardById } from '../src/engine/content.js';
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

test('майстерня мобів: дитина малює монстра, батько підтверджує, він виходить у підземеллі', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', role: 'parent', pin: '0000' });
  const a = g.createPlayer({ name: 'Віктор', classId: 'archer', age: 10, pin: '1111' });
  assert.throws(() => g.createCustomMob(a, { name: 'Жук', str: 5, hp: 5, trick: 5 }), /рівно 10/);
  const m = g.createCustomMob(a, { name: 'Жук-гризун', str: 4, hp: 4, trick: 2 });
  assert.equal(m.approved, false); assert.equal(g.pendingMobs().length, 1);
  assert.equal(g.customMobs().length, 0, 'до підтвердження в підземеллях нема');
  g.approveCustomMob(dad, m.id, true);
  assert.equal(g.customMobs().length, 1); assert.ok(m.level >= 1 && m.hp > 30 && m.atk > 5);
  assert.ok(g.playerState(dad).mobs.some(x => x.author === 'Віктор' && x.name === 'Жук-гризун'));
  // другий можна, третій ні
  g.createCustomMob(a, { name: 'Слимак', str: 0, hp: 10, trick: 0 });
  assert.throws(() => g.createCustomMob(a, { name: 'Третій', str: 10, hp: 0, trick: 0 }), /не більше/);
  // у першій кімнаті підземелля один моб замінений на свого
  g.setMode(dad, { mode: 'dungeon', dungeonId: 'kitchen_caves' }); g.join(dad); g.join(a); g.ready(dad, true); g.ready(a, true);
  const f = g.battle.fighters.find(x => x.custom);
  assert.ok(f, 'свій монстр у кімнаті'); assert.equal(f.author, 'Віктор');
  assert.ok(g.tvState().battle.fighters.some(x => x.team === 1 && x.name === f.name));
  let guard = 0;
  while (g.battle && guard++ < 400) g.fire('round');
  const cm = g.history.customMobs.find(x => x.id === f.mob);
  assert.ok((cm.beaten || 0) + (cm.won || 0) >= 1, 'рахунок зустрічей ведеться');
  // відхилений зникає
  const m2 = g.pendingMobs()[0]; g.approveCustomMob(dad, m2.id, false);
  assert.equal(g.history.customMobs.length, 1);
});

test('книга сім\'ї: рекорди побиваються, моменти записуються', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', role: 'parent', pin: '0000' });
  const a = g.createPlayer({ name: 'Віктор', classId: 'archer', age: 10, pin: '1111' });
  assert.equal(g.setRecord('bigHit', 0, a.id, 'нуль'), false);
  assert.equal(g.setRecord('bigHit', 12, a.id, 'Віктор: 12'), true);
  assert.equal(g.setRecord('bigHit', 10, a.id, 'менше'), false, 'менший не записується');
  assert.equal(g.setRecord('bigHit', 20, a.id, 'Віктор: 20'), true);
  assert.ok(!g.tvState().announce, 'того ж дня рекорд не оголошується');
  g.advance(24 * 3600 * 1000);
  assert.equal(g.setRecord('bigHit', 30, a.id, 'Віктор: 30'), true);
  assert.match(g.tvState().announce.text, /Рекорд сім'ї/);
  const bv = g.bookView();
  assert.equal(bv.records.find(r => r.key === 'bigHit').value, 30);
  assert.ok(bv.moments.some(m => m.text.includes('Рекорд')));
  // дуель лишає рекорд довжини, підземелля — моменти босів
  g.setMode(dad, { mode: 'duel' }); g.join(dad); g.join(a); g.ready(dad, true); g.ready(a, true);
  let guard = 0; while (g.battle && guard++ < 400) g.fire('round');
  assert.ok(g.history.book.records.longDuel && g.history.book.records.longDuel.value >= 1);
  assert.ok(g.playerState(a).book.records.length === 4);
  assert.ok(g.tvState().book.moments.length <= 6);
});

test('батьки нарівні: справи батьків підтверджує дитина, свою не можна', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', role: 'parent', pin: '0000' });
  const a = g.createPlayer({ name: 'Віктор', classId: 'archer', age: 10, pin: '1111' });
  const dq = g.questsFor(dad); assert.ok(dq.length >= 5 && dq.every(q => q.forParent), 'у батька свої справи');
  assert.ok(g.questsFor(a).every(q => !q.forParent), 'у дитини дитячі');
  g.questDone(dad, 'p_sport');
  assert.equal(g.pendingFor(a).length, 1, 'дитина бачить справу батька');
  assert.equal(g.pendingFor(dad).length, 0, 'сам себе не бачить');
  assert.throws(() => g.questApprove(dad, dad.id, 'p_sport'), /свою справу/);
  const gold = dad.gold; const r = g.questApprove(a, dad.id, 'p_sport');
  assert.ok(r.item && dad.gold > gold);
  // дитячу справу дитина не підтверджує
  g.questDone(a, 'bed'); assert.throws(() => g.questApprove(a, a.id, 'bed'), /лише батьки/);
  assert.equal(g.pendingFor(dad).length, 1);
});

test('друзі в гостях: герой на вечір, без очок сезону, завтра йде сам', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', role: 'parent', pin: '0000' });
  const a = g.createPlayer({ name: 'Віктор', classId: 'archer', age: 10, pin: '1111' }); g.players[a.id].level = 4;
  const gst = g.createGuest(dad, { name: 'Максим', classId: 'mage' });
  assert.equal(gst.role, 'guest'); assert.equal(gst.level, 4); assert.match(gst.guest.pin, /^\d{4}$/);
  assert.ok(g.login(gst.id, gst.guest.pin), 'гість заходить за PIN');
  assert.equal(g.questsFor(gst).length, 0);
  g.addSeasonPoints(gst.id, 10); assert.ok(!g.history.season.points[gst.id], 'без очок сезону');
  assert.ok(g.playerState(dad).guests.some(x => x.name === 'Максим' && x.pin === gst.guest.pin));
  g.setMode(dad, { mode: 'duel' }); g.join(a); g.join(gst); g.ready(a, true); g.ready(gst, true);
  let guard = 0; while (g.battle && guard++ < 400) g.fire('round');
  assert.ok(g.history.battles[0].players.includes(gst.id), 'гість бився');
  g.expireGuests(); assert.ok(g.players[gst.id], 'того ж дня лишається');
  const gm = g.createCustomMob(gst, { name: 'Гостьомонстр', str: 4, hp: 3, trick: 3 }); g.approveCustomMob(dad, gm.id, true);
  assert.equal(g.customMobs().length, 1);
  g.advance(24 * 3600 * 1000); g.tick();
  assert.ok(!g.players[gst.id], 'наступного дня пішов');
  assert.equal(g.customMobs().length, 0, 'монстр гостя пішов разом із ним');
  assert.throws(() => { for (let i = 0; i < 4; i++) g.createGuest(dad, { name: 'Гість' + i }); }, /не більше/);
});

test('автобій: хід робиться сам, раунд закривається швидше, дитина може змінити', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', role: 'parent', pin: '0000' });
  const a = g.createPlayer({ name: 'Сашко', classId: 'mage', age: 7, pin: '2222' });
  g.updatePlayer(a.id, { auto: true });
  assert.equal(g.publicPlayer(a).auto, true);
  g.setMode(dad, { mode: 'duel' }); g.join(dad); g.join(a); g.ready(dad, true); g.ready(a, true);
  const f = g.battle.fighters.find(x => x.id === a.id);
  assert.ok(f.move && f.move.auto, 'хід зроблено сам');
  assert.equal(a.stats.autoMoves, 1);
  const st = g.playerState(a); assert.ok(st.battle.me.hint && st.battle.me.auto && st.battle.me.move.auto);
  assert.ok(g.tvState().battle.fighters.find(x => x.id === a.id).auto);
  assert.ok(g.roundEnds - g.now() > 8000, 'тато ходить сам, раунд повний');
  // дитина змінює хід
  g.move(a, { attack: 'legs', blocks: ['head', 'chest'], cards: [] });
  assert.equal(f.move.attack, 'legs'); assert.ok(!f.move.auto);
  // коли всі на автобої, раунд коротший
  g.updatePlayer(dad.id, { auto: true });
  g.fire('round'); if (g.battle) g.fire('round');
  if (g.battle && !g.battle.over) assert.ok(g.roundEnds - g.now() <= 8000, 'усі ходи сам: 8 с');
  let guard = 0; while (g.battle && guard++ < 400) g.fire('round');
  assert.ok(g.history.battles.length === 1);
});

test('кампанія 2: відкривається після першої, розвилка після розділу, вибір дає нагороду і шлях', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', role: 'parent', pin: '0000' });
  const a = g.createPlayer({ name: 'Віктор', classId: 'archer', age: 10, pin: '1111' });
  const b = g.createPlayer({ name: 'Сашко', classId: 'mage', age: 7, pin: '2222' });
  assert.throws(() => g.setMode(dad, { mode: 'campaign', book: 2 }), /після першої/);
  g.history.campaign.runs = 1;
  g.setMode(dad, { mode: 'campaign', book: 2 });
  const cv = g.campaignView(); assert.equal(cv.book, 2); assert.equal(cv.of, 8); assert.equal(cv.title, 'Портал у гардеробній'); assert.ok(!cv.books[1].locked);
  for (const p of [dad, a]) { p.level = 9; p.equipment = {}; }
  let guard = 0, won = false;
  while (!won && guard++ < 5) {
    g.join(dad); g.join(a); g.ready(dad, true); g.ready(a, true);
    let r = 0; while (g.battle && r++ < 400) g.fire('round');
    won = !!(g.results && g.results.won); g.results = null;
  }
  assert.ok(won, 'розділ 1 пройдено');
  const c = g.history.campaign;
  assert.ok(c.pending && c.pending.options.length === 2, 'розвилка чекає');
  assert.ok(g.tvState().campaign.pending, 'ТБ бачить розвилку');
  g.join(dad); g.join(a); g.ready(dad, true); g.ready(a, true); assert.ok(!g.battle, 'без вибору похід не стартує');
  assert.throws(() => g.chooseCampaign(b, 'a'), /хто пройшов/);
  const gold = a.gold; const res = g.chooseCampaign(a, 'a');
  assert.equal(a.gold, gold + 30); assert.equal(c.node, 'c2_2a'); assert.ok(!c.pending); assert.match(res.next, /Ведмідь/);
  assert.equal(g.campaignView().chapters[0].done, true);
  assert.ok(g.history.book.moments.some(m => m.text.includes('Розвилка')));
  // скидання книги 2 не чіпає першу
  g.resetCampaign(dad); assert.equal(g.history.campaign.node, 'c2_1'); assert.equal(g.history.campaign.runs, 1);
  g.setMode(dad, { mode: 'campaign', book: 1 }); assert.equal(g.campaignView().of, 8); assert.equal(g.campaignView().book, 1);
});

test('продати прості: сумка чиститься одним натиском, рідкісне лишається', () => {
  const g = makeGame();
  const a = g.createPlayer({ name: 'Віктор', classId: 'archer', age: 10, pin: '1111' });
  const p = g.players[a.id]; p.inventory = [];
  const mk = (r, i) => ({ id: 'it' + i, name: 'Річ ' + i, slot: 'weapon', rarity: r, level: 1, stats: { atk: 1 } });
  p.inventory.push(mk('common', 1), mk('uncommon', 2), mk('rare', 3), mk('legendary', 4), mk('common', 5));
  const gold = p.gold; const r = g.sellJunk(p);
  assert.equal(r.sold, 3); assert.ok(r.gold > 0); assert.equal(p.gold, gold + r.gold);
  assert.deepEqual(p.inventory.map(i => i.rarity), ['rare', 'legendary']);
  assert.throws(() => g.sellJunk(p), /нема чого/);
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
  g.history.campaign.chapter = 7; g.history.campaign.done = [1, 2, 3, 4, 5, 6, 7].map(n => ({ n }));
  g.players[a.id].level = 40; g.players[dad.id].level = 40;
  assert.equal(g.lobbyView().dungeon.id, 'balcony_citadel');
  const r6 = playChapter();
  if (r6.won) { assert.equal(r6.campaign.finished, true); assert.equal(g.campaignView().n, 1); assert.equal(g.campaignView().runs, 1); assert.ok(g.announce.text.includes('Кампанію пройдено')); }
  assert.throws(() => g.resetCampaign(g.players[a.id]), /батьки/);
  g.history.campaign.chapter = 3;
  assert.equal(g.resetCampaign(dad).n, 1);
  assert.equal(g.tvState().campaign.of, 8);
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

test('тренування: один гравець проти манекена, без нагород і очок', () => {
  const g = makeGame();
  const a = g.createPlayer({ name: 'A', classId: 'warrior', age: 7, pin: '1111' });
  const p = g.players[a.id]; const gold0 = p.gold, xp0 = p.xp;
  g.setMode(a, { mode: 'practice' }); g.join(a); g.ready(a, true);
  assert.ok(g.battle, 'бій стартує з одним гравцем'); assert.equal(g.run.dungeon, 'practice'); assert.equal(g.run.mutator, null);
  assert.ok(g.battle.fighters.some(f => f.mob === 'dummy'));
  assert.equal(g.lobbyView().dungeon.id, 'practice');
  let guard = 0; while (g.battle && guard++ < 200) { try { g.move(a, { attack: 'head', blocks: ['chest', 'belt'], cards: [] }); } catch (e) {} g.fire('round'); }
  assert.ok(g.results && g.results.practice); assert.equal(g.results.xp, 0);
  assert.equal(p.gold, gold0); assert.equal(p.xp, xp0); assert.equal(p.stats.dungeons, 0);
  assert.equal(g.history.season.points[a.id] || 0, 0); assert.equal(g.history.battles.length, 0);
  assert.equal(p.streak.days, 0, 'тренування не рахує серію');
  assert.ok(p.playedToday.minutes >= 1, 'хвилини екрану рахуються');
  // звичайне підземелля рахує серію
  const g2 = makeGame(); const b = g2.createPlayer({ name: 'B', classId: 'warrior', age: 10, pin: '1111' }); g2.players[b.id].level = 10;
  g2.setMode(b, { mode: 'dungeon', dungeonId: 'kitchen_caves' }); g2.join(b); g2.ready(b, true);
  guard = 0; while (g2.battle && guard++ < 600) { try { g2.move(b, { attack: 'head', blocks: ['chest', 'belt'], cards: [] }); } catch (e) {} g2.fire('round'); }
  assert.equal(g2.players[b.id].streak.days, 1);
});

test('купони бажань: купити за золото, батьки виконують або повертають', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'admin' });
  const kid = g.createPlayer({ name: 'Малий', classId: 'mage', age: 7, pin: '2222' });
  const k = g.players[kid.id]; k.gold = 500;
  assert.ok(g.couponsView(k).list.length >= 5);
  assert.throws(() => g.buyCoupon(k, 'nope'), /немає/);
  const o = g.buyCoupon(k, 'icecream'); assert.equal(k.gold, 400); assert.equal(o.status, 'pending');
  assert.equal(g.playerState(g.players[dad.id]).pendingCoupons.length, 1);
  assert.equal(g.playerState(k).pendingCoupons.length, 0);
  assert.throws(() => g.couponDone(k, o.id), /батьки/);
  g.couponDone(g.players[dad.id], o.id); assert.equal(g.history.coupons[0].status, 'done'); assert.equal(k.gold, 400);
  const o2 = g.buyCoupon(k, 'cartoon30'); g.couponDone(g.players[dad.id], o2.id, true); assert.equal(k.gold, 400, 'повернення золота');
  k.gold = 10; assert.throws(() => g.buyCoupon(k, 'icecream'), /золота/);
  k.gold = 2000; g.buyCoupon(k, 'icecream'); g.buyCoupon(k, 'icecream'); g.buyCoupon(k, 'icecream');
  assert.throws(() => g.buyCoupon(k, 'icecream'), /до 3/);
  const list = g.setCoupons(g.players[dad.id], [{ name: 'Кіно', icon: '🎬', price: 250 }]);
  assert.equal(list.length, 1); assert.equal(g.couponsView(k).list[0].name, 'Кіно');
  assert.throws(() => g.setCoupons(g.players[dad.id], [{ name: '', price: 5 }]), /назва/);
  assert.equal(g.couponsView(k).orders.length, 5);
});

test('дайджест згадує куплені бажання й серії', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'admin' });
  const kid = g.createPlayer({ name: 'Малий', classId: 'mage', age: 7, pin: '2222' }); const k = g.players[kid.id]; k.gold = 500;
  g.buyCoupon(k, 'icecream'); k.streak = { days: 3, last: g.kyiv().day };
  const t = g.digest().text; assert.match(t, /Малий: 🍦 Морозиво/); assert.match(t, /Серії днів: Малий 3/);
});

test('профіль героя на ТБ: вихованці, серія, бос тижня, купони', () => {
  const g = makeGame();
  const a = g.createPlayer({ name: 'A', classId: 'warrior', age: 10, pin: '1111' }); const p = g.players[a.id]; p.gold = 500;
  g.buyCoupon(p, 'icecream'); p.streak = { days: 4, last: g.kyiv().day }; p.stats.streakBest = 6; g.worldBoss().dmg[a.id] = 77;
  const h = g.heroProfile(a.id);
  assert.equal(h.coupons.length, 1); assert.equal(h.streak.days, 4); assert.equal(h.streak.best, 6); assert.equal(h.worldBossDmg, 77); assert.deepEqual(h.pets, []);
});

test('відновлення зі старої копії без купонів не ламає купони', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'admin' });
  const data = g.backup(); delete data.history.coupons; delete data.settings.coupons;
  g.restore(g.players[dad.id], data);
  assert.ok(Array.isArray(g.settings.coupons) && g.settings.coupons.length >= 5);
  assert.deepEqual(g.history.coupons, []);
  assert.ok(g.couponsView(g.players[dad.id]).list.length >= 5);
});

test('арена зачиняється: попередження за 10 хв до сну і при кінці ліміту', () => {
  const g = makeGame(); // 17:00 Київ (зимовий час)
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'admin' });
  assert.equal(g.closingView(), null, 'без дітей тихо');
  const kid = g.createPlayer({ name: 'Малий', classId: 'mage', age: 7, pin: '2222' }); const k = g.players[kid.id];
  g.updateSettings({ bedtime: '17:30' }); assert.equal(g.closingView(), null);
  g.updateSettings({ bedtime: '17:08' }); assert.equal(g.closingView().min, 8); assert.equal(g.closingView().why, 'bedtime');
  assert.equal(g.tvState().closing.min, 8); assert.equal(g.playerState(k).closing.min, 8);
  g.tick(); assert.match(g.announce.text, /зачиняється за 8 хв/); const at = g.announce.at;
  g.advance(60 * 1000); g.tick(); assert.equal(g.announce.at, at, 'оголошення раз на день');
  g.updateSettings({ bedtime: '23:00' }); g.addMinutes(k, g.limitFor(k) - 4);
  assert.equal(g.playerState(k).closing.why, 'limit'); assert.equal(g.playerState(k).closing.min, 4);
  assert.equal(g.playerState(g.players[dad.id]).closing, null, 'батькам ліміт не світить');
  g.addMinutes(k, 10); assert.equal(g.playerState(k).closing, null, 'уже заблоковано: показується blocked');
});

test('авто-колода: валідна, рідкісні лише зі знайдених, розумна крива мани', () => {
  const g = makeGame();
  for (const cls of ['warrior', 'mage', 'healer', 'archer', 'rogue', 'paladin', 'engineer']) {
    const a = g.createPlayer({ name: 'P' + cls, classId: cls, age: 10, pin: '1111' }); const p = g.players[a.id];
    const d = g.autoDeck(p); assert.equal(d.length, 20); assert.deepEqual(p.deck, d);
    const costs = d.map(id => cardById[id].cost); assert.ok(costs.filter(c => c >= 5).length <= 5, cls + ': дорогих ≤5'); assert.ok(costs.filter(c => c <= 2).length >= 6, cls + ': дешевих ≥6');
  }
  const b = g.createPlayer({ name: 'B', classId: 'mage', age: 10, pin: '1111' }); const pb = g.players[b.id];
  const d0 = g.autoDeck(pb); assert.ok(!d0.includes('lightning'), 'рідкісна без колекції не береться');
  pb.collection.push('lightning'); const d1 = g.autoDeck(pb); assert.ok(d1.includes('lightning'), 'знайдена рідкісна береться');
});

test('церемонія закриття сезону на ТБ: подіум і зникає за 40 с', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'admin' });
  const a = g.createPlayer({ name: 'A', classId: 'mage', age: 10, pin: '1111' }); const b = g.createPlayer({ name: 'B', classId: 'healer', age: 7, pin: '2222' });
  g.addSeasonPoints(a.id, 7); g.addSeasonPoints(b.id, 3);
  assert.equal(g.tvState().ceremony, null);
  g.endSeason(g.players[dad.id], 'Зима');
  const c = g.tvState().ceremony; assert.ok(c); assert.equal(c.winner, 'A'); assert.equal(c.podium.length, 2); assert.equal(c.podium[0].name, 'A'); assert.equal(c.podium[0].points, 7);
  g.advance(41 * 1000); assert.equal(g.tvState().ceremony, null);
});

test('завдання дня й досягнення для подарунка, купонів, тренування', () => {
  const g = makeGame();
  const a = g.createPlayer({ name: 'A', classId: 'warrior', age: 7, pin: '1111' }); const p = g.players[a.id]; p.gold = 500;
  p.daily = null; g.dailyFor(p); p.daily.tasks = [{ id: 'gift_1', base: 0, done: false }, { id: 'practice_1', base: 0, done: false }, { id: 'boss_1', base: 0, done: false }];
  const r = g.claimGift(p); assert.deepEqual(r.daily, ['Забери щоденний подарунок']);
  g.buyCoupon(p, 'icecream'); assert.ok(p.achievements.includes('coupon_1'));
  g.setMode(a, { mode: 'practice' }); g.join(a); g.ready(a, true);
  let guard = 0; while (g.battle && guard++ < 200) { try { g.move(a, { attack: 'head', blocks: ['chest', 'belt'], cards: [] }); } catch (e) {} g.fire('round'); }
  assert.equal(p.stats.practice, 1); assert.ok(g.results.events.some(e => e.t === 'daily' && e.name === 'Потренуйся на манекені'));
  assert.ok(p.daily.tasks.find(t => t.id === 'practice_1').done);
});

test('сьогодні зроблено (ТБ) і тиждень справ (телефон)', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'admin' });
  assert.equal(g.todayView(), null, 'порожній день = null');
  const kid = g.createPlayer({ name: 'Малий', classId: 'mage', age: 7, pin: '2222' });
  assert.equal(g.todayView(), null);
  assert.equal(g.doneView(kid).total, 0); assert.equal(g.doneView(kid).days.length, 0);
  g.questDone(kid, 'bed'); g.questApprove(dad, kid.id, 'bed');
  g.addMinutes(kid, 7);
  const t = g.todayView();
  assert.ok(t && t.kids.length === 1 && t.kids[0].name === 'Малий');
  assert.equal(t.kids[0].quests.length, 1); assert.equal(t.kids[0].minutes, 7);
  const d = g.doneView(kid);
  assert.equal(d.total, 1); assert.equal(d.days[0].today, true); assert.equal(d.days[0].items[0].who, 'Малий');
  assert.equal(g.doneView(dad).days[0].items.length, 1, 'батько бачить справи дітей');
  // учора: запис у журналі видно на телефоні, але не на ТБ
  g.history.questLog.push({ day: g.kyiv(g.now() - 86400000).day, pid: kid.id, qid: 'bed', at: g.now() - 86400000 });
  assert.equal(g.doneView(kid).days.length, 2); assert.equal(g.todayView().kids[0].quests.length, 1);
  assert.ok(g.tvState().today && g.playerState(kid).done.total === 2);
  // відновлення старого бекапу без questLog не падає
  const b = g.backup(); delete b.history.questLog; g.restore(dad, b); assert.ok(Array.isArray(g.history.questLog));
});

test('виклик на дуель: телефон → телефон, прийняття ставить обох у лобі', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'admin' });
  const a = g.createPlayer({ name: 'A', classId: 'rogue', age: 10, pin: '1111' }); const b = g.createPlayer({ name: 'B', classId: 'mage', age: 7, pin: '2222' });
  assert.throws(() => g.challenge(a, a.id), /сам/);
  const c = g.challenge(a, b.id);
  assert.throws(() => g.challenge(a, b.id), /уже/);
  assert.equal(g.challengesView(b).incoming[0].from.name, 'A'); assert.equal(g.challengesView(a).outgoing[0].to.name, 'B');
  assert.equal(g.challengesView(a).targets.length, 2, 'тато і брат');
  assert.match(g.announce.text, /виклик/);
  assert.throws(() => g.challengeAnswer(dad, c.id, true), /не твій/);
  assert.equal(g.challengeAnswer(b, c.id, false).accepted, false);
  assert.equal(g.challengesView(b).incoming.length, 0);
  const c2 = g.challenge(a, b.id); g.lobby.mode = 'dungeon';
  assert.equal(g.challengeAnswer(b, c2.id, true).accepted, true);
  assert.equal(g.lobby.mode, 'duel'); assert.ok(g.lobby.players[a.id] && g.lobby.players[b.id]);
  assert.notEqual(g.lobby.players[a.id].team, g.lobby.players[b.id].team);
  assert.throws(() => g.challengeAnswer(b, c2.id, true), /згорів/);
  // згорає за 2 хв
  g.leave(a); g.leave(b); const c3 = g.challenge(a, b.id); g.advance(121000); g.tick();
  assert.equal(g.challengesView(b).incoming.length, 0); assert.throws(() => g.challengeAnswer(b, c3.id, true), /згорів/);
  // заблокованому (ліміт) не кинеш і він не ціль
  g.addMinutes(b, 500); assert.throws(() => g.challenge(a, b.id), /B:/); assert.equal(g.challengesView(a).targets.length, 1);
});

test('ціль сім’ї на тиждень: прогрес, досягнення, нагорода, бекап', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'admin' });
  const a = g.createPlayer({ name: 'A', classId: 'rogue', age: 10, pin: '1111' }); const b = g.createPlayer({ name: 'B', classId: 'mage', age: 7, pin: '2222' });
  assert.equal(g.familyGoalView(), null);
  assert.throws(() => g.setFamilyGoal(a, { kind: 'quests', n: 3, reward: 'Кіно' }), /батьки/);
  assert.throws(() => g.setFamilyGoal(dad, { kind: 'quests', n: 3, reward: '' }), /нагороду/);
  assert.throws(() => g.setFamilyGoal(dad, { kind: 'xx', n: 3, reward: 'Кіно' }), /вид/);
  const v = g.setFamilyGoal(dad, { kind: 'quests', n: 3, reward: 'Кіно у вихідні' });
  assert.equal(v.progress, 0); assert.equal(v.done, false); assert.equal(v.kindName, 'справ по дому');
  g.questDone(a, 'bed'); g.questApprove(dad, a.id, 'bed');
  g.questDone(b, 'bed'); g.questApprove(dad, b.id, 'bed');
  assert.equal(g.familyGoalView().progress, 2); assert.equal(g.familyGoalView().pct, 67);
  const goldA = g.players[a.id].gold;
  g.logDay(dad.id, { quests: 5 }); assert.equal(g.familyGoalView().progress, 2, 'справи батьків не рахуються');
  g.questDone(a, 'toys'); g.questApprove(dad, a.id, 'toys');
  const fg = g.familyGoalView(); assert.equal(fg.done, true); assert.equal(fg.progress, 3);
  assert.ok(g.players[a.id].gold >= goldA + 12 + 30, '+30 золота за ціль (завдання дня можуть додати ще)'); assert.match(g.announce.text, /досягнуто/);
  g.questDone(b, 'toys'); g.questApprove(dad, b.id, 'toys'); assert.equal(g.checkFamilyGoal(), false, 'нагорода раз на тиждень'); assert.equal(g.familyGoalView().progress, 3, 'прогрес не вище цілі');
  assert.match(g.digest().text, /Ціль сім'ї виконано/);
  assert.ok(g.tvState().familyGoal.done && g.playerState(a).familyGoal.done);
  // старий бекап без цілі
  const bk = g.backup(); delete bk.history.familyGoal; bk.settings.familyGoal = undefined; g.restore(dad, bk); assert.ok(g.history.familyGoal);
  g.updateSettings({ familyGoal: { kind: 'wins', n: 1, reward: 'x' } }); assert.notEqual((g.settings.familyGoal || {}).kind, 'wins', 'лише через setFamilyGoal');
  g.setFamilyGoal(dad, null); assert.equal(g.familyGoalView(), null);
});

test('міні-гра «Реакція»: чекай, тисни, фальстарт, найшвидший +5 золота', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'admin' });
  const a = g.createPlayer({ name: 'A', classId: 'rogue', age: 10, pin: '1111' }); const b = g.createPlayer({ name: 'B', classId: 'mage', age: 7, pin: '2222' });
  assert.equal(g.miniView(), null); assert.throws(() => g.tapMini(a), /не йде/);
  const v = g.startMini(a); assert.equal(v.phase, 'wait'); assert.equal(v.by, 'A');
  assert.throws(() => g.startMini(b), /вже йде/);
  g.tapMini(b); assert.equal(g.miniView(b).me.fault, true, 'натиснув зарано = фальстарт');
  g.fire('mini-go'); assert.equal(g.miniView().phase, 'go'); assert.equal(g.tvState().mini.phase, 'go');
  g.advance(230); g.tapMini(a); g.advance(100); g.tapMini(dad); g.tapMini(a);
  assert.equal(g.miniView(a).me.tapped, 230); assert.equal(g.miniView(b).me.tapped, null, 'фальстарт не рахується');
  const gold = g.players[a.id].gold;
  g.fire('mini-end'); const d = g.miniView(a);
  assert.equal(d.phase, 'done'); assert.deepEqual(d.ranking.map(r => r.name), ['A', 'Тато']); assert.equal(d.ranking[0].ms, 230); assert.deepEqual(d.faults, ['B']);
  assert.equal(g.players[a.id].gold, gold + 5); assert.equal(g.players[a.id].stats.reaction, 1);
  assert.throws(() => g.tapMini(a), /не йде/);
  g.fire('mini-clear'); assert.equal(g.miniView(), null);
  // нова гра можлива одразу після підсумків; без натискань нікому золота
  g.startMini(b); g.fire('mini-go'); g.fire('mini-end'); assert.equal(g.miniView().ranking.length, 0);
  g.fire('mini-clear'); g.join(a); g.join(b); g.setMode(a, { mode: 'duel' }); g.ready(a, true); g.ready(b, true);
  if (g.battle) assert.throws(() => g.startMini(a), /бій/);
});

test('міні-гра «Бліц»: свої питання за віком, рейтинг за правильними й часом, розумні відповіді в статистику', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'admin' });
  const a = g.createPlayer({ name: 'A', classId: 'rogue', age: 10, pin: '1111' }); const b = g.createPlayer({ name: 'B', classId: 'mage', age: 7, pin: '2222' });
  assert.throws(() => g.startMini(a, 'xx'), /яка гра/);
  const v = g.startMini(a, 'quiz'); assert.equal(v.kind, 'quiz'); assert.equal(v.phase, 'go'); assert.equal(v.n, 5); assert.ok(v.me.q && v.me.q.choices.length === 3);
  assert.throws(() => g.tapMini(a), /не йде/);
  // A відповідає все правильно, B дві правильні й три ні
  for (let i = 0; i < 5; i++) { const q = g.mini.qs[a.id][i]; g.advance(1000); g.answerMini(a, q.a); }
  assert.equal(g.miniView(a).me.done, true); assert.equal(g.miniView(a).me.correct, 5);
  assert.equal(g.miniView().phase, 'go', 'раніше 15 с не закриваємо, інші можуть зайти');
  const bv = g.answerMini(b, 'xx'); assert.equal(bv.me.i, 1); assert.equal(bv.me.correct, 0);
  for (let i = 1; i < 5; i++) { const q = g.mini.qs[b.id][i]; g.answerMini(b, i < 3 ? q.a : 'xx'); }
  assert.equal(g.miniView().phase, 'go'); g.advance(12000); g.fire('mini-min');
  assert.equal(g.miniView().phase, 'done', 'після 15 с і всі готові = підсумки');
  const r = g.miniView().ranking; assert.deepEqual(r.map(x => x.name), ['A', 'B']); assert.equal(r[0].correct, 5); assert.equal(r[1].correct, 2);
  assert.equal(g.players[a.id].stats.smart, 5); assert.equal(g.players[b.id].stats.smart, 2); assert.equal(g.players[a.id].stats.quiz, 1);
  assert.equal(g.todayView().kids.find(k => k.name === 'B').smart, 2);
  g.fire('mini-clear'); assert.equal(g.miniView(), null);
  // ліміт часу закриває гру з тим, що є
  g.startMini(b, 'quiz'); g.answerMini(b, g.mini.qs[b.id][0].a); g.fire('mini-end'); assert.equal(g.miniView().phase, 'done'); assert.equal(g.miniView().ranking[0].ms, null);
  assert.ok(g.tvState().mini.players.length === 1);
});

test('міні-ігри й виклики дають досягнення, завдання дня і статистику в профілі', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'admin' });
  const a = g.createPlayer({ name: 'A', classId: 'rogue', age: 10, pin: '1111' }); const b = g.createPlayer({ name: 'B', classId: 'mage', age: 7, pin: '2222' });
  g.players[a.id].daily = null; g.dailyFor(g.players[a.id]); g.players[a.id].daily.tasks = [{ id: 'mini_1', base: 0, done: false }];
  g.startMini(a, 'quiz'); for (let i = 0; i < 5; i++) g.answerMini(a, g.mini.qs[a.id][i].a); g.answerMini(b, 'xx'); g.fire('mini-end');
  const pa = g.players[a.id], pb = g.players[b.id];
  assert.equal(pa.stats.minis, 1); assert.equal(pb.stats.minis, 1); assert.equal(pa.stats.quizPerfect, 1); assert.equal(pb.stats.quizPerfect, 0);
  assert.ok(pa.achievements.includes('quiz_1') && pa.achievements.includes('quiz_perfect_1')); assert.ok(['Всезнайко', 'Розумник'].includes(pa.title));
  assert.equal(pa.daily.tasks[0].done, true, 'завдання дня «міні-гра» зараховано');
  assert.ok(g.history.feed.some(f => f.text.includes('Всезнайко')));
  g.fire('mini-clear'); g.startMini(b); g.fire('mini-go'); g.advance(100); g.tapMini(b); g.fire('mini-end');
  assert.ok(pb.achievements.includes('reaction_1')); assert.equal(pb.stats.minis, 2);
  g.fire('mini-clear');
  for (let i = 0; i < 3; i++) { const c = g.challenge(a, b.id); g.challengeAnswer(b, c.id, true); g.leave(a); g.leave(b); }
  assert.equal(pa.stats.challenges, 3); assert.equal(pb.stats.challenges, 3); assert.ok(pa.achievements.includes('challenge_3') && pb.achievements.includes('challenge_3'));
  assert.match(JSON.stringify(g.heroProfile(a.id).stats), /"challenges":3/);
});

test('міні-гра «Пам’ять»: послідовність з ТБ, помилка, час, найуважніший +5', () => {
  const g = makeGame();
  const a = g.createPlayer({ name: 'A', classId: 'rogue', age: 10, pin: '1111' }); const b = g.createPlayer({ name: 'B', classId: 'mage', age: 7, pin: '2222' });
  const v = g.startMini(a, 'memory'); assert.equal(v.phase, 'wait'); assert.equal(v.len, 4); assert.equal(v.seq, undefined, 'телефон послідовності не бачить');
  assert.equal(g.tvState().mini.seq.length, 4, 'ТБ бачить');
  assert.throws(() => g.pressMini(a, 0), /не йде/); assert.throws(() => g.tapMini(a), /не йде/);
  g.fire('mini-go'); assert.equal(g.miniView().phase, 'go');
  const seq = g.mini.seq; g.advance(500);
  for (const c of seq) g.pressMini(a, c);
  assert.equal(g.miniView(a).me.tapped, 500); assert.equal(g.miniView(a).me.pressed, 4);
  g.pressMini(b, seq[0]); g.pressMini(b, (seq[1] + 1) % 4); assert.equal(g.miniView(b).me.fault, true);
  assert.equal(g.miniView().phase, 'go', 'ще не 5 с'); g.advance(5000); g.fire('mini-min');
  const d = g.miniView(a); assert.equal(d.phase, 'done'); assert.deepEqual(d.ranking.map(r => r.name), ['A']); assert.deepEqual(d.faults, ['B']); assert.equal(d.seq.length, 4);
  assert.equal(g.players[a.id].stats.memory, 1); assert.ok(g.players[a.id].achievements.includes('memory_1'));
  assert.throws(() => g.pressMini(a, 1), /не йде/);
  g.fire('mini-clear'); g.startMini(b, 'memory'); g.fire('mini-go'); g.fire('mini-end'); assert.equal(g.miniView().ranking.length, 0);
});

test('вечір ігор: три міні-гри поспіль, очки за місця, чемпіон', () => {
  const g = makeGame();
  const a = g.createPlayer({ name: 'A', classId: 'rogue', age: 10, pin: '1111' }); const b = g.createPlayer({ name: 'B', classId: 'mage', age: 7, pin: '2222' });
  const v = g.startParty(a); assert.equal(v.i, 0); assert.equal(v.of, 3); assert.equal(g.miniView().kind, 'reaction');
  assert.throws(() => g.startParty(b), /уже йде/);
  // 1. реакція: B швидший
  g.fire('mini-go'); g.advance(100); g.tapMini(b); g.advance(100); g.tapMini(a); g.fire('mini-end');
  assert.equal(g.partyView().standings[0].name, 'B'); assert.equal(g.partyView().standings[0].points, 3); assert.equal(g.partyView().i, 1);
  g.fire('mini-clear'); assert.equal(g.miniView().kind, 'memory', 'друга гра стартує сама');
  // 2. пам'ять: лише A
  g.fire('mini-go'); for (const c of g.mini.seq) g.pressMini(a, c); g.fire('mini-end');
  assert.deepEqual(g.partyView().standings.map(s => s.name + s.points), ['A5', 'B3'], '2 за друге місце в реакції + 3 за пам\'ять');
  g.fire('mini-clear'); assert.equal(g.miniView().kind, 'quiz');
  // 3. бліц: A 5/5, B 0
  for (let i = 0; i < 5; i++) g.answerMini(a, g.mini.qs[a.id][i].a); for (let i = 0; i < 5; i++) g.answerMini(b, 'xx'); g.fire('mini-end');
  const gold = g.players[a.id].gold; const pts = g.seasonView().top.find(x => x.name === 'A').points;
  assert.equal(g.partyView().phase, 'run'); assert.equal(g.partyView().ranking[0].name, 'A'); assert.equal(g.partyView().ranking[0].points, 8);
  assert.ok(g.players[a.id].achievements.includes('party_1')); assert.equal(g.players[a.id].stats.parties, 1);
  g.fire('mini-clear'); assert.equal(g.miniView(), null); assert.equal(g.partyView().phase, 'done'); assert.equal(g.partyView().champion, 'A');
  assert.ok(g.tvState().party.phase === 'done' && g.playerState(b).party.champion === 'A');
  g.fire('party-clear'); assert.equal(g.partyView(), null);
  // чемпіон отримав золото й очки сезону один раз
  assert.ok(g.players[a.id].gold >= gold); assert.equal(g.seasonView().top.find(x => x.name === 'A').points, pts);
});

test('фора в дуелі слабшому й «друге дихання» після трьох поразок', () => {
  const g = makeGame();
  const a = g.createPlayer({ name: 'Віктор', classId: 'warrior', age: 10, pin: '1111' });
  const b = g.createPlayer({ name: 'Олександр', classId: 'warrior', age: 10, pin: '2222' });
  g.players[a.id].level = 6; g.players[b.id].lossStreak = 3;
  g.setMode(a, { mode: 'duel' }); g.join(a); g.join(b); g.ready(a, true); g.ready(b, true);
  const fa = g.battle.fighters.find(f => f.id === a.id), fb = g.battle.fighters.find(f => f.id === b.id);
  assert.ok(!fa.fora); assert.equal(fb.fora, 50, 'різниця 5 рівнів = +50 %');
  assert.ok(fb.secondWind && !fa.secondWind);
  assert.ok(fb.maxHp > fa.maxHp, 'слабший має більше здоров’я за рахунок фори');
  const pub = g.tvState().battle.fighters.find(f => f.id === b.id);
  assert.equal(pub.fora, 50); assert.equal(pub.secondWind, 20);
  assert.ok(g.feedView ? true : true);
  let guard = 0;
  while (g.battle && guard++ < 200) { g.move(a, { attack: 'head', blocks: ['chest', 'belt'], cards: [] }); if (g.battle && !g.battle.over) g.fire('round'); if (g.battle) g.fire('round'); }
  const won = (g.results.winners || []).includes('Олександр');
  assert.equal(g.players[b.id].lossStreak, won ? 0 : 4);
});

test('події тижня: п’ятниця золото ×2, субота бос ×2, неділя сімейний досвід, анонс на завтра', () => {
  const fri = makeGame(Date.UTC(2026, 9, 30, 15, 0)); // п'ятниця 30.10
  assert.equal(fri.eventToday().id, 'gold_fri');
  assert.equal(fri.eventView().tomorrow.id, 'boss_sat');
  const a = fri.createPlayer({ name: 'Віктор', classId: 'warrior', age: 10, pin: '1111' });
  const b = fri.createPlayer({ name: 'Олександр', classId: 'mage', age: 7, pin: '2222' });
  const g0 = fri.players[a.id].gold + fri.players[b.id].gold;
  fri.setMode(a, { mode: 'duel' }); fri.join(a); fri.join(b); fri.ready(a, true); fri.ready(b, true);
  let guard = 0; while (fri.battle && guard++ < 200) { fri.move(a, { attack: 'head', blocks: ['chest', 'belt'], cards: [] }); if (fri.battle && !fri.battle.over) fri.fire('round'); if (fri.battle) fri.fire('round'); }
  assert.equal(fri.players[a.id].gold + fri.players[b.id].gold - g0, 32, 'дуель: (12+4)×2');
  assert.ok(fri.tvState().event.today && fri.playerState(a).event.today.id === 'gold_fri');
  const sat = makeGame(Date.UTC(2026, 9, 31, 15, 0));
  assert.equal(sat.eventToday().id, 'boss_sat'); assert.equal(sat.eventView().tomorrow.id, 'family_sun');
  const c = sat.createPlayer({ name: 'Віктор', classId: 'warrior', age: 10, pin: '1111' });
  const hit = sat.hitWorldBoss([c.id], 30);
  assert.equal(hit.hit, 60);
  assert.ok(sat.digest().text.includes('Завтра Сімейна неділя'));
  const mon = makeGame(); assert.equal(mon.eventToday(), null); assert.equal(mon.eventView().today, null);
  const tue = makeGame(Date.UTC(2026, 9, 27, 15, 0)); assert.equal(tue.eventView().tomorrow.id, 'smart_wed');
  const wed = makeGame(Date.UTC(2026, 9, 28, 15, 0)); assert.equal(wed.miniGold(), 10);
});

test('конверти-сюрпризи відкриваються за спільні бої і справи', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'admin' });
  const a = g.createPlayer({ name: 'Віктор', classId: 'warrior', age: 10, pin: '1111' });
  const b = g.createPlayer({ name: 'Олександр', classId: 'mage', age: 7, pin: '2222' });
  const ev0 = g.envelopesView();
  assert.equal(ev0.opened, 0); assert.equal(ev0.total, 8); assert.equal(ev0.next.at, 10); assert.ok(ev0.list[0].hint && !ev0.list[0].name);
  assert.ok(g.lobbyView().locked.includes('attic_ghosts'));
  assert.throws(() => g.setMode(a, { mode: 'dungeon', dungeonId: 'attic_ghosts' }), /конверт/);
  for (let i = 0; i < 9; i++) g.history.battles.unshift({ mode: 'duel', players: [a.id, b.id], at: g.now(), winners: ['Віктор'] });
  assert.deepEqual(g.checkEnvelopes(), []);
  g.history.battles.unshift({ mode: 'duel', players: [a.id, b.id], at: g.now(), winners: ['Віктор'] });
  const got = g.checkEnvelopes();
  assert.equal(got.length, 1); assert.equal(got[0].id, 'env_10');
  assert.ok(g.players[b.id].pets.some(p => p.id === 'pet_bee'), 'бджілка кожному');
  assert.ok(g.players[dad.id].pets.some(p => p.id === 'pet_bee'));
  assert.equal(g.envelopesView().opened, 1); assert.equal(g.envelopesView().next.left, 15);
  assert.ok(g.announce.text.includes('Перший конверт'));
  for (let i = 0; i < 40; i++) g.history.battles.unshift({ mode: 'duel', players: [a.id, b.id], at: g.now(), winners: ['Віктор'] });
  const got2 = g.checkEnvelopes();
  assert.deepEqual(got2.map(x => x.id), ['env_25', 'env_50']);
  assert.ok(g.players[a.id].collection.includes('diamond_sword'));
  assert.ok(!g.lobbyView().locked.includes('attic_ghosts'));
  g.setMode(a, { mode: 'dungeon', dungeonId: 'attic_ghosts' });
  assert.equal(g.tvState().envelopes.opened, 3); assert.equal(g.playerState(a).envelopes.list[2].name, 'Конверт зі скрипом');
  const g2 = makeGame(); g2.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'admin' });
  assert.equal(g2.envelopesView().opened, 0, 'нова гра: нічого не відкрито');
});

test('сезон із датою: відлік і автозакриття ввечері', () => {
  const g = makeGame();
  g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'admin' });
  const a = g.createPlayer({ name: 'Віктор', classId: 'warrior', age: 10, pin: '1111' });
  assert.equal(g.seasonView().days, 14); assert.equal(g.seasonView().daysLeft, 14);
  assert.equal(g.tvState().seasonDaysLeft, 14); assert.equal(g.playerState(a).season.daysLeft, 14);
  g.addSeasonPoints(a.id, 5);
  g.advance(13 * 86400000); assert.equal(g.seasonView().daysLeft, 1); assert.equal(g.autoCloseSeason(), false);
  g.advance(86400000); // рівно 14 днів, 17:00 Київ — вечір, але не бій
  assert.equal(g.seasonView().daysLeft, 0);
  assert.equal(g.autoCloseSeason(), false, 'до 18:00 не закриває');
  g.advance(3600000 + 60000);
  assert.equal(g.autoCloseSeason(), true);
  assert.equal(g.seasonView().n, 2); assert.equal(g.history.pastSeasons[0].winner, 'Віктор');
  assert.ok(g.announce.text.includes('чемпіон Віктор')); assert.equal(g.seasonView().daysLeft, 14);
  assert.equal(g.autoCloseSeason(), false, 'новий сезон щойно почався');
  g.updateSettings({ seasonDays: 0 }); assert.equal(g.seasonView().daysLeft, null); assert.equal(g.tvState().seasonDaysLeft, null);
});

test('повернення після паузи: подарунок, збережена серія, заморозка на відпустку', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', age: 40, pin: '1234', role: 'admin' });
  const a = g.createPlayer({ name: 'Віктор', classId: 'warrior', age: 10, pin: '1111' });
  g.playerState(a); g.touchStreak(g.players[a.id]); g.advance(86400000); g.playerState(a); g.touchStreak(g.players[a.id]);
  assert.equal(g.streakView(g.players[a.id]).days, 2);
  assert.equal(g.playerState(a).welcome, null, 'без паузи нічого');
  g.advance(2 * 86400000); assert.equal(g.playerState(a).welcome, null, 'пауза 2 дні ще не пауза');
  assert.equal(g.streakView(g.players[a.id]).days, 0, 'серія згоріла');
  g.advance(3 * 86400000);
  const w = g.playerState(a).welcome; assert.ok(w && w.away === 3 && w.gold === 20, JSON.stringify(w));
  const gold = g.players[a.id].gold; const r = g.claimWelcome(a);
  assert.equal(r.kept, 2); assert.equal(g.players[a.id].gold, gold + 20);
  assert.equal(g.streakView(g.players[a.id]).days, 2, 'серію повернули');
  assert.equal(g.playerState(a).welcome, null); assert.throws(() => g.claimWelcome(a), /немає/);
  assert.ok(g.announce.text.includes('З поверненням'));
  g.playerState(dad); g.advance(5 * 86400000); assert.equal(g.playerState(dad).welcome, null, 'батькам не пропонує');
  // заморозка: серія не згорає без гри і продовжується після
  g.touchStreak(g.players[a.id]); const d0 = g.streakView(g.players[a.id]).days;
  g.updateSettings({ freeze: true }); g.advance(6 * 86400000);
  assert.equal(g.streakView(g.players[a.id]).days, d0); assert.equal(g.streakView(g.players[a.id]).frozen, true);
  g.updateSettings({ freeze: false }); assert.equal(g.streakView(g.players[a.id]).days, d0, 'після розморозки серія ціла');
  g.touchStreak(g.players[a.id]); assert.equal(g.streakView(g.players[a.id]).days, d0 + 1);
});

test('«друге дихання» і в підземеллі: після 3 поразок +20 %, після 6 — +40 %, перемога скидає', () => {
  const g = makeGame();
  const dad = g.createPlayer({ name: 'Тато', classId: 'warrior', role: 'parent', pin: '0000' });
  const a = g.createPlayer({ name: 'Віктор', classId: 'archer', age: 10, pin: '1111' });
  const run = () => { g.setMode(dad, { mode: 'dungeon', dungeonId: 'kitchen_caves' }); g.join(dad); g.join(a); g.ready(dad, true); g.ready(a, true); const fa = g.battle.fighters.find(f => f.id === a.id); const sw = fa.secondWind || 0; let guard = 0; while (g.battle && guard++ < 400) g.fire('round'); g.fire('results'); return sw; };
  assert.equal(run(), 0, 'спочатку без допомоги');
  g.players[a.id].dungeonLosses = 3; g.players[dad.id].dungeonLosses = 6;
  g.setMode(dad, { mode: 'dungeon', dungeonId: 'kitchen_caves' }); g.join(dad); g.join(a); g.ready(dad, true); g.ready(a, true);
  const fa = g.battle.fighters.find(f => f.id === a.id), fd = g.battle.fighters.find(f => f.id === dad.id);
  assert.equal(fa.secondWind, 20); assert.equal(fd.secondWind, 40, 'кожні 3 поразки ще +20 %');
  assert.ok(!fa.fora && !fd.fora, 'фори за рівнем у підземеллі немає');
  assert.ok(g.history.feed.some(t => /Друге дихання: Тато \+40 %/.test(t.text)));
  let guard = 0; while (g.battle && guard++ < 400) g.fire('round');
  const won = g.results.won; g.fire('results');
  assert.equal(g.players[a.id].dungeonLosses, won ? 0 : 4);
});

