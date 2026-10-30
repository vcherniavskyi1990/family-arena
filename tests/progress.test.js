import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/engine/rng.js';
import { newPlayer, addXp, xpForLevel, genItem, rollRarity, equip, unequip, craft, checkAchievements, setDeck, equipmentBonus } from '../src/engine/progress.js';
import { starterDeck, RARITY_ORDER } from '../src/engine/content.js';

test('рівні ростуть від досвіду', () => {
  const p = newPlayer({ id: 'a', name: 'A', classId: 'warrior' });
  const ev = addXp(p, xpForLevel(1) + xpForLevel(2) + 5);
  assert.equal(p.level, 3);
  assert.equal(ev.length, 2);
});

test('лут: рідкості розподілені, легендарка рідко, бос дає рідкісне+', () => {
  const rng = makeRng(42);
  const counts = {};
  for (let i = 0; i < 5000; i++) { const r = rollRarity(rng); counts[r] = (counts[r] || 0) + 1; }
  assert.ok(counts.common > counts.uncommon && counts.uncommon > counts.rare && counts.rare > counts.epic);
  assert.ok((counts.legendary || 0) > 0 && counts.legendary < 150, `легендарок ${counts.legendary}`);
  for (let i = 0; i < 50; i++) assert.ok(RARITY_ORDER.indexOf(genItem(rng, 3, null, 'rare').rarity) >= 2);
  const it = genItem(rng, 2, 'epic');
  assert.equal(it.rarity, 'epic');
  assert.ok(Object.keys(it.stats).length === 2, 'епічний має 2 стати');
});

test('вдягання і крафт', () => {
  const rng = makeRng(5);
  const p = newPlayer({ id: 'a', name: 'A', classId: 'warrior' });
  const sword = { ...genItem(rng, 1, 'common'), slot: 'weapon', stats: { atk: 3 } };
  const sword2 = { ...genItem(rng, 1, 'uncommon'), slot: 'weapon', stats: { atk: 4 } };
  p.inventory.push(sword, sword2);
  assert.equal(equip(p, sword.id), null);
  assert.equal(p.equipment.weapon.id, sword.id);
  assert.equal(equip(p, sword2.id), null);
  assert.ok(p.inventory.some(i => i.id === sword.id), 'старий меч повернувся в сумку');
  assert.ok(equipmentBonus(p).atk > 0);
  assert.equal(unequip(p, 'weapon'), null);
  const three = [genItem(rng, 1, 'common'), genItem(rng, 1, 'common'), genItem(rng, 1, 'common')];
  p.inventory.push(...three);
  assert.match(craft(p, [three[0].id, three[1].id, sword2.id], rng), /однакова/);
  const out = craft(p, three.map(i => i.id), rng);
  assert.equal(out.rarity, 'uncommon');
  assert.equal(p.inventory.filter(i => three.some(t => t.id === i.id)).length, 0);
  assert.equal(p.stats.crafts, 1);
});

test('досягнення й титул', () => {
  const p = newPlayer({ id: 'a', name: 'A', classId: 'rogue' });
  p.stats.kills = 1;
  const got = checkAchievements(p);
  assert.ok(got.some(a => a.id === 'first_blood'));
  assert.equal(p.title, 'Новачок');
  assert.equal(checkAchievements(p).length, 0, 'двічі не дається');
});

test('колода: 12 карт, ≤2 однакових, лише свій клас і знайдені рідкісні', () => {
  const p = newPlayer({ id: 'a', name: 'A', classId: 'mage' });
  assert.equal(setDeck(p, starterDeck('mage')), null);
  assert.match(setDeck(p, starterDeck('mage').slice(0, 11)), /12/);
  const d = starterDeck('mage'); d[0] = 'rage';
  assert.match(setDeck(p, d), /класу/);
  const d2 = starterDeck('mage'); d2[0] = 'lightning';
  assert.match(setDeck(p, d2), /не знайдена/);
  p.collection.push('lightning');
  assert.equal(setDeck(p, d2), null);
  const d3 = starterDeck('mage'); d3[0] = d3[1] = d3[2] = 'stone_strike';
  assert.match(setDeck(p, d3), /не більше 2/);
});
