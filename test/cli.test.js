import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, UsageError } from '../bin/dsh-dual-proxy.js';

const bin = fileURLToPath(new URL('../bin/dsh-dual-proxy.js', import.meta.url));
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

test('CLI：非法端口与负的间隔都被拒绝', () => {
  assert.throws(() => parseArgs(['--listen-port', 'abc'], {}), UsageError);
  assert.throws(() => parseArgs(['--listen-port', '0'], {}), UsageError);
  assert.throws(() => parseArgs(['--health-interval-ms', '-1'], {}), UsageError);
  assert.throws(() => parseArgs(['--gateway', 'not a gateway'], {}), UsageError);
  assert.throws(() => parseArgs([], { LISTEN_PORT: 'abc' }), UsageError);
});

test('CLI：合法参数被解析', () => {
  const opts = parseArgs(['--listen-port', '7899', '--timeout-ms', '2500'], {});
  assert.equal(opts.listenPort, 7899);
  assert.equal(opts.attemptTimeoutMs, 2500);
});

test('CLI：非法参数一行报错、退出码 2、无调用栈', () => {
  const run = spawnSync(process.execPath, [bin, '--listen-port', 'abc'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /invalid value for --listen-port: abc/);
  assert.ok(!/\n\s+at\s/.test(run.stderr), '不应打印调用栈');
  assert.equal(run.stderr.trim().split('\n').length, 1);
});

test('CLI：通过符号链接执行仍会运行', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dual-proxy-link-'));
  const link = join(dir, 'dsh-dual-proxy');
  try {
    symlinkSync(bin, link);
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      t.skip('本机不允许创建符号链接');
      return;
    }
    throw err;
  }
  try {
    const run = spawnSync(process.execPath, [link, '--version'], { encoding: 'utf8' });
    assert.equal(run.status, 0);
    assert.equal(run.stdout.trim(), version);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('I19：重放开关注释与解析', () => {
  assert.equal(parseArgs([], {}).retryNonIdempotentAfterSend, false);
  assert.equal(parseArgs(['--retry-non-idempotent-after-send'], {}).retryNonIdempotentAfterSend, true);
  assert.equal(parseArgs([], { RETRY_NON_IDEMPOTENT_AFTER_SEND: '1' }).retryNonIdempotentAfterSend, true);
  assert.equal(parseArgs([], { RETRY_NON_IDEMPOTENT_AFTER_SEND: '0' }).retryNonIdempotentAfterSend, false);
});

test('I19：CLI 帮助包含重放开关', () => {
  const run = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /--retry-non-idempotent-after-send/);
});

test('CLI：upstreamUrl 解析与非法值脱敏（U16/U17/U19）', () => {
  const opts = parseArgs(['--upstream-url', 'http://alice:secret@127.0.0.1:8080'], {});
  assert.equal(opts.upstreamUrl, 'http://alice:secret@127.0.0.1:8080');

  for (const value of ['https://alice:secret@proxy.local:8443', 'not a url']) {
    assert.throws(() => parseArgs(['--upstream-url', value], {}), (err) => {
      assert.ok(err instanceof UsageError);
      assert.ok(!err.message.includes('alice'));
      assert.ok(!err.message.includes('secret'));
      assert.ok(!err.message.includes('proxy.local'));
      return true;
    });
  }

  assert.throws(() => parseArgs(['--gateway', 'http://alice:secret@not a gateway'], {}), (err) => {
    assert.ok(err instanceof UsageError);
    assert.ok(!err.message.includes('alice'));
    assert.ok(!err.message.includes('secret'));
    return true;
  });
});

test('CLI：非法 upstreamUrl 以退出码 2 结束且不泄漏凭证（U16/U17）', () => {
  for (const args of [
    ['--upstream-url', 'https://alice:secret@proxy.local:8443'],
    ['--upstream-url', 'http://alice:secret@not a gateway']
  ]) {
    const run = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
    assert.equal(run.status, 2);
    assert.ok(!run.stderr.includes('alice'));
    assert.ok(!run.stderr.includes('secret'));
    assert.ok(!/\n\s+at\s/.test(run.stderr));
  }
  const envRun = spawnSync(process.execPath, [bin], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { UPSTREAM_URL: 'https://alice:secret@proxy.local:8443' })
  });
  assert.equal(envRun.status, 2);
  assert.ok(!envRun.stderr.includes('alice'));
  assert.ok(!envRun.stderr.includes('secret'));
});
