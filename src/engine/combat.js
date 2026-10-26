// Рушій бою: чисті функції, без мережі й часу. Усі ходять одночасно (як у combats.ru): кожен потай обирає
// зону удару, дві зони блоку, ціль і карти; потім раунд розкривається разом (карти Hearthstone-стилю: мана росте +1 за хід).
import { makeRng } from './rng.js';
import { SMART_MULT } from './quiz.js';
import { cardById, classById, mobById, ZONES } from './content.js';

export const HAND_MAX = 5;
export const MANA_MAX = 10;
export const MAX_CARDS_PER_TURN = 3;

/** Гравець → боєць. equipmentBonus = {atk, def, hp, mana, crit} з предметів. */
export function fighterFromPlayer(player, rng) {
  const cls = classById[player.class] || classById.warrior;
  const lvl = player.level || 1;
  const eq = player.bonus || { atk: 0, def: 0, hp: 0, mana: 0, crit: 0 };
  const h = handicap(player.age);
  const maxHp = Math.round((cls.hp + (lvl - 1) * 6 + (eq.hp || 0)) * h.hp);
  const deck = rng.shuffle(player.deck && player.deck.length ? player.deck : []);
  const f = {
    id: player.id, name: player.name, icon: player.icon || cls.icon, avatar: player.avatar || null, team: 0, kind: 'player',
    class: cls.id, level: lvl,
    maxHp, hp: maxHp,
    atk: Math.round((cls.atk + (lvl - 1) * 1 + (eq.atk || 0)) * h.dmg), def: cls.def + (eq.def || 0),
    crit: cls.crit + (eq.crit || 0), dodge: cls.dodge, spell: cls.spell || 1, healMult: cls.heal || 1,
    maxMana: Math.min(MANA_MAX, cls.mana + (eq.mana || 0)), mana: 1,
    deck, hand: [], discard: [], shield: 0, buffs: [], minions: [], effects: {},
    alive: true, move: null, stats: { dmgDealt: 0, dmgTaken: 0, blocks: 0, crits: 0, heals: 0, kills: 0 },
  };
  draw(f, 3);
  return f;
}

/** Молодший гравець отримує бонус, щоб міг перемогти старшого. */
export function handicap(age) {
  if (!age) return { hp: 1, dmg: 1 };
  if (age <= 6) return { hp: 1.4, dmg: 1.25 };
  if (age <= 8) return { hp: 1.25, dmg: 1.15 };
  if (age <= 11) return { hp: 1.1, dmg: 1.05 };
  return { hp: 1, dmg: 1 };
}

export function fighterFromMob(mobId, index, scale = 1) {
  const m = mobById[mobId];
  const maxHp = Math.round(m.hp * scale);
  return {
    id: `${mobId}#${index}`, name: m.name, icon: m.icon, team: 1, kind: m.boss ? 'boss' : 'mob', mob: m.id,
    level: m.level, maxHp, hp: maxHp, atk: Math.round(m.atk * scale), def: m.def,
    crit: m.crit || 0.05, dodge: m.dodge || 0.03, spell: 1, healMult: 1,
    maxMana: 0, mana: 0, deck: [], hand: [], discard: [], shield: 0, buffs: [], minions: [], effects: {},
    alive: true, move: null, raged: false, stats: { dmgDealt: 0, dmgTaken: 0, blocks: 0, crits: 0, heals: 0, kills: 0 },
  };
}

export function draw(f, n = 1) {
  for (let i = 0; i < n; i++) {
    if (f.hand.length >= HAND_MAX) return;
    if (!f.deck.length) { if (!f.discard.length) return; f.deck = f.discard; f.discard = []; }
    f.hand.push(f.deck.pop());
  }
}

/** Новий бій. teams: [[fighter...], [fighter...]]. */
export function createBattle({ teams, seed = 1, mode = 'dungeon', meta = {} }) {
  const fighters = [];
  teams.forEach((t, ti) => t.forEach(f => { f.team = ti; fighters.push(f); }));
  return { seed, rng: makeRng(seed), round: 0, fighters, mode, meta, log: [], over: false, winner: null };
}

export const alive = (b, team) => b.fighters.filter(f => f.alive && (team === undefined || f.team === team));
export const enemiesOf = (b, f) => alive(b, 1 - f.team);
export const alliesOf = (b, f) => alive(b, f.team);
export const byId = (b, id) => b.fighters.find(f => f.id === id);

/** Перевірка й запис ходу. move = {target, attack, blocks:[2], cards:[ids]}. Повертає помилку рядком або null. */
export function submitMove(b, fighterId, move) {
  const f = byId(b, fighterId);
  if (!f || !f.alive) return 'немає бійця';
  if (b.over) return 'бій закінчено';
  const m = normalizeMove(b, f, move);
  if (typeof m === 'string') return m;
  f.move = m;
  return null;
}

export function normalizeMove(b, f, move = {}) {
  const enemies = enemiesOf(b, f);
  if (!enemies.length) return 'немає ворогів';
  let target = enemies.find(e => e.id === move.target);
  if (!target) target = enemies[0];
  const attack = ZONES.includes(move.attack) ? move.attack : b.rng.pick(ZONES);
  let blocks = Array.isArray(move.blocks) ? move.blocks.filter(z => ZONES.includes(z)).slice(0, 2) : [];
  if (blocks.length < 2) { const rest = ZONES.filter(z => !blocks.includes(z)); while (blocks.length < 2) { const z = b.rng.pick(rest); if (!blocks.includes(z)) blocks.push(z); } }
  const cards = [];
  let cost = 0;
  for (const id of (move.cards || []).slice(0, MAX_CARDS_PER_TURN)) {
    const idx = f.hand.indexOf(id);
    const c = cardById[id];
    if (idx < 0 || !c) return `карти ${id} немає в руці`;
    if (cards.filter(x => x === id).length >= f.hand.filter(x => x === id).length) return 'карта двічі';
    cost += c.cost;
    cards.push(id);
  }
  if (cost > f.mana) return 'не вистачає мани';
  return { target: target.id, attack, blocks, cards, smart: !!move.smart };
}

/** Хід бота/моба: випадкові зони, карти жадібно за маною. */
export function autoMove(b, f) {
  const enemies = enemiesOf(b, f);
  if (!enemies.length) return null;
  const rng = b.rng;
  // моби й боти частіше б'ють найслабшого
  const weakest = enemies.slice().sort((a, c) => a.hp - c.hp)[0];
  const target = rng.chance(0.5) ? weakest : rng.pick(enemies);
  const blocks = rng.shuffle(ZONES).slice(0, 2);
  const attack = rng.pick(ZONES);
  const cards = [];
  let mana = f.mana;
  const hand = rng.shuffle(f.hand);
  for (const id of hand) {
    const c = cardById[id];
    if (!c || cards.length >= MAX_CARDS_PER_TURN) continue;
    if (c.type === 'heal' && f.hp > f.maxHp * 0.7) continue;
    if (c.cost <= mana) { mana -= c.cost; cards.push(id); }
  }
  return { target: target.id, attack, blocks, cards };
}

/** Розіграти раунд: усі ходи вже є (кого немає, той ходить автоматично). Повертає події для показу на ТБ. */
export function resolveRound(b) {
  if (b.over) return [];
  const rng = b.rng;
  const ev = [];
  b.round += 1;
  ev.push({ t: 'round', n: b.round });
  for (const f of alive(b)) {
    if (!f.move) f.move = normalizeMove(b, f, autoMove(b, f) || {});
    if (typeof f.move === 'string') f.move = normalizeMove(b, f, {});
  }
  const order = alive(b);
  for (const f of order) if (f.move.smart) { ev.push({ t: 'smart', who: f.id }); f.stats.smartHits = (f.stats.smartHits || 0) + 1; }

  // 1. Карти: спершу щити, баффи, мана, добір; потім шкода, лікування, отрута, оглушення; потім призови
  const played = [];
  for (const f of order) {
    for (const id of f.move.cards) {
      const c = cardById[id];
      f.hand.splice(f.hand.indexOf(id), 1); f.discard.push(id); f.mana -= c.cost;
      played.push({ f, c });
      ev.push({ t: 'card', who: f.id, card: id, name: c.name, icon: c.icon, image: c.image || undefined, text: c.custom ? c.text : undefined });
    }
  }
  const phase = (types) => played.filter(p => types.includes(p.c.type));
  for (const { f, c } of phase(['shield', 'buff', 'mana', 'draw', 'dodge', 'weaken'])) {
    if (c.type === 'shield') { const v = c.value; if (c.aoe) alliesOf(b, f).forEach(a => { a.shield += v; }); else f.shield += v; ev.push({ t: 'shield', who: f.id, v, aoe: !!c.aoe }); }
    if (c.type === 'buff') { f.buffs.push({ atk: c.value, turns: 2 }); if (c.selfDamage) hurt(b, f, f, c.selfDamage, ev, 'self'); }
    if (c.type === 'mana') f.mana = Math.min(f.maxMana, f.mana + c.value);
    if (c.type === 'draw') draw(f, c.value);
    if (c.type === 'dodge') f.effects.untouchable = true;
    if (c.type === 'weaken') { const t = byId(b, f.move.target); if (t) t.buffs.push({ atk: -c.value, turns: 2 }); }
  }
  for (const { f, c } of phase(['damage', 'heal', 'poison', 'stun'])) {
    const t = byId(b, f.move.target);
    if (c.type === 'heal') {
      const v = Math.round(c.value * f.healMult);
      const who = c.aoe ? alliesOf(b, f) : [f];
      who.forEach(a => { const before = a.hp; a.hp = Math.min(a.maxHp, a.hp + v); f.stats.heals += a.hp - before; ev.push({ t: 'heal', who: a.id, by: f.id, v: a.hp - before }); });
      continue;
    }
    const targets = c.aoe ? enemiesOf(b, f) : (t && t.alive ? [t] : enemiesOf(b, f).slice(0, 1));
    for (const tt of targets) {
      let v = c.value;
      if (c.spell) v = Math.round(v * f.spell);
      let crit = false;
      if (c.critBonus && rng.chance(f.crit + c.critBonus)) { v = Math.round(v * 1.5); crit = true; }
      if (c.type === 'poison') { tt.effects.poison = { v: c.value, turns: c.turns || 2 }; ev.push({ t: 'poison', who: tt.id, by: f.id, v: c.value }); continue; }
      hurt(b, f, tt, v, ev, 'card', { pierce: !!c.pierce, card: c.id, crit });
      if (c.type === 'stun' && tt.alive) { tt.effects.stunned = true; ev.push({ t: 'stun', who: tt.id, by: f.id }); }
    }
  }
  for (const { f, c } of phase(['summon'])) {
    f.minions.push({ ...c.minion, maxHp: c.minion.hp, id: `${f.id}:${c.id}:${b.round}` });
    ev.push({ t: 'summon', who: f.id, name: c.minion.name, icon: c.minion.icon });
  }

  // 2. Удари: зона vs блок
  for (const f of order) {
    if (!f.alive) continue;
    const t = byId(b, f.move.target);
    if (!t || !t.alive) continue;
    if (f.effects.stunned) { ev.push({ t: 'skip', who: f.id }); continue; }
    const zone = f.move.attack;
    if (t.move && t.move.blocks.includes(zone) && !(f.raged && rng.chance(0.3))) {
      t.stats.blocks += 1;
      ev.push({ t: 'block', who: t.id, by: f.id, zone });
      continue;
    }
    let dmg = f.atk + f.buffs.reduce((s, x) => s + x.atk, 0);
    dmg = Math.round(dmg * (0.9 + rng.next() * 0.2));
    const zoneMult = { head: 1.3, chest: 1.0, belt: 0.9, legs: 0.8 }[zone];
    dmg = Math.round(dmg * zoneMult);
    let crit = false;
    if (rng.chance(f.crit + (zone === 'head' ? 0.1 : 0))) { dmg = Math.round(dmg * 1.6); crit = true; f.stats.crits += 1; }
    if (f.raged) dmg = Math.round(dmg * 1.5);
    if (f.move.smart) dmg = Math.round(dmg * SMART_MULT);
    hurt(b, f, t, dmg, ev, 'hit', { zone, crit, smart: !!f.move.smart });
    if (f.mob && mobById[f.mob].poison && t.alive) t.effects.poison = { v: mobById[f.mob].poison, turns: 2 };
    if (f.mob && mobById[f.mob].aoe && f.raged) {
      for (const o of enemiesOf(b, f)) if (o !== t && o.alive) hurt(b, f, o, Math.round(dmg * 0.4), ev, 'breath');
    }
  }

  // 3. Прислужники
  for (const f of order) {
    if (!f.alive) continue;
    for (const m of f.minions) {
      const t = byId(b, f.move.target);
      const tt = t && t.alive ? t : enemiesOf(b, f)[0];
      if (!tt) break;
      hurt(b, f, tt, m.atk, ev, 'minion', { minion: m.name, icon: m.icon });
    }
  }

  // 4. Кінець раунду: отрута, лікування мобів, лють босів, мана, добір, баффи
  for (const f of alive(b)) {
    if (f.effects.poison) { hurt(b, f, f, f.effects.poison.v, ev, 'poison'); if (--f.effects.poison.turns <= 0) delete f.effects.poison; }
    if (f.mob && mobById[f.mob].heal && f.alive && f.hp < f.maxHp) { const v = mobById[f.mob].heal; f.hp = Math.min(f.maxHp, f.hp + v); ev.push({ t: 'heal', who: f.id, by: f.id, v }); }
    if (f.mob && mobById[f.mob].rageAt && !f.raged && f.hp <= f.maxHp * mobById[f.mob].rageAt) { f.raged = true; ev.push({ t: 'rage', who: f.id, name: f.name }); }
    if (f.mob && mobById[f.mob].summonEvery && b.round % mobById[f.mob].summonEvery === 0 && f.alive) {
      const ids = mobById[f.mob].summons || [];
      const extra = ids.map((id, i) => fighterFromMob(id, 100 + b.round * 10 + i, b.meta && b.meta.scale ? b.meta.scale : 1));
      for (const x of extra) { x.team = f.team; b.fighters.push(x); }
      if (extra.length) ev.push({ t: 'reinforce', who: f.id, names: extra.map(x => x.name), icons: extra.map(x => x.icon) });
    }
    f.effects.stunned = false; f.effects.untouchable = false;
    f.buffs = f.buffs.map(x => ({ ...x, turns: x.turns - 1 })).filter(x => x.turns > 0);
    f.shield = Math.min(f.shield, 30);
    if (f.kind === 'player') { f.mana = Math.min(f.maxMana, f.mana + 1); draw(f, 1); }
    f.move = null;
  }
  const t0 = alive(b, 0).length, t1 = alive(b, 1).length;
  if (!t0 || !t1) { b.over = true; b.winner = t0 ? 0 : 1; ev.push({ t: 'end', winner: b.winner }); }
  if (b.round >= 40 && !b.over) { b.over = true; b.winner = hpShare(b, 0) >= hpShare(b, 1) ? 0 : 1; ev.push({ t: 'end', winner: b.winner, timeout: true }); }
  b.log.push(ev);
  return ev;
}

function hpShare(b, team) { const fs = b.fighters.filter(f => f.team === team); return fs.reduce((s, f) => s + f.hp / f.maxHp, 0) / fs.length; }

function hurt(b, from, to, dmg, ev, kind, extra = {}) {
  if (!to.alive) return;
  if (to.effects.untouchable && from !== to && kind !== 'poison') { ev.push({ t: 'dodge', who: to.id, by: from.id, kind }); return; }
  if ((kind === 'hit' || kind === 'minion') && b.rng.chance(to.dodge)) { ev.push({ t: 'dodge', who: to.id, by: from.id, kind }); return; }
  let v = Math.max(1, dmg - (kind === 'poison' || kind === 'self' ? 0 : to.def));
  if (to.shield > 0 && kind !== 'self') { const s = Math.min(to.shield, v); to.shield -= s; v -= s; if (s) ev.push({ t: 'absorb', who: to.id, v: s }); }
  to.hp -= v;
  to.stats.dmgTaken += v;
  if (from !== to) from.stats.dmgDealt += v;
  ev.push({ t: 'dmg', who: to.id, by: from.id, v, kind, hp: Math.max(0, to.hp), ...extra });
  if (to.hp <= 0) {
    to.hp = 0; to.alive = false; to.minions = [];
    if (from !== to) from.stats.kills += 1;
    ev.push({ t: 'death', who: to.id, by: from.id, name: to.name, boss: to.kind === 'boss' });
    if (to.mob && mobById[to.mob].explode) {
      for (const o of enemiesOf(b, to)) if (o.alive) { o.hp = Math.max(0, o.hp - 10); o.stats.dmgTaken += 10; ev.push({ t: 'dmg', who: o.id, by: to.id, v: 10, kind: 'explode', hp: o.hp }); if (o.hp <= 0) { o.alive = false; ev.push({ t: 'death', who: o.id, by: to.id, name: o.name }); } }
    }
  }
}

/** Публічний вигляд бійця (без руки й колоди). */
export function publicFighter(f) {
  return {
    id: f.id, name: f.name, icon: f.icon, avatar: f.avatar, team: f.team, kind: f.kind, class: f.class, level: f.level,
    hp: f.hp, maxHp: f.maxHp, mana: f.mana, maxMana: f.maxMana, shield: f.shield, alive: f.alive, raged: !!f.raged,
    minions: f.minions.map(m => ({ name: m.name, icon: m.icon, atk: m.atk })), ready: !!f.move,
    poison: !!f.effects.poison, stunned: !!f.effects.stunned, buff: f.buffs.reduce((s, x) => s + x.atk, 0), handSize: f.hand.length,
  };
}
