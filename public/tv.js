/* ТБ-сцена Родинної арени. Chromium 79: без ?. і ??, без flex gap. Стан приходить з /api/events?tv=1. */
(function () {
  'use strict';
  var stage = document.getElementById('stage'), ticker = document.getElementById('ticker'), overlay = document.getElementById('overlay');
  var state = null, prev = null, es = null, shownRound = 0, queue = [], playing = false, roomShown = null, audio = null, timerId = null;
  var ZONE = { head: 'голова', chest: 'груди', belt: 'пояс', legs: 'ноги' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function av(p, cls) { return '<div class="' + (cls || 'av') + (p.frame ? ' fr-' + p.frame : '') + '">' + (p.avatar ? '<img src="' + esc(p.avatar) + '">' : esc(p.icon || '🙂')) + (p.pet ? '<span class="pet">' + esc(p.pet) + '</span>' : '') + '</div>'; }
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
    if (state.announce && (!prev || !prev.announce || prev.announce.at !== state.announce.at)) showAnnounce(state.announce);
    var cl = document.getElementById('closing'); if (state.closing) { if (!cl) { cl = document.createElement('div'); cl.id = 'closing'; document.body.appendChild(cl); } cl.textContent = state.closing.text; } else if (cl) cl.remove();
    if (state.ceremony && (!prev || !prev.ceremony || prev.ceremony.at !== state.ceremony.at)) showCeremony(state.ceremony);
    if (state.mini) { showMini(state.mini, prev && prev.mini); if (state.party && state.party.phase === 'run') { var bn = overlay.querySelector('.banner'); if (bn) bn.insertAdjacentHTML('afterbegin', '<div class="partyline">🎉 Вечір ігор · гра ' + Math.min(state.party.i + 1, state.party.of) + '/' + state.party.of + (state.party.standings.length ? ' · ' + state.party.standings.map(function (s) { return esc(s.name) + ' ' + s.points; }).join(' · ') : '') + '</div>'); } }
    else if (state.party && state.party.phase === 'done' && (!prev || !prev.party || prev.party.phase !== 'done')) showParty(state.party);
    if (state.paused) { overlay.className = 'on'; overlay.innerHTML = '<div class="banner pause"><div class="big">⏸ ПАУЗА</div><div class="sub">' + (state.pauseReason === 'alert' ? 'Тривога. Усі в укриття, бій зачекає.' : 'Батьки поставили гру на паузу') + '</div></div>'; }
    else if (phase !== 'results' && !state.mini && !(state.party && state.party.phase === 'done') && Date.now() > introUntil) overlay.className = '';
  }
  var introUntil = 0;
  function showAnnounce(a) {
    var old = document.querySelector('.announce'); if (old) old.remove();
    var d = document.createElement('div'); d.className = 'announce'; d.innerHTML = '<div class="who">🎩 ' + esc(a.by) + '</div><div class="tx">' + esc(a.text) + '</div>';
    document.body.appendChild(d); beep(440, 200, 'triangle', 0.07); setTimeout(function () { d.remove(); }, 5000);
  }
  // ---------- екран спокою: зал трофеїв + QR ----------
  function renderIdle() {
    var h = '<div class="hdr"><div class="t">⚔️ Родинна арена</div><div class="s">' + esc(state.season) + '</div><div class="r">Скануй QR телефоном,<br>щоб зайти в лобі</div></div>';
    h += '<div class="qr big"><img src="/qr.svg"><div>' + esc(location.host) + '</div></div>';
    var evn = state.event || {}; if (evn.today) h += '<div class="evline">' + esc(evn.today.icon) + ' <b>' + esc(evn.today.name) + '</b> · ' + esc(evn.today.text) + '</div>'; else if (evn.tomorrow) h += '<div class="evline soon">' + esc(evn.tomorrow.icon) + ' Завтра: <b>' + esc(evn.tomorrow.name) + '</b> · ' + esc(evn.tomorrow.text) + '</div>';
    if (state.campaign) h += '<div class="campline">📖 Розділ ' + state.campaign.n + '/' + state.campaign.of + ': ' + esc(state.campaign.title) + (state.campaign.runs ? ' · ' + state.campaign.runs + '-й раз' : '') + '</div>';
    var fg = state.familyGoal; if (fg) h += '<div class="fgoal' + (fg.done ? ' ok' : '') + '"><span class="n">🎯 Ціль сім’ї: ' + fg.n + ' ' + esc(fg.kindName) + ' → ' + esc(fg.reward) + '</span>' + (fg.done ? '<span class="dead">ДОСЯГНУТО 🎉</span>' : '<div class="bar"><i style="width:' + fg.pct + '%"></i><b>' + esc(fg.icon) + ' ' + fg.progress + ' / ' + fg.n + ' · ' + fg.daysLeft + ' дн.</b></div>') + '</div>';
    var w = state.worldBoss; if (w) h += '<div class="wboss' + (fg ? ' narrow' : '') + '"><span class="n">' + esc(w.icon) + ' Бос тижня: ' + esc(w.name) + '</span>' + (w.killed ? '<span class="dead">ПОВАЛЕНИЙ · новий у понеділок</span>' : '<div class="bar"><i style="width:' + w.pct + '%"></i><b>' + w.hp + ' / ' + w.maxHp + ' · ' + w.daysLeft + ' дн.</b></div>') + '</div>';
    h += '<div class="heroes">' + state.heroes.slice(0, 8).map(function (p) { return '<div class="hero click" data-hero="' + esc(p.id) + '">' + av(p) + '<div class="n">' + esc(p.name) + '</div><div class="c">' + esc(p.title || p.className) + ' · ' + p.level + ' рів.</div><div class="st">⚔️ ' + p.kills + ' · 🏰 ' + p.dungeons + ' · 🥊 ' + p.duelWins + ' · 🟠 ' + p.legendaries + '</div>' + (p.streak >= 2 ? '<div class="flame">🔥 ' + p.streak + ' дн.</div>' : '') + '</div>'; }).join('') + '</div>';
    var en = state.envelopes; if (en) h += '<div class="envline">' + en.list.map(function (x) { return '<span class="' + (x.opened ? 'op' : 'cl') + '">' + esc(x.icon) + (x.opened ? ' ' + esc(x.name) : ' ' + x.at) + '</span>'; }).join('') + (en.next ? '<b>' + en.progress + ' / ' + en.next.at + ' · ще ' + en.next.left + '</b>' : '<b>усі відкрито</b>') + '</div>';
    if (state.family) { var fa = state.family.achievements.filter(function (a) { return a.got; }); h += '<div class="family">' + (fa.length ? fa.map(function (a) { return '<span>' + esc(a.icon) + ' ' + esc(a.name) + '</span>'; }).join('') : '<span style="color:#5c6f85">👨‍👩‍👦 Сімейні досягнення: разом ⚔️ ' + state.family.sums.kills + ' ворогів, 🏰 ' + state.family.sums.dungeons + ' підземель</span>') + '</div>'; }
    var td = state.today; if (td) h += '<div class="today"><div class="h">Сьогодні зроблено</div>' + td.kids.map(function (k) { return '<span><b>' + esc(k.name) + '</b> ' + (k.battles ? '⚔️ ' + k.battles + (k.wins ? ' · 🏆 ' + k.wins : '') + ' ' : '') + (k.smart ? '🧠 ' + k.smart + ' ' : '') + k.quests.map(function (q) { return esc(q.icon); }).join('') + (k.quests.length ? ' ' + k.quests.length + ' ' + (k.quests.length === 1 ? 'справа' : k.quests.length < 5 ? 'справи' : 'справ') + ' ' : '') + '· ' + k.minutes + ' хв</span>'; }).join('') + '</div>';
    h += '<div class="feed' + (td ? ' short' : '') + '"><div class="h">Хроніка</div>' + state.feed.slice(0, td ? 3 : 6).map(function (f) { return '<div>' + esc(f.text) + '</div>'; }).join('') + '</div>';
    var top = (state.seasonTop || []).filter(function (p) { return p.points > 0; });
    if (top.length) h += '<div class="season"><div class="h">🏆 ' + esc(state.season) + (state.seasonDaysLeft !== null && state.seasonDaysLeft !== undefined ? ' <span class="left">· ' + (state.seasonDaysLeft > 0 ? 'ще ' + state.seasonDaysLeft + ' дн.' : 'фінал сьогодні!') + '</span>' : '') + '</div>' + top.slice(0, 5).map(function (p, i) { return '<div><span class="pl">' + ['🥇', '🥈', '🥉', '4', '5'][i] + '</span> ' + av(p, 'avs') + ' <b>' + esc(p.name) + '</b><span class="pts">' + p.points + '</span></div>'; }).join('') + ((state.pastSeasons || []).length ? '<div class="past">' + state.pastSeasons.map(function (ps) { return '🏅 сезон ' + ps.n + ': ' + esc(ps.winner || '—'); }).join(' · ') + '</div>' : '') + '</div>';
    h += '<div class="legend' + (top.length ? ' short' : '') + '"><div class="h">Зал легендарок</div>' + (state.legendaries.length ? state.legendaries.map(function (l) { return '<div>🟠 <b>' + esc(l.name) + '</b>: <span class="r-legendary">' + esc(l.item.name) + '</span></div>'; }).join('') : '<div style="color:#5c6f85">Ще ніхто не вибив легендарку…</div>') + (state.pendingQuests ? '<div style="margin-top:20px;color:#f1c40f">✅ Справ чекають підтвердження: ' + state.pendingQuests + '</div>' : '') + '</div>';
    h += '<div class="tvbtns">' + (state.hasReplay !== false ? '<button class="tvbtn" id="tv-replay">📼 Повтор бою</button>' : '') + '<span class="tvhint">Magic Remote: тисни на героя</span></div>';
    stage.innerHTML = h; ticker.innerHTML = '';
    var cards = stage.querySelectorAll('[data-hero]'); for (var i = 0; i < cards.length; i++) cards[i].onclick = function () { showHero(this.getAttribute('data-hero')); };
    var rb = document.getElementById('tv-replay'); if (rb) rb.onclick = function () { fetch('/api/tv/replay', { method: 'POST' }).catch(function () { }); };
  }
  // ---------- церемонія закриття сезону ----------
  var ceremonyTimer = null;
  var MEM_COLORS = ['#e74c3c', '#2ecc71', '#3498db', '#f1c40f'], memTimers = [];
  function showMini(m, pm) {
    var h;
    if (m.kind === 'memory') {
      var pads = '<div class="mpads">' + MEM_COLORS.map(function (c, i) { return '<div class="mpad" id="mpad' + i + '" style="background:' + c + '"></div>'; }).join('') + '</div>';
      if (m.phase === 'done') h = '<div class="banner mini done"><div class="big">🧩 Пам’ять: хто найуважніший</div><div class="mseq">' + (m.seq || []).map(function (c) { return '<span style="background:' + MEM_COLORS[c] + '"></span>'; }).join('') + '</div>' + (m.ranking.length ? '<div class="rank">' + m.ranking.map(function (r, i) { return '<div><span class="pl">' + (['🥇', '🥈', '🥉'][i] || (i + 1)) + '</span> <b>' + esc(r.name) + '</b><span class="ms">' + (r.ms / 1000).toFixed(1) + ' с</span></div>'; }).join('') + '</div>' : '<div class="sub">Ніхто не повторив 😅</div>') + (m.faults.length ? '<div class="sub">Помилились: ' + esc(m.faults.join(', ')) + '</div>' : '') + '</div>';
      else if (m.phase === 'go') h = '<div class="banner mini memgo"><div class="big">🧩 ПОВТОРИ на телефоні!</div>' + pads + '<div class="sub">' + (m.players.length ? m.players.map(function (p) { return esc(p.name) + ': ' + (p.fault ? '😅' : p.done ? '✅' : p.pressed + '/' + m.len); }).join(' · ') : 'чекаємо…') + '</div></div>';
      else h = '<div class="banner mini memwait"><div class="big">🧩 ПАМ’ЯТЬ · запам’ятай ' + m.len + ' кольори</div>' + pads + '<div class="sub">Запустив ' + esc(m.by) + '. Повторювати на телефоні, коли ТБ скаже</div></div>';
      overlay.innerHTML = h; overlay.className = 'on'; introUntil = Date.now() + 2000;
      if (m.phase === 'wait' && (!pm || pm.phase !== 'wait' || pm.at !== m.at)) {
        memTimers.forEach(clearTimeout); memTimers = [];
        (m.seq || []).forEach(function (c, i) { memTimers.push(setTimeout(function () { var el = document.getElementById('mpad' + c); if (el) { el.className = 'mpad lit'; beep(330 + c * 110, 250, 'sine', 0.06); setTimeout(function () { el.className = 'mpad'; }, m.step - 250); } }, 600 + i * m.step)); });
      }
      if (m.phase === 'done' && (!pm || pm.phase !== 'done')) { beep(523, 120, 'triangle', 0.08); setTimeout(function () { beep(784, 200, 'triangle', 0.08); }, 150); }
      return;
    }
    if (m.kind === 'quiz') {
      if (m.phase === 'done') h = '<div class="banner mini done"><div class="big">🧠 Бліц: хто найрозумніший</div>' + (m.ranking.length ? '<div class="rank">' + m.ranking.map(function (r, i) { return '<div><span class="pl">' + (['🥇', '🥈', '🥉'][i] || (i + 1)) + '</span> <b>' + esc(r.name) + '</b><span class="ms">✅ ' + r.correct + ' з ' + m.n + (r.ms !== null ? ' · ' + Math.round(r.ms / 1000) + ' с' : '') + '</span></div>'; }).join('') + '</div>' : '<div class="sub">Ніхто не відповів 😅</div>') + '</div>';
      else h = '<div class="banner mini quiz"><div class="big">🧠 БЛІЦ · ' + m.n + ' питань</div><div class="sub">Запустив ' + esc(m.by) + '. Питання на телефонах, у кожного свої за віком · ще ' + m.left + ' с</div><div class="rank">' + (m.players.length ? m.players.map(function (p) { return '<div><b>' + esc(p.name) + '</b><span class="ms">' + (p.done ? '✅ готово · ' : '') + p.i + '/' + m.n + ' · правильних ' + p.correct + '</span></div>'; }).join('') : '<div class="sub">Чекаємо перших відповідей…</div>') + '</div></div>';
      overlay.innerHTML = h; overlay.className = 'on'; introUntil = Date.now() + 2000;
      if (m.phase === 'done' && (!pm || pm.phase !== 'done')) { beep(523, 120, 'triangle', 0.08); setTimeout(function () { beep(784, 200, 'triangle', 0.08); }, 150); }
      return;
    }
    if (m.phase === 'wait') h = '<div class="banner mini wait"><div class="big">⚡ РЕАКЦІЯ</div><div class="sub">Запустив ' + esc(m.by) + '. Тримай палець над кнопкою…</div><div class="go">ЧЕКАЙ</div></div>';
    else if (m.phase === 'go') h = '<div class="banner mini go"><div class="go">ТИСНИ!</div><div class="sub">натиснули: ' + m.tapped + '</div></div>';
    else h = '<div class="banner mini done"><div class="big">⚡ Хто найшвидший</div>' + (m.ranking.length ? '<div class="rank">' + m.ranking.map(function (r, i) { return '<div><span class="pl">' + ['🥇', '🥈', '🥉', '4', '5', '6'][i] + '</span> <b>' + esc(r.name) + '</b><span class="ms">' + r.ms + ' мс</span></div>'; }).join('') + '</div>' : '<div class="sub">Ніхто не встиг за 3 с 😅</div>') + (m.faults.length ? '<div class="sub">Фальстарт: ' + esc(m.faults.join(', ')) + '</div>' : '') + '</div>';
    overlay.innerHTML = h; overlay.className = 'on'; introUntil = Date.now() + 2000;
    if (m.phase === 'go' && (!pm || pm.phase !== 'go')) beep(880, 150, 'square', 0.08);
    if (m.phase === 'done' && (!pm || pm.phase !== 'done')) { beep(523, 120, 'triangle', 0.08); setTimeout(function () { beep(784, 200, 'triangle', 0.08); }, 150); }
  }
  function showParty(pt) {
    var h = '<div class="banner mini done party"><div class="big">🎉 Вечір ігор: підсумки</div>' + (pt.ranking.length ? '<div class="rank">' + pt.ranking.map(function (r, i) { return '<div><span class="pl">' + (['🥇', '🥈', '🥉'][i] || (i + 1)) + '</span> <b>' + esc(r.name) + '</b><span class="ms">' + r.points + ' оч.</span></div>'; }).join('') + '</div><div class="sub">👑 Чемпіон вечора: <b>' + esc(pt.champion) + '</b> · +15 🪙, +3 очки сезону</div>' : '<div class="sub">Ніхто не брав участі 😅</div>') +
      '<div class="confetti">' + ['🎉', '🎊', '✨', '🎉', '🎊', '✨', '🎉', '🎊', '✨', '🎉'].map(function (x, i) { return '<span style="left:' + (5 + i * 9) + '%;animation-delay:' + (i * 0.3) + 's">' + x + '</span>'; }).join('') + '</div></div>';
    overlay.innerHTML = h; overlay.className = 'on'; introUntil = Date.now() + 2000;
    beep(523, 150, 'triangle', 0.08); setTimeout(function () { beep(659, 150, 'triangle', 0.08); }, 180); setTimeout(function () { beep(784, 250, 'triangle', 0.08); }, 360);
  }
  function showCeremony(c) {
    var pod = c.podium || [], order = [1, 0, 2];
    var h = '<div class="banner ceremony"><div class="big">🏁 «' + esc(c.name) + '» закрито</div>' +
      (c.winner ? '<div class="sub">👑 Чемпіон сезону: <b>' + esc(c.winner) + '</b> · титул і +100 🪙</div>' : '<div class="sub">Без чемпіона: ніхто не набрав очок</div>') +
      '<div class="podium">' + order.map(function (i) { var p = pod[i]; if (!p) return '<div class="step s' + i + '"></div>'; return '<div class="step s' + i + '">' + av(p, 'avbig') + '<div class="pn">' + esc(p.name) + '</div><div class="pp">' + p.points + ' очок</div><div class="pb">' + ['🥇', '🥈', '🥉'][i] + '</div></div>'; }).join('') + '</div>' +
      '<div class="confetti">' + ['🎉', '🎊', '✨', '🎉', '🎊', '✨', '🎉', '🎊', '✨', '🎉'].map(function (x, i) { return '<span style="left:' + (5 + i * 9) + '%;animation-delay:' + (i * 0.17) + 's">' + x + '</span>'; }).join('') + '</div>' +
      '<div class="cnt">Новий сезон уже почався. Очки з нуля!</div></div>';
    overlay.innerHTML = h; overlay.className = 'on'; introUntil = Date.now() + 30000;
    beep(523, 150, 'triangle', 0.08); setTimeout(function () { beep(659, 150, 'triangle', 0.08); }, 180); setTimeout(function () { beep(784, 150, 'triangle', 0.08); }, 360); setTimeout(function () { beep(1047, 400, 'triangle', 0.1); }, 540);
    clearTimeout(ceremonyTimer); ceremonyTimer = setTimeout(function () { if (!state.paused) overlay.className = ''; }, 30000);
    overlay.onclick = function () { clearTimeout(ceremonyTimer); introUntil = 0; overlay.className = ''; overlay.onclick = null; };
  }
  // ---------- профіль героя на ТБ (клік Magic Remote) ----------
  var heroTimer = null;
  function showHero(id) {
    fetch('/api/tv/hero?id=' + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (p) {
      if (!p || p.error) return;
      var eq = ['weapon', 'helmet', 'armor', 'amulet'].map(function (sl) { var it = p.equipment[sl]; return it ? '<span class="r-' + it.rarity + '">' + esc(it.name) + '</span>' : null; }).filter(Boolean);
      var h = '<div class="banner hero-prof"><div class="row">' + av(p, 'avbig') + '<div class="grow"><div class="big">' + esc(p.name) + '</div><div class="sub">' + esc(p.title || p.className) + ' · ' + p.level + ' рів. · ' + p.xp + '/' + p.xpNext + ' досвіду · 🪙 ' + p.gold + '</div>' +
        '<div class="sub">🏆 Сезон: ' + p.seasonPoints + ' очок, місце ' + (p.seasonRank || '—') + (p.streak && p.streak.days >= 2 ? ' · 🔥 серія ' + p.streak.days + ' дн.' + (p.streak.best > p.streak.days ? ' (рекорд ' + p.streak.best + ')' : '') : '') + (p.worldBossDmg ? ' · 🐉 босу тижня ' + p.worldBossDmg : '') + '</div></div></div>' +
        '<div class="cols"><div class="loot"><div><b>Статистика</b></div><div>⚔️ вбито ' + p.stats.kills + ' · 👑 босів ' + p.stats.bossKills + ' · 🏰 підземель ' + p.stats.dungeons + '</div><div>🥊 дуелей ' + p.stats.duelWins + '/' + p.stats.duels + ' · 💥 критів ' + p.stats.crits + ' · 🛡 блоків ' + p.stats.blocks + '</div><div>⚡ реакція ' + (p.stats.reaction || 0) + ' · 🧠 бліц ' + (p.stats.quiz || 0) + (p.stats.quizPerfect ? ' (5/5 ×' + p.stats.quizPerfect + ')' : '') + ' · 🤺 виклики ' + (p.stats.challenges || 0) + '</div><div>🧠 розумних ' + (p.stats.smart || 0) + ' · ✅ справ ' + p.stats.quests + ' · 🟠 легендарок ' + p.stats.legendaries + '</div>' +
        '<div style="margin-top:10px"><b>Спорядження</b></div><div>' + (eq.length ? eq.join(', ') : 'порожньо') + '</div></div>' +
        '<div class="loot"><div><b>Досягнення</b></div><div>' + (p.achievements.length ? p.achievements.map(function (a) { return esc(a.icon) + ' ' + esc(a.name); }).join(' · ') : 'ще немає') + '</div>' +
        '<div style="margin-top:10px"><b>Завдання дня</b></div>' + p.daily.map(function (t) { return '<div>' + (t.done ? '✅' : '○') + ' ' + esc(t.name) + ' (' + t.progress + '/' + t.n + ')</div>'; }).join('') +
        (p.pets && p.pets.length ? '<div style="margin-top:10px"><b>Вихованці</b></div><div>' + p.pets.map(function (x) { return (x.active ? '★ ' : '') + esc(x.icon) + ' ' + esc(x.name) + ' ' + x.level + ' рів.'; }).join(' · ') + '</div>' : '') +
        (p.coupons && p.coupons.length ? '<div style="margin-top:10px"><b>🎟 Чекає від батьків</b></div><div>' + p.coupons.map(function (c) { return esc(c.icon) + ' ' + esc(c.title); }).join(' · ') + '</div>' : '') +
        (p.customCards.length ? '<div style="margin-top:10px"><b>Свої карти</b></div><div>' + p.customCards.map(function (c) { return (c.image ? '<img class="ccimg" src="' + esc(c.image) + '" alt=""> ' : '🖍️ ') + esc(c.name); }).join(' · ') + '</div>' : '') + '</div></div>' +
        '<div class="cnt">закриється саме</div></div>';
      overlay.innerHTML = h; overlay.className = 'on';
      clearTimeout(heroTimer); heroTimer = setTimeout(function () { if (!state.paused && state.phase !== 'results') overlay.className = ''; }, 12000);
      overlay.onclick = function () { clearTimeout(heroTimer); overlay.className = ''; overlay.onclick = null; };
    }).catch(function () { });
  }
  // ---------- лобі ----------
  function renderLobby() {
    var l = state.lobby;
    var h = '<div class="hdr"><div class="t">Лобі</div><div class="s">' + esc(state.season) + '</div><div class="r">Скануй QR, щоб приєднатись</div></div>';
    h += '<div class="lobby"><div class="mode">' + (l.mode === 'practice' ? '🎯 Тренування <span>· манекен у дворі · без нагород</span>' : l.mode === 'tournament' ? '🏆 Турнір <span>· 3 або 4 гравці · дуелі одна за одною</span>' : l.mode === 'campaign' && l.campaign ? '📖 Розділ ' + l.campaign.n + ' з ' + l.campaign.of + ': ' + esc(l.campaign.title) + ' <span>· ' + esc(l.dungeon.name) + ', рівень ' + l.dungeon.level + '</span><div class="story">' + esc(l.campaign.intro) + '</div>' : l.mode === 'duel' ? '⚔️ Дуель <span>· дві команди</span>' : l.dungeon.icon + ' ' + esc(l.dungeon.name) + ' <span>· рівень ' + l.dungeon.level + ' · ' + (l.dungeon.raid ? 'РЕЙД: бос сильнішає з кожним гравцем' : l.dungeon.rooms.length + ' кімнати + бос') + '</span>' + (l.mutator && !l.dungeon.raid ? '<div class="mutline">' + esc(l.mutator.icon) + ' Мутатор дня: <b>' + esc(l.mutator.name) + '</b> · ' + esc(l.mutator.text) + '</div>' : '') + '<div class="s" style="font-size:24px;color:#9fb0c3">' + esc(l.dungeon.text) + '</div>') + '</div>';
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
      '<div class="tags">' + (f.level ? f.level + ' рів. ' : '') + (f.shield ? '🛡' + f.shield + ' ' : '') + (f.poison ? '☠️ ' : '') + (f.stunned ? '💫 ' : '') + (f.buff > 0 ? '💪 ' : '') + (f.raged ? '😡 ЛЮТЬ ' : '') + (f.fora ? '🤝 +' + f.fora + '% ' : '') + (f.secondWind ? '💨 ' : '') + (f.minions.length ? '<span class="minions">' + f.minions.map(function (m) { return m.icon; }).join('') + '</span>' : '') + (f.kind === 'player' && f.alive ? (f.ready ? ' ✅' : ' ⏳') : '') + '</div>' +
      '<div class="bar ' + (f.team ? 'red' : '') + '"><i style="width:' + hp + '%"></i><b>' + f.hp + ' / ' + f.maxHp + '</b></div>' + (f.maxMana ? '<div class="bar mana"><i style="width:' + Math.round(100 * f.mana / f.maxMana) + '%"></i></div>' : '') + '</div>';
  }
  function cssId(s) { return s.replace(/[^a-zA-Z0-9_-]/g, '_'); }
  function renderBattle() {
    var b = state.battle;
    var t0 = b.fighters.filter(function (f) { return f.team === 0; }), t1 = b.fighters.filter(function (f) { return f.team === 1; });
    var title = b.mode === 'duel' ? '⚔️ Дуель' : b.meta.practice ? '🎯 Тренування' : (b.meta.boss ? (b.meta.raid ? '🗿 РЕЙД-БОС' : '👑 БОС') : '🏰 Кімната ' + b.meta.room + ' з ' + b.meta.rooms) + (b.meta && b.meta.mutator ? ' · ' + b.meta.mutator.icon + ' ' + b.meta.mutator.name : '');
    if (state.tournament && !b.replay) title = '🏆 Турнір · бій ' + (state.tournament.current + 1) + ' з ' + state.tournament.of + (state.tournament.matches[state.tournament.current] && state.tournament.matches[state.tournament.current].final ? ' · ФІНАЛ' : '');
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
      overlay.innerHTML = '<div class="room-intro"><div class="big">' + (b.roomIntro.practice ? '🎯 Тренування' : b.roomIntro.boss ? '👑 БОС!' : 'Кімната ' + b.roomIntro.n) + '</div><div class="sub">' + esc(b.roomIntro.names.join(', ')) + '</div></div>';
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
      case 'reinforce': say('🧟 ' + (e.dm ? '<b>Ведучий</b> кличе' : '<b>' + who + '</b> кличе підмогу') + ': ' + esc((e.names || []).join(', ')) + ' ' + esc((e.icons || []).join(''))); beep(200, 300, 'sawtooth', 0.07); wait = 1200; break;
      case 'smart': floatText(e.who, '🧠 ×1.5', 'heal'); say('🧠 <b>' + who + '</b> розв’язав розумну карту: удар у півтора раза сильніший!'); beep(900, 150, 'sine', 0.06); wait = 900; break;
      case 'card': showCard(e); say('🃏 ' + who + ' грає <b>' + esc(e.name) + '</b>'); beep(520, 120, 'triangle'); wait = 1100; break;
      case 'block': flash(e.who, 'blocked'); floatText(e.who, '🛡 БЛОК', 'block'); say('🛡 ' + who + ' заблокував удар ' + by + ' (' + ZONE[e.zone] + ')'); beep(300, 80); break;
      case 'dodge': floatText(e.who, 'повз!', 'miss'); say('💨 ' + who + ' ухилився від ' + by); break;
      case 'absorb': floatText(e.who, '🛡 −' + e.v, 'block'); wait = 250; break;
      case 'dmg': flash(e.who, 'hit'); floatText(e.who, '−' + e.v, e.crit ? 'crit' : ''); setHp(e.who, e.hp);
        if (e.crit && e.by) { var cf = (state.battle && state.battle.fighters || []).filter(function (x) { return x.id === e.by; })[0]; if (cf && cf.cry) floatText(e.by, '«' + cf.cry + '»', 'cry'); }
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
    d.innerHTML = '<div class="who">' + esc(e.whoName) + ' грає</div><div class="ic">' + (e.image ? '<img src="' + esc(e.image) + '" alt="">' : esc(e.icon)) + '</div><div class="nm">' + esc(e.name) + '</div>' + (card || e.text ? '<div class="tx">' + esc(e.text || card.text) + '</div>' : '') + (e.image ? '<div class="who">намалював ' + esc(e.whoName) + '</div>' : '');
    stage.appendChild(d); setTimeout(function () { d.remove(); }, 1000);
  }
  // ---------- підсумки ----------
  function renderResults() {
    var r = state.results;
    var win = r.mode === 'duel' || r.won;
    var h = '<div class="banner ' + (win ? '' : 'lose') + '"><div class="big">' + (r.mode === 'duel' ? '⚔️ Переміг: ' + esc(r.winners.join(', ')) : (r.won ? (r.practice ? '🎯 Манекен повалений!' : r.raid ? '🗿 РЕЙД ПРОЙДЕНО! «' + esc(r.dungeon) + '»' : '🏆 «' + esc(r.dungeon) + '» пройдено!') : (r.practice ? '🎯 Манекен встояв. Ще раз?' : '💀 «' + esc(r.dungeon) + '» виявилось сильнішим'))) + '</div>';
    if (r.practice) h += '<div class="sub">Тренування: ' + r.rounds + ' раундів. Нагород немає, зате досвід у голові.</div>'; else if (r.mode === 'dungeon') h += '<div class="sub">Вбито ' + r.kills + ' · кожному +' + r.xp + ' досвіду, +' + r.gold + ' золота</div>';
    if (r.campaign && r.campaign.outro) h += '<div class="sub story">📖 ' + esc(r.campaign.outro) + (r.campaign.finished ? ' 🎉' : '') + '</div>';
    if (r.tournament) h += '<div class="sub bracket">' + (r.tournament.done ? '🏆 ЧЕМПІОН ТУРНІРУ: ' + esc(r.tournament.champion) : '🏆 Турнір · бій ' + Math.min(r.tournament.current + 1, r.tournament.of) + ' з ' + r.tournament.of + ' · далі: ' + (function (m) { return m && m.a && m.b ? esc(m.a.name) + ' проти ' + esc(m.b.name) : '…'; })(r.tournament.matches[r.tournament.current])) + '<div class="ms">' + r.tournament.matches.map(function (m) { return '<span class="' + (m.winner ? 'done' : m.live ? 'live' : '') + '">' + (m.a ? esc(m.a.name) : '?') + ' – ' + (m.b ? esc(m.b.name) : '?') + (m.winner ? ' ✅ ' + esc(m.winner) : '') + '</span>'; }).join('') + '</div></div>';
    var loot = (r.loot || []).slice(0, 10);
    h += '<div class="cols">';
    if (loot.length) h += '<div class="loot">' + loot.map(function (l) { return '<div>🎁 <b>' + esc(l.name) + '</b>: ' + (l.item ? '<span class="r-' + l.item.rarity + '">' + esc(l.item.name) + '</span>' : l.pet ? '🐾 вихованець ' + esc(l.petIcon) + ' <span class="r-rare">' + esc(l.petName) + '</span>' : '🃏 карта <span class="r-rare">' + esc(l.cardName) + '</span>') + '</div>'; }).join('') + '</div>';
    var ev = (r.events || []).slice(0, 10);
    if (r.worldBoss && r.worldBoss.hit) h += '<div class="sub wbhit">' + esc(r.worldBoss.icon) + ' Босу тижня «' + esc(r.worldBoss.name) + '» −' + r.worldBoss.hit + (r.worldBoss.killed ? ' · ПОВАЛЕНИЙ!' : '') + '</div>';
    if (ev.length) h += '<div class="loot">' + ev.map(function (e) { return e.t === 'pet' ? '<div>🐾 ' + esc(e.whoName) + ': ' + esc(e.icon) + ' ' + esc(e.name) + (e.isNew ? ' приручено!' : e.levelUp ? ', рівень ' + e.level : '') + '</div>' : e.t === 'worldboss' ? '<div>' + esc(e.icon) + ' Бос тижня «' + esc(e.name) + '» повалений: +' + e.gold + ' золота всім!</div>' : e.t === 'levelup' ? '<div>⬆️ ' + esc(e.whoName) + ': рівень ' + e.level + '!</div>' : e.t === 'daily' ? '<div>📅 ' + esc(e.whoName) + ': завдання дня «' + esc(e.name) + '»</div>' : e.t === 'family' ? '<div>👨‍👩‍👦 <b>Сімейне досягнення «' + esc(e.name) + '»</b> усім +' + e.gold + ' 🪙</div>' : '<div>' + esc(e.icon) + ' ' + esc(e.whoName) + ': досягнення «' + esc(e.name) + '»</div>'; }).join('') + '</div>';
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
