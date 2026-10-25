import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';

test('/health відповідає ok', async () => {
  const srv = createServer().listen(0);
  await new Promise(r => srv.once('listening', r));
  const res = await fetch(`http://127.0.0.1:${srv.address().port}/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  srv.close();
});
