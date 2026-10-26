/* Родинна арена: телефон гравця. Один файл, без збірки. Стан приходить потоком /api/events, команди йдуть POST-ами. */
(function () {
  'use strict';
  var $ = function (sel) { return document.querySelector(sel); };
  var app = $('#app');
  var token = localStorage.getItem('arena.token') || null;
  var content = null, state = null, es = null, tab = localStorage.getItem('arena.tab') || 'arena';
  var ui = { sound: (function () { try { return localStorage.getItem('arena.sound') === '1'; } catch (e) { return false; } })(), move: { attack: null, blocks: [], cards: [], target: null }, sent: false, craftSel: [], deck: null, pick: null, pin: '', loginPlayer: null, setup: false, heroView: 'gear', avatarCands: null, timerId: null };
  var RAR = { common: 'Звичайний', uncommon: 'Незвичайний', rare: 'Рідкісний', epic: 'Епічний', legendary: 'Легендарний' };
  var STAT = { atk: 'удар', def: 'захист', hp: 'здоров’я', mana: 'мана', crit: 'крит' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var audio = null;
  function beep(freq, ms, type) {
    if (!ui.sound) return;
    try { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); var o = audio.createOscillator(), g = audio.createGain(); o.type = type || 'square'; o.frequency.value = freq; g.gain.value = 0.05; o.connect(g); g.connect(audio.destination); o.start(); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + ms / 1000); o.stop(audio.currentTime + ms / 1000); } catch (e) { }
  }
  function toast(msg, ms) { var t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove('on'); }, ms || 2200); }
  function api(path, body, method) {
    return fetch('/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Authorization: token ? 'Bearer ' + token : '' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) { if (r.status === 401 && token) logout(); throw new Error(j.error || 'помилка'); } return j; }); });
  }
  function act(path, body, okMsg) { return api(path, body || {}).then(function (r) { if (okMsg) toast(okMsg); return r; }).catch(function (e) { toast(e.message, 3000); throw e; }); }
  function logout() { token = null; localStorage.removeItem('arena.token'); if (es) { es.close(); es = null; } state = null; boot(); }
  function avatarHtml(p, cls) { var a = p.avatar; return '<div class="avatar ' + (cls || '') + '">' + (a ? '<img src="' + esc(a) + '" alt="">' : esc(p.icon || '🙂')) + '</div>'; }
  function statLine(stats) { return Object.keys(stats || {}).map(function (k) { var v = stats[k]; return '+' + (k === 'crit' ? Math.round(v * 100) + '%' : v) + ' ' + STAT[k]; }).join(', '); }
  function itemHtml(it, extra) { return '<div class="item b-' + it.rarity + ' ' + (extra && extra.sel ? 'sel' : '') + '" data-id="' + it.id + '"><div class="grow"><div class="r-' + it.rarity + '"><b>' + esc(it.name) + '</b></div><div class="small muted">' + esc(RAR[it.rarity]) + ' · ' + esc(content.slots[it.slot].name) + ' · ' + statLine(it.stats) + '</div></div>' + (extra && extra.btns ? extra.btns : '') + '</div>'; }

  // ---------- старт ----------
  function boot() {
    api('/content').then(function (c) { content = c; return api('/players'); }).then(function (pl) {
      if (!token) return renderLogin(pl);
      connect();
    }).catch(function (e) { app.innerHTML = '<div class="center"><div>Сервер не відповідає</div><button onclick="location.reload()">Ще раз</button></div>'; });
  }
  function connect() {
    if (es) es.close();
    es = new EventSource('/api/events?token=' + encodeURIComponent(token));
    es.onmessage = function (e) { var prev = state; state = JSON.parse(e.data); onState(prev); render(); };
    es.addEventListener('logout', function () { logout(); });
    es.onerror = function () { setTimeout(function () { if (es && es.readyState === 2) connect(); }, 2000); };
  }
  function onState(prev) {
    var b = state.battle;
    if (b && (!prev || !prev.battle || prev.battle.round !== b.round || !b.me || !b.me.move)) {
      if (!b.me || !b.me.move) { ui.sent = false; if (!prev || !prev.battle || prev.battle.round !== b.round) ui.move = { attack: null, blocks: [], cards: [], target: ui.move.target }; }
    }
    if (!b) ui.sent = false;
    if (b && !b.replay && b.lastRound && (!prev || !prev.battle || !prev.battle.lastRound || prev.battle.lastRound.n !== b.lastRound.n)) { if (navigator.vibrate) navigator.vibrate(60); beep(440, 120, 'triangle'); }
    if (state.results && (!prev || !prev.results)) { tab = 'arena'; }
  }

  // ---------- вхід ----------
  function renderLogin(pl) {
    // QR-картка гравця (/print): ?p=<id> одразу відкриває PIN цього гравця
    var want = (location.search.match(/[?&]p=([\w]+)/) || [])[1];
    if (want && !ui.loginPlayer && !pl.setup) { var pp = pl.players.filter(function (x) { return x.id === want; })[0]; if (pp) ui.loginPlayer = pp; }
    if (pl.setup) {
      app.innerHTML = '<div class="screen"><h1>⚔️ Родинна арена</h1><div class="card"><p>Перший гравець стає адміністратором (тато). Далі він додає інших.</p>' + playerForm('Створити') + '</div></div>';
      bindPlayerForm(function (data) { return api('/setup', data).then(function (r) { token = r.token; localStorage.setItem('arena.token', token); connect(); }); });
      return;
    }
    if (ui.loginPlayer) {
      var p = ui.loginPlayer;
      app.innerHTML = '<div class="screen"><h1>⚔️ Родинна арена</h1><div class="center" style="min-height:auto">' + avatarHtml(p, 'lg') + '<div class="big">' + esc(p.name) + '</div><div class="muted">Введи свій PIN</div><div class="pin-dots">' + '●'.repeat(ui.pin.length) + '</div></div>' +
        '<div class="pin">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, '←', 0, '✕'].map(function (k) { return '<button data-k="' + k + '">' + k + '</button>'; }).join('') + '</div></div>';
      app.querySelectorAll('.pin button').forEach(function (b) {
        b.onclick = function () {
          var k = b.dataset.k;
          if (k === '✕') { ui.loginPlayer = null; ui.pin = ''; return renderLogin(pl); }
          if (k === '←') { ui.pin = ui.pin.slice(0, -1); return renderLogin(pl); }
          if (ui.pin.length >= 4) return;
          ui.pin += k;
          if (ui.pin.length === 4) {
            api('/login', { playerId: p.id, pin: ui.pin }).then(function (r) { token = r.token; localStorage.setItem('arena.token', token); ui.pin = ''; ui.loginPlayer = null; connect(); })
              .catch(function (e) { toast(e.message); ui.pin = ''; renderLogin(pl); });
          } else renderLogin(pl);
        };
      });
      return;
    }
    app.innerHTML = '<div class="screen"><h1>⚔️ Родинна арена</h1><div class="muted">' + esc(pl.season || '') + '</div><h3>Хто ти?</h3><div class="players">' +
      pl.players.map(function (p) { return '<div class="card" data-id="' + p.id + '">' + avatarHtml(p) + '<div><b>' + esc(p.name) + '</b></div><div class="small muted">' + esc(p.className) + ' · ' + p.level + ' рів.</div></div>'; }).join('') + '</div>' +
      '<p class="muted small" style="margin-top:20px">Нового гравця додають батьки у своєму меню.</p></div>';
    app.querySelectorAll('.players .card').forEach(function (c) { c.onclick = function () { ui.loginPlayer = pl.players.filter(function (p) { return p.id === c.dataset.id; })[0]; ui.pin = ''; renderLogin(pl); }; });
  }
  function playerForm(btn, withRole) {
    return '<input id="f-name" placeholder="Ім’я героя" maxlength="20"><select id="f-class">' + content.classes.map(function (c) { return '<option value="' + c.id + '">' + c.icon + ' ' + esc(c.name) + ': ' + esc(c.text) + '</option>'; }).join('') + '</select>' +
      '<input id="f-age" type="number" placeholder="Вік (молодшим бонус до здоров’я)" min="3" max="99">' + (withRole ? '<select id="f-role"><option value="kid">Дитина (ліміти, 21:30)</option><option value="parent">Батько/мама (підтверджує квести)</option></select>' : '') +
      '<input id="f-pin" type="tel" inputmode="numeric" placeholder="PIN з 4 цифр" maxlength="4" pattern="\\d{4}"><button class="btn-primary btn-block" id="f-go">' + btn + '</button>';
  }
  function bindPlayerForm(submit) {
    $('#f-go').onclick = function () {
      var d = { name: $('#f-name').value, classId: $('#f-class').value, age: $('#f-age').value, pin: $('#f-pin').value };
      if ($('#f-role')) d.role = $('#f-role').value;
      submit(d).catch(function (e) { toast(e.message, 3000); });
    };
  }

  // ---------- каркас ----------
  function render() {
    if (!state) return;
    var me = state.me;
    var pendingN = state.pendingQuests ? state.pendingQuests.length : 0;
    var tabs = [['arena', '⚔️', 'Арена'], ['hero', '🧙', 'Герой'], ['deck', '🃏', 'Колода'], ['quests', '✅', 'Квести'], me.isParent ? ['admin', '👨‍👩‍👦', 'Батьки'] : ['more', '⚙️', 'Ще']];
    var body;
    if (state.battle && state.battle.me && !(tab === 'admin' && state.dm)) body = renderBattle();
    else if (tab === 'arena') body = renderArena();
    else if (tab === 'hero') body = renderHero();
    else if (tab === 'deck') body = renderDeck();
    else if (tab === 'quests') body = renderQuests();
    else if (tab === 'admin') body = renderAdmin();
    else body = renderMore();
    app.innerHTML = '<div class="screen">' + body + '</div><div class="tabs">' + tabs.map(function (t) { return '<button data-tab="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '"><span>' + t[1] + '</span>' + t[2] + (t[0] === 'quests' && pendingN && me.isParent ? '<span class="badge">' + pendingN + '</span>' : '') + '</button>'; }).join('') + '</div>';
    app.querySelectorAll('.tabs button').forEach(function (b) { b.onclick = function () { tab = b.dataset.tab; localStorage.setItem('arena.tab', tab); render(); }; });
    bind();
  }
  function head() {
    var me = state.me;
    return '<div class="row card" style="margin-top:0">' + avatarHtml(me) + '<div class="grow"><div><b>' + esc(me.name) + '</b> <span class="muted small">' + esc(me.title || me.className) + '</span></div><div class="bar xp"><i style="width:' + Math.min(100, 100 * me.xp / me.xpNext) + '%"></i></div><div class="small muted">Рівень ' + me.level + ' · ' + me.xp + '/' + me.xpNext + ' досвіду · 🪙 ' + me.gold + '</div></div></div>';
  }

  // ---------- арена ----------
  function renderArena() {
    var me = state.me, h = head();
    if (!state.tvOnline) h += '<div class="card warn">📵 ТБ не підключений: режим блекауту, увесь бій показуємо тут</div>';
    if (state.paused) h += '<div class="card warn">⏸ Пауза: ' + (state.pauseReason === 'alert' ? 'тривога, усі в укриття' : 'батьки поставили паузу') + '</div>';
    if (state.results) return h + renderResults();
    if (state.tournament && !state.battle) h += tournamentHtml(state.tournament);
    if (state.battle && !state.battle.replay) return h + '<div class="card">Бій уже йде без тебе. Зачекай, поки закінчиться.</div>' + battleSpectator();
    if (state.replay) h += '<div class="card">📼 На ТБ іде повтор: ' + esc(state.replay.names.join(', ')) + (me.isParent ? ' <button class="btn-sm" id="replay-stop">Зупинити</button>' : '') + '</div>';
    h += worldBossHtml();
    var lob = state.lobby;
    var raidOf = {}; (lob.raids || []).forEach(function (r) { raidOf[r.id] = r; });
    var dungeons = content.dungeons.map(function (d) { var r = raidOf[d.id]; return '<option value="' + d.id + '"' + (lob.dungeonId === d.id ? ' selected' : '') + (r && !r.available ? ' disabled' : '') + '>' + d.icon + ' ' + esc(d.name) + ' (рівень ' + d.level + ')' + (r && !r.available ? ' 🔒' : '') + '</option>'; }).join('');
    var mine = lob.players.filter(function (p) { return p.id === me.id; })[0];
    h += '<div class="card"><h3>Режим</h3><div class="row"><button class="btn-sm ' + (lob.mode === 'dungeon' ? 'btn-blue' : '') + '" data-mode="dungeon">🏰 Підземелля</button><button class="btn-sm ' + (lob.mode === 'duel' ? 'btn-blue' : '') + '" data-mode="duel">⚔️ Дуель</button><button class="btn-sm ' + (lob.mode === 'campaign' ? 'btn-blue' : '') + '" data-mode="campaign">📖 Кампанія</button><button class="btn-sm ' + (lob.mode === 'tournament' ? 'btn-blue' : '') + '" data-mode="tournament">🏆 Турнір</button></div>' +
      (lob.mode === 'tournament' ? '<div class="small muted">3 або 4 гравці в лобі. Троє — кожен з кожним, четверо — два півфінали й фінал. Дуелі йдуть одна за одною самі, чемпіон +8 очок сезону.</div>' : '') +
      (lob.mode === 'campaign' ? campaignHtml(lob.campaign) : '') +
      (lob.mode === 'dungeon' ? '<select id="dungeon">' + dungeons + '</select><div class="small muted">' + esc(lob.dungeon.text) + ' · кімнат: ' + lob.dungeon.rooms.length + ' + бос</div>' + (lob.raid && lob.raid.raid ? '<div class="card warn" style="margin:8px 0 0">🗿 Рейд: мінімум ' + (lob.raid.minPlayers || 2) + ' гравці, бос сильнішає з кожним. Раз на тиждень.' + (lob.raid.available ? '' : ' ' + esc(lob.raid.reason)) + '</div>' : '') : lob.mode === 'campaign' || lob.mode === 'tournament' ? '' : '<div class="small muted">Дві команди. Перемикай команду кнопкою нижче.</div>') + '</div>';
    h += '<div class="card"><h3>Лобі (' + lob.players.length + ')</h3>' + (lob.players.length ? lob.players.map(function (p) { return '<div class="row" style="padding:4px 0">' + avatarHtml(p) + '<div class="grow"><b>' + esc(p.name) + '</b> <span class="small muted">' + p.level + ' рів.' + (lob.mode === 'duel' ? ' · команда ' + (p.team ? '🔴' : '🔵') : '') + '</span></div><div>' + (p.ready ? '✅' : '⏳') + '</div></div>'; }).join('') : '<div class="muted">Ще нікого. Подивись на ТБ!</div>') + '</div>';
    if (me.blocked) h += '<div class="card warn">🔒 ' + esc(me.blocked) + '</div>';
    else if (!mine) h += '<button class="btn-primary btn-block" id="join">Зайти в лобі</button>';
    else h += (lob.mode === 'duel' ? '<button class="btn-block" id="team">Команда: ' + (mine.team ? '🔴 червона' : '🔵 синя') + ' (змінити)</button>' : '') +
      (mine.ready ? '<button class="btn-block" id="unready">⏳ Готовий, чекаємо інших…</button>' : '<button class="btn-green btn-block" id="ready">✅ Готовий!</button>') + '<button class="btn-block btn-sm" id="leave">Вийти з лобі</button>';
    if (!me.isParent) h += '<div class="small muted">Сьогодні зіграно ' + me.minutesToday + ' з ' + me.limit + ' хв. Справи повертають час.</div>';
    h += seasonCard();
    return h;
  }
  function seasonCard() {
    var me = state.me, sz = state.season;
    if (!sz) return '';
    return '<div class="card"><h3>🏆 ' + esc(sz.name) + '</h3><div class="small muted">Твоє місце: ' + (me.seasonRank || '—') + ' · ' + me.seasonPoints + ' очок. Дуель +3, підземелля +5 і більше, справа +1.</div>' +
      sz.top.map(function (p, i) { return '<div class="row small" style="padding:3px 0"><span>' + ['🥇', '🥈', '🥉', '4.', '5.'][i] + '</span>' + avatarHtml(p) + '<div class="grow"><b>' + esc(p.name) + '</b></div><b>' + p.points + '</b></div>'; }).join('') + '</div>';
  }
  function battleSpectator() {
    var b = state.battle;
    return '<div class="card">' + b.fighters.map(function (f) { return '<div class="row small"><span>' + esc(f.icon) + ' ' + esc(f.name) + '</span><div class="bar grow ' + (f.team ? 'red' : '') + '"><i style="width:' + (100 * f.hp / f.maxHp) + '%"></i></div><span>' + f.hp + '</span></div>'; }).join('') + '</div>';
  }
  function tournamentHtml(t) {
    if (!t) return '';
    return '<div class="card"><h3>🏆 Турнір' + (t.champion ? ': чемпіон ' + esc(t.champion) : ' · бій ' + Math.min(t.current + 1, t.of) + ' з ' + t.of) + '</h3>' +
      t.matches.map(function (m, i) { return '<div class="row small" style="padding:3px 0"><span>' + (m.final ? '🏁' : (i + 1) + '.') + '</span><div class="grow">' + (m.a ? esc(m.a.name) : '?') + ' <span class="muted">проти</span> ' + (m.b ? esc(m.b.name) : '?') + '</div><b>' + (m.winner ? '✅ ' + esc(m.winner) : m.live ? '⚔️ зараз' : '…') + '</b></div>'; }).join('') + '</div>';
  }
  function campaignHtml(c) {
    return '<div class="camp"><div class="small muted">Розділ ' + c.n + ' з ' + c.of + (c.runs ? ' · пройдено ' + c.runs + ' раз' : '') + '</div><b>' + esc(c.icon) + ' ' + esc(c.title) + '</b> <span class="small muted">' + esc(c.dungeon) + ', рівень ' + c.level + '</span>' +
      '<div class="story">' + esc(c.intro) + '</div><div class="chap">' + c.chapters.map(function (x) { return '<span class="' + (x.done ? 'done' : x.n === c.n ? 'cur' : '') + '" title="' + esc(x.title) + '">' + x.n + '</span>'; }).join('') + '</div>' +
      (state.me.isParent ? '<button class="btn-sm" id="camp-reset">Почати кампанію заново</button>' : '') + '</div>';
  }
  function worldBossHtml() {
    var w = state.worldBoss; if (!w) return '';
    var top = w.top.map(function (t) { return esc(t.name) + ' ' + t.dmg; }).join(', ');
    return '<div class="card wboss"><h3>' + esc(w.icon) + ' Бос тижня: ' + esc(w.name) + '</h3>' + (w.killed ? '<div class="ok-text">Повалений! Новий у понеділок.</div>' :
      '<div class="bar red"><i style="width:' + w.pct + '%"></i></div><div class="small">' + w.hp + ' / ' + w.maxHp + ' · ще ' + w.daysLeft + ' дн.</div>') +
      '<div class="small muted">' + esc(w.text) + '</div>' + (w.mine ? '<div class="small">Твій внесок: ' + w.mine + '</div>' : '') + (top ? '<div class="small muted">Б’ють: ' + top + '</div>' : '') + '</div>';
  }
  function renderResults() {
    var r = state.results;
    var h = '<div class="card ' + (r.mode === 'duel' || r.won ? 'ok' : 'warn') + '"><div class="big">' + (r.mode === 'duel' ? '⚔️ Дуель виграв: ' + esc(r.winners.join(', ')) : (r.won ? (r.raid ? '🗿 Рейд пройдено! ' : '🏆 ') + '«' + esc(r.dungeon) + '»' + (r.raid ? '' : ' пройдено!') : '💀 «' + esc(r.dungeon) + '» виявилось сильнішим')) + '</div>' +
      (r.mode === 'dungeon' ? '<div class="muted">Вбито ' + r.kills + ' · кожному +' + r.xp + ' досвіду, +' + r.gold + ' золота</div>' : '') + '</div>';
    var myLoot = (r.loot || []).filter(function (l) { return state.tvOnline ? l.name === state.me.name : true; });
    if (myLoot.length) h += '<div class="card"><h3>' + (state.tvOnline ? 'Твій лут' : 'Лут усім') + '</h3>' + myLoot.map(function (l) { return (state.tvOnline ? '' : '<div class="small muted">' + esc(l.name) + ':</div>') + (l.item ? itemHtml(l.item) : l.pet ? '<div class="item b-rare"><b>🐾 Вихованець: ' + esc(l.petIcon) + ' ' + esc(l.petName) + '</b></div>' : '<div class="item b-rare"><b class="r-rare">🃏 Нова карта: ' + esc(l.cardName) + '</b></div>'); }).join('') + '</div>';
    if (r.tournament) h += tournamentHtml(r.tournament) + (r.tournament.done ? '' : '<div class="small muted">Наступна дуель почнеться сама за пів хвилини.</div>');
    if (r.campaign) h += '<div class="card ' + (r.campaign.outro ? 'ok' : 'warn') + '"><b>📖 Розділ ' + r.campaign.n + ': ' + esc(r.campaign.title) + '</b><div class="story">' + (r.campaign.outro ? esc(r.campaign.outro) : 'Розділ не пройдено. Спробуйте ще раз або прокачайтесь у підземеллях.') + '</div>' + (r.campaign.finished ? '<div class="ok-text">🎉 Кампанію пройдено, дім урятовано!</div>' : '') + '</div>';
    if (r.worldBoss && r.worldBoss.hit) h += '<div class="card">' + esc(r.worldBoss.icon) + ' Босу тижня «' + esc(r.worldBoss.name) + '» −' + r.worldBoss.hit + (r.worldBoss.killed ? ' · <b>повалений!</b>' : ' (лишилось ' + r.worldBoss.hp + ')') + '</div>';
    var ev = (r.events || []).filter(function (e) { return e.who === state.me.id || e.t === 'family' || e.t === 'worldboss'; });
    if (ev.length) h += '<div class="card ok">' + ev.map(function (e) { return e.t === 'pet' ? '<div>🐾 ' + esc(e.icon) + ' ' + esc(e.name) + (e.isNew ? ' приручено!' : e.levelUp ? ': рівень ' + e.level + '!' : ': +досвід') + '</div>' : e.t === 'worldboss' ? '<div>' + esc(e.icon) + ' Бос тижня «' + esc(e.name) + '» повалений: +' + e.gold + ' золота всім!</div>' : e.t === 'levelup' ? '<div>⬆️ Новий рівень: ' + e.level + '!</div>' : e.t === 'daily' ? '<div>📅 Завдання дня «' + esc(e.name) + '»: +' + e.gold + ' 🪙</div>' : e.t === 'family' ? '<div>👨‍👩‍👦 Сімейне досягнення «' + esc(e.name) + '»: усім +' + e.gold + ' 🪙</div>' : '<div>' + esc(e.icon) + ' Досягнення: ' + esc(e.name) + ' (титул «' + esc(e.title) + '»)</div>'; }).join('') + '</div>';
    return h + '<button class="btn-primary btn-block" id="join">Ще раз у лобі</button>';
  }

  // ---------- бій ----------
  function renderBattle() {
    var b = state.battle, me = b.me, m = ui.move;
    var enemies = b.fighters.filter(function (f) { return f.team !== myTeam(); }), allies = b.fighters.filter(function (f) { return f.team === myTeam(); });
    if (!m.target || !enemies.some(function (e) { return e.id === m.target && e.alive; })) { var al = enemies.filter(function (e) { return e.alive; }); m.target = al.length ? al[0].id : null; }
    var left = b.roundEnds ? Math.max(0, Math.round((b.roundEnds - Date.now()) / 1000)) : null;
    var h = '<div class="row"><div class="grow"><b>' + (b.mode === 'duel' ? 'Дуель' : (b.meta.boss ? '👑 БОС' : 'Кімната ' + b.meta.room + ' з ' + b.meta.rooms)) + '</b> · раунд ' + (b.round + 1) + '</div><div class="timer ' + (left !== null && left <= 10 ? 'low' : '') + '" id="timer">' + (b.paused ? '⏸' : left === null ? '…' : left) + '</div></div>';
    if (b.paused) h += '<div class="card warn">⏸ ' + (b.pauseReason === 'alert' ? 'Тривога! Усі в укриття, гра зачекає' : 'Батьки поставили паузу') + '</div>';
    if (!state.tvOnline) h += '<div class="small muted">📵 ТБ не підключений: раунди тут, без анімацій на ТБ</div>';
    if (b.lastRound && b.lastRound.events) h += '<div class="card log">' + b.lastRound.events.map(describeEvent).filter(Boolean).slice(0, state.tvOnline ? 12 : 40).map(function (t) { return '<div>' + t + '</div>'; }).join('') + '</div>';
    h += '<h3>Вороги · тисни, щоб обрати ціль</h3>' + enemies.map(function (f) { return fighterRow(f, f.id === m.target, true); }).join('');
    if (allies.length > 1) h += '<h3>Команда</h3>' + allies.map(function (f) { return fighterRow(f, false, false); }).join('');
    if (!me.alive) return h + '<div class="card warn">💀 Ти повалений. Команда б’ється далі, тримай кулаки!</div>';
    h += '<div class="card" style="margin-top:10px"><div class="row"><span>❤️ ' + me.hp + '/' + me.maxHp + (me.shield ? ' 🛡' + me.shield : '') + '</span><span class="right">🔵 мана ' + me.mana + '/' + me.maxMana + '</span></div><div class="bar"><i style="width:' + (100 * me.hp / me.maxHp) + '%"></i></div></div>';
    if (ui.sent || me.move) return h + '<div class="card ok">✅ Хід зроблено. Чекаємо інших…</div>' + '<div class="muted small">' + moveSummary(me.move || m) + '</div>';
    if (me.hint) h += '<div class="card hint"><div><b>💡 Порада:</b> ' + esc(me.hint.text) + '</div><button class="btn-green btn-block" id="hint-go">⚡ Зробити так</button></div>';
    h += '<h3>⚔️ Удар (одна зона)</h3><div class="zones">' + content.zones.map(function (z) { return '<button data-att="' + z + '" class="' + (m.attack === z ? 'sel' : '') + '">' + esc(content.zoneNames[z]) + '</button>'; }).join('') + '</div>';
    h += '<h3>🛡 Блок (дві зони)</h3><div class="zones">' + content.zones.map(function (z) { return '<button data-blk="' + z + '" class="' + (m.blocks.indexOf(z) >= 0 ? 'selb' : '') + '">' + esc(content.zoneNames[z]) + '</button>'; }).join('') + '</div>';
    var spent = m.cards.reduce(function (s, id) { return s + cardOf(id).cost; }, 0);
    h += '<h3>🃏 Карти (мана ' + (me.mana - spent) + ', до 3 за хід)</h3><div class="hand">' + me.hand.map(function (c, i) { var key = c.id + '#' + i; var sel = m.cards.indexOf(key) >= 0; var can = sel || (c.cost <= me.mana - spent && m.cards.length < 3); return '<div class="hcard ' + (sel ? 'sel' : '') + (can ? '' : ' off') + '" data-card="' + key + '"><div class="cost">' + c.cost + '</div><div class="ico">' + (c.image ? '<img src="' + esc(c.image) + '" alt="">' : esc(c.icon)) + '</div><div class="nm r-' + c.rarity + '">' + esc(c.name) + '</div><div class="muted">' + esc(c.text) + '</div></div>'; }).join('') + '</div>';
    if (me.quiz) h += '<div class="card quiz"><h3>🧠 Розумна карта: ' + (me.quiz.kind === 'english' ? 'англійська' : 'математика') + '</h3><div class="big">' + esc(me.quiz.q) + '</div><div class="row">' + me.quiz.choices.map(function (c) { return '<button class="btn-sm grow ' + (String(m.quiz) === String(c) ? 'btn-blue' : '') + '" data-quiz="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div><div class="small muted">Правильна відповідь: удар у півтора раза сильніший. Можна пропустити.</div></div>';
    var ok = m.attack && m.blocks.length === 2;
    h += '<button class="btn-primary btn-block" id="go" ' + (ok ? '' : 'disabled') + '>' + (ok ? '⚡ Зробити хід' : 'Обери удар і 2 блоки') + '</button>';
    return h;
  }
  function myTeam() { var f = state.battle.fighters.filter(function (x) { return x.id === state.me.id; })[0]; return f ? f.team : 0; }
  function cardOf(key) { var id = key.split('#')[0]; return content.cards.filter(function (c) { return c.id === id; })[0] || { cost: 0 }; }
  function fighterRow(f, sel, clickable) {
    return '<div class="fighter ' + (sel ? 'sel' : '') + (f.alive ? '' : ' dead') + '" ' + (clickable && f.alive ? 'data-target="' + f.id + '"' : '') + '>' + avatarHtml(f) + '<div class="grow"><div class="small"><b>' + esc(f.name) + '</b>' + (f.kind === 'boss' ? ' 👑' : '') + (f.raged ? ' 😡' : '') + (f.poison ? ' ☠️' : '') + (f.stunned ? ' 💫' : '') + (f.shield ? ' 🛡' + f.shield : '') + (f.minions.length ? ' ' + f.minions.map(function (x) { return x.icon; }).join('') : '') + (f.ready && f.kind === 'player' ? ' ✅' : '') + '</div><div class="bar ' + (f.team !== myTeam() ? 'red' : '') + '"><i style="width:' + (100 * f.hp / f.maxHp) + '%"></i></div></div><div class="small">' + f.hp + '</div></div>';
  }
  function moveSummary(mv) { if (!mv) return ''; return 'Удар: ' + content.zoneNames[mv.attack] + ' · блок: ' + mv.blocks.map(function (z) { return content.zoneNames[z]; }).join(', ') + (mv.cards && mv.cards.length ? ' · карти: ' + mv.cards.map(function (id) { return cardOf(id).name; }).join(', ') : ''); }
  function describeEvent(e) {
    var who = esc(e.whoName || ''), by = esc(e.byName || '');
    switch (e.t) {
      case 'card': return '🃏 ' + by.replace(by, esc(e.whoName)) + ': ' + esc(e.icon) + ' ' + esc(e.name);
      case 'block': return '🛡 ' + who + ' заблокував удар ' + by + ' (' + esc(e.zoneName) + ')';
      case 'dodge': return '💨 ' + who + ' ухилився від ' + by;
      case 'dmg': return (e.crit ? '💥 КРИТ! ' : '⚔️ ') + by + ' → ' + who + ': −' + e.v + (e.zoneName ? ' (' + esc(e.zoneName) + ')' : '') + (e.kind === 'poison' ? ' ☠️' : '') + (e.minion ? ' (' + esc(e.minion) + ')' : '');
      case 'heal': return '💚 ' + who + ' +' + e.v;
      case 'death': return '💀 ' + who + ' повалено!';
      case 'rage': return '😡 ' + who + ' ЛЮТУЄ!';
      case 'summon': return '✨ ' + who + ' кличе: ' + esc(e.icon) + ' ' + esc(e.name);
      case 'stun': return '💫 ' + who + ' оглушений';
      case 'skip': return '💫 ' + who + ' пропускає удар';
      case 'shield': return '🛡 ' + who + ' щит +' + e.v;
      case 'reinforce': return '🧟 ' + (e.dm ? 'Ведучий кличе' : who + ' кличе підмогу') + ': ' + esc((e.names || []).join(', '));
      case 'smart': return '🧠 ' + who + ' розв’язав розумну карту: удар ×1.5';
      case 'end': return e.winner === myTeam() ? '🏆 ПЕРЕМОГА!' : '💀 Поразка…';
      default: return null;
    }
  }

  // ---------- герой ----------
  function renderHero() {
    var me = state.me, h = head();
    h += '<div class="row wrap" style="margin:8px 0">' + ['gear', 'bag', 'shop', 'pets', 'ach', 'avatar'].map(function (v) { return '<button class="btn-sm ' + (ui.heroView === v ? 'btn-blue' : '') + '" data-hv="' + v + '">' + { gear: '🛡 Спорядження', bag: '🎒 Сумка (' + me.inventory.length + ')', shop: '🏪 Магазин', ach: '🏆 Досягнення', pets: '🐾 Вихованці' + (me.pets && me.pets.length ? ' (' + me.pets.length + ')' : ''), avatar: '🎨 Аватар' }[v] + '</button>'; }).join('') + '</div>';
    if (ui.heroView === 'gear') {
      h += '<div class="slots">' + Object.keys(content.slots).map(function (s) { var it = me.equipment[s]; return '<div class="slot" ' + (it ? 'data-unequip="' + s + '"' : '') + '><div class="muted small">' + esc(content.slots[s].name) + '</div>' + (it ? '<div class="r-' + it.rarity + '"><b>' + esc(it.name) + '</b></div><div class="small">' + statLine(it.stats) + '</div><div class="small muted">тисни, щоб зняти</div>' : '<div class="muted">порожньо</div>') + '</div>'; }).join('') + '</div>';
      h += '<div class="card small">Бонуси: ' + (statLine(me.bonus) || 'немає') + '</div>';
      h += '<div class="card small"><span class="stat">⚔️ вбито ' + me.stats.kills + '</span><span class="stat">👑 босів ' + me.stats.bossKills + '</span><span class="stat">🏰 підземель ' + me.stats.dungeons + '</span><span class="stat">🥊 дуелей ' + me.stats.duelWins + '/' + me.stats.duels + '</span><span class="stat">💥 критів ' + me.stats.crits + '</span><span class="stat">🛡 блоків ' + me.stats.blocks + '</span><span class="stat">🟠 легендарок ' + me.stats.legendaries + '</span><span class="stat">✅ справ ' + me.stats.quests + '</span></div>';
    } else if (ui.heroView === 'bag') {
      h += '<div class="row"><button class="btn-sm ' + (ui.craft ? 'btn-blue' : '') + '" id="craftmode">🔧 Крафт: 3 однакові → 1 краще</button></div>';
      if (ui.craft) h += '<div class="small muted">Обери 3 предмети однієї рідкості (' + ui.craftSel.length + '/3)</div>' + (ui.craftSel.length === 3 ? '<button class="btn-green btn-block" id="craft">🔨 Скрафтити</button>' : '');
      h += me.inventory.length ? me.inventory.slice().sort(function (a, b) { return rarIdx(b.rarity) - rarIdx(a.rarity); }).map(function (it) { return itemHtml(it, { sel: ui.craftSel.indexOf(it.id) >= 0, btns: ui.craft ? '' : '<button class="btn-sm btn-green" data-equip="' + it.id + '">Вдягти</button><button class="btn-sm" data-sell="' + it.id + '">🪙</button>' }); }).join('') : '<div class="muted">Порожньо. Лут падає в підземеллях і з квестів.</div>';
    } else if (ui.heroView === 'shop') {
      h += '<div class="card"><b>📦 Проста скриня</b> · 40 🪙<div class="small muted">Незвичайний предмет або краще</div><button class="btn-sm btn-primary" data-chest="common" ' + (me.gold < 40 ? 'disabled' : '') + '>Купити</button></div>' +
        '<div class="card"><b>💎 Рідкісна скриня</b> · 150 🪙<div class="small muted">Рідкісний предмет або краще, шанс на легендарку</div><button class="btn-sm btn-primary" data-chest="rare" ' + (me.gold < 150 ? 'disabled' : '') + '>Купити</button></div>';
      if (ui.lastChest) h += '<div class="card ok"><div>Відкрито:</div>' + itemHtml(ui.lastChest) + '</div>';
    } else if (ui.heroView === 'pets') {
      var pets = me.pets || [];
      if (!pets.length) h += '<div class="card"><div class="muted">Вихованців ще немає. Вони випадають із пройдених підземель (шанс ~35 %). Повторний той самий — досвід і рівень вихованця.</div></div>';
      else h += pets.map(function (pt) { var bon = Object.keys(pt.bonus).map(function (k) { return { atk: '⚔️ +', def: '🛡 +', hp: '❤️ +', mana: '💧 +', crit: '💥 крит +' }[k] + (k === 'crit' ? Math.round(pt.bonus[k] * 100) + ' %' : pt.bonus[k]); }).join(' · ');
        return '<div class="card pet b-' + pt.rarity + (pt.active ? ' sel' : '') + '"><div class="row"><span class="pico">' + esc(pt.icon) + '</span><div class="grow"><b>' + esc(pt.name) + '</b> <span class="small r-' + pt.rarity + '">' + RAR[pt.rarity] + '</span><div class="small">' + pt.level + ' рів. · ' + pt.xp + '/' + pt.xpNext + ' · ' + bon + '</div><div class="small muted">' + esc(pt.text) + '</div></div>' +
          (pt.active ? '<button class="btn-sm btn-blue" data-pet="">З тобою</button>' : '<button class="btn-sm" data-pet="' + esc(pt.id) + '">Взяти</button>') + '</div></div>'; }).join('') + '<div class="small muted">Бонус росте з рівнем вихованця: +25 % за рівень. У бою з тобою лише один.</div>';
    } else if (ui.heroView === 'ach') {
      h += '<div>' + content.achievements.map(function (a) { var got = me.achievements.indexOf(a.id) >= 0; return '<span class="ach ' + (got ? '' : 'off') + '">' + esc(a.icon) + ' ' + esc(a.name) + '</span>'; }).join('') + '</div><div class="small muted" style="margin-top:8px">Титул біля імені дає перше досягнення.</div>';
      if (state.family) { var fm = state.family; h += '<div class="card"><h3>👨‍👩‍👦 Сімейні досягнення</h3><div class="small muted">Разом: ⚔️ ' + fm.sums.kills + ' · 🏰 ' + fm.sums.dungeons + ' · ✅ ' + fm.sums.quests + ' · 🧠 ' + fm.sums.smart + ' · 🗿 ' + fm.sums.raids + '</div>' + fm.achievements.map(function (a) { return '<span class="ach ' + (a.got ? '' : 'off') + '">' + esc(a.icon) + ' ' + esc(a.name) + '</span>'; }).join('') + '</div>'; }
    } else if (ui.heroView === 'avatar') {
      h += '<div class="center" style="min-height:auto">' + avatarHtml(me, 'lg') + '</div>';
      if (ui.avatarCands) h += '<div class="card"><h3>Обери свого героя назавжди</h3><div class="grid3">' + ui.avatarCands.map(function (u) { return '<img src="' + esc(u) + '" data-pick="' + esc(u) + '" class="' + (ui.pick === u ? 'sel' : '') + '">'; }).join('') + '</div><button class="btn-primary btn-block" id="pickav" ' + (ui.pick ? '' : 'disabled') + '>Це я!</button></div>';
      else if (me.avatarPending && me.avatarPending.length) { ui.avatarCands = me.avatarPending.map(function (n) { return '/avatars/' + n; }); return renderHero(); }
      else h += '<div class="card"><h3>' + (me.avatar ? 'Аватар уже є назавжди' : 'Створити аватар') + '</h3><div class="small muted">Намалюй героя на папері й сфотографуй, або опиши словами. ШІ зробить 3 варіанти, обираєш один раз назавжди.' + (me.avatar ? ' Новий лише з PIN батьків.' : '') + '</div>' +
        '<textarea id="av-desc" rows="2" placeholder="Опис: лицар у синіх обладунках із котом…"></textarea><input type="file" id="av-file" accept="image/*" class="file">' + (me.avatar ? '<input id="av-ppin" type="tel" inputmode="numeric" maxlength="4" placeholder="PIN батьків">' : '') + '<button class="btn-primary btn-block" id="genav">🎨 Згенерувати</button></div>';
    }
    return h;
  }
  function rarIdx(r) { return ['common', 'uncommon', 'rare', 'epic', 'legendary'].indexOf(r); }

  // ---------- колода ----------
  function renderDeck() {
    var me = state.me;
    if (!ui.deck) ui.deck = me.deck.slice();
    if (!ui.allowed) { api('/me/cards').then(function (r) { ui.allowed = r.cards; render(); }); return head() + '<div class="muted">Завантажую карти…</div>'; }
    var count = {}; ui.deck.forEach(function (id) { count[id] = (count[id] || 0) + 1; });
    var h = head() + '<div class="row"><b>Колода: ' + ui.deck.length + '/20</b><button class="btn-sm btn-primary right" id="savedeck" ' + (ui.deck.length === 20 ? '' : 'disabled') + '>Зберегти</button><button class="btn-sm" id="resetdeck">Скинути</button></div><div class="small muted">Тисни на карту: + в колоду, до 2 однакових. Рідкісні карти відкриваються з босів.</div>';
    h += '<div class="deckgrid">' + ui.allowed.map(function (c) { var n = count[c.id] || 0; return '<div class="dcard ' + (n ? 'in' : '') + '" data-dc="' + c.id + '"><div>' + (c.image ? '<img class="cimg" src="' + esc(c.image) + '" alt="">' : esc(c.icon)) + ' <b class="r-' + c.rarity + '">' + esc(c.name) + '</b> <span class="muted">(' + c.cost + ')</span></div><div class="muted">' + esc(c.text) + '</div><div>' + (n ? '✅ ×' + n : '') + '</div></div>'; }).join('') + '</div>';
    h += customCardsHtml();
    return h;
  }
  function customCardsHtml() {
    var me = state.me, mine = state.customCards || [], t = state.cardTemplates || {};
    var h = '<div class="card"><h3>🖍️ Свої карти (' + mine.length + '/3)</h3><div class="small muted">Намалюй карту на папері, сфотографуй, дай назву й обери, що вона робить. Батьки підтвердять, і карта з’явиться в колоді (рідкісна, до 2 у колоді).</div>';
    h += mine.map(function (c) { return '<div class="row small" style="padding:4px 0">' + (c.image ? '<img class="cimg" src="' + esc(c.image) + '" alt="">' : '<span>🖍️</span>') + '<div class="grow"><b>' + esc(c.name) + '</b> <span class="muted">(' + c.cost + ') ' + esc(c.text) + '</span></div><span>' + (c.approved ? '✅' : '⏳') + '</span></div>'; }).join('');
    if (mine.length < 3) h += '<input id="cc-name" placeholder="Назва карти" maxlength="24"><select id="cc-tpl">' + Object.keys(t).map(function (k) { return '<option value="' + k + '">' + esc(t[k].name) + ': ' + esc(t[k].text) + ' (мана ' + t[k].cost + ')</option>'; }).join('') + '</select><input type="file" id="cc-file" accept="image/*" class="file"><button class="btn-primary btn-block" id="cc-go">🖍️ Створити карту</button>';
    return h + '</div>';
  }

  // ---------- квести ----------
  function renderQuests() {
    var me = state.me, h = head();
    if (me.isParent && state.pendingQuests.length) h += '<div class="card warn"><h3>Чекають підтвердження</h3>' + state.pendingQuests.map(function (q) { return '<div class="q"><span class="ic">' + esc(q.quest.icon) + '</span><div class="grow"><b>' + esc(q.name) + '</b>: ' + esc(q.quest.name) + '</div><button class="btn-sm btn-green" data-approve="' + q.pid + '|' + q.quest.id + '">✅</button><button class="btn-sm" data-reject="' + q.pid + '|' + q.quest.id + '">✕</button></div>'; }).join('') + '</div>';
    if (me.isParent && state.pendingCards && state.pendingCards.length) h += '<div class="card warn"><h3>🖍️ Нові карти дітей</h3>' + state.pendingCards.map(function (c) { return '<div class="q">' + (c.image ? '<img class="cimg" src="' + esc(c.image) + '" alt="">' : '<span class="ic">🖍️</span>') + '<div class="grow"><b>' + esc(c.author) + '</b>: «' + esc(c.name) + '» <span class="small muted">' + esc(c.text) + '</span></div><button class="btn-sm btn-green" data-cardok="' + c.id + '">✅</button><button class="btn-sm" data-cardno="' + c.id + '">✕</button></div>'; }).join('') + '</div>';
    if (state.daily && state.daily.length) h += '<div class="card"><h3>📅 Завдання дня</h3>' + state.daily.map(function (t) { return '<div class="q ' + (t.done ? 'done' : '') + '"><span class="ic">' + esc(t.icon) + '</span><div class="grow"><b>' + esc(t.name) + '</b><div class="small muted">' + (t.done ? 'виконано' : t.progress + ' з ' + t.n) + ' · +' + t.gold + ' 🪙, +' + t.xp + ' досвіду</div><div class="bar xp"><i style="width:' + Math.round(100 * Math.min(1, t.progress / t.n)) + '%"></i></div></div><span>' + (t.done ? '✅' : '') + '</span></div>'; }).join('') + '</div>';
    h += '<h3>Справи на сьогодні</h3><div class="small muted">Зробив, тисни «Зробив». Батьки підтвердять, і впаде скриня + 10 хвилин гри.</div>';
    h += state.quests.map(function (q) { return '<div class="q ' + (q.state === 'approved' ? 'done' : '') + '"><span class="ic">' + esc(q.icon) + '</span><div class="grow"><b>' + esc(q.name) + '</b><div class="small muted">+' + q.gold + ' 🪙, +' + q.xp + ' досвіду, скриня: ' + esc(RAR[q.chest]) + '</div></div>' + (q.state === 'open' ? '<button class="btn-sm btn-primary" data-done="' + q.id + '">Зробив</button>' : q.state === 'pending' ? '<span class="small">⏳ чекає</span>' : '<span>✅</span>') + '</div>'; }).join('');
    return h;
  }

  // ---------- батьки ----------
  function renderDm() {
    var dm = state.dm;
    return '<div class="card" style="border-color:#f1c40f"><h3>🎩 Ведучий</h3><div class="small muted">Втручайся в бій, поки діти не бачать. Усе показується на ТБ.</div>' +
      '<div class="row"><select id="dm-mob" class="grow">' + dm.mobs.map(function (m) { return '<option value="' + m.id + '">' + esc(m.icon) + ' ' + esc(m.name) + ' (' + m.level + ')</option>'; }).join('') + '</select><button class="btn-sm btn-red" data-dm="spawn">🧟 Підмога</button></div>' +
      '<div class="row"><button class="btn-sm btn-green grow" data-dm="heal">💚 Зцілити +25</button><button class="btn-sm btn-red grow" data-dm="rage">😡 Лють боса</button></div>' +
      '<div class="row"><select id="dm-player" class="grow">' + dm.players.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('') + '</select><button class="btn-sm btn-primary" data-dm="treasure">🎁 Скарб</button></div>' +
      '<div class="row"><input id="dm-text" class="grow" placeholder="Слово ведучого на ТБ…" maxlength="120"><button class="btn-sm" data-dm="say">📣</button></div></div>';
  }
  function reportHtml(r) {
    if (!r.players.length) return '<div class="muted">Дітей ще немає.</div>';
    var h = '<div class="small muted">' + esc(r.from) + ' — ' + esc(r.to) + '</div>';
    r.players.forEach(function (p) {
      var max = Math.max(r.limitWeekend, r.limitWeekday, 1); p.byDay.forEach(function (d) { if (d.minutes > max) max = d.minutes; });
      h += '<div class="rep"><b>' + esc(p.name) + '</b> <span class="small muted">' + p.level + ' рів. · ' + p.minutes + ' хв · боїв ' + p.battles + ' (перемог ' + p.wins + ') · справ ' + p.quests + ' · розумних ' + p.smart + '</span><div class="days">' +
        p.byDay.map(function (d, i) { var lim = (i >= 5 ? r.limitWeekend : r.limitWeekday); return '<div class="day"><div class="col"><i style="height:' + Math.round(100 * d.minutes / max) + '%" class="' + (d.minutes > lim ? 'over' : '') + '"></i></div><div class="small">' + r.dayNames[i] + '</div><div class="small muted">' + (d.minutes || '') + '</div></div>'; }).join('') + '</div></div>';
    });
    return h + '<div class="small muted">Стовпчик вище ліміту дня — червоний.</div>';
  }
  function renderAdmin() {
    var h = head() + (state.dm ? renderDm() : (state.me.isParent ? '<div class="card"><div class="row"><input id="dm-text" class="grow" placeholder="Оголошення на ТБ…" maxlength="120"><button class="btn-sm" data-dm="say">📣</button></div></div>' : '')) + '<div class="card"><h3>Пауза гри</h3><button class="btn-block ' + (state.paused ? 'btn-green' : 'btn-red') + '" id="pause">' + (state.paused ? '▶️ Зняти паузу' : '⏸ Поставити на паузу (тривога)') + '</button></div>';
    h += '<div class="card"><h3>На ТБ</h3><button class="btn-block" id="replay" ' + (state.hasReplay && !state.battle ? '' : 'disabled') + '>📼 Повтор останнього бою на ТБ</button></div>';
    h += '<div class="card"><h3>Сезон</h3><div class="small muted">Зараз: ' + esc(state.season.name) + '. Закриття: лідер стає чемпіоном сезону (титул, +100 🪙), очки обнуляються.</div><input id="season-name" placeholder="Назва нового сезону (необов’язково)"><button class="btn-block btn-red" id="season-end">🏁 Закрити сезон</button></div>';
    h += '<div class="card"><h3>📊 Звіт тижня</h3>' + (ui.report ? reportHtml(ui.report) : '<div class="small muted">Хвилини, бої, справи й розумні відповіді кожної дитини по днях.</div>') + '<div class="row" style="margin-top:8px"><button class="btn-sm" data-report="0">Цей тиждень</button><button class="btn-sm" data-report="1">Минулий</button></div></div>';
    h += '<div class="card"><h3>Новий гравець</h3>' + playerForm('Додати', true) + '</div>';
    h += '<div class="card"><h3>Гравці</h3>' + (ui.players || []).map(function (p) { return '<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)">' + avatarHtml(p) + '<div class="grow"><b>' + esc(p.name) + '</b><div class="small muted">' + esc(p.className) + ' · ' + p.level + ' рів. · ' + (p.role === 'kid' ? 'дитина' : 'батьки') + (p.age ? ' · ' + p.age + ' р.' : '') + '</div></div><button class="btn-sm" data-edit="' + p.id + '">✏️</button></div>'; }).join('') + '</div>';
    if (ui.editP) { var p = ui.editP; h += '<div class="card warn"><h3>' + esc(p.name) + '</h3><input id="e-name" value="' + esc(p.name) + '"><input id="e-age" type="number" value="' + (p.age || '') + '" placeholder="Вік"><select id="e-role"><option value="kid" ' + (p.role === 'kid' ? 'selected' : '') + '>Дитина</option><option value="parent" ' + (p.role !== 'kid' ? 'selected' : '') + '>Батьки</option></select><input id="e-pin" type="tel" maxlength="4" placeholder="Новий PIN (порожнє = без змін)"><div class="row"><button class="btn-sm btn-primary" id="e-save">Зберегти</button><button class="btn-sm" id="e-avreset">Скинути аватар</button><button class="btn-sm btn-red" id="e-del">Видалити</button><button class="btn-sm right" id="e-close">✕</button></div></div>'; }
    if (ui.settings) { var s = ui.settings; h += '<div class="card"><h3>Правила</h3><label class="small muted">Діти грають до</label><input id="s-bed" value="' + esc(s.bedtime) + '"><label class="small muted">і з</label><input id="s-wake" value="' + esc(s.wakeup) + '"><label class="small muted">Хвилин на день, будні</label><input id="s-wd" type="number" value="' + s.limitWeekday + '"><label class="small muted">Хвилин на день, вихідні</label><input id="s-we" type="number" value="' + s.limitWeekend + '"><label class="small muted">Секунд на хід</label><input id="s-round" type="number" value="' + s.roundSeconds + '"><label class="small muted">Назва сезону</label><input id="s-season" value="' + esc(s.season) + '"><label class="row small"><input type="checkbox" id="s-smart" ' + (s.smartCards ? 'checked' : '') + '> 🧠 Розумні карти в бою (математика, англійська)</label><label class="row small"><input type="checkbox" id="s-raid" ' + (s.raidAnyDay ? 'checked' : '') + '> 🗿 Рейд дозволено в будь-який день (не лише вихідні)</label><button class="btn-primary btn-block" id="s-save">Зберегти правила</button></div>'; }
    else api('/admin/settings').then(function (s) { ui.settings = s; render(); });
    if (!ui.players) api('/players').then(function (r) { ui.players = r.players; render(); });
    return h + prefsHtml() + '<button class="btn-block" id="logout">Вийти з акаунта</button>';
  }
  function prefsHtml() {
    return '<div class="card"><h3>Налаштування</h3><label class="row small"><input type="checkbox" id="simple" ' + (state.me.simple ? 'checked' : '') + '> 💡 Підказки на хід (простий режим)</label><label class="row small"><input type="checkbox" id="sound" ' + (ui.sound ? 'checked' : '') + '> 🔔 Звук на телефоні (таймер, раунд)</label></div>';
  }
  function renderMore() {
    return head() + prefsHtml() + '<div class="card"><h3>Змінити PIN</h3><input id="p-old" type="tel" maxlength="4" placeholder="Старий PIN"><input id="p-new" type="tel" maxlength="4" placeholder="Новий PIN"><button class="btn-sm btn-primary" id="p-save">Зберегти</button></div><div class="card small muted">Додати на головний екран: у браузері «Поділитись» → «На Початковий екран».</div><button class="btn-block" id="logout">Вийти з акаунта</button>';
  }

  // ---------- кнопки ----------
  function on(sel, fn) { app.querySelectorAll(sel).forEach(function (el) { el.onclick = function (ev) { fn(el, ev); }; }); }
  function bind() {
    on('#join', function () { act('/lobby/join').then(function () { ui.players = null; }); });
    on('#leave', function () { act('/lobby/leave'); });
    on('#ready', function () { act('/lobby/ready', { ready: true }); });
    on('#unready', function () { act('/lobby/ready', { ready: false }); });
    on('#team', function () { var mine = state.lobby.players.filter(function (p) { return p.id === state.me.id; })[0]; act('/lobby/team', { team: mine && mine.team ? 0 : 1 }); });
    on('[data-mode]', function (el) { act('/lobby/mode', { mode: el.dataset.mode }); });
    on('#camp-reset', function () { if (confirm('Почати кампанію з першого розділу?')) act('/admin/campaign/reset', {}, '📖 Кампанія з початку'); });
    var d = $('#dungeon'); if (d) d.onchange = function () { act('/lobby/mode', { dungeonId: d.value }); };
    on('[data-target]', function (el) { ui.move.target = el.dataset.target; render(); });
    on('[data-att]', function (el) { ui.move.attack = el.dataset.att; render(); });
    on('#hint-go', function () { var hh = state.battle.me.hint; ui.sent = true; render(); act('/battle/move', { target: hh.target, attack: hh.attack, blocks: hh.blocks, cards: hh.cards, quiz: ui.move.quiz }).catch(function () { ui.sent = false; render(); }); });
    on('#simple', function (el) { act('/me/simple', { on: el.checked }, el.checked ? 'Підказки увімкнено' : 'Підказки вимкнено'); });
    on('#sound', function (el) { ui.sound = el.checked; try { localStorage.setItem('arena.sound', el.checked ? '1' : '0'); } catch (e) { } if (el.checked) beep(660, 120); });
    on('[data-quiz]', function (el) { ui.move.quiz = el.dataset.quiz; render(); });
    on('[data-dm]', function (el) { var k = el.dataset.dm; var body = { kind: k }; if (k === 'spawn') body.mobId = $('#dm-mob').value; if (k === 'treasure') body.playerId = $('#dm-player').value; if (k === 'say') { body.text = $('#dm-text').value; } act('/dm', body, k === 'say' ? 'На ТБ' : 'Зроблено').then(function () { if (k === 'say') $('#dm-text').value = ''; }); });
    on('#replay-stop', function () { act('/admin/replay', { on: false }); });
    on('#replay', function () { act('/admin/replay', { on: true }, 'Повтор пішов на ТБ'); });
    on('#season-end', function () { if (confirm('Закрити сезон? Лідер стане чемпіоном, очки обнуляться.')) act('/admin/season/end', { name: $('#season-name').value }).then(function (r) { toast(r.season.winner ? '🥇 Чемпіон: ' + r.season.winner : 'Сезон закрито'); ui.settings = null; render(); }); });
    on('[data-blk]', function (el) { var z = el.dataset.blk, b = ui.move.blocks, i = b.indexOf(z); if (i >= 0) b.splice(i, 1); else { if (b.length >= 2) b.shift(); b.push(z); } render(); });
    on('[data-card]', function (el) { var k = el.dataset.card, c = ui.move.cards, i = c.indexOf(k); if (i >= 0) c.splice(i, 1); else if (!el.classList.contains('off')) c.push(k); render(); });
    on('#go', function () { var m = ui.move; ui.sent = true; render(); act('/battle/move', { target: m.target, attack: m.attack, blocks: m.blocks, cards: m.cards.map(function (k) { return k.split('#')[0]; }), quiz: m.quiz }).catch(function () { ui.sent = false; render(); }); });
    on('[data-report]', function (el) { api('/admin/report?back=' + el.dataset.report).then(function (r) { ui.report = r; render(); }).catch(function (e) { toast(e.message, 3000); }); });
    on('[data-hv]', function (el) { ui.heroView = el.dataset.hv; ui.lastChest = null; render(); });
    on('[data-pet]', function (el) { act('/me/pet', { petId: el.dataset.pet || null }).then(function () { toast(el.dataset.pet ? '🐾 Вихованець із тобою' : '🐾 Відпочиває'); }); });
    on('[data-unequip]', function (el) { act('/me/unequip', { slot: el.dataset.unequip }); });
    on('[data-equip]', function (el) { act('/me/equip', { itemId: el.dataset.equip }, 'Вдягнуто'); });
    on('[data-sell]', function (el) { if (confirm('Продати предмет за золото?')) act('/me/sell', { itemId: el.dataset.sell }).then(function (r) { toast('+' + r.gold + ' 🪙'); }); });
    on('#craftmode', function () { ui.craft = !ui.craft; ui.craftSel = []; render(); });
    on('.item[data-id]', function (el) { if (!ui.craft) return; var id = el.dataset.id, i = ui.craftSel.indexOf(id); if (i >= 0) ui.craftSel.splice(i, 1); else if (ui.craftSel.length < 3) ui.craftSel.push(id); render(); });
    on('#craft', function () { act('/me/craft', { itemIds: ui.craftSel }).then(function (r) { ui.craftSel = []; ui.craft = false; toast('🔨 ' + r.item.name + ' (' + RAR[r.item.rarity] + ')', 4000); }); });
    on('[data-chest]', function (el) { act('/me/chest', { kind: el.dataset.chest }).then(function (r) { ui.lastChest = r.item; render(); }); });
    on('[data-pick]', function (el) { ui.pick = el.dataset.pick; render(); });
    on('#pickav', function () { act('/me/avatar/pick', { name: ui.pick }, 'Аватар збережено назавжди!').then(function () { ui.avatarCands = null; ui.pick = null; }); });
    on('#genav', function (el) {
      var desc = $('#av-desc').value, f = $('#av-file').files[0], ppin = $('#av-ppin') ? $('#av-ppin').value : undefined;
      el.disabled = true; el.textContent = '⏳ Малюю (до хвилини)…';
      var go = function (image, mime) { act('/me/avatar', { description: desc, image: image, mime: mime, parentPin: ppin }).then(function (r) { if (r.fallback) toast('ШІ-художник не налаштований: дав блоковий аватар', 4000); else { ui.avatarCands = r.candidates; ui.pick = null; } render(); }).catch(function () { render(); }); };
      if (f) shrink(f, function (b64, mime) { go(b64, mime); }); else go(null, null);
    });
    on('[data-dc]', function (el) { var id = el.dataset.dc, n = ui.deck.filter(function (x) { return x === id; }).length; if (n >= 2) ui.deck = ui.deck.filter(function (x) { return x !== id; }); else if (ui.deck.length < 20) ui.deck.push(id); else toast('Уже 20 карт, прибери якусь'); render(); });
    on('#savedeck', function () { act('/me/deck', { deck: ui.deck }, 'Колоду збережено').catch(function () { }); });
    on('#resetdeck', function () { ui.deck = state.me.deck.slice(); render(); });
    on('[data-cardok]', function (el) { act('/admin/card/approve', { id: el.dataset.cardok, approve: true }, 'Карта в грі!'); });
    on('[data-cardno]', function (el) { act('/admin/card/approve', { id: el.dataset.cardno, approve: false }, 'Відхилено'); });
    on('#cc-go', function (el) {
      var name = $('#cc-name').value, tpl = $('#cc-tpl').value, f = $('#cc-file').files[0];
      el.disabled = true;
      var go = function (image, mime) { act('/me/card', { name: name, template: tpl, image: image, mime: mime }, state.me.isParent ? 'Карта в грі' : 'Надіслано батькам').then(function () { ui.allowed = null; render(); }).catch(function () { el.disabled = false; }); };
      if (f) shrink(f, function (b64, mime) { go(b64, mime); }, 512); else go(null, null);
    });
    on('[data-done]', function (el) { act('/quests/done', { questId: el.dataset.done }, 'Надіслано батькам'); });
    on('[data-approve]', function (el) { var a = el.dataset.approve.split('|'); act('/quests/approve', { playerId: a[0], questId: a[1] }).then(function (r) { toast('Зараховано: ' + r.reward.item.name, 3000); }); });
    on('[data-reject]', function (el) { var a = el.dataset.reject.split('|'); act('/quests/approve', { playerId: a[0], questId: a[1], approve: false }); });
    on('#pause', function () { act('/admin/pause', { on: !state.paused, reason: 'manual' }); });
    if ($('#f-go')) bindPlayerForm(function (dd) { return api('/admin/players/create', dd).then(function () { toast('Гравця додано'); ui.players = null; render(); }); });
    on('[data-edit]', function (el) { ui.editP = ui.players.filter(function (p) { return p.id === el.dataset.edit; })[0]; render(); });
    on('#e-close', function () { ui.editP = null; render(); });
    on('#e-save', function () { var p = ui.editP; act('/admin/players/update', { id: p.id, name: $('#e-name').value, age: $('#e-age').value, role: $('#e-role').value, pin: $('#e-pin').value || undefined }, 'Збережено').then(function () { ui.editP = null; ui.players = null; render(); }); });
    on('#e-avreset', function () { act('/admin/avatar/reset', { playerId: ui.editP.id }, 'Аватар скинуто'); });
    on('#e-del', function () { var pin = prompt('Видалити ' + ui.editP.name + ' назавжди? Введи свій PIN'); if (pin) act('/admin/players/delete', { id: ui.editP.id, pin: pin }, 'Видалено').then(function () { ui.editP = null; ui.players = null; render(); }); });
    on('#s-save', function () { act('/admin/settings', { bedtime: $('#s-bed').value, wakeup: $('#s-wake').value, limitWeekday: +$('#s-wd').value, limitWeekend: +$('#s-we').value, roundSeconds: +$('#s-round').value, season: $('#s-season').value, smartCards: $('#s-smart').checked, raidAnyDay: $('#s-raid').checked }, 'Правила збережено').then(function () { ui.settings = null; }); });
    on('#p-save', function () { act('/me/pin', { oldPin: $('#p-old').value, pin: $('#p-new').value }, 'PIN змінено, увійди знову').then(function () { setTimeout(logout, 800); }); });
    on('#logout', function () { api('/logout', {}).catch(function () { }); logout(); });
    clearInterval(ui.timerId);
    if (state.battle && state.battle.roundEnds) ui.timerId = setInterval(function () { var t = $('#timer'); if (!t) return; var left = Math.max(0, Math.round((state.battle.roundEnds - Date.now()) / 1000)); t.textContent = left; t.classList.toggle('low', left <= 10); if (left === 5 && !ui.sent) beep(990, 90); }, 500);
  }
  function shrink(file, cb, max) {
    var img = new Image(); var url = URL.createObjectURL(file);
    img.onload = function () { var s = Math.min(1, (max || 1024) / Math.max(img.width, img.height)); var c = document.createElement('canvas'); c.width = img.width * s; c.height = img.height * s; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); var d = c.toDataURL('image/jpeg', 0.85); URL.revokeObjectURL(url); cb(d.split(',')[1], 'image/jpeg'); };
    img.src = url;
  }
  boot();
})();
