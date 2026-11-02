import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { apply } from '../src/index.js';
import { isFetchRouteInstalled } from '../src/fetch-route.js';
import { closedPort } from './helpers.js';

function makeCtx() {
  const handlers = new Map();
  const disposers = [];
  const info = [];
  const errors = [];
  return {
    logger: { info: (msg) => info.push(msg), error: (msg) => errors.push(msg) },
    on(name, fn) { handlers.set(name, fn); },
    effect(fn) { disposers.push(fn()); },
    emit(name) { handlers.get(name)?.(); },
    async dispose() { for (const disposer of disposers) await disposer(); },
    info,
    errors
  };
}

function cfg(port, extra = {}) {
  return Object.assign({
    listenHost: '127.0.0.1',
    listenPort: port,
    upstreamHost: '127.0.0.1',
    upstreamPort: 1,
    gateways: '',
    routeHostFetch: false,
    healthUrl: '',
    healthIntervalMs: 0,
    fastFailTimeoutMs: 1000,
    cooldownMs: 0,
    attemptTimeoutMs: 500,
    responseTimeoutMs: 500,
    prefTtlMs: 60000,
    verifyTls: false
  }, extra);
}

function tryConnect(port, host = '127.0.0.1', timeoutMs = 200) {
  return new Promise((resolve) => {
    const sock = net.connect(port, host);
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

test('生命周期：启动后监听，dispose 后释放', async () => {
  const port = await closedPort();
  const ctx = makeCtx();
  await apply(ctx, cfg(port));
  assert.equal(await tryConnect(port), true);
  assert.ok(ctx.info.some((msg) => msg.includes('listening')), '应有 listening 日志');

  await ctx.dispose();
  assert.equal(await tryConnect(port), false);
});

test('生命周期：重启窗口内 dispose 不会再拉起监听', async () => {
  const port = await closedPort();
  const ctx = makeCtx();
  await apply(ctx, cfg(port));

  const hold = net.connect(port, '127.0.0.1');
  await new Promise((resolve) => hold.once('connect', resolve));
  ctx.emit('loader/volatile-update');
  await new Promise((resolve) => setTimeout(resolve, 100));
  await ctx.dispose();
  hold.destroy();

  assert.equal(await tryConnect(port), false, 'dispose 后不应再有监听');
});

test('生命周期：旧 context 的 disposer 不会关掉新 context', async () => {
  const firstPort = await closedPort();
  const secondPort = await closedPort();
  const first = makeCtx();
  const second = makeCtx();
  await apply(first, cfg(firstPort));
  await apply(second, cfg(secondPort));

  await first.dispose();
  assert.equal(await tryConnect(firstPort), false);
  assert.equal(await tryConnect(secondPort), true, '新 context 应继续监听');

  await second.dispose();
  assert.equal(await tryConnect(secondPort), false);
});

test('生命周期：监听失败只记错误，不崩溃', async () => {
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  const port = blocker.address().port;
  const ctx = makeCtx();
  try {
    await apply(ctx, cfg(port));
    assert.ok(ctx.errors.some((msg) => /failed to listen/.test(msg)), '应记录监听失败');
  } finally {
    await ctx.dispose();
    await new Promise((resolve) => blocker.close(resolve));
  }
});

test('生命周期：非回环绑定告警，fetch 路由随 dispose 还原', async () => {
  const port = await closedPort();
  const ctx = makeCtx();
  await apply(ctx, cfg(port, { listenHost: '0.0.0.0', routeHostFetch: true }));
  assert.ok(ctx.info.some((msg) => /non-loopback/.test(msg)), '应给出非回环告警');
  assert.equal(isFetchRouteInstalled(), true);

  await ctx.dispose();
  assert.equal(isFetchRouteInstalled(), false);
});

test('生命周期：注册清理时 context 已失活则不会监听', async () => {
  const port = await closedPort();
  const ctx = makeCtx();
  ctx.effect = () => { throw new Error('INACTIVE_EFFECT'); };
  await assert.rejects(() => apply(ctx, cfg(port)), /INACTIVE_EFFECT/);
  assert.equal(await tryConnect(port), false, 'apply 被拒绝后不应留下监听');
});

test('生命周期：初次启动过程中 dispose 不泄漏监听', async () => {
  const port = await closedPort();
  const ctx = makeCtx();
  // apply 的同步段会走到 listen 的 await；此刻 starting 已就位，dispose 落在启动窗口内
  const applying = apply(ctx, cfg(port));
  await ctx.dispose();
  await applying.catch(() => { /* 释放期间 apply 可能被拒绝 */ });
  assert.equal(await tryConnect(port), false);
});
