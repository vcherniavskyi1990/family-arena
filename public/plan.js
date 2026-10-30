/* plan.js: план квартири для ТБ-арени (v0.59, крок 3). ES5 під Chromium 79.
   Геометрія в мм з плану Ії/Віктора (той самий, що на дашборді дому: mimismart-pult web/www/tv-plan.js).
   PLAN.svg({ at: 'kitchen_caves', path: [{ n, dungeon, done }] }) → рядок <svg>: кімнати, де зараз команда (⚔️),
   і шлях кампанії по дому номерами розділів. Без імен кімнат усередині, лише підпис знизу. */
var PLAN = (function () {
  var ZONES = { '1': [[0, 0], [4250, 0], [4250, 3300], [0, 3300]], '2': [[0, 3300], [3970, 3300], [3970, 6730], [0, 6730]],
    '3.1': [[4250, 2690], [6420, 2690], [6420, 6730], [6294, 6730], [6294, 7390], [5284, 7390], [5284, 6730], [4070, 6730], [4070, 5490], [3970, 5490], [3970, 3300], [4250, 3300]],
    '3.2': [[6420, 2690], [7090, 2690], [7090, 4740], [6420, 4740]], '3.3': [[7090, 2690], [8460, 2690], [8460, 5290], [7090, 5290]],
    '4': [[4370, 0], [6400, 0], [6400, 2590], [4370, 2590]], '6': [[7090, 0], [8460, 0], [8460, 2590], [7090, 2590]], '8': [[7090, 5390], [8460, 5390], [8460, 7360], [7090, 7360]],
    '9': [[8560, 0], [12360, 0], [12360, 3620], [8560, 3620]], '9.1': [[8560, 3620], [9693, 3620], [9693, 4300], [8560, 4300]], '9.2': [[11122, 3620], [12360, 3620], [12360, 4300], [11122, 4300]],
    '10': [[8560, 4400], [9793, 4400], [9793, 3720], [11022, 3720], [11022, 4400], [12460, 4400], [12460, 3700], [13760, 3700], [13760, 7360], [8560, 7360]],
    '11': [[12360, 1100], [13030, 1100], [13030, 0], [14360, 0], [14360, 3120], [13030, 3120], [13030, 2510], [12360, 2510]] };
  var NAMES = { '1': 'Вітальня', '2': 'Кухня', '3.1': 'Коридор', '3.2': 'Коридор', '3.3': 'Комора', '4': 'Ванна', '6': 'Санвузол', '8': 'Комора', '9': 'Спальня', '9.1': 'Гардероб', '9.2': 'Гардероб', '10': 'Дитяча', '11': 'Лоджія' };
  /* де в домі яке підземелля; at = точка маркера в мм, коли центр зони не підходить */
  var WHERE = { kitchen_caves: { z: '2' }, lego_castle: { z: '10', at: [11200, 5900] }, wardrobe_shadows: { z: '9.1' }, bedroom_nightmares: { z: '9' },
    bathroom_kraken: { z: '4' }, attic_ghosts: { z: '8' }, dad_office: { z: '11', at: [13700, 2500] }, garage_machines: { z: '3.3' }, balcony_citadel: { z: '11', at: [13700, 700] },
    raid_titan: { z: '1' }, raid_dragon: { z: '9', at: [10460, 600] }, practice: { z: '3.1', at: [5100, 4300] } };
  function center(poly) { var x = 0, y = 0; for (var i = 0; i < poly.length; i++) { x += poly[i][0]; y += poly[i][1]; } return [x / poly.length, y / poly.length]; }
  function spot(d) { var w = WHERE[d]; if (!w) return null; return { z: w.z, at: w.at || center(ZONES[w.z]) }; }
  function pts(poly) { var s = []; for (var i = 0; i < poly.length; i++) s.push(poly[i][0] + ',' + poly[i][1]); return s.join(' '); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function svg(o) {
    o = o || {}; var cur = spot(o.at); var h = '<svg class="plan-svg" viewBox="-250 -250 14900 8000" preserveAspectRatio="xMidYMid meet">';
    for (var z in ZONES) h += '<polygon class="pz' + (cur && cur.z === z ? ' here' : '') + '" points="' + pts(ZONES[z]) + '"/>';
    if (o.path && o.path.length) {
      var line = [], k;
      for (k = 0; k < o.path.length; k++) { var s = spot(o.path[k].dungeon); if (s) line.push(s.at[0] + ',' + s.at[1]); }
      if (line.length > 1) h += '<polyline class="pp" points="' + line.join(' ') + '"/>';
      for (k = 0; k < o.path.length; k++) { var p = o.path[k], sp = spot(p.dungeon); if (!sp) continue; var isCur = o.at && p.dungeon === o.at && !p.done;
        h += '<g class="pn' + (p.done ? ' done' : isCur ? ' cur' : '') + '" transform="translate(' + (sp.at[0] + (isCur ? 750 : 0)) + ',' + (sp.at[1] - (isCur ? 650 : 0)) + ')"><circle r="330"/><text dy="130">' + (p.done ? '✓' : esc(p.n)) + '</text></g>'; }
    }
    if (cur) h += '<text class="pm" x="' + cur.at[0] + '" y="' + (cur.at[1] + 300) + '">⚔️</text>';
    h += '</svg>';
    if (cur && o.label !== false) h += '<div class="plan-label">📍 ' + esc(NAMES[cur.z] || '') + (o.title ? ' · ' + esc(o.title) : '') + '</div>';
    return h;
  }
  return { svg: svg, where: spot, ZONES: ZONES, NAMES: NAMES, WHERE: WHERE };
})();
