import test from 'node:test';
import assert from 'node:assert/strict';
import { createDispatcher, mergeOptions } from '../src/server.js';

const silent = () => {};

test('mergeOptions：显式 undefined 不覆盖默认值', () => {
  const merged = mergeOptions({ prefTtlMs: 60000, attemptTimeoutMs: 5000 }, {
    prefTtlMs: undefined,
    attemptTimeoutMs: undefined
  });
  assert.equal(merged.prefTtlMs, 60000);
  assert.equal(merged.attemptTimeoutMs, 5000);
});

test('候选列表：上游与监听同端口时不会把自己当网关', () => {
  const d = createDispatcher({ listenPort: 7898, upstreamPort: 7898, log: silent });
  assert.deepEqual(d.candidates.map((gateway) => gateway.id), ['direct']);
  d.close();
});

test('listen：保留一个持久 error 监听，双 emit 不抛，端口占用仍 reject', async () => {
  const first = createDispatcher({ listenPort: 0, log: silent });
  const addr = await first.listen();
  try {
    assert.equal(first.server.listenerCount('error'), 1, '应保留持久日志监听');
    assert.doesNotThrow(() => {
      first.server.emit('error', new Error('first'));
      first.server.emit('error', new Error('second'));
    }, '连续两次 error 不应抛出');

    const second = createDispatcher({ listenPort: addr.port, log: silent });
    await assert.rejects(() => second.listen(), /EADDRINUSE/);
    await second.close();
  } finally {
    await first.close();
  }
});
