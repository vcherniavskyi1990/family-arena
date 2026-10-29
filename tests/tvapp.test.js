// tvapp/: the game's own webOS app «Арена» for the LG TV. appinfo sane, index.html for Chromium 79 (no ?., ??, inset, gap).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

test('tvapp: appinfo.json, іконки, index.html під Chromium 79', () => {
  const info = JSON.parse(readFileSync(new URL('../tvapp/appinfo.json', import.meta.url), 'utf8'));
  assert.equal(info.id, 'ua.home.arena'); assert.equal(info.type, 'web'); assert.equal(info.main, 'index.html');
  assert.equal(info.resolution, '1920x1080'); assert.match(info.version, /^\d+\.\d+\.\d+$/);
  for (const f of [info.icon, info.largeIcon]) assert.ok(existsSync(new URL('../tvapp/' + f, import.meta.url)), f);
  const html = readFileSync(new URL('../tvapp/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('/tv'), 'frame opens the TV page');
  assert.ok(html.includes('/health'), 'probes /health');
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.ok(!/\binset\s*:/.test(css) && !/\bgap\s*:/.test(css), 'без inset і gap');
  const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(!/\?\.|\?\?/.test(js), 'без ?. і ??');
  let acorn = null;
  for (const p of ['acorn', '/opt/node-tools/node_modules/acorn']) { try { acorn = createRequire(import.meta.url)(p); break; } catch { } }
  if (acorn) acorn.parse(js, { ecmaVersion: 2019, sourceType: 'script' });
});
