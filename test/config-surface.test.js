import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

test('I20：重放开关在 Config / patch / README / CLI 四处一致', () => {
  const index = read('../src/index.js');
  assert.match(index, /retryNonIdempotentAfterSend: live\(Schema\.boolean\(\)\.default\(false\)\)/);
  assert.match(index, /retryNonIdempotentAfterSend: fieldValue\(config, 'retryNonIdempotentAfterSend', false\)/);
  assert.match(index, /upstreamUrl: live\(Schema\.string\(\)\.default\(''\)\)/);
  assert.match(index, /upstreamUrl: fieldValue\(config, 'upstreamUrl', ''\)/);
  assert.match(index, /retryNonIdempotentWithIdempotencyKey: live\(Schema\.boolean\(\)\.default\(false\)\)/);
  assert.match(index, /retryNonIdempotentWithIdempotencyKey: fieldValue\(config, 'retryNonIdempotentWithIdempotencyKey', false\)/);

  const patch = read('../cordis.patch.yml');
  assert.match(patch, /retryNonIdempotentAfterSend: false/);
  assert.match(patch, /upstreamUrl: ''/);
  assert.match(patch, /retryNonIdempotentWithIdempotencyKey: false/);

  const readme = read('../README.md');
  assert.match(readme, /retryNonIdempotentAfterSend/);
  assert.match(readme, /--retry-non-idempotent-after-send/);
  assert.match(readme, /RETRY_NON_IDEMPOTENT_AFTER_SEND=1/);
  assert.match(readme, /upstreamUrl/);
  assert.match(readme, /--upstream-url/);
  assert.match(readme, /UPSTREAM_URL/);
  assert.match(readme, /retryNonIdempotentWithIdempotencyKey/);
  assert.match(readme, /--retry-non-idempotent-with-idempotency-key/);
  assert.match(readme, /RETRY_NON_IDEMPOTENT_WITH_IDEMPOTENCY_KEY=1/);

  const bin = read('../bin/dsh-dual-proxy.js');
  assert.match(bin, /--retry-non-idempotent-after-send/);
  assert.match(bin, /RETRY_NON_IDEMPOTENT_AFTER_SEND/);
  assert.match(bin, /--upstream-url/);
  assert.match(bin, /UPSTREAM_URL/);
  assert.match(bin, /--retry-non-idempotent-with-idempotency-key/);
  assert.match(bin, /RETRY_NON_IDEMPOTENT_WITH_IDEMPOTENCY_KEY/);
});
