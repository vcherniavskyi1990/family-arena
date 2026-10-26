/* ТБ-сцена Родинної арени. Chromium 79: без ?. і ??, без flex gap. Стан приходить з /api/events?tv=1. */
(function () {
  'use strict';
  var stage = document.getElementById('stage'), ticker = document.getElementById('ticker'), overlay = document.getElementById('overlay');
  var state = null, prev = null, es = null, shownRound = 0, queue = [], playing = false, roomShown = null, audio = null, timerId = null;
  var ZONE = { head: 'голова', chest: 'груди', belt: 'пояс', legs: 'ноги' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function av(p, cls) { return '<div class="' + (cls || 'av') + '">' + (p.avatar ? '<img src="' + esc(p.avatar) + '">' : esc(p.icon || '🙂')) + '</div>'; }
  function connect() {
    if (es) es.close();
    es = new EventSource('/api/events?tv=1');
    es.onmessage = function (e) { prev = state; state = JSON.parse(e.data); onState(); };
    es.onerror = function () { setTimeout(function () { if (!es || es.readyState === 2) connect(); }, 3000); };
  }
  // ---------- звук (тихі години з сервера) ----------
  function beep(freq, ms, type, vol) {
    if (!state || state.quiet) return;
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      var o = audio.createOscillator(), g = audio.createGain();
      o.type = type || 'square'; o.frequency.value = freq; g.gain.value = vol || 0.05;
      o.connect(g); g.connect(audio.destination); o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + ms / 1000); o.stop(audio.currentTime + ms / 1000);
    } catch (e) { }
  }
  function onState() {
    var phase = state.phase;
    if (!prev || prev.phase !== phase) { shownRound = 0; queue = []; roomShown = null; playing = false; stage.removeAttribute('data-next'); }
    if (phase === 'battle' || phase === 'replay') renderBattle(); else if (phase === 'lobby') renderLobby(); else if (phase === 'results') renderResults(); else renderIdle();
    if (state.paused) { overlay.className = 'on'; overlay.innerHTML = '<div class="banner pause"><div class="big">⏸ ПАУЗА</div><div class="sub">' + (state.pauseReason === 'alert' ? 'Тривога. Усі в укриття, бій зачекає.' : 'Батьки поставили гру на паузу') + '</div></div>'; }
    else if (phase !== 'results' && Date.now() > introUntil) overlay.className = '';
  }
  var introUntil = 0;
  // ---------- екран спокою: зал трофеїв + QR ----------
  function renderIdle() {
    var h = '<div class="hdr"><div class="t">⚔️ Родинна арена</div><div class="s">' + esc(state.season) + '</div><div class="r">Скануй QR телефоном,<br>щоб зайти в лобі</div></div>';
    h += '<div class="qr big"><img src="/qr.svg"><div>' + esc(location.host) + '</div></div>';
    h += '<div class="heroes">' + state.heroes.slice(0, 8).map(function (p) { return '<div class="hero">' + av(p) + '<div class="n">' + esc(p.name) + '</div><div class="c">' + esc(p.title || p.className) + ' · ' + p.level + ' рів.</div><div class="st">⚔️ ' + p.kills + ' · 🏰 ' + p.dungeons + ' · 🥊 ' + p.duelWins + ' · 🟠 ' + p.legendaries + '</div></div>'; }).join('') + '</div>';
    h += '<div class="feed"><div class="h">Хроніка</div>' + state.feed.slice(0, 6).map(function (f) { return '<div>' + esc(f.text) + '</div>'; }).join('') + '</div>';
    var top = (state.seasonTop || []).filter(function (p) { return p.points > 0; });
    if (top.length) h += '<div class="season"><div class="h">🏆 ' + esc(state.season) + '</div>' + top.slice(0, 5).map(function (p, i) { return '<div><span class="pl">' + ['🥇', '🥈', '🥉', '4', '5'][i] + '</span> ' + av(p, 'avs') + ' <b>' + esc(p.name) + '</b><span class="pts">' + p.points + '</span></div>'; }).join('') + ((state.pastSeasons || []).length ? '<div class="past">' + state.pastSeasons.map(function (ps) { return '🏅 сезон ' + ps.n + ': ' + esc(ps.winner || '—'); }).join(' · ') + '</div>' : '') + '</div>';
    h += '<div class="legend' + (top.length ? ' short' : '') + '"><div class="h">Зал легендарок</div>' + (state.legendaries.length ? state.legendaries.map(function (l) { return '<div>🟠 <b>' + esc(l.name) + '</b>: <span class="r-legendary">' + esc(l.item.name) + '</span></div>'; }).join('') : '<div style="color:#5c6f85">Ще ніхто не вибив легендарку…</div>') + (state.pendingQuests ? '<div style="margin-top:20px;color:#f1c40f">✅ Справ чекають підтвердження: ' + state.pendingQuests + '</div>' : '') + '</div>';
    stage.innerHTML = h; ticker.innerHTML = '';
  }
  // ---------- лобі ----------
  function renderLobby() {
    var l = state.lobby;
    var h = '<div class="hdr"><div class="t">Лобі</div><div class="s">' + esc(state.season) + '</div><div class="r">Скануй QR, щоб приєднатись</div></div>';
    h += '<div class="lobby"><div class="mode">' + (l.mode === 'duel' ? '⚔️ Дуель <span>· дві команди</span>' : l.dungeon.icon + ' ' + esc(l.dungeon.name) + ' <span>· рівень ' + l.dungeon.level + ' · ' + l.dungeon.rooms.length + ' кімнати + бос</span><div class="s" style="font-size:24px;color:#9fb0c3">' + esc(l.dungeon.text) + '</div>') + '</div>';
    h += l.players.map(function (p) { return '<div class="lp ' + (p.ready ? 'ready' : '') + '">' + (l.mode === 'duel' ? '<div class="team">' + (p.team ? '🔴' : '🔵') + '</div>' : '') + '<div class="rd">' + (p.ready ? '✅' : '⏳') + '</div>' + av(p) + '<div class="n">' + esc(p.name) + '</div><div class="c">' + esc(p.className) + ' · ' + p.level + ' рів.</div></div>'; }).join('');
    for (var i = l.players.length; i < 4; i++) h += '<div class="lp empty">вільне місце</div>';
    h += '</div><div class="hint">' + (l.players.every(function (p) { return p.ready; }) ? 'Починаємо!' : 'Натисніть «Готовий» на телефонах') + '</div><div class="qr small"><img src="/qr.svg"></div>';
    stage.innerHTML = h; ticker.innerHTML = '';
    if (!prev || prev.phase !== 'lobby' || prev.lobby.players.length < l.players.length) beep(660, 120, 'triangle');
  }
  // ---------- бій ----------
  function fighterHtml(f, right) {
    var hp = Math.max(0, Math.round(100 * f.hp / f.maxHp));
    return '<div class="f ' + (f.alive ? '' : 'dead') + (f.kind === 'boss' ? ' boss' : '') + (f.raged ? ' rage' : '') + '" id="f-' + cssId(f.id) + '">' + av(f) +
      '<div class="n">' + esc(f.name) + (f.kind === 'boss' ? ' 👑' : '') + '</div>' +
      '<div class="tags">' + (f.level ? f.level + ' рів. ' : '') + (f.shield ? '🛡' + f.shield + ' ' : '') + (f.poison ? '☠️ ' : '') + (f.stunned ? '💫 ' : '') + (f.buff > 0 ? '💪 ' : '') + (f.raged ? '😡 ЛЮТЬ ' : '') + (f.minions.length ? '<span class="minions">' + f.minions.map(function (m) { return m.icon; }).join('') + '</span>' : '') + (f.kind === 'player' && f.alive ? (f.ready ? ' ✅' : ' ⏳') : '') + '</div>' +
      '<div class="bar ' + (f.team ? 'red' : '') + '"><i style="width:' + hp + '%"></i><b>' + f.hp + ' / ' + f.maxHp + '</b></div>' + (f.maxMana ? '<div class="bar mana"><i style="width:' + Math.round(100 * f.mana / f.maxMana) + '%"></i></div>' : '') + '</div>';
  }
  function cssId(s) { return s.replace(/[^a-zA-Z0-9_-]/g, '_'); }
  function renderBattle() {
    var b = state.battle;
    var t0 = b.fighters.filter(function (f) { return f.team === 0; }), t1 = b.fighters.filter(function (f) { return f.team === 1; });
    var title = b.mode === 'duel' ? '⚔️ Дуель' : (b.meta.boss ? '👑 БОС' : '🏰 Кімната ' + b.meta.room + ' з ' + b.meta.rooms);
    var h = '<div class="hdr"><div class="t">' + (b.replay ? '📼 ПОВТОР · ' : '') + title + '</div><div class="s">' + esc(state.season) + '</div>' + (b.replay ? '<div class="r">Повтор останнього бою</div>' : '') + '</div>';
    h += '<div class="arena"><div class="team l">' + t0.map(function (f) { return fighterHtml(f, false); }).join('') + '</div>';
    h += '<div class="mid"><div class="round">раунд ' + (b.round + 1) + '</div><div class="timer" id="timer">' + (b.roundEnds ? Math.max(0, Math.round((b.roundEnds - Date.now()) / 1000)) : '…') + '</div><div class="vs">VS</div></div>';
    h += '<div class="team r">' + t1.map(function (f) { return fighterHtml(f, true); }).join('') + '</div></div>';
    if (!playing || !prev || prev.phase !== state.phase) { stage.innerHTML = h; } else { stage.setAttribute('data-next', h); }
    clearInterval(timerId);
    timerId = setInterval(function () { var t = document.getElementById('timer'); if (!t || !state.battle) return; if (!state.battle.roundEnds) { t.textContent = state.battle.replay ? '📼' : '…'; return; } var left = Math.max(0, Math.round((state.battle.roundEnds - Date.now()) / 1000)); t.textContent = left; t.className = 'timer' + (left <= 10 ? ' low' : ''); if (left === 5) beep(880, 80); }, 400);
    if (b.roomIntro && b.round === 0 && roomShown !== b.meta.room) {
      roomShown = b.meta.room;
      overlay.className = 'on'; introUntil = Date.now() + 2500;
      overlay.innerHTML = '<div class="room-intro"><div class="big">' + (b.roomIntro.boss ? '👑 БОС!' : 'Кімната ' + b.roomIntro.n) + '</div><div class="sub">' + esc(b.roomIntro.names.join(', ')) + '</div></div>';
      beep(b.roomIntro.boss ? 110 : 330, 500, 'sawtooth', 0.08);
      setTimeout(function () { if (!state.paused) overlay.className = ''; }, 2500);
    }
    if (b.lastRound && b.lastRound.n !== shownRound) { shownRound = b.lastRound.n; queue = b.lastRound.events.slice(); if (!playing) playNext(); }
  }
  function el(id) { return document.getElementById('f-' + cssId(id)); }
  function flash(id, cls) { var e = el(id); if (!e) return; e.classList.add(cls); setTimeout(function () { e.classList.remove(cls); }, 500); }
  function floatText(id, text, cls) {
    var e = el(id); if (!e) return;
    var r = e.getBoundingClientRect(), d = document.createElement('div');
    d.className = 'float ' + (cls || ''); d.textContent = text;
    d.style.left = (r.left + r.width / 2 - 40 + (Math.random() * 80 - 40)) + 'px'; d.style.top = (r.top + 20) + 'px';
    document.body.appendChild(d); setTimeout(function () { d.remove(); }, 1400);
  }
  function say(t) { ticker.innerHTML = '<div>' + t + '</div>'; }
  function setHp(id, hp) { var e = el(id); if (!e) return; var f = state.battle && state.battle.fighters.filter(function (x) { return x.id === id; })[0]; if (!f) return; var i = e.querySelector('.bar i'), b = e.querySelector('.bar b'); if (i) i.style.width = Math.max(0, Math.round(100 * hp / f.maxHp)) + '%'; if (b) b.textContent = hp + ' / ' + f.maxHp; }
  function playNext() {
    var e = queue.shift();
    if (!e) { playing = false; var next = stage.getAttribute('data-next'); if (next) { stage.innerHTML = next; stage.removeAttribute('data-next'); } if (state && state.phase !== 'battle' && state.phase !== 'replay') onState(); return; }
    playing = true;
    var wait = 450, who = esc(e.whoName), by = esc(e.byName);
    switch (e.t) {
      case 'round': say('<b>Раунд ' + e.n + '</b>: усі розкривають ходи!'); wait = 700; break;
      case 'smart': floatText(e.who, '🧠 ×1.5', 'heal'); say('🧠 <b>' + who + '</b> розв’язав розумну карту: удар у півтора раза сильніший!'); beep(900, 150, 'sine', 0.06); wait = 900; break;
      case 'card': showCard(e); say('🃏 ' + who + ' грає <b>' + esc(e.name) + '</b>'); beep(520, 120, 'triangle'); wait = 1100; break;
      case 'block': flash(e.who, 'blocked'); floatText(e.who, '🛡 БЛОК', 'block'); say('🛡 ' + who + ' заблокував удар ' + by + ' (' + ZONE[e.zone] + ')'); beep(300, 80); break;
      case 'dodge': floatText(e.who, 'повз!', 'miss'); say('💨 ' + who + ' ухилився від ' + by); break;
      case 'absorb': floatText(e.who, '🛡 −' + e.v, 'block'); wait = 250; break;
      case 'dmg': flash(e.who, 'hit'); floatText(e.who, '−' + e.v, e.crit ? 'crit' : ''); setHp(e.who, e.hp);
        say((e.crit ? '💥 <b>КРИТ!</b> ' : '⚔️ ') + by + ' → ' + who + ': <b>−' + e.v + '</b>' + (e.zone ? ' у ' + ZONE[e.zone] : '') + (e.kind === 'poison' ? ' (отрута)' : e.kind === 'minion' ? ' (' + esc(e.minion) + ')' : e.kind === 'explode' ? ' (вибух!)' : ''));
        beep(e.crit ? 180 : 240, e.crit ? 220 : 100, 'square', e.crit ? 0.09 : 0.05); if (e.crit) wait = 800; break;
      case 'heal': flash(e.who, 'healed'); floatText(e.who, '+' + e.v, 'heal'); say('💚 ' + who + ' +' + e.v + ' здоров’я'); beep(700, 150, 'sine'); break;
      case 'shield': floatText(e.who, '🛡 +' + e.v, 'block'); say('🛡 ' + who + ' ставить щит ' + e.v + (e.aoe ? ' усій команді' : '')); break;
      case 'poison': floatText(e.who, '☠️', 'miss'); say('☠️ ' + who + ' отруєний'); break;
      case 'stun': floatText(e.who, '💫', 'miss'); say('💫 ' + who + ' оглушений і пропустить удар'); break;
      case 'skip': say('💫 ' + who + ' не може вдарити'); break;
      case 'summon': say('✨ ' + who + ' кличе ' + esc(e.icon) + ' <b>' + esc(e.name) + '</b>'); beep(600, 200, 'triangle'); wait = 800; break;
      case 'rage': var r = el(e.who); if (r) r.classList.add('rage'); say('😡 <b>' + who + ' ЛЮТУЄ!</b> Удари в півтора раза сильніші'); beep(90, 700, 'sawtooth', 0.1); wait = 1500; break;
      case 'death': var d = el(e.who); if (d) d.classList.add('dead'); say('💀 <b>' + who + '</b> повалено' + (e.boss ? '! БОСА ПЕРЕМОЖЕНО!' : '')); beep(e.boss ? 60 : 150, e.boss ? 1200 : 400, 'sawtooth', 0.08); wait = e.boss ? 2000 : 1000; break;
      case 'end': say(e.winner === 0 ? '🏆 <b>ПЕРЕМОГА!</b>' : '💀 <b>Поразка…</b>'); wait = 1200; break;
      default: wait = 100;
    }
    setTimeout(playNext, wait);
  }
  function showCard(e) {
    var old = document.querySelector('.cardpop'); if (old) old.remove();
    var card = state.content && state.content[e.card];
    var d = document.createElement('div'); d.className = 'cardpop';
    d.innerHTML = '<div class="who">' + esc(e.whoName) + ' грає</div><div class="ic">' + esc(e.icon) + '</div><div class="nm">' + esc(e.name) + '</div>' + (card ? '<div class="tx">' + esc(card.text) + '</div>' : '');
    stage.appendChild(d); setTimeout(function () { d.remove(); }, 1000);
  }
  // ---------- підсумки ----------
  function renderResults() {
    var r = state.results;
    var win = r.mode === 'duel' || r.won;
    var h = '<div class="banner ' + (win ? '' : 'lose') + '"><div class="big">' + (r.mode === 'duel' ? '⚔️ Переміг: ' + esc(r.winners.join(', ')) : (r.won ? '🏆 «' + esc(r.dungeon) + '» пройдено!' : '💀 «' + esc(r.dungeon) + '» виявилось сильнішим')) + '</div>';
    if (r.mode === 'dungeon') h += '<div class="sub">Вбито ' + r.kills + ' · кожному +' + r.xp + ' досвіду, +' + r.gold + ' золота</div>';
    var loot = (r.loot || []).slice(0, 10);
    h += '<div class="cols">';
    if (loot.length) h += '<div class="loot">' + loot.map(function (l) { return '<div>🎁 <b>' + esc(l.name) + '</b>: ' + (l.item ? '<span class="r-' + l.item.rarity + '">' + esc(l.item.name) + '</span>' : '🃏 карта <span class="r-rare">' + esc(l.cardName) + '</span>') + '</div>'; }).join('') + '</div>';
    var ev = (r.events || []).slice(0, 10);
    if (ev.length) h += '<div class="loot">' + ev.map(function (e) { return e.t === 'levelup' ? '<div>⬆️ ' + esc(e.whoName) + ': рівень ' + e.level + '!</div>' : '<div>' + esc(e.icon) + ' ' + esc(e.whoName) + ': досягнення «' + esc(e.name) + '»</div>'; }).join('') + '</div>';
    h += '</div><div class="cnt">Скануй QR і заходь у лобі, щоб зіграти ще</div></div>';
    if (!prev || prev.phase !== 'results') { renderIdle(); beep(win ? 523 : 200, 200, 'triangle', 0.08); setTimeout(function () { beep(win ? 659 : 150, 200, 'triangle', 0.08); }, 220); setTimeout(function () { beep(win ? 784 : 100, 400, 'triangle', 0.08); }, 440); }
    overlay.innerHTML = h; overlay.className = 'on';
  }
  fetch('/api/content').then(function (r) { return r.json(); }).then(function (c) { var m = {}; c.cards.forEach(function (x) { m[x.id] = x; }); contentMap = m; }).catch(function () { });
  var contentMap = null;
  Object.defineProperty(window, '__arena', { get: function () { return { state: state, queue: queue, playing: playing }; } });
  var _onState = onState; onState = function () { if (state && contentMap) state.content = contentMap; _onState(); };
  connect();
})();
