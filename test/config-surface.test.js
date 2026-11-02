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

  const patch = read('../cordis.patch.yml');
  assert.match(patch, /retryNonIdempotentAfterSend: false/);

  const readme = read('../README.md');
  assert.match(readme, /retryNonIdempotentAfterSend/);
  assert.match(readme, /--retry-non-idempotent-after-send/);
  assert.match(readme, /RETRY_NON_IDEMPOTENT_AFTER_SEND=1/);

  const bin = read('../bin/dsh-dual-proxy.js');
  assert.match(bin, /--retry-non-idempotent-after-send/);
  assert.match(bin, /RETRY_NON_IDEMPOTENT_AFTER_SEND/);
});
