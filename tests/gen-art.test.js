import test from 'node:test';
import assert from 'node:assert/strict';
import { jobs, main, SCENES, BOSSES } from '../tools/gen-art.mjs';
import { DUNGEONS, MOBS } from '../src/engine/content.js';

test('gen-art: кожне підземелля має сцену, кожен бос портрет, промпти без тексту й людей', () => {
  const j = jobs();
  for (const d of DUNGEONS) assert.ok(SCENES[d.id] && j.some(x => x.file === `scene_${d.id}.png`), 'сцена ' + d.id);
  for (const m of MOBS.filter(m => m.boss && m.id !== 'dummy')) assert.ok(BOSSES[m.id] && j.some(x => x.file === `mob_${m.id}.png`), 'портрет ' + m.id);
  for (const x of j) { assert.match(x.prompt, /No text/); assert.match(x.prompt, /no people/); assert.ok(['16:9', '1:1'].includes(x.aspect)); }
});

test('gen-art: пише файли з фальшивого API, наявні пропускає, --only звужує', async () => {
  const { mkdtempSync, existsSync, readdirSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'arena-genart-'));
  const calls = [];
  const fake = async (url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from('png!').toString('base64') } }] } }] }) }; };
  let code = await main(['--only', 'kitchen_caves,boss_wither'], { ARENA_DATA: dir, GEMINI_API_KEY: 'k' }, fake);
  assert.equal(code, 0); assert.deepEqual(readdirSync(join(dir, 'art')).sort(), ['mob_boss_wither.png', 'scene_kitchen_caves.png']);
  assert.equal(calls.length, 2); assert.equal(calls[0].generationConfig.imageConfig.aspectRatio, '16:9'); assert.equal(calls[1].generationConfig.imageConfig.aspectRatio, '1:1');
  code = await main(['--only', 'kitchen_caves'], { ARENA_DATA: dir, GEMINI_API_KEY: 'k' }, fake);
  assert.equal(calls.length, 2, 'наявний файл не перемальовується без --force');
  assert.equal(await main([], { ARENA_DATA: dir }, fake), 2, 'без ключа код 2');
  assert.ok(existsSync(join(dir, 'art', 'scene_kitchen_caves.png')));
});
