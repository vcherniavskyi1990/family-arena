// ТБ LG webOS 6.5 ≈ Chromium 79: tv.js має парситись як ES2019 (без ?., ??, полів класів тощо).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

test('tv.js: синтаксис не новіший за ES2019 (Chromium 79 на ТБ)', () => {
  let acorn = null;
  for (const p of ['acorn', '/opt/node-tools/node_modules/acorn']) { try { acorn = createRequire(import.meta.url)(p); break; } catch { } }
  const src = readFileSync(new URL('../public/tv.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\?\.|\?\?/.test(code), 'без ?. і ??');
  assert.ok(!/\bgap\s*:/.test(readFileSync(new URL('../public/tv.css', import.meta.url), 'utf8')), 'без flex gap у tv.css');
  if (!acorn) return; // немає парсера: перевірили лише регулярками
  acorn.parse(src, { ecmaVersion: 2019, sourceType: 'script' });
  acorn.parse(readFileSync(new URL('../public/plan.js', import.meta.url), 'utf8'), { ecmaVersion: 5, sourceType: 'script' });
});
