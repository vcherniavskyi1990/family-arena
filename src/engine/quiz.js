// Розумні карти: питання на раунд (математика за віком або англійське слово). Правильна відповідь = сильніший удар.
// Чисті функції з детермінованим rng, щоб тести були відтворювані.
import { readFileSync } from 'node:fs';

export const WORDS = JSON.parse(readFileSync(new URL('../content/words.json', import.meta.url), 'utf8'));
// v0.58 (рішення Віктора 30.10): раз на 3 раунди, лише дітям; правильно → удар ×2, помилка → удар −25 %
export const SMART_MULT = 2;
export const FLOP_MULT = 0.75;
export const SMART_EVERY = 3;
export const SMART_MAX_AGE = 13;   // розумні завдання бачать гравці з віком до 13 включно
export const smartFor = (age) => !!age && age <= SMART_MAX_AGE;
export const smartRound = (round) => round % SMART_EVERY === 0;   // round = номер поточного раунду мінус 1 (0, 3, 6 …)

/** Питання для гравця за віком. Повертає { kind, q, a, choices } (a завжди серед choices). */
export function makeQuiz(rng, age) {
  const english = rng.chance(0.35);
  if (english) {
    const [en, uk] = rng.pick(WORDS);
    const wrong = rng.shuffle(WORDS.filter(w => w[0] !== en)).slice(0, 2).map(w => w[0]);
    return { kind: 'english', q: `Як англійською «${uk}»?`, a: en, choices: rng.shuffle([en, ...wrong]) };
  }
  let q, a;
  if (!age || age >= 12) {
    const x = rng.int(3, 12), y = rng.int(3, 12);
    if (rng.chance(0.5)) { q = `${x} × ${y}`; a = x * y; } else { q = `${x * y} ÷ ${x}`; a = y; }
  } else if (age >= 9) {
    const x = rng.int(2, 9), y = rng.int(2, 9);
    if (rng.chance(0.6)) { q = `${x} × ${y}`; a = x * y; } else { const s = rng.int(20, 99), t = rng.int(5, 19); q = `${s} − ${t}`; a = s - t; }
  } else {
    const x = rng.int(2, 10), y = rng.int(1, 10);
    if (rng.chance(0.5)) { q = `${x} + ${y}`; a = x + y; } else { const big = Math.max(x, y), small = Math.min(x, y); q = `${big} − ${small}`; a = big - small; }
  }
  const choices = new Set([a]);
  while (choices.size < 3) { const d = rng.int(1, 4) * (rng.chance(0.5) ? 1 : -1); if (a + d >= 0) choices.add(a + d); }
  return { kind: 'math', q: `${q} = ?`, a, choices: rng.shuffle([...choices]) };
}

export function checkQuiz(quiz, answer) {
  if (!quiz) return false;
  return String(answer).trim().toLowerCase() === String(quiz.a).toLowerCase();
}
