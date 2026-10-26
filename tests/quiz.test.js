import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/engine/rng.js';
import { makeQuiz, checkQuiz } from '../src/engine/quiz.js';

test('розумні карти: питання за віком, відповідь серед варіантів', () => {
  const rng = makeRng(7);
  for (let i = 0; i < 200; i++) {
    for (const age of [7, 10, 40, null]) {
      const z = makeQuiz(rng, age);
      assert.equal(z.choices.length, 3);
      assert.ok(z.choices.includes(z.a), `${z.q}: ${z.a} серед ${z.choices}`);
      assert.ok(checkQuiz(z, z.a));
      assert.ok(!checkQuiz(z, 'ні'));
      if (z.kind === 'math' && age === 7) { const n = Number(z.a); assert.ok(n >= 0 && n <= 20, `для 7 років ${z.q} = ${n}`); }
    }
  }
});

test('розумні карти: однаковий seed дає однакове питання', () => {
  assert.deepEqual(makeQuiz(makeRng(42), 10), makeQuiz(makeRng(42), 10));
});
