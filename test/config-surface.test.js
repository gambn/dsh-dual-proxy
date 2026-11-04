import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

test('I20：重放/认证配置面在 Config/plainConfig/patch/两份 README/CLI/env 一致', () => {
  const index = read('../src/adapters/dsh.js');
  assert.match(index, /retryNonIdempotentAfterSend: live\(Schema\.boolean\(\)\.default\(false\)\)/);
  assert.match(index, /retryNonIdempotentAfterSend: fieldValue\(config, 'retryNonIdempotentAfterSend', false\)/);
  assert.match(index, /upstreamUrl: live\(Schema\.string\(\)\.default\(''\)\)/);
  assert.match(index, /upstreamUrl: fieldValue\(config, 'upstreamUrl', ''\)/);
  assert.match(index, /portFallback: live\(Schema\.number\(\)\.min\(0\)\.max\(100\)\.step\(1\)\.default\(0\)\)/);
  assert.match(index, /portFallback: fieldValue\(config, 'portFallback', 0\)/);
  assert.match(index, /retryNonIdempotentWithIdempotencyKey: live\(Schema\.boolean\(\)\.default\(false\)\)/);
  assert.match(index, /retryNonIdempotentWithIdempotencyKey: fieldValue\(config, 'retryNonIdempotentWithIdempotencyKey', false\)/);

  const patch = read('../cordis.patch.yml');
  assert.match(patch, /retryNonIdempotentAfterSend: false/);
  assert.match(patch, /upstreamUrl: ''/);
  assert.match(patch, /portFallback: 0/);
  assert.match(patch, /retryNonIdempotentWithIdempotencyKey: false/);

  const readme = read('../README.md');
  const readmeEn = read('../README.en.md');
  for (const doc of [readme, readmeEn]) {
    assert.match(doc, /retryNonIdempotentAfterSend/);
    assert.match(doc, /--retry-non-idempotent-after-send/);
    assert.match(doc, /RETRY_NON_IDEMPOTENT_AFTER_SEND=1/);
    assert.match(doc, /upstreamUrl/);
    assert.match(doc, /--upstream-url/);
    assert.match(doc, /UPSTREAM_URL/);
    assert.match(doc, /portFallback/);
    assert.match(doc, /--port-fallback/);
    assert.match(doc, /PORT_FALLBACK/);
    assert.match(doc, /retryNonIdempotentWithIdempotencyKey/);
    assert.match(doc, /--retry-non-idempotent-with-idempotency-key/);
    assert.match(doc, /RETRY_NON_IDEMPOTENT_WITH_IDEMPOTENCY_KEY=1/);
    assert.ok(!doc.includes('不支持上游代理认证'), '不应保留旧的中文边界');
    assert.ok(!doc.includes('凭证会被丢弃'), '不应保留旧的中文边界');
    assert.ok(!doc.includes('authentication is not supported'), '不应保留旧的英文边界');
    assert.ok(!doc.includes('are dropped'), '不应保留旧的英文边界');
  }

  const bin = read('../bin/dsh-dual-proxy.js');
  assert.match(bin, /--retry-non-idempotent-after-send/);
  assert.match(bin, /RETRY_NON_IDEMPOTENT_AFTER_SEND/);
  assert.match(bin, /--upstream-url/);
  assert.match(bin, /UPSTREAM_URL/);
  assert.match(bin, /--port-fallback/);
  assert.match(bin, /PORT_FALLBACK/);
  assert.match(bin, /--retry-non-idempotent-with-idempotency-key/);
  assert.match(bin, /RETRY_NON_IDEMPOTENT_WITH_IDEMPOTENCY_KEY/);
});
