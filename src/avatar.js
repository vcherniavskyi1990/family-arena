// Аватари: Gemini малює 3 варіанти з дитячого малюнка або опису (один раз назавжди, перегенерація лише з PIN батьків).
// Без ключа або при помилці: блоковий SVG-аватар у стилі Minecraft, детермінований від імені й класу.
import { mkdirSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { classById } from './engine/content.js';

const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

export class Avatars {
  constructor(dir, { key = process.env.GEMINI_API_KEY, fetchFn = globalThis.fetch } = {}) {
    this.dir = dir; mkdirSync(dir, { recursive: true });
    this.key = key; this.fetch = fetchFn;
  }
  get enabled() { return !!this.key; }

  /** Повертає масив з назв файлів-варіантів (png) або [] якщо Gemini недоступний. */
  async generate(player, { description = '', image = null, mime = 'image/jpeg' } = {}) {
    if (!this.key) return [];
    const cls = classById[player.class];
    const prompt = [
      `Створи ігровий аватар героя для дитячої сімейної гри у стилі Minecraft + World of Warcraft + Roblox: блоковий, яскравий, дружній, портрет по груди, квадратний, однотонний темний фон.`,
      `Клас героя: ${cls.name} (${cls.text}). Ім'я героя: ${player.name}.`,
      image ? 'За основу візьми цей дитячий малюнок: збережи його ідею, кольори й настрій, зроби його красивим ігровим персонажем.' : (description ? `Опис від дитини: ${description}.` : ''),
      'Без тексту й написів на картинці. Без реальних облич.',
    ].join(' ');
    const parts = [{ text: prompt }];
    if (image) parts.push({ inline_data: { mime_type: mime, data: image } });
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${this.key}`;
    const out = [];
    for (let i = 0; i < 3; i++) {
      try {
        const res = await this.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE'] } }) });
        if (!res.ok) { console.error('gemini', res.status, (await res.text()).slice(0, 200)); continue; }
        const j = await res.json();
        const img = (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.find(p => p.inlineData || p.inline_data);
        if (!img) continue;
        const d = img.inlineData || img.inline_data;
        const name = `${player.id}_v${i}_${Date.now().toString(36)}.png`;
        writeFileSync(join(this.dir, name), Buffer.from(d.data, 'base64'));
        out.push(name);
      } catch (e) { console.error('gemini', e.message); }
    }
    return out;
  }

  /** Залишити обраний варіант як аватар гравця, решту видалити. */
  pick(player, name, candidates) {
    if (!candidates.includes(name)) return null;
    for (const c of candidates) if (c !== name && existsSync(join(this.dir, c))) unlinkSync(join(this.dir, c));
    return `/avatars/${name}`;
  }

  /** Запасний аватар: блокова голова у кольорах класу, однакова для того самого імені. */
  fallbackSvg(player) {
    const cls = classById[player.class] || classById.warrior;
    let h = 0; for (const ch of player.name + player.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const r = () => { h = (h * 1103515245 + 12345) >>> 0; return (h >>> 8) / 16777216; };
    const palette = { warrior: ['#8b5a2b', '#c0392b'], mage: ['#5b2c83', '#3498db'], healer: ['#1e8449', '#f1c40f'], archer: ['#196f3d', '#784212'], rogue: ['#2c3e50', '#7d3c98'] }[cls.id];
    const skin = ['#f5cba7', '#e0ac69', '#c68642', '#8d5524'][Math.floor(r() * 4)];
    const hair = ['#2c1b0e', '#f1c40f', '#c0392b', '#1b1b1b', '#7f8c8d'][Math.floor(r() * 5)];
    const eye = ['#2e86c1', '#117a65', '#6e2c00'][Math.floor(r() * 3)];
    const px = 8, cells = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      let c = skin;
      if (y < 2 || (y === 2 && (x === 0 || x === 7))) c = hair;
      if (y === 4 && (x === 2 || x === 5)) c = eye;
      if (y === 6 && x >= 3 && x <= 4) c = '#a04000';
      if (y === 7 && (x < 1 || x > 6)) c = palette[0];
      if (r() < 0.08 && y > 2) c = shade(c, r() < 0.5 ? -12 : 12);
      cells.push(`<rect x="${x * px}" y="${y * px}" width="${px}" height="${px}" fill="${c}"/>`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 80 80" shape-rendering="crispEdges"><rect x="-8" y="-8" width="80" height="80" fill="${palette[1]}"/>${cells.join('')}<text x="32" y="70" font-size="9" text-anchor="middle" font-family="sans-serif">${cls.icon}</text></svg>`;
  }
  list() { return readdirSync(this.dir); }
}

function shade(hex, d) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, v + d)));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}
