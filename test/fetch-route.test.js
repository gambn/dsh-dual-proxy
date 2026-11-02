import test from 'node:test';
import assert from 'node:assert/strict';
import { installFetchRoute, uninstallFetchRoute, isFetchRouteInstalled } from '../src/fetch-route.js';
import { startTarget, startFakeProxy } from './helpers.js';

test('fetch 路由：安装后 http 请求经代理，卸载后恢复直连', async () => {
  const target = await startTarget();
  const proxy = await startFakeProxy();
  await installFetchRoute('http://127.0.0.1:' + proxy.port, '');
  try {
    assert.equal(isFetchRouteInstalled(), true);
    const r = await fetch('http://127.0.0.1:' + target.port + '/through');
    assert.equal(r.headers.get('x-via'), 'proxy');
  } finally {
    uninstallFetchRoute();
  }
  assert.equal(isFetchRouteInstalled(), false);
  const direct = await fetch('http://127.0.0.1:' + target.port + '/direct');
  assert.equal(direct.headers.get('x-via'), null);

  await proxy.close();
  await target.close();
});

test('fetch 路由：noProxy 命中回环时直连，不进代理', async () => {
  const target = await startTarget();
  const proxy = await startFakeProxy();
  await installFetchRoute('http://127.0.0.1:' + proxy.port, '127.0.0.1');
  try {
    const r = await fetch('http://127.0.0.1:' + target.port + '/bypass');
    assert.equal(r.headers.get('x-via'), null);
  } finally {
    uninstallFetchRoute();
  }
  await proxy.close();
  await target.close();
});

test('fetch 路由：重复安装同一地址不叠层，换地址会替换', async () => {
  const target = await startTarget();
  const proxyA = await startFakeProxy('a');
  const proxyB = await startFakeProxy('b');
  await installFetchRoute('http://127.0.0.1:' + proxyA.port, '');
  try {
    await installFetchRoute('http://127.0.0.1:' + proxyA.port, '');
    const same = await fetch('http://127.0.0.1:' + target.port + '/same');
    assert.equal(same.headers.get('x-via'), 'a');

    await installFetchRoute('http://127.0.0.1:' + proxyB.port, '');
    const other = await fetch('http://127.0.0.1:' + target.port + '/other');
    assert.equal(other.headers.get('x-via'), 'b');
  } finally {
    uninstallFetchRoute();
  }
  await proxyA.close();
  await proxyB.close();
  await target.close();
});
