import test from 'node:test';
import assert from 'node:assert/strict';
import { createRestarter } from '../src/restart.js';

test('restart：运行期间的再次触发不会被丢掉', async () => {
  let runs = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let first = true;
  const restart = createRestarter(async () => {
    runs += 1;
    if (first) {
      first = false;
      await gate;
    }
  });

  const running = restart();
  await Promise.resolve();
  await restart();
  await restart();
  release();
  await running;

  assert.equal(runs, 2, '合并后应再跑一次');
});
