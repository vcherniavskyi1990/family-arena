// Гра як єдиний стан у пам'яті: гравці (збережені), лобі, поточний бій, таймери раундів, нагороди, квести, ліміти.
// Усе, що бачать телефон і ТБ, береться з tvState() і playerState(); зміни розсилаються слухачам (SSE у server.js).
import { createHash, randomBytes } from 'node:crypto';
import { makeRng } from './engine/rng.js';
import { createBattle, fighterFromPlayer, fighterFromMob, submitMove, resolveRound, publicFighter, alive } from './engine/combat.js';
import { newPlayer, addXp, xpForLevel, equipmentBonus, genItem, genCard, equip, unequip, craft, checkAchievements, setDeck, sellPrice } from './engine/progress.js';
import { makeQuiz, checkQuiz } from './engine/quiz.js';
import { CLASSES, CARDS, DUNGEONS, QUESTS, ACHIEVEMENTS, ITEMS, ZONES, ZONE_NAMES, classById, dungeonById, mobById, questById, cardById, starterDeck, allowedCards } from './engine/content.js';

export const ROUND_SECONDS = 30;
const RESULTS_SECONDS = 25;
const ROOM_HEAL = 0.3;
const REPLAY_FRAMES = 80;
const SEASON_POINTS = { duelWin: 3, duelLoss: 1, dungeonLoss: 1, quest: 1 };

const DEFAULT_SETTINGS = {
  bedtime: '21:30', wakeup: '07:00', limitWeekday: 45, limitWeekend: 90, roundSeconds: ROUND_SECONDS,
  questsEnabled: true, season: 'Сезон 1: Перші кроки', tz: 'Europe/Kyiv', smartCards: true, raidAnyDay: false,
};

export const hashPin = (pin, salt) => createHash('sha256').update(`${salt}:${pin}`).digest('hex');

export class Game {
  constructor({ store, now = () => Date.now(), realTimers = true }) {
    this.store = store;
    this.now = now;
    this.realTimers = realTimers;
    this.players = store.get('players', () => ({}));
    this.tokens = store.get('tokens', () => ({}));
    this.settings = { ...DEFAULT_SETTINGS, ...store.get('settings', () => ({})) };
    this.history = store.get('history', () => ({ battles: [], legendaries: [], feed: [] }));
    if (!this.history.season) this.history.season = { n: 1, startedAt: this.now(), points: {} };
    if (!this.history.pastSeasons) this.history.pastSeasons = [];
    if (!this.history.raids) this.history.raids = [];
    this.announce = null;
    this.replay = null;
    this.lobby = { players: {}, mode: 'dungeon', dungeonId: DUNGEONS[0].id };
    this.battle = null; this.run = null; this.results = null;
    this.paused = false; this.pauseReason = null;
    this.listeners = new Set();
    this.timers = {};
    this.seed = (Date.now() % 1e9) | 0;
    this.rng = makeRng(this.seed);
  }

  // ---------- гравці й вхід ----------
  get playerList() { return Object.values(this.players); }
  publicPlayer(p) {
    return { id: p.id, name: p.name, class: p.class, className: classById[p.class].name, icon: p.icon || classById[p.class].icon, avatar: p.avatar, title: p.title, level: p.level, role: p.role, age: p.age };
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
  checkPin(p, pin) { return p.pinHash === hashPin(String(pin), p.id); }
  parentPin(pin) { return this.playerList.some(p => this.isParent(p) && this.checkPin(p, pin)); }
  updatePlayer(id, patch) {
    const p = this.players[id]; if (!p) throw err('немає гравця');
    if (patch.name) p.name = String(patch.name).trim().slice(0, 20);
    if (patch.age !== undefined) p.age = patch.age ? Number(patch.age) : null;
    if (patch.role && ['kid', 'parent', 'admin'].includes(patch.role)) p.role = patch.role;
    if (patch.pin) { if (!/^\d{4}$/.test(String(patch.pin))) throw err('PIN: 4 цифри'); p.pinHash = hashPin(patch.pin, p.id); for (const [t, v] of Object.entries(this.tokens)) if (v.playerId === id) delete this.tokens[t]; this.store.save('tokens'); }
    if (patch.class && classById[patch.class] && p.level <= 3) { p.class = patch.class; p.deck = starterDeck(patch.class); }
    this.store.save('players'); this.emit();
    return p;
  }
  deletePlayer(id) { delete this.players[id]; delete this.lobby.players[id]; this.store.save('players'); this.emit(); }

  // ---------- час, ліміти, тиша ----------
  kyiv(ts = this.now()) {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: this.settings.tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
    const o = Object.fromEntries(f.formatToParts(ts).map(x => [x.type, x.value]));
    return { day: `${o.year}-${o.month}-${o.day}`, hm: `${o.hour === '24' ? '00' : o.hour}:${o.minute}`, weekend: o.weekday === 'Sat' || o.weekday === 'Sun' };
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
  addMinutes(p, min) { this.minutesToday(p); p.playedToday.minutes += min; this.store.save('players'); }

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
    if (mode && !['dungeon', 'duel'].includes(mode)) throw err('режим');
    if (mode) this.lobby.mode = mode;
    if (dungeonId) { if (!dungeonById[dungeonId]) throw err('підземелля'); const rs = this.raidStatus(dungeonId); if (!rs.available) throw err(rs.reason); this.lobby.dungeonId = dungeonId; }
    for (const l of Object.values(this.lobby.players)) l.ready = false;
    this.emit();
  }
  setTeam(p, team) { const l = this.lobby.players[p.id]; if (!l) throw err('ти не в лобі'); l.team = team ? 1 : 0; l.ready = false; this.emit(); }
  maybeStart() {
    const ids = Object.keys(this.lobby.players);
    if (!ids.length || !ids.every(id => this.lobby.players[id].ready)) return;
    if (this.lobby.mode === 'duel') {
      const t0 = ids.filter(id => this.lobby.players[id].team === 0), t1 = ids.filter(id => this.lobby.players[id].team === 1);
      if (!t0.length || !t1.length) return;
    } else {
      const rs = this.raidStatus(this.lobby.dungeonId);
      if (rs.raid && (!rs.available || ids.length < rs.minPlayers)) return;
    }
    this.startBattle();
  }
  startBattle() {
    this.stopReplay();
    const ids = Object.keys(this.lobby.players);
    const fighters = (list) => list.map(id => { const p = this.players[id]; return fighterFromPlayer({ ...p, bonus: equipmentBonus(p), icon: this.publicPlayer(p).icon }, this.rng); });
    this.seed = (this.seed * 7919 + 13) % 2147483647; this.rng = makeRng(this.seed);
    if (this.lobby.mode === 'duel') {
      const t0 = ids.filter(id => this.lobby.players[id].team === 0), t1 = ids.filter(id => this.lobby.players[id].team === 1);
      this.run = { mode: 'duel', players: ids, startedAt: this.now(), frames: [] };
      this.battle = createBattle({ teams: [fighters(t0), fighters(t1)], seed: this.seed, mode: 'duel' });
      this.roundEvents = [];
      this.recordFrame();
    } else {
      const d = dungeonById[this.lobby.dungeonId];
      this.run = { mode: 'dungeon', dungeon: d.id, players: ids, room: 0, rooms: [...d.rooms, [d.boss]], team: fighters(ids), loot: [], xp: 0, gold: 0, kills: [], startedAt: this.now(), frames: [] };
      this.nextRoom();
    }
    this.lobby.players = {};
    this.feed(this.run.mode === 'duel' ? `Дуель: ${this.run.players.map(id => this.players[id].name).join(' проти ')}` : `${ids.map(id => this.players[id].name).join(', ')}: у «${dungeonById[this.run.dungeon].name}»`);
    this.startRound();
  }
  nextRoom() {
    const r = this.run;
    const d = dungeonById[r.dungeon];
    const scale = d.raid ? 1 + Math.max(0, r.players.length - 1) * (d.scalePerPlayer || 0.5) : 1 + Math.max(0, r.players.length - 2) * 0.35;
    const mobs = r.rooms[r.room].map((m, i) => fighterFromMob(m, i, mobById[m].boss ? scale * 1.1 : scale));
    for (const f of r.team) { f.move = null; f.shield = 0; f.buffs = []; f.effects = {}; f.minions = []; if (r.room > 0 && f.alive) f.hp = Math.min(f.maxHp, f.hp + Math.round(f.maxHp * ROOM_HEAL)); if (!f.alive) { f.alive = true; f.hp = Math.round(f.maxHp * 0.5); } }
    this.battle = createBattle({ teams: [r.team, mobs], seed: this.seed + r.room, mode: 'dungeon', meta: { room: r.room + 1, rooms: r.rooms.length, boss: r.room === r.rooms.length - 1, dungeon: r.dungeon, raid: !!d.raid, scale } });
    this.roundEvents = [{ t: 'room', n: r.room + 1, of: r.rooms.length, boss: r.room === r.rooms.length - 1, names: mobs.map(m => m.name) }];
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
      if (smart) { p.stats.smart = (p.stats.smart || 0) + 1; }
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
    this.roundEnds = null;
    this.recordFrame();
    const animMs = Math.min(12000, 1500 + ev.length * 450);
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
    const minutes = Math.max(1, Math.round((this.now() - r.startedAt) / 60000));
    if (r.mode === 'dungeon') {
      // нагороди за кімнату: досвід, золото, лут із мобів
      for (const m of b.fighters.filter(f => f.team === 1)) {
        const mob = mobById[m.mob];
        if (m.alive) continue;
        r.kills.push(mob.id); r.xp += mob.xp; r.gold += mob.gold;
        if (rng.chance(mob.lootChance)) {
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
      if (d.raid) {
        this.history.raids.push({ raid: d.id, week: this.weekKey(), won, at: this.now(), players: r.players.map(id => this.players[id].name) });
        if (won) for (const pid of r.players) {
          const it = genItem(rng, d.level, rng.chance(d.rewards.legendaryChance) ? 'legendary' : null, d.rewards.minRarity); r.loot.push({ pid, item: it, from: d.name, guaranteed: true });
          this.players[pid].stats.raids = (this.players[pid].stats.raids || 0) + 1; this.addSeasonPoints(pid, 10);
        }
      }
      for (const pid of r.players) {
        const p = this.players[pid]; const f = r.team.find(x => x.id === pid);
        const share = won ? 1 : 0.4;
        const xp = Math.round(r.xp * share / r.players.length) + 10; const gold = Math.round(r.gold * share / r.players.length);
        p.gold += gold; ev.push(...addXp(p, xp));
        p.stats.kills += f.stats.kills; p.stats.crits += f.stats.crits; p.stats.blocks += f.stats.blocks; p.stats.heals += f.stats.heals;
        if (won) { p.stats.dungeons += 1; p.stats.bossKills += 1; if (r.dungeon === 'bathroom_kraken') p.stats.dragonKills += 1; }
        this.addSeasonPoints(pid, won ? 4 + dungeonById[r.dungeon].level : SEASON_POINTS.dungeonLoss);
        for (const l of r.loot.filter(x => x.pid === pid)) {
          if (l.item) { p.inventory.push(l.item); if (l.item.rarity === 'legendary') { p.stats.legendaries += 1; this.history.legendaries.unshift({ pid, name: p.name, item: l.item, at: this.now() }); this.feed(`🟠 ${p.name} вибив легендарку: ${l.item.name}!`); } }
          if (l.card && !p.collection.includes(l.card)) p.collection.push(l.card);
        }
        for (const a of checkAchievements(p)) ev.push({ t: 'achievement', who: pid, name: a.name, icon: a.icon, title: a.title });
        this.addMinutes(p, minutes);
      }
      this.results = { mode: 'dungeon', won, raid: !!d.raid, dungeon: dungeonById[r.dungeon].name, xp: Math.round(r.xp / r.players.length), gold: Math.round(r.gold / r.players.length), kills: r.kills.length,
        loot: r.loot.map(l => ({ ...l, name: this.players[l.pid].name, cardName: l.card ? cardById[l.card].name : undefined })), events: ev.map(e => ({ ...e, whoName: this.players[e.who] && this.players[e.who].name })), players: r.players.map(id => this.publicPlayer(this.players[id])) };
      this.feed(won ? `${d.raid ? '🗿' : '🏆'} ${r.players.map(id => this.players[id].name).join(', ')} пройшли «${dungeonById[r.dungeon].name}»` : `💀 «${dungeonById[r.dungeon].name}» виявилось сильнішим`);
    } else {
      const winners = b.fighters.filter(f => f.team === b.winner).map(f => f.id);
      for (const pid of r.players) {
        const p = this.players[pid]; const f = b.fighters.find(x => x.id === pid); const won = winners.includes(pid);
        p.stats.duels += 1; if (won) p.stats.duelWins += 1;
        this.addSeasonPoints(pid, won ? SEASON_POINTS.duelWin : SEASON_POINTS.duelLoss);
        p.stats.crits += f.stats.crits; p.stats.blocks += f.stats.blocks; p.stats.heals += f.stats.heals;
        ev.push(...addXp(p, won ? 40 : 15)); p.gold += won ? 12 : 4;
        for (const a of checkAchievements(p)) ev.push({ t: 'achievement', who: pid, name: a.name, icon: a.icon, title: a.title });
        this.addMinutes(p, minutes);
      }
      this.results = { mode: 'duel', winners: winners.map(id => this.players[id].name), xp: 40, gold: 12, events: ev.map(e => ({ ...e, whoName: this.players[e.who] && this.players[e.who].name })), players: r.players.map(id => this.publicPlayer(this.players[id])) };
      this.feed(`⚔️ Дуель виграв: ${winners.map(id => this.players[id].name).join(', ')}`);
    }
    this.history.battles.unshift({ mode: r.mode, players: r.players, at: this.now(), won: this.results.won, winners: this.results.winners });
    this.history.battles = this.history.battles.slice(0, 200);
    this.history.lastReplay = { mode: r.mode, at: this.now(), names: r.players.map(id => this.players[id].name), frames: r.frames || [] };
    this.store.save('players'); this.store.save('history');
    this.battle = null; this.run = null; this.roundEvents = [];
    this.emit();
    this.setTimer('results', RESULTS_SECONDS * 1000, () => { this.results = null; this.emit(); });
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
  equip(p, itemId) { const e = equip(p, itemId); if (e) throw err(e); this.store.save('players'); this.emit(); }
  unequip(p, slot) { const e = unequip(p, slot); if (e) throw err(e); this.store.save('players'); this.emit(); }
  craft(p, ids) { const out = craft(p, ids, this.rng); if (typeof out === 'string') throw err(out); this.store.save('players'); if (out.rarity === 'legendary') this.feed(`🔧 ${p.name} скрафтив легендарку: ${out.name}!`); checkAchievements(p); this.emit(); return out; }
  sell(p, itemId) { const it = p.inventory.find(i => i.id === itemId); if (!it) throw err('немає предмета'); p.inventory = p.inventory.filter(i => i.id !== itemId); const g = sellPrice(it); p.gold += g; this.store.save('players'); this.emit(); return g; }
  /** Магазин: скриня за золото (рідкість випадкова, трохи краща за звичайну). */
  buyChest(p, kind) {
    const price = { common: 40, rare: 150 }[kind]; if (!price) throw err('немає такої скрині');
    if (p.gold < price) throw err('не вистачає золота');
    p.gold -= price;
    const it = genItem(this.rng, p.level, null, kind === 'rare' ? 'rare' : 'uncommon');
    p.inventory.push(it); if (it.rarity === 'legendary') { p.stats.legendaries += 1; this.feed(`🟠 ${p.name} відкрив легендарку в скрині: ${it.name}!`); }
    checkAchievements(p); this.store.save('players'); this.emit();
    return it;
  }

  // ---------- квести-справи ----------
  questsFor(p) {
    const day = this.kyiv().day;
    if (!p.quests || p.quests.day !== day) p.quests = { day, state: {} };
    return QUESTS.map(q => ({ ...q, state: p.quests.state[q.id] || 'open' }));
  }
  questDone(p, qid) {
    if (!questById[qid]) throw err('немає квесту');
    this.questsFor(p);
    if (p.quests.state[qid] === 'approved') throw err('уже зараховано');
    p.quests.state[qid] = 'pending'; this.store.save('players'); this.emit();
  }
  questApprove(parent, pid, qid, approve = true) {
    if (!this.isParent(parent)) throw err('лише батьки', 403);
    const p = this.players[pid]; if (!p) throw err('немає гравця');
    const q = questById[qid]; if (!q) throw err('немає квесту');
    this.questsFor(p);
    if (!approve) { p.quests.state[qid] = 'open'; this.store.save('players'); this.emit(); return null; }
    p.quests.state[qid] = 'approved';
    p.gold += q.gold; const ev = addXp(p, q.xp); p.stats.quests += 1; this.addSeasonPoints(pid, SEASON_POINTS.quest);
    const it = genItem(this.rng, p.level, null, q.chest); p.inventory.push(it);
    if (it.rarity === 'legendary') { p.stats.legendaries += 1; this.feed(`🟠 ${p.name} отримав легендарку за справу: ${it.name}!`); }
    p.playedToday.minutes = Math.max(0, this.minutesToday(p) - 10); // кожна справа повертає 10 хв гри
    checkAchievements(p); this.store.save('players');
    this.feed(`✅ ${p.name}: «${q.name}» зараховано, +${q.gold} золота`);
    this.emit();
    return { item: it, gold: q.gold, xp: q.xp, levelups: ev };
  }
  pendingQuests() {
    const out = [];
    for (const p of this.playerList) { this.questsFor(p); for (const [qid, st] of Object.entries(p.quests.state)) if (st === 'pending') out.push({ pid: p.id, name: p.name, quest: questById[qid] }); }
    return out;
  }

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
  addSeasonPoints(pid, n) { const s = this.history.season; s.points[pid] = (s.points[pid] || 0) + n; }
  seasonView() {
    const s = this.history.season;
    const top = this.playerList.map(p => ({ ...this.publicPlayer(p), points: s.points[p.id] || 0 })).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    return { n: s.n, name: this.settings.season, startedAt: s.startedAt, top, past: this.history.pastSeasons.slice(-5).reverse() };
  }
  /** Батьки закривають сезон: лідер стає чемпіоном (титул), очки обнуляються, новий сезон отримує назву. */
  endSeason(parent, newName) {
    if (!this.isParent(parent)) throw err('лише батьки', 403);
    if (this.battle) throw err('дочекайся кінця бою');
    const v = this.seasonView();
    const winner = v.top.find(p => p.points > 0) || null;
    const past = { n: v.n, name: v.name, startedAt: v.startedAt, endedAt: this.now(), winner: winner ? winner.name : null, winnerId: winner ? winner.id : null, top: v.top.slice(0, 5).map(p => ({ name: p.name, points: p.points })) };
    this.history.pastSeasons.push(past);
    if (winner) { const p = this.players[winner.id]; p.stats.seasonWins = (p.stats.seasonWins || 0) + 1; p.title = `Чемпіон сезону ${v.n}`; p.gold += 100; checkAchievements(p); this.feed(`🥇 ${p.name}: чемпіон сезону ${v.n} «${v.name}»! +100 золота`); }
    else this.feed(`Сезон ${v.n} «${v.name}» закрито без чемпіона`);
    this.history.season = { n: v.n + 1, startedAt: this.now(), points: {} };
    this.settings.season = (newName && String(newName).trim().slice(0, 40)) || `Сезон ${v.n + 1}`;
    this.store.set('settings', this.settings); this.store.save('history'); this.store.save('players');
    this.emit();
    return past;
  }

  // ---------- повтор останнього бою на ТБ ----------
  startReplay(parent) {
    if (!this.isParent(parent)) throw err('лише батьки', 403);
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

  // ---------- стан для клієнтів ----------
  feed(text) { this.history.feed.unshift({ text, at: this.now() }); this.history.feed = this.history.feed.slice(0, 50); this.store.save('history'); }
  battleView() {
    const b = this.battle; if (!b) return null;
    return { round: b.round, mode: b.mode, meta: b.meta, over: b.over, winner: b.winner, roundEnds: this.roundEnds, paused: this.paused, pauseReason: this.pauseReason,
      fighters: b.fighters.map(publicFighter), lastRound: this.lastRound && this.lastRound.n === b.round ? this.lastRound : null, roomIntro: this.roundEvents && this.roundEvents[0] && this.roundEvents[0].t === 'room' ? this.roundEvents[0] : null };
  }
  lobbyView() {
    return { mode: this.lobby.mode, dungeonId: this.lobby.dungeonId, dungeon: dungeonById[this.lobby.dungeonId], raid: this.raidStatus(this.lobby.dungeonId),
      raids: DUNGEONS.filter(d => d.raid).map(d => ({ id: d.id, name: d.name, icon: d.icon, level: d.level, ...this.raidStatus(d.id) })),
      players: Object.entries(this.lobby.players).map(([id, l]) => ({ ...this.publicPlayer(this.players[id]), ready: l.ready, team: l.team })) };
  }
  tvState() {
    const phase = this.battle ? 'battle' : this.replay ? 'replay' : this.results ? 'results' : Object.keys(this.lobby.players).length ? 'lobby' : 'idle';
    const hm = this.kyiv().hm; const quiet = hm < '07:00' || (hm >= '13:00' && hm < '15:00');
    const sv = this.seasonView();
    return { phase, season: this.settings.season, seasonN: sv.n, seasonTop: sv.top.slice(0, 5), pastSeasons: sv.past.slice(0, 3), quiet, now: this.now(), announce: this.announce, lobby: this.lobbyView(), battle: this.battle ? this.battleView() : this.replayView(), results: this.results, paused: this.paused, pauseReason: this.pauseReason,
      heroes: this.playerList.map(p => ({ ...this.publicPlayer(p), xp: p.xp, xpNext: xpForLevel(p.level), kills: p.stats.kills, duelWins: p.stats.duelWins, dungeons: p.stats.dungeons, legendaries: p.stats.legendaries, achievements: p.achievements.length })),
      legendaries: this.history.legendaries.slice(0, 5), feed: this.history.feed.slice(0, 8), pendingQuests: this.pendingQuests().length };
  }
  playerState(p) {
    const b = this.battle; const f = b && b.fighters.find(x => x.id === p.id);
    const inLobby = this.lobby.players[p.id];
    const tv = this.tvState(); const sv = { ...this.seasonView(), phase: tv.phase };
    return {
      me: { ...this.publicPlayer(p), xp: p.xp, xpNext: xpForLevel(p.level), gold: p.gold, deck: p.deck, collection: p.collection, inventory: p.inventory, equipment: p.equipment, bonus: equipmentBonus(p), stats: p.stats, achievements: p.achievements,
        minutesToday: this.minutesToday(p), limit: this.limitFor(p), blocked: this.blockedReason(p), isParent: this.isParent(p), avatarPending: p.avatarPending || null,
        seasonPoints: this.history.season.points[p.id] || 0, seasonRank: sv.top.findIndex(x => x.id === p.id) + 1 },
      phase: sv.phase, season: { n: sv.n, name: sv.name, top: sv.top.slice(0, 5) }, lobby: this.lobbyView(), inLobby: !!inLobby, results: this.results, paused: this.paused, pauseReason: this.pauseReason,
      dm: this.isParent(p) && b && b.mode === 'dungeon' && !b.over ? { mobs: this.dmMobs(), players: this.run.players.map(id => this.publicPlayer(this.players[id])) } : null,
      replay: this.replay ? { mode: this.replay.mode, names: this.replay.names } : null, hasReplay: !!(this.history.lastReplay && this.history.lastReplay.frames.length),
      battle: b ? { ...this.battleView(), me: f ? { hand: f.hand.map(id => cardById[id]), mana: f.mana, maxMana: f.maxMana, hp: f.hp, maxHp: f.maxHp, alive: f.alive, move: f.move, shield: f.shield, quiz: f.quiz && !f.move ? { kind: f.quiz.kind, q: f.quiz.q, choices: f.quiz.choices } : null } : null } : null,
      quests: this.settings.questsEnabled ? this.questsFor(p) : [], pendingQuests: this.isParent(p) ? this.pendingQuests() : [],
    };
  }
  content() {
    return { classes: CLASSES, cards: CARDS, dungeons: DUNGEONS, quests: QUESTS, achievements: ACHIEVEMENTS, rarities: ITEMS.rarities, slots: ITEMS.slots, zones: ZONES, zoneNames: ZONE_NAMES, roundSeconds: this.settings.roundSeconds };
  }
  allowedCards(p) { return allowedCards(p.class, p.collection); }
  dungeonList() { return DUNGEONS.map(d => ({ ...d, ...this.raidStatus(d.id) })); }
  updateSettings(patch) { for (const k of Object.keys(DEFAULT_SETTINGS)) if (patch[k] !== undefined) this.settings[k] = patch[k]; this.store.set('settings', this.settings); this.emit(); }

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
