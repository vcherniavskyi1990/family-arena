#!/usr/bin/env node
// Сцени кімнат і портрети босів для полотна бою (v0.59, крок 2).
// Генерує через Gemini (та сама модель, що й аватари) і кладе в $ARENA_DATA/art/:
//   scene_<підземелля>.png  — 16:9 фон кімнати дому без людей і написів
//   mob_<бос>.png           — квадратний портрет боса для кола на ТБ
// Діти потім можуть замінити будь-який файл своїм малюнком (та сама назва).
// Запуск на CT 106 (ключ лише в /etc/arena.env, у репо його нема):
//   set -a; . /etc/arena.env; set +a; ARENA_DATA=/var/lib/arena node tools/gen-art.mjs
// Параметри: --force (перемалювати наявні), --only kitchen_caves,boss_wither (лише ці), --dry (показати промпти, нічого не слати).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DUNGEONS, MOBS } from '../src/engine/content.js';

const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const STYLE = 'Bright colorful cartoon illustration for a family video game, playful Minecraft and Lego toy vibe, clean shapes, soft lighting, high detail. No text, no letters, no watermark, no people, no real faces.';

/** Де в домі яке підземелля: опис сцени для Gemini (рішення Віктора 30.10: тематичні кімнати, «щось цікавеньке»). */
export const SCENES = {
  kitchen_caves: 'A family kitchen turned into a cave: stalactites made of hanging pots and pans, glowing oven like a lava furnace, cookie crumbs on the floor, a sink with green slime, night light through the window.',
  lego_castle: 'A kids bedroom where a giant castle built of colorful plastic bricks fills the room, toy knights on the shelves, a bunk bed in the background, warm evening lamp.',
  wardrobe_shadows: 'Inside a huge walk-in wardrobe at night: long rows of coats like a dark forest, shadows with glowing eyes between hangers, a single flashlight beam, scattered shoes.',
  bedroom_nightmares: 'A child bedroom at midnight: purple moonlight, blanket shaped like a monster, floating pillows, a nightlight projecting stars, dream mist on the floor.',
  bathroom_kraken: 'A bathroom flooded like an ocean: huge green tentacles rising from the bathtub, rubber ducks floating like boats, bubbles everywhere, a shower raining, tiles with sea plants.',
  attic_ghosts: 'A dusty attic full of old boxes, a rocking chair, cobwebs, a cracked mirror, pale ghost-light glowing from a chest, moonlight through a round window.',
  dad_office: 'A home office turned into a server room: racks of blinking servers, tangled cables like vines, three monitors with green code, a mechanical keyboard, a cup of coffee, blue LED glow.',
  garage_machines: 'A home garage where tools and machines came alive: a lawn mower with eyes, drills and wrenches floating, oil puddles, a car under a sheet, sparks and neon workshop light.',
  balcony_citadel: 'A balcony of an apartment at sunset turned into a fortress: flower pots as towers, a clothesline with flags, a bicycle as a catapult, city rooftops and sky in the background.',
  raid_titan: 'A living room in total chaos: a huge sofa fortress, toys scattered like a battlefield, the big TV glowing, curtains torn, cushions flying, dramatic storm light.',
  raid_dragon: 'The roof of a family house at night under a starry sky: chimney with smoke, satellite dish, a dragon-shaped cloud lit by the moon, city lights far below.',
  practice: 'A sunny backyard training ground: a straw dummy on a pole, a trampoline, a wooden fence, a dog house, garden flowers, blue sky.',
};

/** Портрети босів: вигляд для кола на ТБ. */
export const BOSSES = {
  boss_ravager: 'A huge angry wild boar boss with iron tusks and a small crown, covered in kitchen soot.',
  boss_wither: 'A three-headed skeletal wither boss made of dark smoke and bones, glowing blue eyes.',
  boss_ender_dragon: 'A black dragon boss with purple glowing eyes and wet tentacle-like wings, bathroom bubbles around.',
  boss_lich_king: 'A frost lich king boss in a spiky crown and icy armor, holding a glowing blue sword, snow and flowerpots on a balcony.',
  raid_titan: 'A giant stone titan boss built from sofa cushions, toys and furniture, glowing cracks, chaotic and funny.',
  raid_dragon: 'An ancient golden dragon boss with huge wings and glowing eyes, rising above a rooftop at night.',
  boss_server_king: 'A king boss made of computer servers and monitors, a crown of cables, screens as eyes, blue LED glow.',
  boss_nightmare: 'A nightmare lord boss: a purple shadow creature with many glowing eyes, made of blankets and dream mist.',
  boss_mech_titan: 'A steel mech titan boss assembled from garage tools: drill arm, wrench hand, lawnmower chest, sparks.',
};

/** Список робіт: що намалювати і куди покласти. */
export function jobs() {
  const out = [];
  for (const d of DUNGEONS) if (SCENES[d.id]) out.push({ id: d.id, file: `scene_${d.id}.png`, aspect: '16:9', prompt: `Wide game background, horizontal 16:9. ${SCENES[d.id]} Empty stage with free floor space at the bottom third for characters. ${STYLE}` });
  for (const m of MOBS) if (m.boss && BOSSES[m.id]) out.push({ id: m.id, file: `mob_${m.id}.png`, aspect: '1:1', prompt: `Square character portrait, head and shoulders centered, dark plain background, looking at the viewer. ${BOSSES[m.id]} ${STYLE}` });
  return out;
}

async function generate(job, key, fetchFn = globalThis.fetch) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const body = { contents: [{ parts: [{ text: job.prompt }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: job.aspect } } };
  for (let i = 0; i < 3; i++) {
    const res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { console.error(job.file, res.status, (await res.text()).slice(0, 200)); await new Promise(r => setTimeout(r, 5000)); continue; }
    const j = await res.json();
    const img = (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.find(p => p.inlineData || p.inline_data);
    if (!img) { console.error(job.file, 'без картинки у відповіді'); continue; }
    const d = img.inlineData || img.inline_data;
    return Buffer.from(d.data, 'base64');
  }
  return null;
}

export async function main(argv = process.argv.slice(2), env = process.env, fetchFn = globalThis.fetch) {
  const force = argv.includes('--force'), dry = argv.includes('--dry');
  const onlyArg = argv[argv.indexOf('--only') + 1]; const only = argv.includes('--only') && onlyArg ? onlyArg.split(',') : null;
  const dir = join(env.ARENA_DATA || join(process.cwd(), 'data'), 'art'); mkdirSync(dir, { recursive: true });
  const key = env.GEMINI_API_KEY;
  if (!key && !dry) { console.error('Нема GEMINI_API_KEY: set -a; . /etc/arena.env; set +a'); return 2; }
  let done = 0, skipped = 0, failed = 0;
  for (const job of jobs()) {
    if (only && !only.includes(job.id)) continue;
    const path = join(dir, job.file);
    if (!force && (existsSync(path) || existsSync(path.replace(/png$/, 'jpg')) || existsSync(path.replace(/png$/, 'webp')))) { skipped++; continue; }
    if (dry) { console.log(job.file, '·', job.aspect, '·', job.prompt); continue; }
    process.stdout.write(job.file + ' … ');
    const png = await generate(job, key, fetchFn);
    if (!png) { failed++; console.log('не вийшло'); continue; }
    writeFileSync(path, png); done++; console.log(Math.round(png.length / 1024) + ' КБ');
    if (fetchFn === globalThis.fetch) await new Promise(r => setTimeout(r, 1500));   // не частіше, ніж раз на 1,5 с
  }
  console.log(`Готово: нових ${done}, пропущено (вже є) ${skipped}, не вийшло ${failed}. Тека: ${dir}`);
  return failed ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().then(c => process.exit(c));
