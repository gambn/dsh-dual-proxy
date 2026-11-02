import test from 'node:test';
import assert from 'node:assert/strict';
import { isIdempotent, shouldRetryAfterSend } from '../src/retry-policy.js';

test('retry-policy：幂等集合', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'TRACE', 'PUT', 'DELETE']) {
    assert.equal(isIdempotent(method), true, method);
  }
  for (const method of ['POST', 'PATCH', 'FOO', undefined]) {
    assert.equal(isIdempotent(method), false, String(method));
  }
});

test('retry-policy：方法大小写不敏感', () => {
  assert.equal(isIdempotent('get'), true);
  assert.equal(isIdempotent('Put'), true);
});

test('retry-policy：重放决策表', () => {
  const base = { retryNonIdempotentAfterSend: false };
  assert.equal(shouldRetryAfterSend({ method: 'POST', sent: false, ...base }), true);
  assert.equal(shouldRetryAfterSend({ method: 'GET', sent: true, ...base }), true);
  assert.equal(shouldRetryAfterSend({ method: 'POST', sent: true, ...base }), false);
  assert.equal(shouldRetryAfterSend({ method: 'POST', sent: true, retryNonIdempotentAfterSend: true }), true);
  assert.equal(shouldRetryAfterSend({ method: 'PATCH', sent: true, ...base }), false);
  assert.equal(shouldRetryAfterSend({ method: 'PUT', sent: true, ...base }), true);
});
