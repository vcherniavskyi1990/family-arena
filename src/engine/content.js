// Дані гри з JSON: карти, класи, моби, підземелля, предмети, квести, досягнення.
import { readFileSync } from 'node:fs';

const load = (name) => JSON.parse(readFileSync(new URL(`../content/${name}.json`, import.meta.url), 'utf8'));

export const CLASSES = load('classes');
export const CARDS = load('cards');
export const MOBS = load('mobs');
export const DUNGEONS = load('dungeons');
export const ITEMS = load('items');
export const QUESTS = load('quests');
export const ACHIEVEMENTS = load('achievements');
export const DAILY = load('daily');
export const FAMILY = load('family');

export const cardById = Object.fromEntries(CARDS.map(c => [c.id, c]));
export const classById = Object.fromEntries(CLASSES.map(c => [c.id, c]));
export const mobById = Object.fromEntries(MOBS.map(m => [m.id, m]));
export const dungeonById = Object.fromEntries(DUNGEONS.map(d => [d.id, d]));
export const questById = Object.fromEntries(QUESTS.map(q => [q.id, q]));

export const ZONES = ['head', 'chest', 'belt', 'legs'];
export const ZONE_NAMES = { head: 'Голова', chest: 'Груди', belt: 'Пояс', legs: 'Ноги' };
export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

/** Стартова колода класу: 20 карт, лише звичайні й незвичайні, свого класу або спільні. */
export function starterDeck(classId) {
  const own = CARDS.filter(c => c.class === classId && (c.rarity === 'common' || c.rarity === 'uncommon'));
  const shared = CARDS.filter(c => c.class === 'all' && (c.rarity === 'common' || c.rarity === 'uncommon'));
  const deck = [];
  // карти класу двічі, далі спільні по одній, доки не буде 20
  for (const c of own) deck.push(c.id, c.id);
  for (const c of shared) { if (deck.length < 20) deck.push(c.id); }
  for (const c of shared) { if (deck.length < 20) deck.push(c.id); }
  return deck.slice(0, 20);
}

/** Карти, які гравець може класти в колоду: спільні, свого класу, і ті, що він знайшов (collection). */
export function allowedCards(classId, collection = []) {
  return CARDS.filter(c => (c.class === 'all' || c.class === classId) &&
    ((c.rarity === 'common' || c.rarity === 'uncommon') || collection.includes(c.id)));
}
