// Темп показу раунду на ТБ (v0.56): сервер кладе в кожну подію `ms`, ТБ грає рівно стільки, а наступний раунд
// стартує після показу. Одне джерело правди, щоб телефони й ТБ не розходились.
export const SHOW_MS = {
  round: 900, wave: 1100, card: 1600, smart: 1000, reinforce: 1400, summon: 1000,
  block: 1400, dodge: 1300, absorb: 350, heal: 900, shield: 700, poison: 700, stun: 900, skip: 700,
  rage: 1600, death: 1300, deathBoss: 2400, end: 1600, dmgHit: 1500, dmgCard: 1400, dmgMinion: 1000, dmgOther: 700, dmgCrit: 1800,
};
export const SHOW_CAP_MS = 30000;   // довше не чекаємо навіть у великому бою

export function showMs(e) {
  switch (e.t) {
    case 'dmg': return e.crit ? SHOW_MS.dmgCrit : e.kind === 'hit' ? SHOW_MS.dmgHit : e.kind === 'card' ? SHOW_MS.dmgCard : e.kind === 'minion' ? SHOW_MS.dmgMinion : SHOW_MS.dmgOther;
    case 'death': return e.boss ? SHOW_MS.deathBoss : SHOW_MS.death;
    default: return SHOW_MS[e.t] || 400;
  }
}
export function showTotal(events) { return Math.min(SHOW_CAP_MS, 600 + events.reduce((s, e) => s + showMs(e), 0)); }
