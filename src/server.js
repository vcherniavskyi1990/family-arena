// Родинна арена: HTTP-сервер. Телефони й ТБ отримують стан через SSE (/api/events), команди шлють POST-ами.
// Без залежностей, крім qrcode (QR на ТБ). Chromium 79 на ТБ: сторінка tv.html без сучасного синтаксису.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';
import { Store } from './store.js';
import { Game, err } from './game.js';
import { Avatars } from './avatar.js';

export const VERSION = '0.45.0';
const PUBLIC = new URL('../public/', import.meta.url);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

export function lanAddress() {
  for (const list of Object.values(networkInterfaces())) for (const i of list) if (i.family === 'IPv4' && !i.internal) return i.address;
  return '127.0.0.1';
}

export function createApp({ dataDir, avatars: avatarsOpt, baseUrl, alertToken = process.env.ARENA_ALERT_TOKEN } = {}) {
  const dir = dataDir || process.env.ARENA_DATA || join(process.cwd(), 'data');
  const store = new Store(dir);
  const game = new Game({ store, cardsDir: join(dir, 'cards') });
  const avatars = avatarsOpt || new Avatars(join(dir, 'avatars'));
  const clients = new Set(); // {res, token|null, tv}
  game.tvOnline = () => { for (const c of clients) if (c.tv) return true; return false; };
  let pushScheduled = false;
  const pushAll = () => {
    if (pushScheduled) return; pushScheduled = true;
    setImmediate(() => { pushScheduled = false; for (const c of clients) sendState(c); });
  };
  game.onChange(pushAll);
  const sendState = (c) => {
    try {
      let payload;
      if (c.tv) payload = game.tvState();
      else { const p = game.auth(c.token); if (!p) { c.res.write(`event: logout\ndata: {}\n\n`); return; } payload = game.playerState(p); }
      c.res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (e) { console.error(e); }
  };
  setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 25000).unref();

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(type.startsWith('application/json') ? JSON.stringify(body) : body); };
    try {
      if (path === '/health') return send(200, { ok: true, version: VERSION, uptimeSec: Math.round(process.uptime()), players: game.playerList.length, phase: game.tvState().phase, paused: game.paused, tv: game.tvOnline() });
      if (path === '/api/digest' || path === '/api/digest.txt') {
        // дайджест дня для бота пульта: лише з токеном інтеграції (той самий, що для тривоги)
        if (!alertToken) return send(503, { error: 'ARENA_ALERT_TOKEN не задано в /etc/arena.env' });
        if ((req.headers['x-arena-token'] || url.searchParams.get('token')) !== alertToken) return send(403, { error: 'токен' });
        const d = game.digest();
        return path.endsWith('.txt') ? send(200, d.text, 'text/plain; charset=utf-8') : send(200, d);
      }
      if (path === '/api/report' || path === '/api/report.txt') {
        // звіт тижня для бота пульта (неділя ввечері): той самий токен; ?back=1 = минулий тиждень
        if (!alertToken) return send(503, { error: 'ARENA_ALERT_TOKEN не задано в /etc/arena.env' });
        if ((req.headers['x-arena-token'] || url.searchParams.get('token')) !== alertToken) return send(403, { error: 'токен' });
        const d = game.weekReport(parseInt(url.searchParams.get('back') || '0', 10) || 0);
        return path.endsWith('.txt') ? send(200, d.text, 'text/plain; charset=utf-8') : send(200, d);
      }
      if (path === '/api/tv/replay' && req.method === 'POST') { if (game.replay) game.stopReplay(); else game.startReplay(null, { fromTv: true }); return send(200, { ok: true, replay: !!game.replay }); }
      if (path === '/api/tv/book') return send(200, game.bookView(14));
      if (path === '/api/tv/hero') { const h = game.heroProfile(url.searchParams.get('id')); return h ? send(200, h) : send(404, { error: 'немає героя' }); }
      if (path === '/api/alert') {
        // тривога з дому: пульт (192.168.1.21) шле POST з токеном; гра сама нікуди не ходить
        if (!alertToken) return send(503, { error: 'ARENA_ALERT_TOKEN не задано в /etc/arena.env' });
        if (req.method === 'GET') return send(200, { paused: game.paused, reason: game.pauseReason });
        if ((req.headers['x-arena-token'] || url.searchParams.get('token')) !== alertToken) return send(403, { error: 'токен' });
        const body = await readBody(req);
        return send(200, { ok: true, ...game.setAlert(body.on !== false && body.on !== 'false' && body.on !== 0) });
      }
      if (path === '/api/events') {
        const tv = url.searchParams.get('tv') === '1';
        const token = url.searchParams.get('token');
        if (!tv && !game.auth(token)) return send(401, { error: 'увійди' });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(': hi\n\n');
        const c = { res, token, tv };
        clients.add(c); sendState(c);
        req.on('close', () => clients.delete(c));
        return;
      }
      if (path.startsWith('/api/')) return await api(req, res, url, send);
      if (path.startsWith('/avatars/') || path.startsWith('/cards/')) {
        const name = path.split('/')[2] || '';
        if (!/^[\w.-]+$/.test(name)) return send(404, 'no', 'text/plain');
        const f = join(path.startsWith('/cards/') ? game.cardsDir : avatars.dir, name);
        if (!existsSync(f)) return send(404, 'no', 'text/plain');
        res.writeHead(200, { 'Content-Type': MIME[extname(name)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' });
        return res.end(await readFile(f));
      }
      if (path === '/avatar-svg') {
        const p = game.players[url.searchParams.get('id')];
        if (!p) return send(404, 'no', 'text/plain');
        return send(200, avatars.fallbackSvg(p), 'image/svg+xml');
      }
      if (path === '/qr.svg') {
        const base = baseUrl || process.env.ARENA_URL || `http://${req.headers.host || lanAddress()}`;
        const pid = url.searchParams.get('p'); const dark = url.searchParams.get('dark') === '1';
        const target = base + '/' + (pid && game.players[pid] ? `?p=${pid}` : '');
        return send(200, await QRCode.toString(target, { type: 'svg', margin: 1, color: dark ? { dark: '#000000', light: '#ffffff' } : { dark: '#ffffff', light: '#00000000' } }), 'image/svg+xml');
      }
      // статика
      let file = path === '/' ? 'index.html' : path === '/tv' ? 'tv.html' : path === '/print' ? 'print.html' : path.slice(1);
      if (file.includes('..')) return send(404, 'no', 'text/plain');
      const full = new URL(file, PUBLIC);
      try { const s = await stat(full); if (!s.isFile()) throw new Error(); } catch { return send(404, 'немає', 'text/plain'); }
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': file.endsWith('.html') ? 'no-store' : 'max-age=300' });
      return res.end(await readFile(full));
    } catch (e) {
      if (!e.status) console.error(e);
      return send(e.status || 500, { error: e.message || 'помилка' });
    }
  };

  async function readBody(req) {
    const chunks = []; let size = 0;
    for await (const ch of req) { size += ch.length; if (size > 8e6) throw err('завеликий запит', 413); chunks.push(ch); }
    const s = Buffer.concat(chunks).toString('utf8');
    return s ? JSON.parse(s) : {};
  }

  async function api(req, res, url, send) {
    const path = url.pathname.slice(4);
    const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : {};
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('token');
    const me = game.auth(token);
    const need = () => { if (!me) throw err('увійди', 401); return me; };
    const parent = () => { const p = need(); if (!game.isParent(p)) throw err('лише для батьків', 403); return p; };
    const ok = (x = {}) => send(200, { ok: true, ...x });

    // --- відкрите ---
    if (path === '/content') return send(200, game.content());
    if (path === '/players') return send(200, { players: game.playerList.map(p => game.publicPlayer(p)), setup: game.playerList.length === 0, avatarsEnabled: avatars.enabled, season: game.settings.season });
    if (path === '/setup' && req.method === 'POST') {
      if (game.playerList.length) throw err('уже налаштовано', 403);
      const p = game.createPlayer({ ...body, role: 'admin' });
      return ok({ token: game.login(p.id, body.pin), player: game.publicPlayer(p) });
    }
    if (path === '/login' && req.method === 'POST') { const t = game.login(body.playerId, body.pin); return ok({ token: t, player: game.publicPlayer(game.players[body.playerId]) }); }
    if (path === '/tv') return send(200, game.tvState());

    // --- гравець ---
    if (path === '/me') return send(200, game.playerState(need()));
    if (path === '/logout' && req.method === 'POST') { game.logout(token); return ok(); }
    if (path === '/me/deck/auto' && req.method === 'POST') { return ok({ deck: game.autoDeck(need()) }); }
    if (path === '/me/deck' && req.method === 'PUT') { game.setDeck(need(), body.deck); return ok(); }
    if (path === '/me/cards') return send(200, { cards: game.allowedCards(need()) });
    if (path === '/me/equip' && req.method === 'POST') { game.equip(need(), body.itemId); return ok(); }
    if (path === '/me/unequip' && req.method === 'POST') { game.unequip(need(), body.slot); return ok(); }
    if (path === '/me/craft' && req.method === 'POST') { return ok({ item: game.craft(need(), body.itemIds || []) }); }
    if (path === '/me/sell' && req.method === 'POST') { return ok({ gold: game.sell(need(), body.itemId) }); }
    if (path === '/me/chest' && req.method === 'POST') { return ok({ item: game.buyChest(need(), body.kind) }); }
    if (path === '/me/cosmetic/buy' && req.method === 'POST') { return ok({ cosmetics: game.buyCosmetic(need(), body.key) }); }
    if (path === '/me/cosmetic' && req.method === 'POST') { return ok({ cosmetics: game.setCosmetic(need(), { frame: body.frame, cry: body.cry }) }); }
    if (path === '/me/coupon/buy' && req.method === 'POST') { return ok({ order: game.buyCoupon(need(), body.couponId) }); }
    if (path === '/admin/coupon/done' && req.method === 'POST') { return ok({ order: game.couponDone(need(), body.orderId, !!body.refund) }); }
    if (path === '/admin/coupons' && req.method === 'POST') { return ok({ coupons: game.setCoupons(need(), body.coupons) }); }
    if (path === '/me/gift' && req.method === 'POST') { return ok(game.claimGift(need())); }
    if (path === '/me/welcome' && req.method === 'POST') { return ok(game.claimWelcome(need())); }
    if (path === '/me/mini/start' && req.method === 'POST') { return ok(game.startMini(need(), body.kind || 'reaction')); }
    if (path === '/me/party/start' && req.method === 'POST') { return ok(game.startParty(need())); }
    if (path === '/me/mini/press' && req.method === 'POST') { return ok(game.pressMini(need(), body.color)); }
    if (path === '/me/mini/answer' && req.method === 'POST') { return ok(game.answerMini(need(), body.answer)); }
    if (path === '/me/mini/tap' && req.method === 'POST') { return ok(game.tapMini(need())); }
    if (path === '/me/challenge' && req.method === 'POST') { return ok(game.challenge(need(), String(body.to || ''))); }
    if (path === '/me/challenge/answer' && req.method === 'POST') { return ok(game.challengeAnswer(need(), String(body.id || ''), !!body.accept)); }
    if (path === '/me/pet' && req.method === 'POST') { return ok({ pets: game.setPet(need(), body.petId || null) }); }
    if (path === '/me/simple' && req.method === 'POST') { const p = need(); game.updatePlayer(p.id, { simple: !!body.on }); return ok(); }
    if (path === '/me/pin' && req.method === 'POST') { const p = need(); if (!game.checkPin(p, body.oldPin)) throw err('старий PIN неправильний'); game.updatePlayer(p.id, { pin: body.pin }); return ok(); }

    // --- аватар ---
    if (path === '/me/avatar' && req.method === 'POST') {
      const p = need();
      if (p.avatar && !body.parentPin) throw err('аватар уже є назавжди; новий лише з PIN батьків');
      if (p.avatar && !game.parentPin(body.parentPin)) throw err('PIN батьків неправильний', 403);
      if (p.avatarPending && p.avatarPending.length && !body.parentPin) throw err('спершу обери один з варіантів');
      const names = await avatars.generate(p, { description: body.description, image: body.image, mime: body.mime });
      if (!names.length) {
        // без Gemini: блоковий аватар одразу
        p.avatar = `/avatar-svg?id=${p.id}&v=${Date.now()}`; p.avatarPending = null; store.save('players'); game.emit();
        return ok({ fallback: true, avatar: p.avatar });
      }
      p.avatarPending = names; store.save('players'); game.emit();
      return ok({ candidates: names.map(n => `/avatars/${n}`) });
    }
    if (path === '/me/avatar/pick' && req.method === 'POST') {
      const p = need();
      const name = String(body.name || '').replace(/^\/avatars\//, '');
      const a = avatars.pick(p, name, p.avatarPending || []);
      if (!a) throw err('немає такого варіанта');
      p.avatar = a; p.avatarPending = null; store.save('players'); game.feed(`🎨 ${p.name} отримав свій аватар назавжди`); game.emit();
      return ok({ avatar: a });
    }

    // --- лобі й бій ---
    if (path === '/lobby/join' && req.method === 'POST') { game.join(need()); return ok(); }
    if (path === '/lobby/leave' && req.method === 'POST') { game.leave(need()); return ok(); }
    if (path === '/lobby/ready' && req.method === 'POST') { game.ready(need(), body.ready !== false); return ok(); }
    if (path === '/lobby/mode' && req.method === 'POST') { game.setMode(need(), body); return ok(); }
    if (path === '/lobby/team' && req.method === 'POST') { game.setTeam(need(), body.team); return ok(); }
    if (path === '/battle/move' && req.method === 'POST') { game.move(need(), body); return ok(); }
    if (path === '/season') { need(); return send(200, game.seasonView()); }
    if (path === '/me/card' && req.method === 'POST') { const c = game.createCustomCard(need(), body); return ok({ card: { ...c } }); }
    if (path === '/admin/card/approve' && req.method === 'POST') { return ok({ card: game.approveCustomCard(parent(), body.id, body.approve !== false) }); }
    if (path === '/me/mob' && req.method === 'POST') { const m = game.createCustomMob(need(), body); return ok({ mob: { ...m } }); }
    if (path === '/admin/mob/approve' && req.method === 'POST') { return ok({ mob: game.approveCustomMob(parent(), body.id, body.approve !== false) }); }
    if (path === '/dm' && req.method === 'POST') { return ok(game.dmAction(parent(), body)); }

    // --- квести ---
    if (path === '/quests/done' && req.method === 'POST') { game.questDone(need(), body.questId, { image: body.image, mime: body.mime }); return ok(); }
    if (path === '/quests/approve' && req.method === 'POST') { return ok({ reward: game.questApprove(parent(), body.playerId, body.questId, body.approve !== false) }); }

    // --- батьки ---
    if (path === '/admin/campaign/reset' && req.method === 'POST') { return ok({ campaign: game.resetCampaign(need()) }); }
    if (path === '/admin/backup') { parent(); const b = game.backup(); return send(200, b); }
    if (path === '/admin/restore' && req.method === 'POST') { const p = parent(); if (!game.checkPin(p, body.pin)) throw err('PIN', 403); return ok(game.restore(p, body.data)); }
    if (path === '/admin/status') { parent(); return send(200, { ...game.serviceStatus(), version: VERSION, node: process.version, uptimeSec: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1048576), gemini: avatars.enabled, alertToken: !!alertToken, baseUrl: baseUrl || null }); }
    if (path === '/admin/report') { parent(); return send(200, game.weekReport(parseInt(url.searchParams.get('back') || '0', 10) || 0)); }
    if (path === '/admin/players' && req.method === 'POST') { parent(); const p = game.createPlayer(body); return ok({ player: game.publicPlayer(p) }); }
    if (path === '/admin/players/update' && req.method === 'POST') { parent(); game.updatePlayer(body.id, body); return ok(); }
    if (path === '/admin/players/delete' && req.method === 'POST') { const a = parent(); if (!game.checkPin(a, body.pin)) throw err('PIN'); game.deletePlayer(body.id); return ok(); }
    if (path === '/admin/settings' && req.method === 'GET') { parent(); return send(200, game.settings); }
    if (path === '/admin/settings' && req.method === 'POST') { parent(); game.updateSettings(body); return ok(); }
    if (path === '/admin/goal' && req.method === 'POST') { return ok({ goal: game.setFamilyGoal(parent(), body.goal || null) }); }
    if (path === '/admin/pause' && req.method === 'POST') { parent(); game.setPaused(!!body.on, body.reason || 'manual'); return ok(); }
    if (path === '/admin/season/end' && req.method === 'POST') { return ok({ season: game.endSeason(parent(), body.name) }); }
    if (path === '/admin/replay' && req.method === 'POST') { const p = parent(); if (body.on === false) game.stopReplay(); else game.startReplay(p); return ok(); }
    if (path === '/admin/avatar/reset' && req.method === 'POST') { parent(); const p = game.players[body.playerId]; if (!p) throw err('немає гравця'); p.avatar = null; p.avatarPending = null; store.save('players'); game.emit(); return ok(); }
    if (path === '/admin/players/create' && req.method === 'POST') { parent(); const p = game.createPlayer(body); return ok({ player: game.publicPlayer(p) }); }
    throw err('немає такого запиту', 404);
  }

  const server = http.createServer(handler);
  server.game = game; server.store = store; server.avatars = avatars;
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8080);
  const server = createApp();
  server.listen(port, () => console.log(`Родинна арена ${VERSION} на http://${lanAddress()}:${port}  (ТБ: /tv)`));
  const bye = () => { server.store.flushAll(); process.exit(0); };
  process.on('SIGTERM', bye); process.on('SIGINT', bye);
}
