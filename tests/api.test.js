import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';
import { Avatars } from '../src/avatar.js';

async function start() {
  const dir = mkdtempSync(join(tmpdir(), 'arena-api-'));
  const server = createApp({ dataDir: dir, baseUrl: 'http://192.168.1.26' });
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body, token, method) => {
    const res = await fetch(base + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };
  return { server, base, call, close: () => { server.closeAllConnections(); server.close(); } };
}

test('API: налаштування, вхід, гравці, лобі, хід', async () => {
  const { server, base, call, close } = await start();
  try {
    let r = await call('/players');
    assert.equal(r.json.setup, true);
    r = await call('/setup', { name: 'Тато', classId: 'warrior', age: 40, pin: '1234' });
    assert.equal(r.status, 200); const dad = r.json.token;
    r = await call('/setup', { name: 'X', classId: 'warrior', pin: '1234' }); assert.equal(r.status, 403);
    r = await call('/admin/players/create', { name: 'Віктор', classId: 'archer', age: 10, pin: '1111' }, dad);
    assert.equal(r.status, 200); const kidId = r.json.player.id;
    r = await call('/login', { playerId: kidId, pin: '0000' }); assert.equal(r.status, 401);
    r = await call('/login', { playerId: kidId, pin: '1111' }); const kid = r.json.token;
    r = await call('/me', null, kid); assert.equal(r.json.me.name, 'Віктор'); assert.equal(r.json.me.isParent, false);
    r = await call('/admin/settings', null, kid); assert.equal(r.status, 403);
    r = await call('/admin/settings', { bedtime: '23:59', wakeup: '00:00' }, dad); assert.equal(r.status, 200);
    r = await call('/lobby/mode', { mode: 'duel' }, dad);
    await call('/lobby/join', {}, dad); await call('/lobby/join', {}, kid);
    r = await call('/tv'); assert.equal(r.json.phase, 'lobby'); assert.equal(r.json.lobby.players.length, 2);
    await call('/lobby/ready', { ready: true }, dad); await call('/lobby/ready', { ready: true }, kid);
    r = await call('/tv'); assert.equal(r.json.phase, 'battle');
    r = await call('/me', null, kid); assert.ok(r.json.battle.me.hand.length >= 3);
    r = await call('/battle/move', { attack: 'head', blocks: ['head', 'chest'], cards: [] }, kid); assert.equal(r.status, 200);
    r = await call('/me', null, kid); assert.ok(r.json.battle.me.move);
    r = await call('/battle/move', { cards: ['ender_dragon_breath'] }, dad); assert.equal(r.status, 400);
    // ТБ-потік подій: перший кадр приходить одразу
    const ev = await fetch(base + '/api/events?tv=1');
    const reader = ev.body.getReader(); const { value } = await reader.read(); const txt = new TextDecoder().decode(value);
    assert.ok(txt.includes(': hi'));
    reader.cancel();
    const h = await (await fetch(base + '/health')).json(); assert.equal(h.phase, 'battle');
    const qr = await (await fetch(base + '/qr.svg')).text(); assert.ok(qr.includes('<svg'));
    const svg = await (await fetch(base + '/avatar-svg?id=' + kidId)).text(); assert.ok(svg.includes('<rect'));
    const page = await fetch(base + '/tv'); assert.equal(page.status, 200);
  } finally { close(); }
});

test('аватар без ключа Gemini: блоковий назавжди, новий лише з PIN батьків', async () => {
  const { call, close, server } = await start();
  try {
    const dad = (await call('/setup', { name: 'Тато', classId: 'mage', pin: '1234' })).json.token;
    let r = await call('/me/avatar', { description: 'лицар з котом' }, dad);
    assert.equal(r.json.fallback, true);
    r = await call('/me/avatar', { description: 'інший' }, dad); assert.equal(r.status, 400);
    r = await call('/me/avatar', { description: 'інший', parentPin: '1234' }, dad); assert.equal(r.status, 200);
    assert.equal(server.avatars.enabled, false);
  } finally { close(); }
});

test('Gemini: три варіанти з фальшивого API, вибір одного', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'arena-av-'));
  const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
  let calls = 0;
  const fetchFn = async (url, opts) => { calls++; assert.ok(url.includes('generateContent')); assert.ok(JSON.parse(opts.body).contents[0].parts[0].text.includes('Minecraft')); return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png } }] } }] }) }; };
  const av = new Avatars(join(dir, 'avatars'), { key: 'test', fetchFn });
  const names = await av.generate({ id: 'p1', name: 'Олександр', class: 'rogue' }, { description: 'ніндзя' });
  assert.equal(names.length, 3); assert.equal(calls, 3);
  assert.equal(av.pick({ id: 'p1' }, names[1], names), `/avatars/${names[1]}`);
  assert.equal(av.list().length, 1);
});

test('API тривоги: без токена 503, з чужим 403, зі своїм пауза', async () => {
  const { createApp } = await import('../src/server.js');
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const srv = createApp({ dataDir: mkdtempSync(join(tmpdir(), 'alert-')), alertToken: 'secret1' });
  await new Promise(r => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const r1 = await fetch(base + '/api/alert', { method: 'POST', headers: { 'x-arena-token': 'wrong' }, body: '{"on":true}' });
  assert.equal(r1.status, 403);
  const r2 = await fetch(base + '/api/alert', { method: 'POST', headers: { 'x-arena-token': 'secret1', 'content-type': 'application/json' }, body: '{"on":true}' });
  assert.equal((await r2.json()).paused, true);
  const h = await (await fetch(base + '/health')).json();
  assert.equal(h.paused, true); assert.equal(h.tv, false);
  const r3 = await fetch(base + '/api/alert', { method: 'POST', headers: { 'x-arena-token': 'secret1', 'content-type': 'application/json' }, body: '{"on":false}' });
  assert.equal((await r3.json()).paused, false);
  const srv2 = createApp({ dataDir: mkdtempSync(join(tmpdir(), 'alert2-')), alertToken: '' });
  await new Promise(r => srv2.listen(0, r));
  const r4 = await fetch(`http://127.0.0.1:${srv2.address().port}/api/alert`, { method: 'POST', body: '{}' });
  assert.equal(r4.status, 503);
  srv.closeAllConnections(); srv.close(); srv2.closeAllConnections(); srv2.close();
});
