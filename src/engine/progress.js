// Прогрес героя: досвід і рівні, лут 5 рідкостей, спорядження, крафт, досягнення. Чисті функції над об'єктом гравця.
import { ITEMS, ACHIEVEMENTS, CARDS, PETS, RARITY_ORDER, cardById, petById, DECK_SIZE } from './content.js';

export const MAX_LEVEL = 20;
export const xpForLevel = (lvl) => Math.round(100 * Math.pow(lvl, 1.5));

export function newPlayer({ id, name, classId, age, role = 'kid', pinHash }) {
  return {
    id, name, class: classId, age: age || null, role, pinHash, icon: null, avatar: null, title: null, simple: !!(age && age <= 8), auto: false,
    level: 1, xp: 0, gold: 50, deck: [], collection: [], inventory: [], equipment: {}, achievements: [],
    stats: { kills: 0, bossKills: 0, dragonKills: 0, duelWins: 0, duels: 0, dungeons: 0, legendaries: 0, blocks: 0, crits: 0, heals: 0, quests: 0, crafts: 0, alertPauses: 0, smart: 0, seasonWins: 0, raids: 0, worldBoss: 0, pets: 0, chapters: 0, tournaments: 0, streakBest: 0, gifts: 0, coupons: 0, practice: 0, minis: 0, reaction: 0, quiz: 0, quizPerfect: 0, memory: 0, parties: 0, challenges: 0, level: 1 },
    quests: {}, playedToday: { day: null, minutes: 0 }, createdAt: Date.now(), pets: [], activePet: null, cosmetics: { owned: [], frame: null, cry: null }, streak: { days: 0, last: null }, gift: { day: null },
  };
}

/** Додати досвід; повертає список подій (новий рівень). */
export function addXp(p, xp) {
  const ev = [];
  p.xp += xp;
  while (p.level < MAX_LEVEL && p.xp >= xpForLevel(p.level)) {
    p.xp -= xpForLevel(p.level);
    p.level += 1; p.stats.level = p.level;
    ev.push({ t: 'levelup', who: p.id, level: p.level });
  }
  return ev;
}

/** Бонуси зі спорядження. */
export function equipmentBonus(p) {
  const b = { atk: 0, def: 0, hp: 0, mana: 0, crit: 0 };
  for (const slot of Object.keys(ITEMS.slots)) {
    const it = p.equipment[slot];
    if (it) for (const k of Object.keys(it.stats || {})) b[k] = (b[k] || 0) + it.stats[k];
  }
  const pb = petBonus(p);
  for (const k of Object.keys(pb)) b[k] = (b[k] || 0) + pb[k];
  return b;
}

/** Вихованці: випадають із підземель; активний дає бонус, що росте з рівнем вихованця (+25 % за рівень). */
export const PET_XP_PER_LEVEL = 3;
export function petOf(p, id) { return (p.pets || []).find(x => x.id === id); }
export function petBonus(p) {
  const pet = p.activePet && petOf(p, p.activePet); const def = pet && petById[pet.id];
  if (!def) return {};
  const mult = 1 + 0.25 * ((pet.level || 1) - 1); const b = {};
  for (const k of Object.keys(def.bonus)) b[k] = k === 'crit' ? Math.round(def.bonus[k] * mult * 100) / 100 : Math.round(def.bonus[k] * mult);
  return b;
}
export function petView(p) {
  return (p.pets || []).map(x => { const d = petById[x.id]; return { ...x, name: d.name, icon: d.icon, rarity: d.rarity, text: d.text, bonus: d.bonus, active: p.activePet === x.id, xpNext: PET_XP_PER_LEVEL }; });
}
export function activePetIcon(p) { const pet = p.activePet && petOf(p, p.activePet); return pet && petById[pet.id] ? petById[pet.id].icon : null; }
/** Випадковий вихованець за рідкістю (рівень підземелля додає шанс на рідкісних). */
export function genPet(rng, level = 1) {
  const r = rollRarity(rng, level * 2);
  const pool = PETS.filter(x => x.rarity === r);
  return rng.pick(pool.length ? pool : PETS.filter(x => x.rarity === 'common')).id;
}
/** Дати вихованця: новий — у список (і активний, якщо не було); повторний — досвід і рівень. Повертає подію. */
export function grantPet(p, id) {
  if (!p.pets) p.pets = [];
  const d = petById[id]; if (!d) return null;
  const have = petOf(p, id);
  if (!have) { p.pets.push({ id, level: 1, xp: 0 }); if (!p.activePet) p.activePet = id; p.stats.pets = (p.stats.pets || 0) + 1; return { t: 'pet', who: p.id, name: d.name, icon: d.icon, rarity: d.rarity, isNew: true, level: 1 }; }
  have.xp += 1;
  if (have.xp >= PET_XP_PER_LEVEL) { have.xp = 0; have.level += 1; return { t: 'pet', who: p.id, name: d.name, icon: d.icon, rarity: d.rarity, isNew: false, level: have.level, levelUp: true }; }
  return { t: 'pet', who: p.id, name: d.name, icon: d.icon, rarity: d.rarity, isNew: false, level: have.level };
}

export function rollRarity(rng, luck = 0) {
  const entries = Object.entries(ITEMS.rarities);
  const total = entries.reduce((s, [, r]) => s + r.weight, 0) + luck;
  let x = rng.next() * total;
  for (let i = entries.length - 1; i >= 0; i--) {
    const [id, r] = entries[i];
    const w = r.weight + (i >= 2 ? luck / (entries.length - 2) : 0);
    if (x < w) return id;
    x -= w;
  }
  return 'common';
}

/** Згенерувати предмет. rarity можна задати (бос дає rare+). */
export function genItem(rng, level = 1, rarity = null, minRarity = 'common') {
  let r = rarity || rollRarity(rng, level * 2);
  if (RARITY_ORDER.indexOf(r) < RARITY_ORDER.indexOf(minRarity)) r = minRarity;
  const slotId = rng.pick(Object.keys(ITEMS.slots));
  const slot = ITEMS.slots[slotId];
  const mult = ITEMS.rarities[r].mult;
  const main = Math.max(1, Math.round(slot.base * mult * (1 + level * 0.15) * (0.9 + rng.next() * 0.2)));
  const stats = { [slot.stat]: main };
  // рідкісні й вище мають другий стат
  if (RARITY_ORDER.indexOf(r) >= 2) {
    const extra = rng.pick(['atk', 'def', 'hp', 'crit'].filter(s => s !== slot.stat));
    stats[extra] = extra === 'crit' ? Math.round(mult * 2) / 100 : Math.max(1, Math.round(ITEMS.slots[Object.keys(ITEMS.slots).find(k => ITEMS.slots[k].stat === extra) || 'weapon'].base * (mult - 1)));
  }
  const [base, gender] = rng.pick(slot.names).split(':');
  const prefix = rng.pick(ITEMS.prefixes[r]).split('/')[{ m: 0, f: 1, n: 2 }[gender] || 0];
  const name = `${prefix} ${base.toLowerCase()}${RARITY_ORDER.indexOf(r) >= 1 ? ' ' + rng.pick(ITEMS.suffixes) : ''}`;
  return { id: `it_${Date.now().toString(36)}_${Math.floor(rng.next() * 1e9).toString(36)}`, name, slot: slotId, rarity: r, level, stats };
}

/** Випадкова карта як трофей (рідкісна+ тільки з босів). */
export function genCard(rng, classId, minRarity = 'rare') {
  const pool = CARDS.filter(c => (c.class === 'all' || c.class === classId) && RARITY_ORDER.indexOf(c.rarity) >= RARITY_ORDER.indexOf(minRarity));
  return pool.length ? rng.pick(pool).id : null;
}

export function statValue(it) { return Object.values(it.stats).reduce((s, v) => s + (v < 1 ? v * 100 : v), 0) * ITEMS.rarities[it.rarity].mult; }

export function equip(p, itemId) {
  const it = p.inventory.find(i => i.id === itemId);
  if (!it) return 'немає предмета';
  const old = p.equipment[it.slot];
  p.inventory = p.inventory.filter(i => i.id !== itemId);
  if (old) p.inventory.push(old);
  p.equipment[it.slot] = it;
  return null;
}

export function unequip(p, slot) {
  const it = p.equipment[slot];
  if (!it) return 'нічого не вдягнуто';
  delete p.equipment[slot];
  p.inventory.push(it);
  return null;
}

/** Крафт: 3 предмети однієї рідкості → 1 предмет наступної рідкості. */
export function craft(p, itemIds, rng) {
  if (itemIds.length !== 3) return 'потрібно 3 предмети';
  const items = itemIds.map(id => p.inventory.find(i => i.id === id));
  if (items.some(i => !i)) return 'немає предмета';
  const r = items[0].rarity;
  if (items.some(i => i.rarity !== r)) return 'рідкість має бути однакова';
  const idx = RARITY_ORDER.indexOf(r);
  if (idx >= RARITY_ORDER.length - 1) return 'легендарки не крафтяться';
  p.inventory = p.inventory.filter(i => !itemIds.includes(i.id));
  const lvl = Math.max(...items.map(i => i.level));
  const out = genItem(rng, lvl, RARITY_ORDER[idx + 1]);
  p.inventory.push(out);
  p.stats.crafts += 1;
  if (out.rarity === 'legendary') p.stats.legendaries += 1;
  return out;
}

/** Перевірити досягнення; повертає нові. */
export function checkAchievements(p) {
  const got = [];
  for (const a of ACHIEVEMENTS) {
    if (p.achievements.includes(a.id)) continue;
    const v = p.stats[a.cond.stat] || 0;
    if (v >= a.cond.gte) { p.achievements.push(a.id); got.push(a); if (!p.title) p.title = a.title; }
  }
  return got;
}

export function sellPrice(it) { return Math.round(5 * ITEMS.rarities[it.rarity].mult * (1 + it.level * 0.2)); }

/** Колода: 12 карт (DECK_SIZE), не більше 2 однакових, лише дозволені. */
/** Колода за гравця: найкращі доступні карти (клас + спільні, рідкісні лише зі знайдених), до 2 копій, з розумною кривою мани. */
export function autoDeck(p) {
  const pool = CARDS.filter(c => (c.class === 'all' || c.class === p.class) && (RARITY_ORDER.indexOf(c.rarity) < 2 || p.collection.includes(c.id)));
  const score = (c) => {
    const cost = Math.max(1, c.cost); let v = (c.value || 0) / cost;
    if (c.type === 'summon' && c.minion) v = (c.minion.atk * 2 + c.minion.hp / 4) / cost;
    if (c.type === 'heal' || c.type === 'shield') v += 1.5;
    if (c.type === 'stun') v += 2; if (c.type === 'buff' || c.type === 'weaken') v += 1; if (c.type === 'mana' || c.type === 'draw') v += 2.5; if (c.type === 'dodge') v += 1.5;
    if (c.aoe) v += 3; if (c.pierce) v += 2; if (c.critBonus) v += 1;
    return v + RARITY_ORDER.indexOf(c.rarity) * 2.5;
  };
  const sorted = pool.slice().sort((a, b) => score(b) - score(a) || a.cost - b.cost);
  const deck = []; let big = 0, small = 0;
  const take = (c) => { deck.push(c.id); if (c.cost >= 10) big++; if (c.cost <= 4) small++; };
  for (let copy = 0; copy < 2 && deck.length < DECK_SIZE; copy++) {
    for (const c of sorted) {
      if (deck.length >= DECK_SIZE) break;
      if (deck.filter(x => x === c.id).length > copy) continue;
      if (c.cost >= 10 && big >= 3) continue;
      take(c);
    }
  }
  // мало дешевих карт: заміняємо найдорожчі на дешеві
  if (small < 4) {
    const cheap = sorted.filter(c => c.cost <= 4);
    for (const c of cheap) { if (small >= 4 || deck.length === 0) break; const n = deck.filter(x => x === c.id).length; if (n >= 2) continue; const idx = deck.map(id => cardById[id].cost).lastIndexOf(Math.max(...deck.map(id => cardById[id].cost))); if (cardById[deck[idx]].cost <= 4) break; deck.splice(idx, 1); deck.push(c.id); small++; }
  }
  while (deck.length < DECK_SIZE && sorted.length) deck.push(sorted[deck.length % sorted.length].id);
  return deck.slice(0, DECK_SIZE);
}
export function setDeck(p, deck) {
  if (!Array.isArray(deck) || deck.length !== DECK_SIZE) return `у колоді має бути ${DECK_SIZE} карт`;
  const counts = {};
  for (const id of deck) {
    const c = cardById[id];
    if (!c) return `немає карти ${id}`;
    if (c.class !== 'all' && c.class !== p.class) return `${c.name} не для твого класу`;
    if (RARITY_ORDER.indexOf(c.rarity) >= 2 && !p.collection.includes(id)) return `${c.name} ще не знайдена`;
    counts[id] = (counts[id] || 0) + 1;
    if (counts[id] > 2) return `${c.name} не більше 2 разів`;
  }
  p.deck = deck;
  return null;
}
