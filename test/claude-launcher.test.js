import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { splitArgs, childEnvironment, DEFAULT_LISTEN_PORT } from '../bin/claude-dual-proxy.js';

const LAUNCHER = fileURLToPath(new URL('../bin/claude-dual-proxy.js', import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function run(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [LAUNCHER, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

test('claude 启动器：`--` 前的参数留给代理，后面的原样交给 claude', () => {
  assert.deepEqual(splitArgs(['--listen-port', '7896', '--', '--resume', 'abc']), {
    proxyArgs: ['--listen-port', '7896'],
    claudeArgs: ['--resume', 'abc']
  });
});

test('claude 启动器：没有 `--` 时全部按代理参数处理', () => {
  assert.deepEqual(splitArgs(['--listen-port', '7896']), {
    proxyArgs: ['--listen-port', '7896'],
    claudeArgs: []
  });
});

test('claude 启动器：子进程代理变量指向本代理，ALL_PROXY 不再保留 socks', () => {
  const env = childEnvironment({
    PATH: '/usr/bin',
    HTTPS_PROXY: 'http://127.0.0.1:12334',
    all_proxy: 'socks://127.0.0.1:12334/',
    NO_PROXY: 'localhost,192.168.0.0/16'
  }, 'http://127.0.0.1:7896');

  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) {
    assert.equal(env[key], 'http://127.0.0.1:7896');
  }
  assert.equal(env.ALL_PROXY, 'http://127.0.0.1:7896');
  assert.equal(env.all_proxy, 'http://127.0.0.1:7896');
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.NO_PROXY, 'localhost,127.0.0.1,::1,[::1],192.168.0.0/16');
  assert.equal(env.no_proxy, env.NO_PROXY);
});

test('claude 启动器：默认端口与 dsh 的 7898/7899 错开', () => {
  assert.equal(DEFAULT_LISTEN_PORT, 7896);
});

test('claude 启动器：代理起来后把 HTTPS_PROXY 交给 claude 并正常退出', async () => {
  const port = await freePort();
  const { code, stdout } = await run(
    ['--listen-port', String(port), '--', '-e', 'process.stdout.write(process.env.HTTPS_PROXY || "")'],
    { CLAUDE_BIN: process.execPath }
  );
  assert.equal(code, 0);
  assert.equal(stdout, 'http://127.0.0.1:' + port);
});

test('claude 启动器：claude 不存在时报错并以 1 退出', async () => {
  const port = await freePort();
  const { code, stderr } = await run(
    ['--listen-port', String(port), '--'],
    { CLAUDE_BIN: '/nonexistent/claude-binary-for-test' }
  );
  assert.equal(code, 1);
  assert.match(stderr, /failed to start/);
});
