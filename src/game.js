// Гра як єдиний стан у пам'яті: гравці (збережені), лобі, поточний бій, таймери раундів, нагороди, квести, ліміти.
// Усе, що бачать телефон і ТБ, береться з tvState() і playerState(); зміни розсилаються слухачам (SSE у server.js).
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeRng } from './engine/rng.js';
import { VERSION_DATA } from './version.js';
import { statSync } from 'node:fs';
import { createBattle, applyFora, fighterFromPlayer, fighterFromMob, submitMove, resolveRound, publicFighter, alive, enemiesOf, MAX_CARDS_PER_TURN } from './engine/combat.js';
import { newPlayer, addXp, xpForLevel, equipmentBonus, genItem, genCard, equip, unequip, craft, checkAchievements, setDeck, autoDeck, sellPrice, genPet, grantPet, petView, petOf, activePetIcon } from './engine/progress.js';
import { makeQuiz, checkQuiz } from './engine/quiz.js';
import { CLASSES, CARDS, DUNGEONS, QUESTS, ACHIEVEMENTS, DAILY, FAMILY, WORLDBOSS, PETS, CAMPAIGN, COSMETICS, MUTATORS, EVENTS, ENVELOPES, ITEMS, petById, ZONES, ZONE_NAMES, classById, dungeonById, mobById, questById, cardById, starterDeck, allowedCards } from './engine/content.js';

export const ROUND_SECONDS = 30;
const cryText = (id) => { const c = COSMETICS.cries.find(x => x.id === id); return c ? c.text : null; };
const RESULTS_SECONDS = 25;
const ROOM_HEAL = 0.3;
const REPLAY_FRAMES = 80;
const CUSTOM_CARD_MAX = 3;
const GUEST_MAX = 3;      // друзів у гостях одночасно
const CUSTOM_MOB_MAX = 2; // своїх монстрів на дитину
const MOB_POINTS = 10;    // очок на сила/здоров'я/хитрість
/** Шаблони «своїх карт»: дитина малює картинку й дає назву, сила з шаблону, щоб баланс не ламався. */
export const CARD_TEMPLATES = {
  strike: { name: 'Удар', cost: 2, type: 'damage', value: 12, text: '12 шкоди.' },
  big_strike: { name: 'Могутній удар', cost: 4, type: 'damage', value: 24, critBonus: 0.2, text: '24 шкоди, шанс криту +20 %.' },
  shield: { name: 'Щит', cost: 2, type: 'shield', value: 14, text: 'Щит на 14.' },
  heal: { name: 'Зцілення', cost: 3, type: 'heal', value: 18, text: '+18 здоров’я.' },
  poison: { name: 'Отрута', cost: 2, type: 'poison', value: 5, turns: 3, text: '5 отрути на 3 ходи.' },
};
const SEASON_POINTS = { duelWin: 3, duelLoss: 1, dungeonLoss: 1, quest: 1, worldBoss: 5, chapter: 3, champion: 8, party: 3 };
const PARTY_GAMES = ['reaction', 'memory', 'quiz'];   // «Вечір ігор»: три міні-гри поспіль
const PARTY_NAMES = { reaction: '⚡ Реакція', memory: '🧩 Пам\'ять', quiz: '🧠 Бліц' };
const PARTY_POINTS = [3, 2, 1];   // очки за місця в кожній грі
const PARTY_GOLD = 15;   // чемпіону вечора
const PARTY_SHOW_MS = 12000;
const TOURNAMENT_MIN = 3, TOURNAMENT_MAX = 4;
/** Бос тижня: спільне здоров’я на всю сім’ю; кожен бій відколює шматок. Нагорода, коли впав. */
const DEFAULT_COUPONS = [
  { id: 'cartoon30', name: '30 хвилин мультиків', icon: '📺', price: 150 },
  { id: 'dinner', name: 'Обрати вечерю для всіх', icon: '🍕', price: 200 },
  { id: 'boardgame', name: 'Настілка з татом', icon: '🎲', price: 120 },
  { id: 'latebed', name: 'На 30 хв пізніше спати (вихідний)', icon: '🌙', price: 300 },
  { id: 'icecream', name: 'Морозиво', icon: '🍦', price: 100 },
];
const CLOSING_WARN_MIN = 10;
const MINI_GOLD = 5;   // золото найшвидшому в «Реакції»
const MINI_TAP_MS = 3000;   // скільки чекаємо натискань після «ТИСНИ!»
const MINI_SHOW_MS = 8000;   // скільки висять підсумки
const MEMORY_LEN = 4;   // довжина послідовності в «Пам'яті»
const MEMORY_STEP_MS = 800;   // показ одного кольору на ТБ
const MEMORY_INPUT_MS = 20000;   // час на повтор
const MEMORY_MIN_MS = 5000;   // раніше не закривати
const QUIZ_N = 5;   // питань у «Бліці»
const QUIZ_MS = 60000;   // ліміт «Бліцу»
const QUIZ_MIN_MS = 15000;   // раніше не закривати, щоб усі встигли зайти
const CHALLENGE_MS = 120000;   // виклик на дуель живе 2 хв
const CEREMONY_MS = 40000;   // церемонія закриття сезону на ТБ
const GIFT = { base: 10, perDay: 5, maxDays: 7, itemEvery: 7 };
const WELCOME = { afterDays: 3, gold: 20 };
const RECORDS = { bigHit: { name: 'Найсильніший удар', icon: '💥' }, runKills: { name: 'Найбільше ворогів за похід', icon: '⚔️' }, longDuel: { name: 'Найдовша дуель', icon: '🥊' }, streak: { name: 'Найдовша серія днів', icon: '🔥' } };
const BOOK_MOMENTS = 80;   // «з поверненням» після паузи: золото і збережена серія
const PET_DROP = 0.35;   // шанс вихованця за пройдене підземелля
const WORLD_BOSS = { duelWin: 30, duelLoss: 10, dungeonBase: 40, dungeonPerLevel: 15, dungeonPerKill: 3, dungeonLoss: 10, smartMult: 2, gold: 40 };

const DEFAULT_SETTINGS = {
  bedtime: '21:30', wakeup: '07:00', limitWeekday: 45, limitWeekend: 90, roundSeconds: ROUND_SECONDS,
  questsEnabled: true, season: 'Сезон 1: Перші кроки', seasonDays: 14, freeze: false, tz: 'Europe/Kyiv', smartCards: true, raidAnyDay: false,
  familyGoal: null,   // ціль сім'ї на тиждень: {kind: quests|smart|wins|battles, n, reward} або null
};
const GOAL_KINDS = { quests: ['справ по дому', '🧹'], smart: ['розумних відповідей', '🧠'], wins: ['перемог', '🏆'], battles: ['боїв', '⚔️'] };
const GOAL_GOLD = 30;   // золото кожній дитині, коли ціль сім'ї досягнуто

export const hashPin = (pin, salt) => createHash('sha256').update(`${salt}:${pin}`).digest('hex');

export class Game {
  constructor({ store, now = () => Date.now(), realTimers = true, cardsDir = null, seed = null }) {
    this.store = store;
    this.cardsDir = cardsDir; if (cardsDir) mkdirSync(cardsDir, { recursive: true });
    this.tvOnline = () => true;
    this.now = now;
    this.realTimers = realTimers;
    this.players = store.get('players', () => ({}));
    this.migratePlayers();
    this.tokens = store.get('tokens', () => ({}));
    this.settings = { ...DEFAULT_SETTINGS, ...store.get('settings', () => ({})) };
    this.history = store.get('history', () => ({ battles: [], legendaries: [], feed: [] }));
    if (!this.history.season) this.history.season = { n: 1, startedAt: this.now(), points: {} };
    if (!this.history.pastSeasons) this.history.pastSeasons = [];
    if (!this.history.raids) this.history.raids = [];
    if (!this.history.customCards) this.history.customCards = [];
    if (!this.history.customMobs) this.history.customMobs = [];
    if (!this.history.book) this.history.book = { records: {}, moments: [], bosses: [] };
    if (!this.history.family) this.history.family = { achievements: [] };
    if (!this.history.worldBoss) this.history.worldBoss = null;
    if (!this.history.days) this.history.days = {};
    if (!this.history.questLog) this.history.questLog = [];
    if (!this.history.familyGoal) this.history.familyGoal = { week: null, done: false };   // чи вже зараховано ціль сім'ї цього тижня   // зараховані справи: {day, pid, qid, at} (тиждень на телефоні, «сьогодні» на ТБ)
    if (!this.history.coupons) this.history.coupons = [];   // замовлення купонів: {id, pid, couponId, name, icon, price, at, status: pending|done|refunded}
    if (!this.settings.coupons) { this.settings.coupons = DEFAULT_COUPONS.map(c => ({ ...c })); this.store.set('settings', this.settings); }
    if (!this.history.campaign) this.history.campaign = { chapter: 0, runs: 0, done: [] };
    if (!this.history.envelopes) this.history.envelopes = [];   // відкриті конверти-сюрпризи: {id, at}   // сюжетна кампанія: chapter = індекс наступного розділу   // журнал по днях для звіту тижня: {день: {гравець: {minutes, battles, wins, quests, smart, kills}}}
    for (const c of this.history.customCards) if (c.approved) this.registerCard(c);
    for (const m of this.history.customMobs) if (m.approved) this.registerMob(m);
    this.announce = null;
    this.party = null;   // «Вечір ігор»: {by, i, points:{pid: n}, phase: run|done, ranking}
    this.mini = null;   // міні-гра «Реакція»: {phase: wait|go|done, by, at, goAt, taps:{pid: ms}, faults:{pid: true}, ranking}
    this.challenges = [];   // виклики на дуель (лише в пам'яті): {id, from, to, at}
    this.replay = null;
    this.lobby = { players: {}, mode: 'dungeon', dungeonId: DUNGEONS[0].id };
    this.tournament = null;   // турнір: {players, matches: [{a, b, winner}], current, champion}
    this.closingWarnedDay = null; this.ceremony = null;
    if (this.realTimers) { const t = setInterval(() => { try { this.tick(); } catch (e) { console.error('tick', e); } }, 30000); if (t.unref) t.unref(); }
    this.battle = null; this.run = null; this.results = null;
    this.paused = false; this.pauseReason = null;
    this.listeners = new Set();
    this.timers = {};
    this.seed = seed !== null ? seed : (Date.now() % 1e9) | 0;
    this.rng = makeRng(this.seed);
  }

  /** Старі збережені гравці після оновлення гри: додати поля, яких не було. */
  migratePlayers() {
    const tpl = newPlayer({ id: 'x', name: 'x', classId: 'warrior', pinHash: '' });
    let changed = false;
    for (const p of Object.values(this.players)) {
      if (p.simple === undefined) { p.simple = !!(p.age && p.age <= 8); changed = true; }
      for (const k of Object.keys(tpl)) if (p[k] === undefined) { p[k] = JSON.parse(JSON.stringify(tpl[k])); changed = true; }
      for (const k of Object.keys(tpl.stats)) if (p.stats[k] === undefined) { p.stats[k] = k === 'level' ? p.level : 0; changed = true; }
      if (!classById[p.class]) { p.class = 'warrior'; p.deck = starterDeck('warrior'); changed = true; }
      if (!Array.isArray(p.deck) || p.deck.length !== 20 || p.deck.some(id => !cardById[id])) { p.deck = starterDeck(p.class); changed = true; }
    }
    if (changed) this.store.save('players');
  }
  /** Порада для простого режиму: кого бити, куди, що блокувати, які карти. */
  hintFor(f) {
    const b = this.battle; if (!b || !f || !f.alive) return null;
    const enemies = enemiesOf(b, f); if (!enemies.length) return null;
    const target = enemies.slice().sort((a, c) => a.hp - c.hp)[0];
    const rng = makeRng(b.seed + b.round * 31 + f.id.length);
    const attack = rng.chance(0.5) ? 'head' : rng.pick(ZONES);
    const blocks = rng.shuffle(ZONES).slice(0, 2);
    const cards = []; let mana = f.mana;
    for (const id of f.hand) { const c = cardById[id]; if (!c || cards.length >= MAX_CARDS_PER_TURN) continue; if (c.type === 'heal' && f.hp > f.maxHp * 0.6) continue; if (c.cost <= mana) { mana -= c.cost; cards.push(id); } }
    const words = { head: 'у голову', chest: 'у груди', belt: 'у пояс', legs: 'у ноги' };
    return { target: target.id, attack, blocks, cards, text: `Бий ${target.name} ${words[attack]}, закрий ${ZONE_NAMES[blocks[0]].toLowerCase()} і ${ZONE_NAMES[blocks[1]].toLowerCase()}${cards.length ? ', зіграй ' + cards.map(id => cardById[id].name).join(' і ') : ''}.` };
  }

  // ---------- гравці й вхід ----------
  get playerList() { return Object.values(this.players); }
  publicPlayer(p) {
    return { id: p.id, name: p.name, class: p.class, className: classById[p.class].name, icon: p.icon || classById[p.class].icon, avatar: p.avatar, title: p.title, level: p.level, role: p.role, age: p.age, simple: !!p.simple, frame: p.cosmetics ? p.cosmetics.frame : null, cry: p.cosmetics ? cryText(p.cosmetics.cry) : null };
  }
  createPlayer({ name, classId, age, pin, role }) {
    if (!name || !name.trim()) throw err('Потрібне ім’я');
    if (!classById[classId]) throw err('Невідомий клас');
    if (!/^\d{4}$/.test(String(pin || ''))) throw err('PIN: 4 цифри');
    if (this.playerList.some(p => p.name.toLowerCase() === name.trim().toLowerCase())) throw err('Таке ім’я вже є');
    const id = 'p' + randomBytes(4).toString('hex');
    const p = newPlayer({ id, name: name.trim().slice(0, 20), classId, age: age ? Number(age) : null, role: role || 'kid', pinHash: hashPin(pin, id) });
    p.deck = starterDeck(classId);
    this.players[id] = p; this.store.save('players');
    this.feed(`${p.name} приєднується до арени як ${classById[classId].name}`);
    this.emit();
    return p;
  }
  login(playerId, pin) {
    const p = this.players[playerId];
    if (!p || p.pinHash !== hashPin(String(pin), p.id)) throw err('Неправильний PIN', 401);
    const token = 't' + randomBytes(16).toString('hex');
    this.tokens[token] = { playerId, at: this.now() };
    this.store.save('tokens');
    return token;
  }
  auth(token) { const t = token && this.tokens[token]; return t ? this.players[t.playerId] : null; }
  logout(token) { delete this.tokens[token]; this.store.save('tokens'); }
  isParent(p) { return p && (p.role === 'parent' || p.role === 'admin'); }
  isGuest(p) { return !!(p && p.role === 'guest'); }
  /** Сім'я без гостей: для сум, цілей і конвертів. */
  get familyList() { return this.playerList.filter(p => !this.isGuest(p)); }
  checkPin(p, pin) { return p.pinHash === hashPin(String(pin), p.id); }
  parentPin(pin) { return this.playerList.some(p => this.isParent(p) && this.checkPin(p, pin)); }
  updatePlayer(id, patch) {
    const p = this.players[id]; if (!p) throw err('немає гравця');
    if (patch.name) p.name = String(patch.name).trim().slice(0, 20);
    if (patch.age !== undefined) p.age = patch.age ? Number(patch.age) : null;
    if (patch.role && ['kid', 'parent', 'admin', 'guest'].includes(patch.role)) p.role = patch.role;
    if (patch.pin) { if (!/^\d{4}$/.test(String(patch.pin))) throw err('PIN: 4 цифри'); p.pinHash = hashPin(patch.pin, p.id); for (const [t, v] of Object.entries(this.tokens)) if (v.playerId === id) delete this.tokens[t]; this.store.save('tokens'); }
    if (patch.class && classById[patch.class] && p.level <= 3) { p.class = patch.class; p.deck = starterDeck(patch.class); }
    if (patch.simple !== undefined) p.simple = !!patch.simple;
    this.store.save('players'); this.emit();
    return p;
  }
  deletePlayer(id) { delete this.players[id]; delete this.lobby.players[id]; this.store.save('players'); this.emit(); }
  // ---------- друзі в гостях: герой на один вечір, без прогресу в сезоні ----------
  createGuest(parent, { name, classId, age }) {
    if (!this.isParent(parent)) throw err('лише батьки', 403);
    if (this.playerList.filter(p => this.isGuest(p)).length >= GUEST_MAX) throw err(`не більше ${GUEST_MAX} гостей`);
    const pin = String(1000 + Math.floor(Math.random() * 9000));
    const p = this.createPlayer({ name, classId: classId || 'warrior', age, pin, role: 'guest' });
    const fam = this.familyList.filter(x => !this.isParent(x)); const lv = fam.length ? Math.round(fam.reduce((s, x) => s + x.level, 0) / fam.length) : 1;
    p.level = Math.max(1, lv); p.xp = 0; p.title = 'Гість'; p.guest = { day: this.kyiv().day, pin };
    this.store.save('players'); this.feed(`👋 Гість ${p.name} у гостях на вечір (${p.level} рів.)`); this.emit();
    return p;
  }
  guestsView() { return this.playerList.filter(p => this.isGuest(p)).map(p => ({ id: p.id, name: p.name, level: p.level, pin: p.guest ? p.guest.pin : null, className: classById[p.class].name })); }
  /** Гості йдуть додому наступного дня: видаляємо, коли не в бою. */
  expireGuests() {
    const day = this.kyiv().day; const inBattle = new Set(this.run ? this.run.players : []);
    for (const p of this.playerList) if (this.isGuest(p) && p.guest && p.guest.day !== day && !inBattle.has(p.id)) { this.feed(`👋 Гість ${p.name} пішов додому`); this.deletePlayer(p.id); }
  }

  // ---------- час, ліміти, тиша ----------
  kyiv(ts = this.now()) {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: this.settings.tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
    const o = Object.fromEntries(f.formatToParts(ts).map(x => [x.type, x.value]));
    return { day: `${o.year}-${o.month}-${o.day}`, hm: `${o.hour === '24' ? '00' : o.hour}:${o.minute}`, weekend: o.weekday === 'Sat' || o.weekday === 'Sun', weekday: o.weekday };
  }
  /** Ключ тижня (понеділок) за Києвом для щотижневих рейдів. */
  weekKey(ts = this.now()) {
    const k = this.kyiv(ts); const d = new Date(k.day + 'T12:00:00Z'); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd);
    return d.toISOString().slice(0, 10);
  }
  /** Чи можна зараз іти в рейд: вихідні (або дозвіл батьків на будь-який день) і ще не пройдено цього тижня. */
  raidStatus(dungeonId) {
    const d = dungeonById[dungeonId]; if (!d || !d.raid) return { raid: false, available: true };
    const done = this.history.raids.some(r => r.raid === d.id && r.week === this.weekKey() && r.won);
    if (done) return { raid: true, available: false, reason: 'Цей рейд уже пройдено цього тижня. Новий у понеділок!' };
    if (!this.kyiv().weekend && !this.settings.raidAnyDay) return { raid: true, available: false, reason: 'Рейд лише у вихідні (батьки можуть дозволити в будь-який день)' };
    return { raid: true, available: true, minPlayers: d.minPlayers || 2 };
  }
  limitFor(p) { return this.kyiv().weekend ? this.settings.limitWeekend : this.settings.limitWeekday; }
  minutesToday(p) { const k = this.kyiv(); if (p.playedToday.day !== k.day) { p.playedToday = { day: k.day, minutes: 0 }; } return p.playedToday.minutes; }
  /** Чому гравець не може почати бій зараз (null = може). */
  blockedReason(p) {
    if (this.isParent(p)) return null;
    const k = this.kyiv();
    if (k.hm >= this.settings.bedtime || k.hm < this.settings.wakeup) return `Пізно: арена для дітей відкрита з ${this.settings.wakeup} до ${this.settings.bedtime}`;
    const left = this.limitFor(p) - this.minutesToday(p);
    if (left <= 0) return `Ліміт на сьогодні вичерпано (${this.limitFor(p)} хв). Квести можуть додати час!`;
    return null;
  }
  addMinutes(p, min) { this.minutesToday(p); p.playedToday.minutes += min; this.logDay(p.id, { minutes: min }); this.store.save('players'); }
  /** Запис у журнал дня (звіт тижня для батьків). Лише числа, що додаються. */
  logDay(pid, patch, day = this.kyiv().day) {
    const d = this.history.days[day] || (this.history.days[day] = {}); const r = d[pid] || (d[pid] = {});
    for (const k of Object.keys(patch)) r[k] = (r[k] || 0) + patch[k];
    const keys = Object.keys(this.history.days).sort(); if (keys.length > 60) for (const k of keys.slice(0, keys.length - 60)) delete this.history.days[k];
    this.store.save('history');
    this.checkFamilyGoal();
  }
  // ---------- ціль сім'ї на тиждень: батьки ставлять число й справжню нагороду, діти збирають разом ----------
  setFamilyGoal(parent, goal) {
    if (!this.isParent(parent)) throw err('лише батьки', 403);
    if (!goal) { this.settings.familyGoal = null; this.store.set('settings', this.settings); this.emit(); return null; }
    const kind = String(goal.kind || 'quests'); if (!GOAL_KINDS[kind]) throw err('вид цілі');
    const n = Math.round(Number(goal.n)); if (!(n >= 1 && n <= 500)) throw err('число від 1 до 500');
    const reward = String(goal.reward || '').trim().slice(0, 80); if (!reward) throw err('напиши нагороду');
    this.settings.familyGoal = { kind, n, reward }; this.history.familyGoal = { week: this.weekKey(), done: false };
    this.store.set('settings', this.settings); this.store.save('history');
    this.feed(`🎯 Ціль сім'ї на тиждень: ${n} ${GOAL_KINDS[kind][0]} → ${reward}`); this.emit();
    return this.familyGoalView();
  }
  familyGoalProgress() {
    const g = this.settings.familyGoal; if (!g) return 0;
    const start = new Date(this.weekKey() + 'T12:00:00Z'); let sum = 0;
    for (let i = 0; i < 7; i++) { const d = new Date(start); d.setUTCDate(d.getUTCDate() + i); const day = this.history.days[d.toISOString().slice(0, 10)] || {}; for (const [pid, r] of Object.entries(day)) if (this.players[pid] && !this.isParent(this.players[pid])) sum += r[g.kind] || 0; }
    return sum;
  }
  familyGoalView() {
    const g = this.settings.familyGoal; if (!g) return null;
    const fg = this.history.familyGoal; const week = this.weekKey(); const progress = this.familyGoalProgress();
    const end = new Date(week + 'T12:00:00Z'); end.setUTCDate(end.getUTCDate() + 7);
    return { kind: g.kind, kindName: GOAL_KINDS[g.kind][0], icon: GOAL_KINDS[g.kind][1], n: g.n, reward: g.reward, progress: Math.min(progress, g.n), pct: Math.min(100, Math.round(100 * progress / g.n)), done: fg.week === week && fg.done, daysLeft: Math.max(0, Math.ceil((end.getTime() - this.now()) / 86400000)) };
  }
  checkFamilyGoal() {
    const g = this.settings.familyGoal; if (!g) return false;
    const week = this.weekKey(); const fg = this.history.familyGoal;
    if (fg.week !== week) { fg.week = week; fg.done = false; }
    if (fg.done || this.familyGoalProgress() < g.n) return false;
    fg.done = true; const kids = this.playerList.filter(p => !this.isParent(p));
    for (const p of kids) p.gold += GOAL_GOLD;
    this.store.save('players'); this.store.save('history');
    this.announce = { text: `🎯 Ціль сім'ї досягнуто: ${g.n} ${GOAL_KINDS[g.kind][0]}! Нагорода: ${g.reward}`, by: 'Арена', at: this.now() };
    this.feed(`👨‍👩‍👦 Ціль сім'ї досягнуто (${g.n} ${GOAL_KINDS[g.kind][0]}): ${g.reward}! +${GOAL_GOLD} золота кожному`); this.moment('🎯', `Ціль сім'ї досягнуто: ${g.n} ${GOAL_KINDS[g.kind][0]} → ${g.reward}`);
    return true;
  }
  /** «Сьогодні зроблено» для ТБ: лише діти з активністю за день (бої, перемоги, справи з назвами, розумні відповіді, хвилини). null, якщо день порожній. */
  todayView() {
    const day = this.kyiv().day; const d = this.history.days[day] || {};
    const kids = this.playerList.filter(p => !this.isParent(p)).map(p => {
      const r = d[p.id] || {}; const quests = this.history.questLog.filter(l => l.day === day && l.pid === p.id).map(l => questById[l.qid]).filter(Boolean);
      return { id: p.id, name: p.name, battles: r.battles || 0, wins: r.wins || 0, smart: r.smart || 0, minutes: r.minutes || 0, quests: quests.map(q => ({ icon: q.icon, name: q.name })) };
    }).filter(k => k.battles || k.smart || k.minutes || k.quests.length);
    return kids.length ? { day, kids } : null;
  }
  /** Зроблені справи за 7 днів для телефона: дитина бачить свої, батьки всіх. Дні з новішого, порожні пропущено. */
  doneView(p) {
    const parent = this.isParent(p); const names = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const days = []; for (let i = 0; i < 7; i++) { const d = new Date(this.kyiv(this.now() - i * 86400000).day + 'T12:00:00Z'); days.push({ day: d.toISOString().slice(0, 10), name: names[d.getUTCDay()], today: i === 0 }); }
    const out = [];
    for (const d of days) {
      const items = this.history.questLog.filter(l => l.day === d.day && (parent ? this.players[l.pid] && !this.isParent(this.players[l.pid]) : l.pid === p.id)).map(l => { const q = questById[l.qid]; return q ? { icon: q.icon, name: q.name, who: this.players[l.pid] ? this.players[l.pid].name : '?' } : null; }).filter(Boolean);
      const stat = Object.entries(this.history.days[d.day] || {}).filter(([pid]) => parent ? this.players[pid] && !this.isParent(this.players[pid]) : pid === p.id).reduce((s, [, r]) => ({ battles: s.battles + (r.battles || 0), wins: s.wins + (r.wins || 0), minutes: s.minutes + (r.minutes || 0) }), { battles: 0, wins: 0, minutes: 0 });
      if (items.length || stat.battles || stat.minutes) out.push({ ...d, items, ...stat });
    }
    const total = out.reduce((s, d) => s + d.items.length, 0);
    return { days: out, total };
  }
  /** Звіт тижня для батьків: по днях і по дітях (хвилини, бої, перемоги, справи, розумні відповіді). weeks назад: 0 = поточний. */
  weekReport(back = 0) {
    const start = new Date(this.weekKey() + 'T12:00:00Z'); start.setUTCDate(start.getUTCDate() - 7 * back);
    const days = []; for (let i = 0; i < 7; i++) { const d = new Date(start); d.setUTCDate(d.getUTCDate() + i); days.push(d.toISOString().slice(0, 10)); }
    const kids = this.playerList.filter(p => !this.isParent(p));
    const sum = (pid, k) => days.reduce((s, day) => s + (((this.history.days[day] || {})[pid] || {})[k] || 0), 0);
    const players = kids.map(p => ({ id: p.id, name: p.name, level: p.level, minutes: sum(p.id, 'minutes'), battles: sum(p.id, 'battles'), wins: sum(p.id, 'wins'), quests: sum(p.id, 'quests'), smart: sum(p.id, 'smart'), kills: sum(p.id, 'kills'),
      byDay: days.map(day => ({ day, minutes: ((this.history.days[day] || {})[p.id] || {}).minutes || 0, battles: ((this.history.days[day] || {})[p.id] || {}).battles || 0 })) }));
    const names = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
    const lines = [`📊 Родинна арена, тиждень з ${days[0]}`];
    for (const p of players) lines.push(`${p.name} (${p.level} рів.): ${p.minutes} хв, боїв ${p.battles} (перемог ${p.wins}), справ ${p.quests}, розумних відповідей ${p.smart}` + (p.minutes ? `; найбільше ${names[p.byDay.reduce((m, x, i) => x.minutes > p.byDay[m].minutes ? i : m, 0)]}` : ''));
    if (!players.some(p => p.minutes)) lines.push('Діти цього тижня не грали.');
    const wb = this.history.worldBoss; if (wb && wb.week === days[0]) lines.push(wb.killed ? '🐲 Бос тижня повалений.' : `🐲 Бос тижня: ${Math.round(100 * wb.hp / wb.maxHp)} % здоров’я.`);
    return { from: days[0], to: days[6], days, dayNames: names, players, text: lines.join('\n'), limitWeekday: this.settings.limitWeekday, limitWeekend: this.settings.limitWeekend };
  }

  // ---------- лобі ----------
  join(p) {
    if (this.battle) throw err('Бій уже йде, зачекай');
    const why = this.blockedReason(p); if (why) throw err(why);
    const n = Object.keys(this.lobby.players).length;
    this.lobby.players[p.id] = this.lobby.players[p.id] || { ready: false, team: n % 2 };
    if (this.results) this.results = null;
    this.emit();
  }
  leave(p) { delete this.lobby.players[p.id]; this.emit(); }
  ready(p, on) { const l = this.lobby.players[p.id]; if (!l) throw err('ти не в лобі'); l.ready = !!on; this.emit(); this.maybeStart(); }
  setMode(p, { mode, dungeonId }) {
    if (this.battle) throw err('бій уже йде');
    if (mode && !['dungeon', 'duel', 'campaign', 'tournament', 'practice'].includes(mode)) throw err('режим');
    if (mode) this.lobby.mode = mode;
    if (dungeonId) { if (!dungeonById[dungeonId]) throw err('підземелля'); if (this.dungeonLocked(dungeonId)) throw err('це підземелля ще в запечатаному конверті'); const rs = this.raidStatus(dungeonId); if (!rs.available) throw err(rs.reason); this.lobby.dungeonId = dungeonId; }
    for (const l of Object.values(this.lobby.players)) l.ready = false;
    this.emit();
  }
  // ---------- міні-гра «Реакція»: ТБ каже «ТИСНИ!», хто швидше натисне на телефоні ----------
  startMini(p, kind = 'reaction') {
    if (this.battle) throw err('бій уже йде, зачекай');
    if (this.mini && this.mini.phase !== 'done') throw err('міні-гра вже йде');
    const why = this.blockedReason(p); if (why) throw err(why);
    if (!['reaction', 'quiz', 'memory'].includes(kind)) throw err('яка гра?');
    this.clearTimer('mini-clear');
    if (kind === 'quiz') {
      this.mini = { kind, phase: 'go', by: p.id, at: this.now(), goAt: this.now(), qs: {}, prog: {}, ranking: [], taps: {}, faults: {} };
      this.setTimer('mini-end', QUIZ_MS, () => this.endMini());
      const tickQ = () => { if (this.mini && this.mini.kind === 'quiz' && this.mini.phase === 'go') { this.emit(); this.setTimer('mini-tick', 10000, tickQ); } };   // лічильник секунд на ТБ
      this.setTimer('mini-tick', 10000, tickQ);
      this.emit(); return this.miniView(p);
    }
    if (kind === 'memory') {
      this.mini = { kind, phase: 'wait', by: p.id, at: this.now(), goAt: null, seq: this.memorySeq(), inputs: {}, taps: {}, faults: {}, ranking: [] };
      this.setTimer('mini-go', MEMORY_LEN * MEMORY_STEP_MS + 1200, () => {
        const m = this.mini; if (!m || m.phase !== 'wait') return;
        m.phase = 'go'; m.goAt = this.now(); this.emit();
        this.setTimer('mini-end', MEMORY_INPUT_MS, () => this.endMini());
      });
      this.emit(); return this.miniView(p);
    }
    this.mini = { kind, phase: 'wait', by: p.id, at: this.now(), goAt: null, taps: {}, faults: {}, ranking: [] };
    this.setTimer('mini-go', 2000 + this.rng.int(0, 3500), () => {
      const m = this.mini; if (!m || m.phase !== 'wait') return;
      m.phase = 'go'; m.goAt = this.now(); this.emit();
      this.setTimer('mini-end', MINI_TAP_MS, () => this.endMini());
    });
    this.emit();
    return this.miniView(p);
  }
  // ---------- «Вечір ігор»: Реакція → Пам'ять → Бліц, очки за місця, чемпіон вечора ----------
  startParty(p) {
    if (this.party) throw err('вечір ігор уже йде');
    if (this.battle) throw err('бій уже йде, зачекай');
    if (this.mini && this.mini.phase !== 'done') throw err('міні-гра вже йде');
    this.party = { by: p.id, i: 0, points: {}, phase: 'run', at: this.now(), ranking: [] };
    this.clearTimer('mini-clear'); this.mini = null;
    try { this.startMini(p, PARTY_GAMES[0]); } catch (e) { this.party = null; throw e; }
    this.announce = { text: `🎉 Вечір ігор! ${PARTY_GAMES.map(k => PARTY_NAMES[k]).join(' → ')}. Чемпіон +${PARTY_GOLD} золота`, by: 'Арена', at: this.now() };
    this.feed(`🎉 ${p.name} відкриває вечір ігор`); this.emit();
    return this.partyView();
  }
  /** Після кожної міні-гри: очки за місця; далі наступна гра або фінал вечора. */
  finishMini() {
    const m = this.mini, pt = this.party;
    if (!pt || pt.phase !== 'run') { this.setTimer('mini-clear', MINI_SHOW_MS, () => { this.mini = null; this.emit(); }); return; }
    m.ranking.forEach((r, i) => { if (m.kind === 'quiz' && !r.correct) return; pt.points[r.id] = (pt.points[r.id] || 0) + (PARTY_POINTS[i] || 0); });
    pt.i += 1;
    if (pt.i < PARTY_GAMES.length) {
      this.setTimer('mini-clear', MINI_SHOW_MS, () => { this.mini = null; const by = this.players[pt.by]; try { this.startMini(by, PARTY_GAMES[pt.i]); } catch (e) { this.feed(`🎉 Вечір ігор зупинено: ${e.message}`); this.party = null; this.emit(); } });
      return;
    }
    pt.ranking = Object.entries(pt.points).filter(([pid]) => this.players[pid]).sort((a, b) => b[1] - a[1]).map(([pid, points]) => ({ id: pid, name: this.players[pid].name, points }));
    if (pt.ranking.length) {
      const w = this.players[pt.ranking[0].id]; w.gold += PARTY_GOLD; w.stats.parties = (w.stats.parties || 0) + 1; this.addSeasonPoints(w.id, SEASON_POINTS.party);
      this.feed(`🎉 Чемпіон вечора ігор: ${w.name} (${pt.ranking[0].points} очок), +${PARTY_GOLD} золота, +${SEASON_POINTS.party} очки сезону`);
      for (const a of checkAchievements(w)) this.feed(`🏅 ${w.name}: досягнення «${a.name}»${a.title ? `, титул «${a.title}»` : ''}`);
      this.store.save('players');
    }
    this.setTimer('mini-clear', MINI_SHOW_MS, () => {
      this.mini = null; pt.phase = 'done'; pt.doneAt = this.now();
      if (pt.ranking.length) this.announce = { text: `🎉 Чемпіон вечора ігор: ${pt.ranking[0].name}!`, by: 'Арена', at: this.now() };
      this.emit();
      this.setTimer('party-clear', PARTY_SHOW_MS, () => { this.party = null; this.emit(); });
    });
  }
  partyView() {
    const pt = this.party; if (!pt) return null;
    const name = id => this.players[id] ? this.players[id].name : '?';
    const standings = Object.entries(pt.points).filter(([pid]) => this.players[pid]).sort((a, b) => b[1] - a[1]).map(([pid, points]) => ({ name: name(pid), points }));
    return { by: name(pt.by), i: pt.i, of: PARTY_GAMES.length, games: PARTY_GAMES.map(k => PARTY_NAMES[k]), current: pt.i < PARTY_GAMES.length ? PARTY_NAMES[PARTY_GAMES[pt.i]] : null, phase: pt.phase, standings, ranking: pt.ranking, champion: pt.ranking.length ? pt.ranking[0].name : null, at: pt.at };
  }
  /** «Бліц»: у кожного свої питання за віком; відповідь рухає далі, після QUIZ_N — готово. */
  quizFor(p) {
    const m = this.mini; if (!m.qs[p.id]) { m.qs[p.id] = Array.from({ length: QUIZ_N }, () => makeQuiz(this.rng, p.age)); m.prog[p.id] = { i: 0, correct: 0, doneAt: null }; }
    return { qs: m.qs[p.id], pr: m.prog[p.id] };
  }
  answerMini(p, answer) {
    const m = this.mini; if (!m || m.kind !== 'quiz' || m.phase !== 'go') throw err('«Бліц» не йде');
    const { qs, pr } = this.quizFor(p);
    if (!pr.doneAt) {
      if (checkQuiz(qs[pr.i], answer)) pr.correct += 1;
      pr.i += 1; if (pr.i >= QUIZ_N) { pr.doneAt = this.now(); const wait = QUIZ_MIN_MS - (this.now() - m.at); if (wait > 0) this.setTimer('mini-min', wait, () => this.maybeEndQuiz()); }
    }
    if (!this.maybeEndQuiz()) this.emit();
    return this.miniView(p);
  }
  /** Закрити «Бліц», коли минуло QUIZ_MIN_MS і всі, хто почав, готові. */
  maybeEndQuiz() {
    const m = this.mini; if (!m || m.kind !== 'quiz' || m.phase !== 'go') return false;
    const active = Object.values(m.prog).filter(x => x.i > 0);
    if (this.now() - m.at < QUIZ_MIN_MS || !active.length || !active.every(x => x.doneAt)) return false;
    this.endMini(); return true;
  }
  /** Послідовність для «Пам'яті»: без двох однакових кольорів поспіль. */
  memorySeq() {
    const seq = [];
    while (seq.length < MEMORY_LEN) { const c = this.rng.int(0, 3); if (c !== seq[seq.length - 1]) seq.push(c); }
    return seq;
  }
  /** «Пам'ять»: повторити послідовність кольорів з ТБ; не той колір = помилка, повна = час. */
  pressMini(p, color) {
    const m = this.mini; if (!m || m.kind !== 'memory' || m.phase !== 'go') throw err('«Пам\'ять» не йде');
    if (m.faults[p.id] || m.taps[p.id] !== undefined) return this.miniView(p);
    const c = Number(color); if (!(c >= 0 && c <= 3)) throw err('колір');
    const inp = m.inputs[p.id] || (m.inputs[p.id] = []); inp.push(c);
    if (m.seq[inp.length - 1] !== c) m.faults[p.id] = true;
    else if (inp.length === m.seq.length) { m.taps[p.id] = this.now() - m.goAt; const wait = MEMORY_MIN_MS - (this.now() - m.goAt); if (wait > 0) this.setTimer('mini-min', wait, () => this.maybeEndMemory()); }
    if (!this.maybeEndMemory()) this.emit();
    return this.miniView(p);
  }
  maybeEndMemory() {
    const m = this.mini; if (!m || m.kind !== 'memory' || m.phase !== 'go') return false;
    const active = Object.keys(m.inputs);
    if (this.now() - m.goAt < MEMORY_MIN_MS || !active.length || !active.every(pid => m.faults[pid] || m.taps[pid] !== undefined)) return false;
    this.endMini(); return true;
  }
  tapMini(p) {
    const m = this.mini; if (!m || m.kind !== 'reaction' || m.phase === 'done') throw err('«Реакція» не йде');
    if (m.faults[p.id] || m.taps[p.id] !== undefined) return this.miniView(p);
    if (m.phase === 'wait') m.faults[p.id] = true; else m.taps[p.id] = this.now() - m.goAt;
    this.emit(); return this.miniView(p);
  }
  endMini() {
    const m = this.mini; if (!m || m.phase === 'done') return;
    this.clearTimer('mini-go'); this.clearTimer('mini-end'); this.clearTimer('mini-min'); this.clearTimer('mini-tick');
    m.phase = 'done'; m.endAt = this.now();
    if (m.kind === 'quiz') {
      m.ranking = Object.entries(m.prog).filter(([pid, x]) => this.players[pid] && x.i > 0).sort((a, b) => b[1].correct - a[1].correct || (a[1].doneAt || Infinity) - (b[1].doneAt || Infinity)).map(([pid, x]) => ({ id: pid, name: this.players[pid].name, correct: x.correct, ms: x.doneAt ? x.doneAt - m.at : null }));
      for (const r of m.ranking) { const p = this.players[r.id]; p.stats.minis = (p.stats.minis || 0) + 1; if (r.correct === QUIZ_N) p.stats.quizPerfect = (p.stats.quizPerfect || 0) + 1; if (r.correct) { p.stats.smart = (p.stats.smart || 0) + r.correct; this.logDay(r.id, { smart: r.correct }); } }
      if (m.ranking.length && m.ranking[0].correct) { const w = this.players[m.ranking[0].id]; w.gold += this.miniGold(); w.stats.quiz = (w.stats.quiz || 0) + 1; this.feed(`🧠 Бліц: ${w.name} найрозумніший (${m.ranking[0].correct} з ${QUIZ_N}), +${this.miniGold()} золота`); }
      this.afterMini(m.ranking.map(r => r.id)); this.store.save('players'); this.emit();
      this.finishMini();
      return;
    }
    m.ranking = Object.entries(m.taps).filter(([pid]) => this.players[pid]).sort((a, b) => a[1] - b[1]).map(([pid, ms]) => ({ id: pid, name: this.players[pid].name, ms }));
    for (const r of m.ranking) this.players[r.id].stats.minis = (this.players[r.id].stats.minis || 0) + 1;
    if (m.ranking.length) { const w = this.players[m.ranking[0].id]; w.gold += this.miniGold(); if (m.kind === 'memory') { w.stats.memory = (w.stats.memory || 0) + 1; this.feed(`🧩 Пам'ять: ${w.name} найуважніший (${(m.ranking[0].ms / 1000).toFixed(1)} с), +${this.miniGold()} золота`); } else { w.stats.reaction = (w.stats.reaction || 0) + 1; this.feed(`⚡ Реакція: ${w.name} найшвидший (${m.ranking[0].ms} мс), +${this.miniGold()} золота`); } }
    this.afterMini(m.ranking.map(r => r.id)); this.store.save('players'); this.emit();
    this.finishMini();
  }
  /** Після міні-гри: досягнення й завдання дня учасникам, рядки в хроніку. */
  afterMini(ids) {
    for (const id of ids) { const p = this.players[id]; if (!p) continue; for (const a of checkAchievements(p)) this.feed(`🏅 ${p.name}: досягнення «${a.name}»${a.title ? `, титул «${a.title}»` : ''}`); this.checkDaily(p); }
    this.checkFamily(); this.checkEnvelopes();
  }
  miniView(p = null) {
    const m = this.mini; if (!m) return null;
    const name = id => this.players[id] ? this.players[id].name : '?';
    const v = { kind: m.kind || 'reaction', phase: m.phase, by: name(m.by), at: m.at, goAt: m.goAt, ranking: m.ranking, faults: Object.keys(m.faults).map(name), tapped: Object.keys(m.taps).length };
    if (m.kind === 'quiz') {
      v.n = QUIZ_N; v.left = Math.max(0, Math.ceil((QUIZ_MS - (this.now() - m.at)) / 1000));
      v.players = Object.entries(m.prog).filter(([pid]) => this.players[pid]).map(([pid, x]) => ({ name: name(pid), i: x.i, correct: x.correct, done: !!x.doneAt }));
      if (p && m.phase === 'go') { const { qs, pr } = this.quizFor(p); const q = qs[pr.i]; v.me = { i: pr.i, correct: pr.correct, done: !!pr.doneAt, q: q && !pr.doneAt ? { kind: q.kind, q: q.q, choices: q.choices } : null }; }
      else if (p) { const pr = m.prog[p.id]; v.me = pr ? { i: pr.i, correct: pr.correct, done: !!pr.doneAt, q: null } : null; }
      return v;
    }
    if (m.kind === 'memory') {
      v.len = MEMORY_LEN; v.step = MEMORY_STEP_MS; if (!p || m.phase === 'done') v.seq = m.seq;   // телефон послідовності не бачить, поки гра йде
      v.players = Object.keys(m.inputs).filter(pid => this.players[pid]).map(pid => ({ name: name(pid), pressed: m.inputs[pid].length, done: m.taps[pid] !== undefined, fault: !!m.faults[pid] }));
    }
    if (p) v.me = { tapped: m.taps[p.id] !== undefined ? m.taps[p.id] : null, fault: !!m.faults[p.id], pressed: m.kind === 'memory' && m.inputs[p.id] ? m.inputs[p.id].length : 0 };
    return v;
  }
  // ---------- виклик на дуель: з телефона братові, той приймає на своєму ----------
  challenge(p, toId) {
    if (this.battle) throw err('бій уже йде, зачекай');
    const to = this.players[toId]; if (!to) throw err('немає гравця'); if (to.id === p.id) throw err('сам собі?');
    const why = this.blockedReason(p); if (why) throw err(why);
    const why2 = this.blockedReason(to); if (why2) throw err(`${to.name}: ${why2}`);
    this.expireChallenges();
    if (this.challenges.some(c => c.from === p.id && c.to === to.id)) throw err('виклик уже надіслано, чекай');
    const c = { id: 'ch' + this.rng.int(0, 999999), from: p.id, to: to.id, at: this.now() }; this.challenges.push(c);
    this.announce = { text: `⚔️ ${p.name} кидає виклик: ${to.name}, на дуель!`, by: 'Арена', at: this.now() };
    this.feed(`⚔️ ${p.name} викликає ${to.name} на дуель`); this.emit();
    return c;
  }
  challengeAnswer(p, id, accept) {
    this.expireChallenges();
    const c = this.challenges.find(x => x.id === id); if (!c) throw err('виклик уже згорів');
    if (c.to !== p.id && c.from !== p.id) throw err('не твій виклик');
    this.challenges = this.challenges.filter(x => x.id !== id);
    const from = this.players[c.from], to = this.players[c.to];
    if (!accept || c.from === p.id) { this.feed(c.from === p.id ? `😶 ${from.name} забрав виклик` : `😅 ${to.name} відмовився від дуелі з ${from.name}`); this.emit(); return { accepted: false }; }
    if (this.battle) throw err('бій уже йде, зачекай');
    if (!['duel'].includes(this.lobby.mode)) this.setMode(from, { mode: 'duel' });
    this.join(from); this.join(to); this.lobby.players[from.id].team = 0; this.lobby.players[to.id].team = 1;
    for (const x of [from, to]) { x.stats.challenges = (x.stats.challenges || 0) + 1; for (const a of checkAchievements(x)) this.feed(`🏅 ${x.name}: досягнення «${a.name}»${a.title ? `, титул «${a.title}»` : ''}`); } this.store.save('players');
    this.announce = { text: `🔥 ${to.name} приймає виклик ${from.name}! Дуель у лобі`, by: 'Арена', at: this.now() };
    this.feed(`🔥 ${to.name} прийняв виклик ${from.name}`); this.emit();
    return { accepted: true };
  }
  expireChallenges() {
    const n = this.challenges.length; this.challenges = this.challenges.filter(c => this.now() - c.at < CHALLENGE_MS);
    if (this.challenges.length !== n) this.emit();
  }
  challengesView(p) {
    const pub = id => { const x = this.players[id]; return x ? { id: x.id, name: x.name, icon: x.icon || classById[x.class].icon, avatar: x.avatar } : null; };
    const left = c => Math.max(0, Math.ceil((CHALLENGE_MS - (this.now() - c.at)) / 1000));
    const live = this.challenges.filter(c => this.now() - c.at < CHALLENGE_MS);
    return { incoming: live.filter(c => c.to === p.id).map(c => ({ id: c.id, from: pub(c.from), left: left(c) })),
      outgoing: live.filter(c => c.from === p.id).map(c => ({ id: c.id, to: pub(c.to), left: left(c) })),
      targets: this.playerList.filter(x => x.id !== p.id && !this.blockedReason(x)).map(x => pub(x.id)) };
  }
  setTeam(p, team) { const l = this.lobby.players[p.id]; if (!l) throw err('ти не в лобі'); l.team = team ? 1 : 0; l.ready = false; this.emit(); }
  maybeStart() {
    const ids = Object.keys(this.lobby.players);
    if (!ids.length || !ids.every(id => this.lobby.players[id].ready)) return;
    if (this.lobby.mode === 'tournament') {
      if (ids.length < TOURNAMENT_MIN || ids.length > TOURNAMENT_MAX) return;
    } else if (this.lobby.mode === 'duel') {
      const t0 = ids.filter(id => this.lobby.players[id].team === 0), t1 = ids.filter(id => this.lobby.players[id].team === 1);
      if (!t0.length || !t1.length) return;
    } else if (this.lobby.mode !== 'campaign' && this.lobby.mode !== 'practice') {
      const rs = this.raidStatus(this.lobby.dungeonId);
      if (rs.raid && (!rs.available || ids.length < rs.minPlayers)) return;
    }
    this.startBattle();
  }
  /** Турнір на 3–4 гравці: 3 — кожен з кожним, 4 — два півфінали і фінал. Дуелі йдуть одна за одною самі. */
  startTournament(ids) {
    const order = this.rng.shuffle(ids.slice());
    const matches = order.length === 3 ? [[order[0], order[1]], [order[0], order[2]], [order[1], order[2]]] : [[order[0], order[1]], [order[2], order[3]], [null, null]];
    this.tournament = { players: order, kind: order.length === 3 ? 'robin' : 'bracket', matches: matches.map(([a, b]) => ({ a, b, winner: null })), current: 0, champion: null, startedAt: this.now() };
    this.feed(`🏆 Турнір: ${order.map(id => this.players[id].name).join(', ')}`);
    this.announce = { text: '🏆 Турнір починається! ' + (order.length === 3 ? 'Кожен з кожним' : 'Два півфінали й фінал'), by: 'Арена', at: this.now() };
    this.startMatch();
  }
  startMatch() {
    const t = this.tournament; const m = t.matches[t.current];
    const fighters = (list) => list.map(id => { const p = this.players[id]; return fighterFromPlayer({ ...p, bonus: equipmentBonus(p), icon: this.publicPlayer(p).icon, pet: activePetIcon(p), cry: this.publicPlayer(p).cry }, this.rng); });
    this.seed = (this.seed * 7919 + 13) % 2147483647; this.rng = makeRng(this.seed);
    this.run = { mode: 'duel', players: [m.a, m.b], tournament: t.current, startedAt: this.now(), frames: [] };
    this.battle = createBattle({ teams: this.duelTeams(fighters([m.a]), fighters([m.b])), seed: this.seed, mode: 'duel' });
    this.roundEvents = []; this.recordFrame(); this.feedFora();
    this.lobby.players = {};
    this.startRound();
  }
  /** Після дуелі турніру: записати переможця, підготувати наступну пару або назвати чемпіона. */
  tournamentAfterDuel(winners) {
    const t = this.tournament; if (!t) return null;
    const m = t.matches[t.current]; m.winner = winners.includes(m.a) ? m.a : m.b;
    if (t.kind === 'bracket' && t.current === 1) { t.matches[2].a = t.matches[0].winner; t.matches[2].b = t.matches[1].winner; }
    t.current += 1;
    if (t.current >= t.matches.length) {
      const st = this.tournamentStandings(); t.champion = st[0].id; t.current = t.matches.length;
      const c = this.players[t.champion]; c.stats.tournaments = (c.stats.tournaments || 0) + 1; this.addSeasonPoints(t.champion, SEASON_POINTS.champion);
      this.feed(`🏆 Чемпіон турніру: ${c.name}!`); this.announce = { text: `🏆 Чемпіон турніру: ${c.name}! +${SEASON_POINTS.champion} очок сезону`, by: 'Арена', at: this.now() };
      return { done: true, champion: c.name, achievements: checkAchievements(c).map(a => ({ t: 'achievement', who: c.id, name: a.name, icon: a.icon, title: a.title })) };
    }
    return { done: false };
  }
  tournamentStandings() {
    const t = this.tournament; const w = {}; for (const id of t.players) w[id] = 0;
    for (const m of t.matches) if (m.winner) w[m.winner] += 1;
    if (t.kind === 'bracket' && t.matches[2].winner) w[t.matches[2].winner] += 10;
    return t.players.map(id => ({ id, name: this.players[id].name, wins: w[id] })).sort((x, y) => y.wins - x.wins || t.players.indexOf(x.id) - t.players.indexOf(y.id));
  }
  tournamentView() {
    const t = this.tournament; if (!t) return null;
    const nm = id => id ? this.publicPlayer(this.players[id]) : null;
    return { kind: t.kind, current: t.current, of: t.matches.length, champion: t.champion ? this.players[t.champion].name : null,
      matches: t.matches.map((m, i) => ({ a: nm(m.a), b: nm(m.b), winner: m.winner ? this.players[m.winner].name : null, live: i === t.current && !t.champion, final: t.kind === 'bracket' && i === 2 })),
      standings: this.tournamentStandings(), players: t.players.map(nm) };
  }
  startBattle() {
    this.stopReplay();
    const ids = Object.keys(this.lobby.players);
    if (this.lobby.mode === 'tournament') { this.tournament = null; return this.startTournament(ids); }
    const fighters = (list) => list.map(id => { const p = this.players[id]; return fighterFromPlayer({ ...p, bonus: equipmentBonus(p), icon: this.publicPlayer(p).icon, pet: activePetIcon(p), cry: this.publicPlayer(p).cry }, this.rng); });
    this.seed = (this.seed * 7919 + 13) % 2147483647; this.rng = makeRng(this.seed);
    if (this.lobby.mode === 'duel') {
      const t0 = ids.filter(id => this.lobby.players[id].team === 0), t1 = ids.filter(id => this.lobby.players[id].team === 1);
      this.run = { mode: 'duel', players: ids, startedAt: this.now(), frames: [] };
      this.battle = createBattle({ teams: this.duelTeams(fighters(t0), fighters(t1)), seed: this.seed, mode: 'duel' });
      this.roundEvents = [];
      this.recordFrame(); this.feedFora();
    } else {
      const ch = this.lobby.mode === 'campaign' ? this.campaignChapter() : null;
      const d = dungeonById[ch ? ch.dungeon : this.lobby.mode === 'practice' ? 'practice' : this.lobby.dungeonId];
      const mut = d.raid || d.practice ? null : this.mutatorToday();
      this.run = { mode: 'dungeon', mutator: mut ? mut.id : null, campaign: ch ? ch.n : undefined, dungeon: d.id, players: ids, room: 0, rooms: [...d.rooms, [d.boss]], team: fighters(ids), loot: [], xp: 0, gold: 0, kills: [], startedAt: this.now(), frames: [] };
      this.nextRoom();
    }
    this.lobby.players = {};
    this.feed(this.run.mode === 'duel' ? `Дуель: ${this.run.players.map(id => this.players[id].name).join(' проти ')}` : `${ids.map(id => this.players[id].name).join(', ')}: у «${dungeonById[this.run.dungeon].name}»`);
    this.startRound();
  }
  /** Фора в дуелі (слабшій команді) і «друге дихання» (3 поразки поспіль). */
  duelTeams(t0, t1) {
    const losses = {}; for (const f of [...t0, ...t1]) losses[f.id] = this.players[f.id].lossStreak || 0;
    return applyFora([t0, t1], losses);
  }
  feedFora() {
    for (const f of this.battle.fighters) {
      if (f.fora) this.feed(`🤝 Фора: ${f.name} +${f.fora} % здоров’я`);
      if (f.secondWind) this.feed(`💨 Друге дихання: ${f.name} +20 % здоров’я і сили`);
    }
  }
  nextRoom() {
    const r = this.run;
    const d = dungeonById[r.dungeon];
    const mut = r.mutator ? MUTATORS.find(m => m.id === r.mutator) : null;
    const scale = (d.raid ? 1 + Math.max(0, r.players.length - 1) * (d.scalePerPlayer || 0.5) : 1 + Math.max(0, r.players.length - 2) * 0.35) * (mut && mut.mobScale ? mut.mobScale : 1);
    const ids = r.rooms[r.room].slice();
    // майстерня мобів: у не-босівській кімнаті один моб може бути намальованим дитиною
    const own = this.customMobs().filter(m => m.level <= (d.level || 1) + 3);
    if (own.length && !ids.every(id => mobById[id].boss) && (r.room === 0 || ((this.seed + r.room) % 2 === 0))) {
      const cands = ids.map((id, i) => mobById[id].boss ? -1 : i).filter(i => i >= 0);
      const at = cands[(this.seed + r.room) % cands.length]; const cm = own[(this.seed + r.room) % own.length];
      ids[at] = cm.id; r.customMobs = r.customMobs || []; if (!r.customMobs.includes(cm.id)) r.customMobs.push(cm.id);
      this.feed(`👾 Монстр ${cm.author} «${cm.name}» вийшов назустріч!`);
    }
    const mobs = ids.map((m, i) => fighterFromMob(m, i, mobById[m].boss ? scale * 1.1 : scale));
    const heal = mut && mut.fullHeal ? 1 : ROOM_HEAL;
    for (const f of r.team) {
      if (r.room === 0 && mut && mut.heroHp) { f.maxHp = Math.round(f.maxHp * mut.heroHp); f.hp = f.maxHp; }
      f.move = null; f.shield = 0; f.buffs = []; f.effects = {}; f.minions = []; if (r.room > 0 && f.alive) f.hp = Math.min(f.maxHp, f.hp + Math.round(f.maxHp * heal)); if (!f.alive) { f.alive = true; f.hp = Math.round(f.maxHp * 0.5); }
      if (mut && mut.startMana) f.mana = Math.min(f.maxMana, mut.startMana);
    }
    this.battle = createBattle({ teams: [r.team, mobs], seed: this.seed + r.room, mode: 'dungeon', meta: { room: r.room + 1, rooms: r.rooms.length, boss: r.room === r.rooms.length - 1 && !d.practice, practice: !!d.practice, dungeon: r.dungeon, raid: !!d.raid, scale, mutator: mut ? { id: mut.id, name: mut.name, icon: mut.icon } : null } });
    this.roundEvents = [{ t: 'room', n: r.room + 1, of: r.rooms.length, boss: r.room === r.rooms.length - 1 && !d.practice, practice: !!d.practice, names: mobs.map(m => m.name) }];
    this.recordFrame();
  }
  /** Кадр для повтору: стан бійців після раунду (або на вході в кімнату) і події раунду. */
  recordFrame() {
    const b = this.battle, r = this.run; if (!b || !r || !r.frames) return;
    if (r.frames.length >= REPLAY_FRAMES) return;
    const intro = this.roundEvents && this.roundEvents[0] && this.roundEvents[0].t === 'room' ? this.roundEvents[0] : null;
    r.frames.push({ round: b.round, mode: b.mode, meta: b.meta, over: b.over, winner: b.winner, fighters: b.fighters.map(publicFighter),
      lastRound: b.round ? { n: b.round, events: this.roundEvents } : null, roomIntro: intro });
  }

  // ---------- бій ----------
  startRound() {
    if (!this.battle || this.battle.over) return;
    if (this.paused) return;
    this.roundEnds = this.now() + this.settings.roundSeconds * 1000;
    if (this.settings.smartCards) for (const f of this.battle.fighters) if (f.kind === 'player' && f.alive) f.quiz = makeQuiz(this.rng, this.players[f.id] ? this.players[f.id].age : null);
    this.setTimer('round', this.settings.roundSeconds * 1000, () => this.resolve());
    this.emit();
  }
  move(p, mv) {
    if (!this.battle || this.battle.over) throw err('бій не йде');
    const f = this.battle.fighters.find(x => x.id === p.id);
    let smart = false;
    if (f && f.quiz && mv && mv.quiz !== undefined && mv.quiz !== null && mv.quiz !== '') {
      smart = checkQuiz(f.quiz, mv.quiz); f.quiz = null;
      if (smart) { p.stats.smart = (p.stats.smart || 0) + 1; this.logDay(p.id, { smart: 1 }); }
    }
    const e = submitMove(this.battle, p.id, { ...mv, smart });
    if (e) throw err(e);
    this.emit();
    const waiting = alive(this.battle, 0).concat(alive(this.battle, 1)).filter(f => f.kind === 'player' && !f.move);
    if (!waiting.length) this.resolve();
  }
  resolve() {
    if (!this.battle || this.battle.over) return;
    this.clearTimer('round');
    const ev = resolveRound(this.battle);
    this.roundEvents = ev.map(e => this.describe(e));
    this.lastRound = { n: this.battle.round, events: this.roundEvents, at: this.now() };
    if (!this.battle.meta.practice) for (const e of ev) if (e.t === 'dmg' && e.kind === 'hit' && this.players[e.by]) { const t = this.battle.fighters.find(x => x.id === e.who); this.setRecord('bigHit', e.v, e.by, `${this.players[e.by].name}: ${e.v} шкоди ${t ? t.name : ''}${e.crit ? ' (крит)' : ''}`); }
    this.roundEnds = null;
    this.recordFrame();
    const animMs = this.tvOnline() ? Math.min(12000, 1500 + ev.length * 450) : Math.min(4000, 1000 + ev.length * 150);
    this.emit();
    if (this.battle.over) { this.setTimer('round', animMs, () => this.afterBattle()); return; }
    this.setTimer('round', animMs, () => this.startRound());
  }
  describe(e) {
    const name = (id) => { const f = this.battle.fighters.find(x => x.id === id); return f ? f.name : id; };
    const d = { ...e, whoName: e.who ? name(e.who) : undefined, byName: e.by ? name(e.by) : undefined };
    if (e.zone) d.zoneName = ZONE_NAMES[e.zone];
    return d;
  }
  afterBattle() {
    const b = this.battle, r = this.run;
    const ev = [];
    const rng = this.rng;
    const minutes = Math.max(1, Math.round((this.now() - r.startedAt) / 60000)); const evt = this.eventToday();
    if (r.mode === 'dungeon') {
      // нагороди за кімнату: досвід, золото, лут із мобів
      for (const m of b.fighters.filter(f => f.team === 1)) {
        const mob = mobById[m.mob];
        if (mob.custom) { const cm = this.history.customMobs.find(x => x.id === mob.id); if (cm) { if (m.alive && b.winner !== 0) cm.won = (cm.won || 0) + 1; else if (!m.alive) cm.beaten = (cm.beaten || 0) + 1; } }
        if (m.alive) continue;
        if (mob.boss && !dungeonById[r.dungeon].practice && !this.history.book.bosses.includes(mob.id)) { this.history.book.bosses.push(mob.id); this.moment('👑', `Вперше повалено ${mob.name}: ${r.players.map(id => this.players[id].name).join(', ')}`); }
        r.kills.push(mob.id); r.xp += mob.xp; r.gold += mob.gold;
        if (rng.chance(Math.min(1, mob.lootChance * (r.mutator && (MUTATORS.find(m => m.id === r.mutator) || {}).lootMult || 1)))) {
          const pid = rng.pick(r.players);
          const it = genItem(rng, mob.level, null, mob.boss ? 'rare' : 'common');
          r.loot.push({ pid, item: it, from: mob.name });
        }
        if (mob.boss) for (const pid of r.players) {
          const it = genItem(rng, mob.level, null, 'rare'); r.loot.push({ pid, item: it, from: mob.name, guaranteed: true });
          if (rng.chance(0.5)) { const c = genCard(rng, this.players[pid].class, 'rare'); if (c) r.loot.push({ pid, card: c, from: mob.name }); }
        }
      }
      if (b.winner === 0 && r.room < r.rooms.length - 1) {
        r.room += 1; this.nextRoom(); this.startRound(); return;
      }
      const won = b.winner === 0;
      const d = dungeonById[r.dungeon];
      if (d.practice) {
        const pev = [];
        for (const pid of r.players) { const p = this.players[pid]; this.addMinutes(p, minutes); p.stats.practice = (p.stats.practice || 0) + 1; for (const a of checkAchievements(p)) pev.push({ t: 'achievement', who: pid, name: a.name, icon: a.icon, title: a.title }); for (const d of this.checkDaily(p)) pev.push({ t: 'daily', who: pid, name: d.name, icon: d.icon, gold: d.gold }); }
        this.results = { mode: 'dungeon', practice: true, won, dungeon: d.name, xp: 0, gold: 0, kills: r.kills.length, loot: [], rounds: b.round, events: pev.map(e => ({ ...e, whoName: this.players[e.who] && this.players[e.who].name })), players: r.players.map(id => this.publicPlayer(this.players[id])) };
        this.feed(`🎯 ${r.players.map(id => this.players[id].name).join(', ')}: тренування, манекен ${won ? 'повалений' : 'встояв'}`);
      } else {
      if (d.raid) {
        this.history.raids.push({ raid: d.id, week: this.weekKey(), won, at: this.now(), players: r.players.map(id => this.players[id].name) });
        if (won) for (const pid of r.players) {
          const it = genItem(rng, d.level, rng.chance(d.rewards.legendaryChance) ? 'legendary' : null, d.rewards.minRarity); r.loot.push({ pid, item: it, from: d.name, guaranteed: true });
          this.players[pid].stats.raids = (this.players[pid].stats.raids || 0) + 1; this.addSeasonPoints(pid, 10);
        }
      }
      const mutDef = r.mutator ? MUTATORS.find(m => m.id === r.mutator) : null;
      if (mutDef && mutDef.rewardMult) { r.xp = Math.round(r.xp * mutDef.rewardMult); r.gold = Math.round(r.gold * mutDef.rewardMult); }
      if (mutDef && mutDef.goldMult) r.gold = Math.round(r.gold * mutDef.goldMult);
      if (evt && evt.goldMult) r.gold = Math.round(r.gold * evt.goldMult);
      if (evt && evt.familyXpMult && r.players.length >= 2) { r.xp = Math.round(r.xp * evt.familyXpMult); if (won) for (const pid of r.players) this.addSeasonPoints(pid, evt.familyPoints); }
      if (evt && evt.parentBonus && won && r.players.some(id => this.isParent(this.players[id]))) for (const pid of r.players) this.addSeasonPoints(pid, evt.parentBonus);
      if (won) for (const pid of r.players) if (rng.chance(mutDef && mutDef.petChance ? mutDef.petChance : PET_DROP)) r.loot.push({ pid, pet: genPet(rng, d.level), from: d.name });
      for (const pid of r.players) {
        const p = this.players[pid]; const f = r.team.find(x => x.id === pid);
        const share = won ? 1 : 0.4;
        const xp = Math.round(r.xp * share / r.players.length) + 10; const gold = Math.round(r.gold * share / r.players.length);
        p.gold += gold; ev.push(...addXp(p, xp));
        p.stats.kills += f.stats.kills; p.stats.crits += f.stats.crits; p.stats.blocks += f.stats.blocks; p.stats.heals += f.stats.heals;
        if (won) { p.stats.dungeons += 1; p.stats.bossKills += 1; if (r.dungeon === 'bathroom_kraken') p.stats.dragonKills += 1; }
        if (f && f.stats) this.setRecord('runKills', f.stats.kills, pid, `${p.name}: ${f.stats.kills} ворогів у «${dungeonById[r.dungeon].name}»`);
        this.addSeasonPoints(pid, won ? 4 + dungeonById[r.dungeon].level : SEASON_POINTS.dungeonLoss);
        for (const l of r.loot.filter(x => x.pid === pid)) {
          if (l.item) { p.inventory.push(l.item); if (l.item.rarity === 'legendary') { p.stats.legendaries += 1; this.history.legendaries.unshift({ pid, name: p.name, item: l.item, at: this.now() }); this.feed(`🟠 ${p.name} вибив легендарку: ${l.item.name}!`); this.moment('🟠', `${p.name} вибив легендарку «${l.item.name}» з ${l.from}`, pid); } }
          if (l.card && !p.collection.includes(l.card)) p.collection.push(l.card);
          if (l.pet) { const pe = grantPet(p, l.pet); if (pe) { ev.push(pe); if (pe.isNew) this.feed(`🐾 ${p.name} приручив вихованця: ${pe.icon} ${pe.name}`); } }
        }
        for (const a of checkAchievements(p)) ev.push({ t: 'achievement', who: pid, name: a.name, icon: a.icon, title: a.title });
        for (const d of this.checkDaily(p)) ev.push({ t: 'daily', who: pid, name: d.name, icon: d.icon, gold: d.gold });
        this.addMinutes(p, minutes); this.touchStreak(p, ev);
      }
      for (const a of this.checkFamily()) ev.push({ t: 'family', name: a.name, icon: a.icon, gold: a.gold });
      for (const e of this.checkEnvelopes()) ev.push({ t: 'envelope', ...e });
      let camp = null;
      if (r.campaign) {
        const ch = CAMPAIGN.find(c => c.n === r.campaign); const cur = this.campaignChapter();
        camp = { n: ch.n, of: CAMPAIGN.length, title: ch.title, outro: won ? ch.outro : null, finished: false };
        if (won && cur && cur.n === ch.n) {
          this.history.campaign.chapter += 1; this.history.campaign.done.push({ n: ch.n, at: this.now(), players: r.players.map(id => this.players[id].name) });
          if (this.history.campaign.chapter >= CAMPAIGN.length) { this.history.campaign.chapter = 0; this.history.campaign.runs += 1; camp.finished = true; this.feed(`📖 Кампанію пройдено! Дім урятовано (${this.history.campaign.runs}-й раз)`); this.announce = { text: '📖 Кампанію пройдено! Дім урятовано 🎉', by: 'Арена', at: this.now() }; }
          else this.feed(`📖 Розділ ${ch.n} «${ch.title}» пройдено. Далі: «${CAMPAIGN[this.history.campaign.chapter].title}»`);
          for (const pid of r.players) { const p = this.players[pid]; p.stats.chapters = (p.stats.chapters || 0) + 1; this.addSeasonPoints(pid, SEASON_POINTS.chapter); for (const a of checkAchievements(p)) ev.push({ t: 'achievement', who: pid, name: a.name, icon: a.icon, title: a.title }); }
        }
      }
      const wb = this.hitWorldBoss(r.players, won ? WORLD_BOSS.dungeonBase + WORLD_BOSS.dungeonPerLevel * d.level + WORLD_BOSS.dungeonPerKill * r.kills.length : WORLD_BOSS.dungeonLoss, ev, null, r.team);
      this.results = { mode: 'dungeon', won, raid: !!d.raid, worldBoss: wb, campaign: camp, mutator: mutDef ? { name: mutDef.name, icon: mutDef.icon } : null, dungeon: dungeonById[r.dungeon].name, xp: Math.round(r.xp / r.players.length), gold: Math.round(r.gold / r.players.length), kills: r.kills.length,
        loot: r.loot.map(l => ({ ...l, name: this.players[l.pid].name, cardName: l.card ? cardById[l.card].name : undefined, petName: l.pet ? petById[l.pet].name : undefined, petIcon: l.pet ? petById[l.pet].icon : undefined })), events: ev.map(e => ({ ...e, whoName: this.players[e.who] && this.players[e.who].name })), players: r.players.map(id => this.publicPlayer(this.players[id])) };
      this.feed(won ? `${d.raid ? '🗿' : '🏆'} ${r.players.map(id => this.players[id].name).join(', ')} пройшли «${dungeonById[r.dungeon].name}»` : `💀 «${dungeonById[r.dungeon].name}» виявилось сильнішим`);
      }
    } else {
      const winners = b.fighters.filter(f => f.team === b.winner).map(f => f.id);
      this.setRecord('longDuel', b.round, null, `${r.players.map(id => this.players[id].name).join(' проти ')}: ${b.round} раундів`);
      for (const pid of r.players) {
        const p = this.players[pid]; const f = b.fighters.find(x => x.id === pid); const won = winners.includes(pid);
        p.stats.duels += 1; if (won) p.stats.duelWins += 1; p.lossStreak = won ? 0 : (p.lossStreak || 0) + 1;
        this.addSeasonPoints(pid, won ? SEASON_POINTS.duelWin : SEASON_POINTS.duelLoss);
        p.stats.crits += f.stats.crits; p.stats.blocks += f.stats.blocks; p.stats.heals += f.stats.heals;
        ev.push(...addXp(p, won ? 40 : 15)); p.gold += (won ? 12 : 4) * (evt && evt.goldMult ? evt.goldMult : 1);
        for (const a of checkAchievements(p)) ev.push({ t: 'achievement', who: pid, name: a.name, icon: a.icon, title: a.title });
        for (const d of this.checkDaily(p)) ev.push({ t: 'daily', who: pid, name: d.name, icon: d.icon, gold: d.gold });
        this.addMinutes(p, minutes); this.touchStreak(p, ev);
      }
      for (const a of this.checkFamily()) ev.push({ t: 'family', name: a.name, icon: a.icon, gold: a.gold });
      for (const e of this.checkEnvelopes()) ev.push({ t: 'envelope', ...e });
      const wb = this.hitWorldBoss(r.players, 0, ev, (pid) => winners.includes(pid) ? WORLD_BOSS.duelWin : WORLD_BOSS.duelLoss, b.fighters);
      let tr = null; if (r.tournament !== undefined && this.tournament) { tr = this.tournamentAfterDuel(winners); if (tr.achievements) ev.push(...tr.achievements); }
      this.results = { mode: 'duel', worldBoss: wb, tournament: tr ? { ...this.tournamentView(), done: tr.done } : null, winners: winners.map(id => this.players[id].name), xp: 40, gold: 12, events: ev.map(e => ({ ...e, whoName: this.players[e.who] && this.players[e.who].name })), players: r.players.map(id => this.publicPlayer(this.players[id])) };
      this.feed(`⚔️ Дуель виграв: ${winners.map(id => this.players[id].name).join(', ')}`);
    }
    if (!this.results.practice) this.history.battles.unshift({ mode: r.mode, players: r.players, at: this.now(), won: this.results.won, winners: this.results.winners });
    if (!this.results.practice) for (const pid of r.players) { const p = this.players[pid]; const won = r.mode === 'duel' ? (this.results.winners || []).includes(p.name) : !!this.results.won; const f = (r.team || (this.battle && this.battle.fighters) || []).find(x => x.id === pid); this.logDay(pid, { battles: 1, wins: won ? 1 : 0, kills: f && f.stats ? f.stats.kills : 0 }); }
    this.history.battles = this.history.battles.slice(0, 200);
    this.history.lastReplay = { mode: r.mode, at: this.now(), names: r.players.map(id => this.players[id].name), frames: r.frames || [] };
    this.store.save('players'); this.store.save('history');
    this.battle = null; this.run = null; this.roundEvents = [];
    this.emit();
    this.setTimer('results', RESULTS_SECONDS * 1000, () => {
      this.results = null;
      if (this.tournament && !this.tournament.champion && this.tournament.current < this.tournament.matches.length) { this.startMatch(); return; }
      if (this.tournament && this.tournament.champion) this.tournament = null;
      this.emit();
    });
  }
  /** Тривога з дому (пульт шле POST /api/alert): пауза з причиною alert, оголошення на ТБ. */
  setAlert(on) {
    this.lastAlert = { on: !!on, at: this.now() };
    if (on && !(this.paused && this.pauseReason === 'alert')) { this.setPaused(true, 'alert'); this.announce = { text: '🚨 Тривога! Усі в укриття, гра зачекає', by: 'Дім', at: this.now() }; this.feed('🚨 Тривога: гра на паузі'); this.emit(); }
    else if (!on && this.paused && this.pauseReason === 'alert') { this.setPaused(false); this.announce = { text: '✅ Відбій тривоги. Граємо далі!', by: 'Дім', at: this.now() }; this.feed('✅ Відбій тривоги'); this.emit(); }
    return { paused: this.paused, reason: this.pauseReason };
  }
  /** Пауза (тривога): раунд не закривається, таймер стоїть. */
  setPaused(on, reason) {
    this.paused = !!on; this.pauseReason = on ? (reason || 'пауза') : null;
    if (on) { this.clearTimer('round'); this.roundEnds = null; if (this.battle) for (const pid of (this.run ? this.run.players : [])) { const p = this.players[pid]; if (p && reason === 'alert') { p.stats.alertPauses += 1; checkAchievements(p); } } }
    else if (this.battle) this.startRound();
    this.emit();
  }

  // ---------- герой ----------
  setDeck(p, deck) { const e = setDeck(p, deck); if (e) throw err(e); this.store.save('players'); this.emit(); }
  autoDeck(p) { const deck = autoDeck(p); const e = setDeck(p, deck); if (e) throw err(e); this.store.save('players'); this.emit(); return deck; }
  equip(p, itemId) { const e = equip(p, itemId); if (e) throw err(e); this.store.save('players'); this.emit(); }
  unequip(p, slot) { const e = unequip(p, slot); if (e) throw err(e); this.store.save('players'); this.emit(); }
  craft(p, ids) { const out = craft(p, ids, this.rng); if (typeof out === 'string') throw err(out); this.store.save('players'); if (out.rarity === 'legendary') this.feed(`🔧 ${p.name} скрафтив легендарку: ${out.name}!`); checkAchievements(p); this.emit(); return out; }
  sell(p, itemId) { const it = p.inventory.find(i => i.id === itemId); if (!it) throw err('немає предмета'); p.inventory = p.inventory.filter(i => i.id !== itemId); const g = sellPrice(it); p.gold += g; this.store.save('players'); this.emit(); return g; }
  /** Магазин: скриня за золото (рідкість випадкова, трохи краща за звичайну). */
  /** Косметика за золото: рамки аватара (видно на ТБ) і бойовий клич (на ТБ при криті). */
  cosmeticsView(p) {
    const c = p.cosmetics || { owned: [], frame: null, cry: null };
    return { frames: COSMETICS.frames.map(f => ({ ...f, owned: c.owned.includes('frame:' + f.id), active: c.frame === f.id })),
      cries: COSMETICS.cries.map(x => ({ ...x, owned: c.owned.includes('cry:' + x.id), active: c.cry === x.id })), frame: c.frame, cry: c.cry };
  }
  buyCosmetic(p, key) {
    if (!p.cosmetics) p.cosmetics = { owned: [], frame: null, cry: null };
    const [kind, id] = String(key).split(':'); const def = kind === 'frame' ? COSMETICS.frames.find(x => x.id === id) : kind === 'cry' ? COSMETICS.cries.find(x => x.id === id) : null;
    if (!def) throw err('немає такого'); if (p.cosmetics.owned.includes(key)) throw err('уже є');
    if (p.gold < def.price) throw err('не вистачає золота');
    p.gold -= def.price; p.cosmetics.owned.push(key); p.cosmetics[kind] = id;
    this.store.save('players'); this.emit(); return this.cosmeticsView(p);
  }
  setCosmetic(p, { frame, cry }) {
    if (!p.cosmetics) p.cosmetics = { owned: [], frame: null, cry: null };
    if (frame !== undefined) { if (frame !== null && !p.cosmetics.owned.includes('frame:' + frame)) throw err('не куплено'); p.cosmetics.frame = frame; }
    if (cry !== undefined) { if (cry !== null && !p.cosmetics.owned.includes('cry:' + cry)) throw err('не куплено'); p.cosmetics.cry = cry; }
    this.store.save('players'); this.emit(); return this.cosmeticsView(p);
  }
  // ---------- «арена зачиняється»: попередження перед сном і при кінці ліміту ----------
  minutesToBedtime() {
    const k = this.kyiv(); const toMin = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
    const now = toMin(k.hm), bed = toMin(this.settings.bedtime), wake = toMin(this.settings.wakeup);
    if (now >= bed || now < wake) return 0;
    return bed - now;
  }
  closingView(p = null) {
    const kids = this.playerList.filter(x => !this.isParent(x));
    if (!kids.length) return null;
    const bed = this.minutesToBedtime();
    let out = null;
    if (bed > 0 && bed <= CLOSING_WARN_MIN) out = { why: 'bedtime', min: bed, text: `🌙 Арена зачиняється за ${bed} хв: о ${this.settings.bedtime} дітям спати` };
    if (p && !this.isParent(p)) {
      const left = this.limitFor(p) - this.minutesToday(p);
      if (left > 0 && left <= CLOSING_WARN_MIN && (!out || left < out.min)) out = { why: 'limit', min: left, text: `⏱ Лишилось ${left} хв ігрового часу на сьогодні. Справи додають час!` };
    }
    return out;
  }
  /** Раз на 30 с: оголошення на ТБ за 10 хв до сну (раз на день). */
  tick() {
    this.expireChallenges(); this.autoCloseSeason(); this.expireGuests();
    const bed = this.minutesToBedtime(); const day = this.kyiv().day;
    if (bed > 0 && bed <= CLOSING_WARN_MIN && this.closingWarnedDay !== day && this.playerList.some(x => !this.isParent(x))) {
      this.closingWarnedDay = day;
      this.announce = { text: `🌙 Арена зачиняється за ${bed} хв. Дограйте бій і готуйтесь до сну`, by: 'Дім', at: this.now() };
      this.feed(`🌙 За ${bed} хв арена зачиняється (${this.settings.bedtime})`); this.emit();
    }
  }
  // ---------- купони бажань: золото → справжня дрібниця, виконує батько ----------
  couponsView(p) {
    const mine = this.history.coupons.filter(o => o.pid === p.id).slice(-10).reverse();
    return { list: this.settings.coupons.map(c => ({ ...c, canBuy: p.gold >= c.price })), orders: mine };
  }
  pendingCoupons() { return this.history.coupons.filter(o => o.status === 'pending').map(o => ({ ...o, name: (this.players[o.pid] || {}).name })); }
  buyCoupon(p, couponId) {
    const c = this.settings.coupons.find(x => x.id === couponId); if (!c) throw err('немає такого купона');
    if (this.history.coupons.filter(o => o.pid === p.id && o.status === 'pending').length >= 3) throw err('спочатку хай батьки виконають попередні (до 3 одночасно)');
    if (p.gold < c.price) throw err('не вистачає золота');
    p.gold -= c.price; p.stats.coupons = (p.stats.coupons || 0) + 1; checkAchievements(p);
    const o = { id: 'o' + this.now().toString(36) + this.rng.int(0, 999999).toString(36), pid: p.id, couponId: c.id, title: c.name, icon: c.icon, price: c.price, at: this.now(), status: 'pending' };
    this.history.coupons.push(o); this.history.coupons = this.history.coupons.slice(-200);
    this.feed(`🎟 ${p.name} купив бажання: ${c.icon} ${c.name}`); this.announce = { text: `🎟 ${p.name}: ${c.icon} ${c.name}`, by: 'Арена', at: this.now() };
    this.store.save('players'); this.store.save('history'); this.emit();
    return o;
  }
  couponDone(parent, orderId, refund = false) {
    if (!this.isParent(parent)) throw err('лише батьки', 403);
    const o = this.history.coupons.find(x => x.id === orderId); if (!o || o.status !== 'pending') throw err('немає такого замовлення');
    o.status = refund ? 'refunded' : 'done'; o.doneAt = this.now();
    const p = this.players[o.pid]; if (refund && p) p.gold += o.price;
    this.feed(refund ? `↩️ ${p ? p.name : '?'}: купон «${o.title}» повернуто, золото назад` : `✅ ${p ? p.name : '?'} отримав: ${o.icon} ${o.title}`);
    this.store.save('players'); this.store.save('history'); this.emit();
    return o;
  }
  setCoupons(parent, list) {
    if (!this.isParent(parent)) throw err('лише батьки', 403);
    if (!Array.isArray(list) || list.length > 20) throw err('до 20 купонів');
    const out = []; const seen = new Set();
    for (const c of list) {
      const name = String(c.name || '').trim().slice(0, 60); const price = Math.round(Number(c.price)); const icon = String(c.icon || '🎟').trim().slice(0, 4);
      if (!name || !(price > 0 && price <= 5000)) throw err('назва і ціна 1–5000');
      let id = c.id && /^[a-z0-9_]{1,20}$/.test(c.id) ? c.id : 'c' + (this.now().toString(36)) + out.length; if (seen.has(id)) id += out.length; seen.add(id);
      out.push({ id, name, icon, price });
    }
    this.settings.coupons = out; this.store.set('settings', this.settings); this.emit();
    return out;
  }
  // ---------- серія днів і щоденний подарунок ----------
  prevDay(day) { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
  touchStreak(p, ev = []) {
    const day = this.kyiv().day; const s = p.streak || (p.streak = { days: 0, last: null });
    if (s.last === day) return s.days;
    s.days = s.last === this.prevDay(day) || (this.settings.freeze && s.last) ? s.days + 1 : 1; s.last = day;
    if (s.days > (p.stats.streakBest || 0)) p.stats.streakBest = s.days;
    if (s.days >= 3) this.setRecord('streak', s.days, p.id, `${p.name}: ${s.days} дн. поспіль`);
    for (const a of checkAchievements(p)) ev.push({ t: 'achievement', who: p.id, name: a.name, icon: a.icon, title: a.title });
    if (s.days >= 3 && s.days % 3 === 0) this.feed(`🔥 ${p.name}: ${s.days} днів поспіль!`);
    return s.days;
  }
  streakView(p) { const day = this.kyiv().day; const s = p.streak || { days: 0, last: null }; const active = s.last === day || s.last === this.prevDay(day) || (this.settings.freeze && s.last); return { days: active ? s.days : 0, today: s.last === day, best: p.stats.streakBest || 0, frozen: !!this.settings.freeze }; }
  daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); }
  /** Відмітити, що гравець сьогодні заходив; після паузи від 3 днів приготувати «з поверненням». */
  touchSeen(p) {
    const day = this.kyiv().day; if (p.lastSeen === day) return;
    if (p.lastSeen && this.daysBetween(p.lastSeen, day) >= WELCOME.afterDays && !this.isParent(p) && !this.isGuest(p)) p.welcome = { day, away: this.daysBetween(p.lastSeen, day), claimed: false };
    p.lastSeen = day; this.store.save('players');
  }
  welcomeView(p) { const w = p.welcome; const day = this.kyiv().day; return w && w.day === day && !w.claimed ? { away: w.away, gold: WELCOME.gold } : null; }
  claimWelcome(p) {
    const w = this.welcomeView(p); if (!w) throw err('немає що забирати');
    const day = this.kyiv().day; const s = p.streak || (p.streak = { days: 0, last: null });
    const kept = s.last && s.last !== day && s.last !== this.prevDay(day) && s.days > 0 ? s.days : 0; if (kept) s.last = this.prevDay(day);
    p.welcome.claimed = true; p.gold += WELCOME.gold;
    this.feed(`👋 ${p.name} повернувся після ${w.away} дн.: +${WELCOME.gold} золота${kept ? `, серія ${kept} дн. збережена` : ''}`);
    this.announce = { text: `👋 З поверненням, ${p.name}! Тебе не було ${w.away} дн.`, by: 'Арена', at: this.now() };
    this.store.save('players'); this.emit(); return { gold: WELCOME.gold, kept };
  }
  giftGold(days) { return GIFT.base + GIFT.perDay * Math.min(days, GIFT.maxDays); }
  giftView(p) { const day = this.kyiv().day; const st = this.streakView(p); const d = st.days + (st.today ? 0 : 1); return { claimed: (p.gift && p.gift.day) === day, gold: this.giftGold(d), item: d > 0 && d % GIFT.itemEvery === 0 }; }
  claimGift(p) {
    const day = this.kyiv().day; if (!p.gift) p.gift = { day: null };
    if (p.gift.day === day) throw err('подарунок на сьогодні вже забрано');
    const days = this.touchStreak(p); const gold = this.giftGold(days);
    p.gift.day = day; p.gold += gold; p.stats.gifts = (p.stats.gifts || 0) + 1; const daily = this.checkDaily(p);
    let item = null; if (days % GIFT.itemEvery === 0) { item = genItem(this.rng, p.level, null, 'rare'); p.inventory.push(item); if (item.rarity === 'legendary') p.stats.legendaries += 1; }
    const ach = checkAchievements(p); this.store.save('players'); this.emit();
    return { gold, item, days, daily: daily.map(d => d.name), achievements: ach.map(a => a.name) };
  }
  buyChest(p, kind) {
    const price = { common: 40, rare: 150 }[kind]; if (!price) throw err('немає такої скрині');
    if (p.gold < price) throw err('не вистачає золота');
    p.gold -= price;
    const it = genItem(this.rng, p.level, null, kind === 'rare' ? 'rare' : 'uncommon');
    p.inventory.push(it); if (it.rarity === 'legendary') { p.stats.legendaries += 1; this.feed(`🟠 ${p.name} відкрив легендарку в скрині: ${it.name}!`); }
    checkAchievements(p); this.store.save('players'); this.emit();
    return it;
  }

  // ---------- щоденні ігрові завдання: 3 на день, прогрес зі статистики ----------
  dailyFor(p) {
    const day = this.kyiv().day;
    if (!p.daily || p.daily.day !== day) {
      const rng = makeRng(parseInt(day.replace(/-/g, ''), 10) + p.id.charCodeAt(1) * 7);
      const pick = rng.shuffle(DAILY.filter(d => d.stat !== 'quests' || this.settings.questsEnabled)).slice(0, 3);
      p.daily = { day, tasks: pick.map(d => ({ id: d.id, base: p.stats[d.stat] || 0, done: false })) };
      this.store.save('players');
    }
    return p.daily.tasks.map(t => { const d = DAILY.find(x => x.id === t.id); const progress = Math.min(d.n, (p.stats[d.stat] || 0) - t.base); return { ...d, progress, done: t.done }; });
  }
  /** Перевірити щоденні після бою чи справи; повертає виконані зараз. */
  checkDaily(p) {
    const out = [];
    this.dailyFor(p);
    for (const t of p.daily.tasks) {
      if (t.done) continue;
      const d = DAILY.find(x => x.id === t.id);
      if ((p.stats[d.stat] || 0) - t.base >= d.n) { t.done = true; p.gold += d.gold; addXp(p, d.xp); out.push(d); this.feed(`📅 ${p.name} виконав завдання дня «${d.name}»: +${d.gold} золота`); }
    }
    if (out.length) this.store.save('players');
    return out;
  }

  // ---------- сімейні досягнення: спільні для всіх ----------
  // ---------- конверти-сюрпризи: відкриваються за спільні бої і справи (як у Zombie Kidz Evolution) ----------
  envelopeProgress() { return this.history.battles.length + this.familySum('quests'); }
  dungeonLocked(id) { const d = dungeonById[id]; return !!(d && d.envelope && !this.history.envelopes.some(e => e.id === d.envelope)); }
  envelopesView() {
    const n = this.envelopeProgress(); const opened = this.history.envelopes;
    const list = ENVELOPES.map(e => { const o = opened.find(x => x.id === e.id); return o ? { id: e.id, at: e.at, name: e.name, icon: e.icon, text: e.text, opened: true, openedAt: o.at } : { id: e.id, at: e.at, icon: '✉️', hint: e.hint, opened: false }; });
    const next = ENVELOPES.find(e => !opened.some(x => x.id === e.id)) || null;
    return { progress: n, opened: opened.length, total: ENVELOPES.length, next: next ? { at: next.at, left: Math.max(0, next.at - n), hint: next.hint } : null, list };
  }
  /** Відкрити всі конверти, до яких дотягнувся лічильник; нагорода кожному гравцю. */
  checkEnvelopes() {
    const n = this.envelopeProgress(); const got = [];
    for (const e of ENVELOPES) {
      if (n < e.at || this.history.envelopes.some(x => x.id === e.id)) continue;
      this.history.envelopes.push({ id: e.id, at: this.now() });
      const r = e.reward;
      for (const p of this.playerList) {
        if (r.gold) p.gold += r.gold;
        if (r.pet) grantPet(p, r.pet);
        if (r.card && !p.collection.includes(r.card)) p.collection.push(r.card);
        if (r.frame) { if (!p.cosmetics) p.cosmetics = { owned: [], frame: null, cry: null }; if (!p.cosmetics.owned.includes('frame:' + r.frame)) p.cosmetics.owned.push('frame:' + r.frame); p.cosmetics.frame = r.frame; }
        if (r.legendary) { const it = genItem(this.rng, p.level, 'legendary'); p.inventory.push(it); p.stats.legendaries += 1; this.history.legendaries.unshift({ pid: p.id, name: p.name, item: it, at: this.now() }); }
      }
      this.feed(`${e.icon} Конверт «${e.name}» відкрито! ${e.text}`); this.moment(e.icon, `Відкрито конверт «${e.name}»: ${e.text}`);
      this.announce = { text: `${e.icon} Конверт «${e.name}» відкрито! ${e.text}`, by: 'Арена', at: this.now() };
      got.push({ id: e.id, name: e.name, icon: e.icon, text: e.text });
    }
    if (got.length) { this.store.save('history'); this.store.save('players'); }
    return got;
  }
  familySum(stat) { return this.familyList.reduce((s, p) => s + (p.stats[stat] || 0), 0); }
  checkFamily() {
    const got = [];
    const kids = this.playerList.filter(p => !this.isParent(p));
    for (const a of FAMILY) {
      if (this.history.family.achievements.some(x => x.id === a.id)) continue;
      const c = a.cond; let ok = false;
      if (c.sum) ok = this.familySum(c.sum) >= c.gte;
      else if (c.minLevel) ok = this.playerList.length >= 2 && (kids.length ? kids : this.playerList).every(p => p.level >= c.minLevel);
      else if (c.customCards) ok = this.history.customCards.filter(x => x.approved).length >= c.customCards;
      if (!ok) continue;
      this.history.family.achievements.push({ id: a.id, at: this.now() });
      for (const p of this.playerList) p.gold += a.gold;
      this.feed(`👨‍👩‍👦 Сімейне досягнення «${a.name}»! Усім +${a.gold} золота`); this.moment('👨‍👩‍👦', `Сімейне досягнення «${a.name}»`);
      got.push(a);
    }
    if (got.length) { this.store.save('history'); this.store.save('players'); }
    return got;
  }
  familyView() {
    return { achievements: FAMILY.map(a => ({ ...a, got: this.history.family.achievements.some(x => x.id === a.id) })), sums: { kills: this.familySum('kills'), dungeons: this.familySum('dungeons'), quests: this.familySum('quests'), smart: this.familySum('smart'), raids: this.familySum('raids') } };
  }

  // ---------- квести-справи ----------
  questsFor(p) {
    const day = this.kyiv().day;
    if (!p.quests || p.quests.day !== day) { if (p.quests && p.quests.photos) for (const q of Object.keys(p.quests.photos)) this.questPhotoDrop(p, q); p.quests = { day, state: {} }; }
    if (this.isGuest(p)) return [];
    return QUESTS.filter(q => !!q.forParent === this.isParent(p)).map(q => ({ ...q, state: p.quests.state[q.id] || 'open' }));
  }
  /** «Зробив»: з фото-доказом (jpg/png base64, до 2 МБ, лежить у cardsDir як /cards/q_…) або без. */
  questDone(p, qid, { image, mime } = {}) {
    if (!questById[qid]) throw err('немає квесту');
    this.questsFor(p);
    if (p.quests.state[qid] === 'approved') throw err('уже зараховано');
    if (image && this.cardsDir) {
      const buf = Buffer.from(String(image), 'base64'); if (buf.length > 2e6) throw err('фото завелике');
      const ext = /png/.test(mime || '') ? 'png' : 'jpg'; const name = `q_${p.id}_${qid}_${this.kyiv().day}.${ext}`;
      mkdirSync(this.cardsDir, { recursive: true }); writeFileSync(join(this.cardsDir, name), buf);
      if (!p.quests.photos) p.quests.photos = {}; p.quests.photos[qid] = `/cards/${name}`;
    }
    p.quests.state[qid] = 'pending'; this.store.save('players'); this.emit();
  }
  questPhotoDrop(p, qid) {
    const url = p.quests && p.quests.photos && p.quests.photos[qid]; if (!url) return;
    delete p.quests.photos[qid]; if (this.cardsDir) { try { unlinkSync(join(this.cardsDir, url.replace('/cards/', ''))); } catch (e) { /* нема файлу */ } }
  }
  /** Справи дітей підтверджують батьки; справи батьків підтверджує будь-хто інший із сім'ї (діти нарівні). */
  questApprove(parent, pid, qid, approve = true) {
    const p = this.players[pid]; if (!p) throw err('немає гравця');
    if (this.isParent(p)) { if (parent.id === pid || this.isGuest(parent)) throw err('свою справу не підтвердиш: хай підтвердить дитина', 403); }
    else if (!this.isParent(parent)) throw err('лише батьки', 403);
    const q = questById[qid]; if (!q) throw err('немає квесту');
    this.questsFor(p);
    if (!approve) { p.quests.state[qid] = 'open'; this.questPhotoDrop(p, qid); this.store.save('players'); this.emit(); return null; }
    p.quests.state[qid] = 'approved';
    p.gold += q.gold; const ev = addXp(p, q.xp); p.stats.quests += 1; this.addSeasonPoints(pid, SEASON_POINTS.quest); this.logDay(pid, { quests: 1 }); this.touchStreak(p, ev);
    this.history.questLog.unshift({ day: this.kyiv().day, pid, qid, at: this.now() }); this.history.questLog = this.history.questLog.slice(0, 300);
    const it = genItem(this.rng, p.level, null, q.chest); p.inventory.push(it);
    if (it.rarity === 'legendary') { p.stats.legendaries += 1; this.feed(`🟠 ${p.name} отримав легендарку за справу: ${it.name}!`); }
    p.playedToday.minutes = Math.max(0, this.minutesToday(p) - 10); // кожна справа повертає 10 хв гри
    checkAchievements(p); this.checkDaily(p); this.checkFamily(); this.checkEnvelopes(); this.store.save('players');
    this.feed(`✅ ${p.name}: «${q.name}» зараховано, +${q.gold} золота`);
    this.emit();
    return { item: it, gold: q.gold, xp: q.xp, levelups: ev };
  }
  pendingQuests() {
    const out = [];
    for (const p of this.playerList) { this.questsFor(p); for (const [qid, st] of Object.entries(p.quests.state)) if (st === 'pending') out.push({ pid: p.id, name: p.name, parent: this.isParent(p), quest: questById[qid], photo: p.quests.photos && p.quests.photos[qid] || null }); }
    return out;
  }
  /** Що може підтвердити саме цей гравець: батько — справи дітей і інших батьків, дитина — справи батьків. */
  pendingFor(p) { if (this.isGuest(p)) return []; return this.pendingQuests().filter(q => q.pid !== p.id && (q.parent || this.isParent(p))); }

  // ---------- свої карти: дитина малює, батьки підтверджують ----------
  registerCard(c) { if (!cardById[c.id]) { cardById[c.id] = c; CARDS.push(c); } else Object.assign(cardById[c.id], c); }
  customCardsOf(p) { return this.history.customCards.filter(c => c.owner === p.id); }
  createCustomCard(p, { name, template, image, mime }) {
    const t = CARD_TEMPLATES[template]; if (!t) throw err('невідомий шаблон карти');
    const nm = String(name || '').trim().slice(0, 24); if (nm.length < 2) throw err('назва карти: від 2 літер');
    if (this.customCardsOf(p).length >= CUSTOM_CARD_MAX) throw err(`не більше ${CUSTOM_CARD_MAX} своїх карт`);
    const id = `cc_${p.id}_${randomBytes(3).toString('hex')}`;
    let img = null;
    if (image && this.cardsDir) {
      const buf = Buffer.from(String(image), 'base64'); if (buf.length > 2e6) throw err('картинка завелика');
      const ext = /png/.test(mime || '') ? 'png' : 'jpg'; writeFileSync(join(this.cardsDir, `${id}.${ext}`), buf); img = `/cards/${id}.${ext}`;
    }
    const c = { id, name: nm, icon: '🖍️', class: 'all', cost: t.cost, rarity: 'rare', type: t.type, value: t.value, critBonus: t.critBonus, turns: t.turns, text: t.text, custom: true, owner: p.id, author: p.name, image: img, approved: this.isParent(p), createdAt: this.now() };
    this.history.customCards.push(c); this.store.save('history');
    if (c.approved) this.approveCustomCard(p, id, true); else this.emit();
    return c;
  }
  approveCustomCard(parent, id, approve = true) {
    if (!this.isParent(parent)) throw err('лише батьки', 403);
    const c = this.history.customCards.find(x => x.id === id); if (!c) throw err('немає карти');
    const owner = this.players[c.owner];
    if (approve) {
      c.approved = true; this.registerCard(c);
      if (owner && !owner.collection.includes(id)) owner.collection.push(id);
      this.feed(`🖍️ ${c.author} намалював карту «${c.name}», і вона тепер у грі!`); this.moment('🖍️', `${c.author} намалював карту «${c.name}»`, c.owner); this.checkFamily();
    } else {
      this.history.customCards = this.history.customCards.filter(x => x.id !== id);
      if (c.image && this.cardsDir) { const f = join(this.cardsDir, c.image.split('/').pop()); if (existsSync(f)) unlinkSync(f); }
    }
    this.store.save('history'); this.store.save('players'); this.emit();
    return c;
  }
  pendingCards() { return this.history.customCards.filter(c => !c.approved); }

  // ---------- майстерня мобів: дитина малює монстра, батьки підтверджують, сім'я б'ється з ним ----------
  registerMob(m) { mobById[m.id] = m; }
  customMobs() { return this.history.customMobs.filter(m => m.approved); }
  customMobsOf(p) { return this.history.customMobs.filter(m => m.owner === p.id); }
  pendingMobs() { return this.history.customMobs.filter(m => !m.approved); }
  /** Рівень монстра = середній рівень гравців (1–8), щоб бій був чесний для всієї сім'ї. */
  mobStats({ str, hp, trick }) {
    const lv = Math.max(1, Math.min(8, Math.round(this.playerList.reduce((s, p) => s + p.level, 0) / Math.max(1, this.playerList.length))));
    return { level: lv, hp: 28 + lv * 8 + hp * 6, atk: Math.round(4 + lv * 1.5 + str * 1.2), def: Math.floor(hp / 4), crit: +(0.05 + trick * 0.03).toFixed(2), dodge: +(0.03 + trick * 0.02).toFixed(2), xp: 22 + lv * 6, gold: 6 + lv * 2, lootChance: 0.45 };
  }
  createCustomMob(p, { name, image, mime, str, hp, trick }) {
    const nm = String(name || '').trim().slice(0, 24); if (nm.length < 2) throw err('ім’я монстра: від 2 літер');
    const pts = { str: Math.max(0, Math.min(MOB_POINTS, +str | 0)), hp: Math.max(0, Math.min(MOB_POINTS, +hp | 0)), trick: Math.max(0, Math.min(MOB_POINTS, +trick | 0)) };
    if (pts.str + pts.hp + pts.trick !== MOB_POINTS) throw err(`розділи рівно ${MOB_POINTS} очок між силою, здоров’ям і хитрістю`);
    if (this.customMobsOf(p).length >= CUSTOM_MOB_MAX) throw err(`не більше ${CUSTOM_MOB_MAX} своїх монстрів`);
    const id = `cm_${p.id}_${randomBytes(3).toString('hex')}`;
    let img = null;
    if (image && this.cardsDir) {
      const buf = Buffer.from(String(image), 'base64'); if (buf.length > 2e6) throw err('картинка завелика');
      const ext = /png/.test(mime || '') ? 'png' : 'jpg'; writeFileSync(join(this.cardsDir, `${id}.${ext}`), buf); img = `/cards/${id}.${ext}`;
    }
    const m = { id, name: nm, icon: '👾', image: img, ...this.mobStats(pts), pts, custom: true, owner: p.id, author: p.name, approved: this.isParent(p), beaten: 0, won: 0, createdAt: this.now() };
    this.history.customMobs.push(m); this.store.save('history');
    if (m.approved) this.approveCustomMob(p, id, true); else this.emit();
    return m;
  }
  approveCustomMob(parent, id, approve = true) {
    if (!this.isParent(parent)) throw err('лише батьки', 403);
    const m = this.history.customMobs.find(x => x.id === id); if (!m) throw err('немає монстра');
    if (approve) {
      m.approved = true; this.registerMob(m);
      this.feed(`👾 ${m.author} намалював монстра «${m.name}» (${m.level} рів.): він тепер чекає в підземеллях!`); this.moment('👾', `${m.author} намалював монстра «${m.name}»`, m.owner);
      this.announce = { text: `👾 Новий монстр від ${m.author}: «${m.name}»!`, by: 'Арена', at: this.now() };
    } else {
      this.history.customMobs = this.history.customMobs.filter(x => x.id !== id);
      if (m.image && this.cardsDir) { const f = join(this.cardsDir, m.image.split('/').pop()); if (existsSync(f)) unlinkSync(f); }
    }
    this.store.save('history'); this.emit();
    return m;
  }
  // ---------- книга сім'ї: рекорди і пам'ятні моменти ----------
  moment(icon, text, who = null) {
    const bk = this.history.book; bk.moments.unshift({ at: this.now(), day: this.kyiv().day, icon, text, who }); bk.moments = bk.moments.slice(0, BOOK_MOMENTS);
    this.store.save('history');
  }
  /** Рекорд сім'ї: лише якщо побито. Повертає true, коли записано новий. */
  setRecord(key, value, who, text) {
    const def = RECORDS[key]; if (!def || !(value > 0)) return false;
    const cur = this.history.book.records[key];
    if (cur && value <= cur.value) return false;
    const loud = cur && cur.day !== this.kyiv().day; // оголошуємо, лише якщо старий рекорд протримався хоч день
    this.history.book.records[key] = { value, who, whoName: who && this.players[who] ? this.players[who].name : null, at: this.now(), day: this.kyiv().day, text };
    if (loud) { this.feed(`📖 Новий рекорд сім'ї, ${def.name.toLowerCase()}: ${text}`); this.announce = { text: `📖 Рекорд сім'ї! ${def.icon} ${text}`, by: 'Арена', at: this.now() }; this.moment('📖', `Рекорд: ${def.name.toLowerCase()}, ${text}`, who); }
    this.store.save('history'); return true;
  }
  bookView(n = 15) {
    const bk = this.history.book;
    const d = (s) => s ? s.slice(8, 10) + '.' + s.slice(5, 7) : '';
    return {
      records: Object.entries(RECORDS).map(([k, r]) => ({ key: k, name: r.name, icon: r.icon, ...(bk.records[k] ? { value: bk.records[k].value, text: bk.records[k].text, who: bk.records[k].whoName, day: d(bk.records[k].day) } : {}) })),
      moments: bk.moments.slice(0, n).map(m => ({ icon: m.icon, text: m.text, day: d(m.day) })), total: bk.moments.length,
      seasons: this.history.pastSeasons.slice(-5).reverse().map(s => ({ n: s.n, name: s.name, winner: s.winner })),
      bosses: bk.bosses.length, since: d(bk.moments.length ? bk.moments[bk.moments.length - 1].day : this.kyiv().day),
    };
  }
  mobsView() { return this.customMobs().map(m => ({ id: m.id, name: m.name, author: m.author, image: m.image, level: m.level, pts: m.pts, beaten: m.beaten || 0, won: m.won || 0 })); }

  // ---------- тато-ведучий: втручання в бій з телефона ----------
  dmAction(parent, { kind, mobId, playerId, text }) {
    if (!this.isParent(parent)) throw err('лише батьки', 403);
    const b = this.battle;
    if (kind === 'say') {
      const t = String(text || '').trim().slice(0, 120); if (!t) throw err('порожнє повідомлення');
      this.announce = { text: t, by: parent.name, at: this.now() }; this.emit(); return { ok: true };
    }
    if (!b || b.over) throw err('бій не йде');
    if (b.mode !== 'dungeon') throw err('ведучий лише в підземеллі');
    const r = this.run;
    if (kind === 'spawn') {
      const m = mobById[mobId]; if (!m || m.boss) throw err('немає такого моба');
      const scale = b.meta.scale || 1; const f = fighterFromMob(m.id, 200 + b.fighters.length, scale); f.team = 1; b.fighters.push(f);
      this.roundEvents = (this.roundEvents || []).concat([this.describe({ t: 'reinforce', who: parent.id, names: [f.name], icons: [f.icon], dm: true })]);
      this.announce = { text: `🎩 Ведучий кличе ${f.name}!`, by: parent.name, at: this.now() };
    } else if (kind === 'heal') {
      for (const f of b.fighters) if (f.kind === 'player' && f.alive) f.hp = Math.min(f.maxHp, f.hp + 25);
      this.announce = { text: '🎩 Ведучий зцілює команду: +25 усім', by: parent.name, at: this.now() };
    } else if (kind === 'rage') {
      const boss = b.fighters.find(f => f.kind === 'boss' && f.alive); if (!boss) throw err('боса немає');
      boss.raged = true; this.announce = { text: `🎩 Ведучий розлютив ${boss.name}!`, by: parent.name, at: this.now() };
    } else if (kind === 'treasure') {
      const pid = playerId && r.players.includes(playerId) ? playerId : this.rng.pick(r.players);
      const it = genItem(this.rng, dungeonById[r.dungeon].level, null, 'rare'); r.loot.push({ pid, item: it, from: 'Ведучий', guaranteed: true });
      this.announce = { text: `🎩 Скарб від ведучого для ${this.players[pid].name}: ${it.name}`, by: parent.name, at: this.now() };
    } else throw err('невідома дія ведучого');
    this.recordFrame();
    this.emit();
    return { ok: true };
  }
  dmMobs() { return Object.values(mobById).filter(m => !m.boss).map(m => ({ id: m.id, name: m.name, icon: m.icon, level: m.level })); }

  // ---------- сезони ----------
  addSeasonPoints(pid, n) { if (this.isGuest(this.players[pid])) return; const s = this.history.season; s.points[pid] = (s.points[pid] || 0) + n; }
  seasonView() {
    const s = this.history.season;
    const top = this.playerList.map(p => ({ ...this.publicPlayer(p), points: s.points[p.id] || 0 })).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    const days = Number(this.settings.seasonDays) || 0; const endsAt = days > 0 ? s.startedAt + days * 86400000 : null;
    const daysLeft = endsAt ? Math.max(0, Math.ceil((endsAt - this.now()) / 86400000)) : null;
    return { n: s.n, name: this.settings.season, startedAt: s.startedAt, endsAt, daysLeft, days, top, past: this.history.pastSeasons.slice(-5).reverse() };
  }
  /** Сезон із датою: закривається сам у перший тихий вечір (18:00–сон) після кінця, якщо немає бою. Викликається з tick(). */
  autoCloseSeason() {
    const v = this.seasonView(); if (!v.endsAt || this.now() < v.endsAt || this.battle || this.ceremony && this.now() - this.ceremony.at < CEREMONY_MS) return false;
    const hm = this.kyiv().hm; if (hm < '18:00' || hm >= this.settings.bedtime) return false;
    this.closeSeason(null, 'auto'); return true;
  }
  /** Батьки закривають сезон: лідер стає чемпіоном (титул), очки обнуляються, новий сезон отримує назву. */
  endSeason(parent, newName) {
    if (!this.isParent(parent)) throw err('лише батьки', 403);
    if (this.battle) throw err('дочекайся кінця бою');
    return this.closeSeason(newName, 'parent');
  }
  closeSeason(newName, by = 'parent') {
    const v = this.seasonView();
    const winner = v.top.find(p => p.points > 0) || null;
    const past = { n: v.n, name: v.name, startedAt: v.startedAt, endedAt: this.now(), winner: winner ? winner.name : null, winnerId: winner ? winner.id : null, top: v.top.slice(0, 5).map(p => ({ name: p.name, points: p.points })) };
    this.history.pastSeasons.push(past);
    this.moment('🏁', `Сезон ${v.n} «${v.name}» закрито: ${winner ? 'чемпіон ' + winner.name : 'без чемпіона'}`, winner ? winner.id : null);
    this.ceremony = { ...past, at: this.now(), podium: v.top.slice(0, 3).filter(p => p.points > 0) };
    if (winner) { const p = this.players[winner.id]; p.stats.seasonWins = (p.stats.seasonWins || 0) + 1; p.title = `Чемпіон сезону ${v.n}`; p.gold += 100; checkAchievements(p); this.feed(`🥇 ${p.name}: чемпіон сезону ${v.n} «${v.name}»! +100 золота`); }
    else this.feed(`Сезон ${v.n} «${v.name}» закрито без чемпіона`);
    this.history.season = { n: v.n + 1, startedAt: this.now(), points: {} };
    this.settings.season = (newName && String(newName).trim().slice(0, 40)) || `Сезон ${v.n + 1}`;
    if (by === 'auto') { this.announce = { text: `🏁 Сезон ${v.n} закрито: ${winner ? 'чемпіон ' + winner.name : 'без чемпіона'}. Починається «${this.settings.season}»`, by: 'Арена', at: this.now() }; this.feed(`🏁 Сезон ${v.n} закрився сам за розкладом (${v.days} дн.)`); }
    this.store.set('settings', this.settings); this.store.save('history'); this.store.save('players');
    this.emit();
    return past;
  }

  // ---------- повтор останнього бою на ТБ ----------
  startReplay(parent, { fromTv = false } = {}) {
    if (!fromTv && !this.isParent(parent)) throw err('лише батьки', 403);
    if (this.battle) throw err('бій уже йде');
    const r = this.history.lastReplay;
    if (!r || !r.frames.length) throw err('ще немає бою для повтору');
    this.results = null; this.clearTimer('results');
    this.replay = { i: 0, frames: r.frames, names: r.names, mode: r.mode };
    this.replayTick();
  }
  replayTick() {
    const rp = this.replay; if (!rp) return;
    if (rp.i >= rp.frames.length) { this.stopReplay(); return; }
    const fr = rp.frames[rp.i];
    const ms = fr.roomIntro && !fr.lastRound ? 3000 : Math.min(12000, 1500 + ((fr.lastRound && fr.lastRound.events.length) || 0) * 450);
    this.setTimer('replay', ms, () => { if (this.replay) { this.replay.i += 1; this.replayTick(); } });
    this.emit();
  }
  stopReplay() { if (!this.replay) return; this.replay = null; this.clearTimer('replay'); this.emit(); }
  replayView() {
    const rp = this.replay; if (!rp) return null;
    const fr = rp.frames[Math.min(rp.i, rp.frames.length - 1)];
    return { ...fr, replay: true, roundEnds: null, paused: false, pauseReason: null };
  }

  // ---------- дайджест дня для бота пульта (пульт сам питає GET /api/digest) ----------
  digest() {
    const day = this.kyiv().day; const start = new Date(day + 'T00:00:00').getTime();
    const todayBattles = this.history.battles.filter(b => b.at >= start - 3 * 3600 * 1000);
    const feed = this.history.feed.filter(f => f.at >= start - 3 * 3600 * 1000);
    const sv = this.seasonView();
    const lines = [`⚔️ Родинна арена, ${day}`];
    if (!todayBattles.length) lines.push('Сьогодні ніхто не бився.');
    else {
      const duels = todayBattles.filter(b => b.mode === 'duel'), dungeons = todayBattles.filter(b => b.mode !== 'duel');
      if (duels.length) { const w = {}; for (const d of duels) for (const n of (d.winners || [])) w[n] = (w[n] || 0) + 1; lines.push(`Дуелей: ${duels.length}. Перемоги: ${Object.entries(w).map(([n, c]) => `${n} ${c}`).join(', ') || '—'}.`); }
      if (dungeons.length) lines.push(`Підземель: ${dungeons.length}, пройдено ${dungeons.filter(d => d.won).length}.`);
    }
    const legend = feed.filter(f => f.text.includes('легендарк')); for (const f of legend.slice(0, 3)) lines.push(f.text);
    const fam = feed.filter(f => f.text.startsWith('👨‍👩‍👦')); for (const f of fam.slice(0, 2)) lines.push(f.text);
    const wb = this.worldBossView(); lines.push(wb.killed ? `${wb.icon} Бос тижня «${wb.name}» повалений!` : `${wb.icon} Бос тижня «${wb.name}»: ${wb.pct} % здоров’я, ${wb.daysLeft} дн. до нового.`);
    const quests = feed.filter(f => f.text.startsWith('✅')).length; if (quests) lines.push(`Справ по дому зараховано: ${quests}.`);
    const fg = this.familyGoalView(); if (fg) lines.push(fg.done ? `🎯 Ціль сім'ї виконано: ${fg.reward}!` : `🎯 Ціль сім'ї: ${fg.progress} з ${fg.n} ${fg.kindName} → ${fg.reward} (ще ${fg.daysLeft} дн.).`);
    const pend = this.pendingQuests().length + this.pendingCards().length + this.pendingMobs().length; if (pend) lines.push(`⏳ Чекають підтвердження батьків: ${pend}.`);
    const pc = this.pendingCoupons(); if (pc.length) lines.push(`🎟 Куплені бажання чекають: ${pc.map(o => `${o.name}: ${o.icon} ${o.title}`).join('; ')}.`);
    const streaks = this.playerList.filter(p => !this.isParent(p) && this.streakView(p).days >= 2).map(p => `${p.name} ${this.streakView(p).days}`); if (streaks.length) lines.push(`🔥 Серії днів: ${streaks.join(', ')}.`);
    const evTomorrow = this.eventView().tomorrow; if (evTomorrow) lines.push(`${evTomorrow.icon} Завтра ${evTomorrow.name}: ${evTomorrow.text}`);
    if (sv.top.some(p => p.points > 0)) lines.push(`🏆 ${sv.name}: ${sv.top.slice(0, 3).map((p, i) => `${['🥇', '🥈', '🥉'][i]} ${p.name} ${p.points}`).join(', ')}.`);
    for (const p of this.playerList) if (!this.isParent(p)) { const m = this.minutesToday(p); if (m) lines.push(`⏱ ${p.name}: ${m} хв з ${this.limitFor(p)}.`); }
    return { day, text: lines.join('\n'), battles: todayBattles.length, season: { name: sv.name, top: sv.top.slice(0, 3).map(p => ({ name: p.name, points: p.points })) }, pending: pend,
      players: this.playerList.map(p => ({ name: p.name, level: p.level, minutesToday: this.minutesToday(p) })) };
  }
  /** Профіль героя для ТБ (клік Magic Remote по картці). */
  heroProfile(id) {
    const p = this.players[id]; if (!p) return null;
    const sv = this.seasonView();
    return { ...this.publicPlayer(p), xp: p.xp, xpNext: xpForLevel(p.level), gold: p.gold, stats: p.stats, equipment: p.equipment, achievements: ACHIEVEMENTS.filter(a => p.achievements.includes(a.id)).map(a => ({ name: a.name, icon: a.icon })),
      seasonPoints: this.history.season.points[p.id] || 0, seasonRank: sv.top.findIndex(x => x.id === p.id) + 1, customCards: this.customCardsOf(p).filter(c => c.approved).map(c => ({ name: c.name, image: c.image, text: c.text })), daily: this.dailyFor(p),
      pets: petView(p).map(x => ({ icon: x.icon, name: x.name, level: x.level, active: x.active })), streak: this.streakView(p), worldBossDmg: this.worldBoss().dmg[p.id] || 0,
      coupons: this.history.coupons.filter(o => o.pid === p.id && o.status === 'pending').map(o => ({ icon: o.icon, title: o.title })) };
  }

  // ---------- стан для клієнтів ----------
  /** Бос тижня: один на всю сім’ю, новий щопонеділка (черга з worldboss.json). */
  worldBoss() {
    const week = this.weekKey();
    let w = this.history.worldBoss;
    if (!w || w.week !== week) {
      const n = Math.round(new Date(week + 'T12:00:00Z').getTime() / (7 * 24 * 3600 * 1000));
      const b = WORLDBOSS[((n % WORLDBOSS.length) + WORLDBOSS.length) % WORLDBOSS.length];
      w = this.history.worldBoss = { week, id: b.id, hp: b.hp, maxHp: b.hp, dmg: {}, killed: false, killedAt: null };
      this.store.save('history');
    }
    return w;
  }
  /** Удар по босу тижня від учасників бою. amount спільний на всіх; perPid(pid) — свій для кожного. Повертає, що показати. */
  hitWorldBoss(pids, amount, ev = [], perPid = null, fighters = null) {
    const w = this.worldBoss(); const def = WORLDBOSS.find(b => b.id === w.id);
    if (w.killed) return { name: def.name, icon: def.icon, hit: 0, killed: true, hp: 0, maxHp: w.maxHp };
    let total = 0;
    for (const pid of pids) {
      const p = this.players[pid]; if (!p) continue;
      let d = perPid ? perPid(pid) : Math.round(amount / pids.length);
      if (fighters) { const f = fighters.find(x => x.id === pid); if (f && f.stats && f.stats.smartHits) d = Math.round(d * WORLD_BOSS.smartMult); }
      const evt = this.eventToday(); if (evt && evt.worldBossMult) d = Math.round(d * evt.worldBossMult);
      w.dmg[pid] = (w.dmg[pid] || 0) + d; total += d;
    }
    w.hp = Math.max(0, w.hp - total);
    let killed = false;
    if (w.hp === 0) {
      w.killed = true; w.killedAt = this.now(); killed = true; { const wb = WORLDBOSS.find(x => x.id === w.id); this.moment('🐉', `Повалено боса тижня ${wb ? wb.name : ''}`.trim()); }
      const names = [];
      for (const pid of Object.keys(w.dmg)) {
        const p = this.players[pid]; if (!p) continue;
        p.gold += WORLD_BOSS.gold; p.stats.worldBoss = (p.stats.worldBoss || 0) + 1; this.addSeasonPoints(pid, SEASON_POINTS.worldBoss); names.push(p.name);
        for (const a of checkAchievements(p)) ev.push({ t: 'achievement', who: pid, name: a.name, icon: a.icon, title: a.title });
      }
      ev.push({ t: 'worldboss', name: def.name, icon: def.icon, gold: WORLD_BOSS.gold });
      this.feed(`${def.icon} Бос тижня «${def.name}» повалений! ${names.join(', ')}: +${WORLD_BOSS.gold} золота кожному`);
      this.announce = { text: `${def.icon} Бос тижня «${def.name}» повалений! +${WORLD_BOSS.gold} золота всім`, by: 'Арена', at: this.now() };
    }
    this.store.save('history'); this.store.save('players');
    return { name: def.name, icon: def.icon, hit: total, killed, hp: w.hp, maxHp: w.maxHp };
  }
  /** Вибрати активного вихованця (null = без). */
  setPet(p, id) {
    if (id !== null && !petOf(p, id)) throw err('немає такого вихованця');
    p.activePet = id; this.store.save('players'); this.emit(); return petView(p);
  }
  miniGold() { const e = this.eventToday(); return MINI_GOLD * (e && e.miniGoldMult ? e.miniGoldMult : 1); }
  /** Подія тижня за днем (середа, п'ятниця, субота, неділя). */
  eventToday(ts = this.now()) { const k = this.kyiv(ts); return EVENTS.find(e => e.weekday === k.weekday) || null; }
  eventView() {
    const today = this.eventToday(); const tomorrow = this.eventToday(this.now() + 24 * 3600 * 1000);
    const pick = (e) => e ? { id: e.id, name: e.name, icon: e.icon, text: e.text } : null;
    return { today: pick(today), tomorrow: pick(tomorrow) };
  }
  /** Мутатор дня для підземель: раз на ~2 дні за датою (детерміновано), інакше null. */
  mutatorToday(day = this.kyiv().day) {
    let h = 0; for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const n = h % (MUTATORS.length * 2);
    return n < MUTATORS.length ? MUTATORS[n] : null;
  }
  /** Поточний розділ кампанії (наступний непройдений). */
  campaignChapter() { return CAMPAIGN[this.history.campaign.chapter] || CAMPAIGN[0]; }
  campaignView() {
    const ch = this.campaignChapter(); const d = dungeonById[ch.dungeon];
    return { n: ch.n, of: CAMPAIGN.length, title: ch.title, intro: ch.intro, dungeon: d.name, icon: d.icon, level: d.level, runs: this.history.campaign.runs, done: this.history.campaign.done.map(x => x.n),
      chapters: CAMPAIGN.map(c => ({ n: c.n, title: c.title, done: this.history.campaign.done.some(x => x.n === c.n) })) };
  }
  /** Резервна копія всіх даних гри (без токенів входу) і відновлення з неї. */
  serviceStatus() {
    let bytes = 0; try { for (const n of ['players', 'history', 'settings']) bytes += statSync(this.store.path(n)).size; } catch (e) {}
    const lastBattle = this.history.battles[0] || null;
    return {
      dataVersion: VERSION_DATA, players: this.playerList.length, parents: this.playerList.filter(p => this.isParent(p)).length,
      battles: this.history.battles.length, lastBattleAt: lastBattle ? lastBattle.at : null, bytes, tv: this.tvOnline(), paused: this.paused, pauseReason: this.pauseReason,
      lastAlert: this.lastAlert || null, mutator: this.mutatorToday() ? this.mutatorToday().name : null, worldBoss: this.worldBossView().name,
      season: this.seasonView().name, settings: { tz: this.settings.tz, bedtime: this.settings.bedtime, wakeup: this.settings.wakeup },
    };
  }
  backup() { this.store.flushAll(); return { app: 'family-arena', version: VERSION_DATA, at: this.now(), players: this.players, history: this.history, settings: this.settings }; }
  restore(parent, data) {
    if (!this.isParent(parent)) throw err('лише батьки', 403);
    if (!data || data.app !== 'family-arena' || !data.players || !data.history) throw err('це не копія Родинної арени');
    if (this.battle) throw err('бій іде, зачекай');
    this.players = data.players; this.store.set('players', this.players); this.migratePlayers();
    this.history = data.history; this.store.set('history', this.history);
    if (!this.history.book) this.history.book = { records: {}, moments: [], bosses: [] };
    for (const k of ['season', 'pastSeasons', 'raids', 'customCards', 'customMobs', 'family', 'days', 'campaign']) if (this.history[k] === undefined) this.history[k] = k === 'season' ? { n: 1, startedAt: this.now(), points: {} } : k === 'family' ? { achievements: [] } : k === 'days' ? {} : k === 'campaign' ? { chapter: 0, runs: 0, done: [] } : [];
    if (this.history.worldBoss === undefined) this.history.worldBoss = null;
    if (!Array.isArray(this.history.coupons)) this.history.coupons = [];
    if (!Array.isArray(this.history.questLog)) this.history.questLog = [];
    if (!this.history.familyGoal) this.history.familyGoal = { week: null, done: false };
    for (const c of this.history.customCards) if (c.approved) this.registerCard(c);
    for (const m of this.history.customMobs) if (m.approved) this.registerMob(m);
    if (data.settings) { this.settings = { ...DEFAULT_SETTINGS, ...data.settings }; }
    if (!Array.isArray(this.settings.coupons)) this.settings.coupons = DEFAULT_COUPONS.map(c => ({ ...c }));
    this.store.set('settings', this.settings);
    this.tokens = {}; this.store.set('tokens', this.tokens);   // усі входять заново
    this.lobby.players = {}; this.results = null; this.tournament = null;
    this.feed('💾 Дані гри відновлено з резервної копії'); this.emit();
    return { players: Object.keys(this.players).length };
  }
  /** Батьки: почати кампанію заново. */
  resetCampaign(parent) { if (!this.isParent(parent)) throw err('лише батьки', 403); this.history.campaign = { chapter: 0, runs: this.history.campaign.runs, done: [] }; this.store.save('history'); this.emit(); return this.campaignView(); }
  worldBossView() {
    const w = this.worldBoss(); const def = WORLDBOSS.find(b => b.id === w.id);
    const end = new Date(w.week + 'T12:00:00Z'); end.setUTCDate(end.getUTCDate() + 7);
    const daysLeft = Math.max(0, Math.ceil((end.getTime() - this.now()) / (24 * 3600 * 1000)));
    const top = Object.entries(w.dmg).map(([pid, dmg]) => ({ pid, name: this.players[pid] ? this.players[pid].name : '?', dmg })).sort((a, b) => b.dmg - a.dmg).slice(0, 5);
    return { id: w.id, name: def.name, icon: def.icon, text: def.text, hp: w.hp, maxHp: w.maxHp, pct: Math.round(100 * w.hp / w.maxHp), killed: w.killed, top, daysLeft, week: w.week };
  }
  feed(text) { this.history.feed.unshift({ text, at: this.now() }); this.history.feed = this.history.feed.slice(0, 50); this.store.save('history'); }
  battleView() {
    const b = this.battle; if (!b) return null;
    return { round: b.round, mode: b.mode, meta: b.meta, over: b.over, winner: b.winner, roundEnds: this.roundEnds, paused: this.paused, pauseReason: this.pauseReason,
      fighters: b.fighters.map(publicFighter), lastRound: this.lastRound && this.lastRound.n === b.round ? this.lastRound : null, roomIntro: this.roundEvents && this.roundEvents[0] && this.roundEvents[0].t === 'room' ? this.roundEvents[0] : null };
  }
  lobbyView() {
    const camp = this.campaignView(); const mut = this.mutatorToday();
    return { locked: DUNGEONS.filter(d => this.dungeonLocked(d.id)).map(d => d.id), mode: this.lobby.mode, mutator: mut ? { id: mut.id, name: mut.name, icon: mut.icon, text: mut.text } : null, dungeonId: this.lobby.dungeonId, dungeon: this.lobby.mode === 'campaign' ? dungeonById[this.campaignChapter().dungeon] : this.lobby.mode === 'practice' ? dungeonById.practice : dungeonById[this.lobby.dungeonId], raid: this.raidStatus(this.lobby.dungeonId), campaign: camp,
      practice: this.lobby.mode === 'practice',
      raids: DUNGEONS.filter(d => d.raid).map(d => ({ id: d.id, name: d.name, icon: d.icon, level: d.level, ...this.raidStatus(d.id) })),
      players: Object.entries(this.lobby.players).map(([id, l]) => ({ ...this.publicPlayer(this.players[id]), ready: l.ready, team: l.team })) };
  }
  tvState() {
    const phase = this.battle ? 'battle' : this.replay ? 'replay' : this.results ? 'results' : Object.keys(this.lobby.players).length ? 'lobby' : 'idle';
    const hm = this.kyiv().hm; const quiet = hm < '07:00' || (hm >= '13:00' && hm < '15:00');
    const sv = this.seasonView();
    return { phase, closing: this.closingView(), ceremony: this.ceremony && this.now() - this.ceremony.at < CEREMONY_MS ? this.ceremony : null, season: this.settings.season, seasonN: sv.n, seasonDaysLeft: sv.daysLeft, seasonTop: sv.top.slice(0, 5), pastSeasons: sv.past.slice(0, 3), quiet, now: this.now(), announce: this.announce, lobby: this.lobbyView(), battle: this.battle ? this.battleView() : this.replayView(), results: this.results, paused: this.paused, pauseReason: this.pauseReason,
      heroes: this.playerList.map(p => ({ ...this.publicPlayer(p), pet: activePetIcon(p), streak: this.streakView(p).days, xp: p.xp, xpNext: xpForLevel(p.level), kills: p.stats.kills, duelWins: p.stats.duelWins, dungeons: p.stats.dungeons, legendaries: p.stats.legendaries, achievements: p.achievements.length })),
      legendaries: this.history.legendaries.slice(0, 5), feed: this.history.feed.slice(0, 8), pendingQuests: this.pendingQuests().length,
      family: this.familyView(), worldBoss: this.worldBossView(), campaign: this.campaignView(), tournament: this.tournamentView(), today: this.todayView(), familyGoal: this.familyGoalView(), mini: this.miniView(), party: this.partyView(), event: this.eventView(), envelopes: this.envelopesView(), book: this.bookView(6) };
  }
  playerState(p) {
    this.touchSeen(p);
    const b = this.battle; const f = b && b.fighters.find(x => x.id === p.id);
    const inLobby = this.lobby.players[p.id];
    const tv = this.tvState(); const sv = { ...this.seasonView(), phase: tv.phase };
    return {
      me: { ...this.publicPlayer(p), xp: p.xp, xpNext: xpForLevel(p.level), gold: p.gold, deck: p.deck, collection: p.collection, inventory: p.inventory, equipment: p.equipment, bonus: equipmentBonus(p), pets: petView(p), cosmetics: this.cosmeticsView(p), streak: this.streakView(p), gift: this.giftView(p), coupons: this.couponsView(p), stats: p.stats, achievements: p.achievements,
        minutesToday: this.minutesToday(p), limit: this.limitFor(p), blocked: this.blockedReason(p), isParent: this.isParent(p), avatarPending: p.avatarPending || null,
        seasonPoints: this.history.season.points[p.id] || 0, seasonRank: sv.top.findIndex(x => x.id === p.id) + 1 },
      phase: sv.phase, season: { n: sv.n, name: sv.name, daysLeft: sv.daysLeft, days: sv.days, top: sv.top.slice(0, 5) }, lobby: this.lobbyView(), inLobby: !!inLobby, results: this.results, paused: this.paused, pauseReason: this.pauseReason,
      dm: this.isParent(p) && b && b.mode === 'dungeon' && !b.over ? { mobs: this.dmMobs(), players: this.run.players.map(id => this.publicPlayer(this.players[id])) } : null,
      replay: this.replay ? { mode: this.replay.mode, names: this.replay.names } : null, hasReplay: !!(this.history.lastReplay && this.history.lastReplay.frames.length),
      battle: b ? { ...this.battleView(), me: f ? { hand: f.hand.map(id => cardById[id]), mana: f.mana, maxMana: f.maxMana, hp: f.hp, maxHp: f.maxHp, alive: f.alive, move: f.move, shield: f.shield, quiz: f.quiz && !f.move ? { kind: f.quiz.kind, q: f.quiz.q, choices: f.quiz.choices } : null, hint: p.simple && !f.move ? this.hintFor(f) : null } : null } : null,
      closing: this.closingView(p), done: this.doneView(p), challenges: this.challengesView(p), familyGoal: this.familyGoalView(), mini: this.miniView(p), party: this.partyView(), event: this.eventView(), envelopes: this.envelopesView(), welcome: this.welcomeView(p), quests: this.settings.questsEnabled ? this.questsFor(p) : [], pendingQuests: this.pendingFor(p), guests: this.isParent(p) ? this.guestsView() : [], pendingCoupons: this.isParent(p) ? this.pendingCoupons() : [],
      daily: this.dailyFor(p), tournament: this.tournamentView(), worldBoss: { ...this.worldBossView(), mine: (this.worldBoss().dmg[p.id] || 0) }, family: this.familyView(),
      customCards: this.customCardsOf(p), pendingCards: this.isParent(p) ? this.pendingCards() : [], cardTemplates: CARD_TEMPLATES, tvOnline: this.tvOnline(),
      customMobs: this.customMobsOf(p), pendingMobs: this.isParent(p) ? this.pendingMobs() : [], mobs: this.mobsView(), mobPoints: MOB_POINTS, book: this.bookView(),
    };
  }
  content() {
    return { classes: CLASSES, cards: CARDS, dungeons: DUNGEONS, quests: QUESTS, achievements: ACHIEVEMENTS, rarities: ITEMS.rarities, slots: ITEMS.slots, zones: ZONES, zoneNames: ZONE_NAMES, roundSeconds: this.settings.roundSeconds };
  }
  allowedCards(p) { return allowedCards(p.class, p.collection); }
  dungeonList() { return DUNGEONS.map(d => ({ ...d, ...this.raidStatus(d.id) })); }
  updateSettings(patch) {
    const wasFrozen = !!this.settings.freeze;
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (patch[k] !== undefined && k !== 'familyGoal') this.settings[k] = patch[k];
    if (wasFrozen && !this.settings.freeze) { const prev = this.prevDay(this.kyiv().day); for (const p of this.playerList) if (p.streak && p.streak.last && p.streak.last < prev) p.streak.last = prev; this.store.save('players'); }
    this.store.set('settings', this.settings); this.emit();
  }

  // ---------- таймери й розсилка ----------
  setTimer(name, ms, fn) {
    this.clearTimer(name);
    this.pending = this.pending || {};
    this.pending[name] = fn;
    if (this.realTimers) { this.timers[name] = setTimeout(() => { delete this.pending[name]; fn(); }, ms); if (this.timers[name].unref) this.timers[name].unref(); }
  }
  clearTimer(name) { if (this.timers[name]) clearTimeout(this.timers[name]); delete this.timers[name]; if (this.pending) delete this.pending[name]; }
  /** Для тестів: виконати таймер негайно. */
  fire(name) { const fn = this.pending && this.pending[name]; this.clearTimer(name); if (fn) fn(); }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) { try { fn(); } catch (e) { console.error(e); } } }
}

export function err(message, status = 400) { const e = new Error(message); e.status = status; return e; }
