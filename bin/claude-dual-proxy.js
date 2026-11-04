#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs, UsageError } from './dsh-dual-proxy.js';
import { assertNode, collectGateways, createDispatcher, isLoopbackHost, resolveUpstream } from '../src/core.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

// 与 dsh web（7898）、headless（7899）错开，避免同机运行时抢端口
export const DEFAULT_LISTEN_PORT = 7896;
const DEFAULT_NO_PROXY = ['localhost', '127.0.0.1', '::1', '[::1]'];

/** 参数以 `--` 分界：前面是代理参数，后面原样交给 claude。 */
export function splitArgs(argv) {
  const at = argv.indexOf('--');
  if (at === -1) return { proxyArgs: argv, claudeArgs: [] };
  return { proxyArgs: argv.slice(0, at), claudeArgs: argv.slice(at + 1) };
}

/** 监听地址 → 代理 URL（0.0.0.0/:: 视为回环） */
function proxyUrlFor(addr) {
  const address = addr.address === '0.0.0.0' || addr.address === '::' ? '127.0.0.1' : addr.address;
  return 'http://' + (address.includes(':') ? '[' + address + ']' : address) + ':' + addr.port;
}

/**
 * 给 Claude Code 子进程准备环境：所有代理变量指向本代理，
 * 并去掉启动环境里的 socks ALL_PROXY（部分客户端会优先用它）。
 */
export function childEnvironment(baseEnv, proxyUrl) {
  const env = { ...baseEnv };
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
    env[key] = proxyUrl;
  }
  const noProxy = [...DEFAULT_NO_PROXY];
  for (const item of String(env.NO_PROXY ?? env.no_proxy ?? '').split(',')) {
    const value = item.trim();
    if (value && !noProxy.includes(value)) noProxy.push(value);
  }
  env.NO_PROXY = noProxy.join(',');
  env.no_proxy = env.NO_PROXY;
  return env;
}

function usage() {
  process.stdout.write([
    'claude-dual-proxy ' + pkg.version,
    '',
    'Start the dual proxy, then run Claude Code with HTTP(S)_PROXY pointed at it.',
    '',
    'Usage: claude-dual-proxy [proxy options] [-- claude args...]',
    '',
    'Proxy options are the same as dsh-dual-proxy; --listen-port defaults to ' + DEFAULT_LISTEN_PORT + '.',
    'Everything after `--` is passed to claude unchanged.',
    '',
    'Env: CLAUDE_BIN overrides the claude executable (default: claude).',
    ''
  ].join('\n'));
}

async function main() {
  try {
    assertNode();
    const { proxyArgs, claudeArgs } = splitArgs(process.argv.slice(2));
    const env = { ...process.env, LISTEN_PORT: process.env.LISTEN_PORT ?? String(DEFAULT_LISTEN_PORT) };
    if (env.PORT_FALLBACK === undefined || env.PORT_FALLBACK === '') env.PORT_FALLBACK = '10';
    const opts = parseArgs(proxyArgs, env);
    if (opts.help) { usage(); return; }
    if (opts.version) { process.stdout.write(pkg.version + '\n'); return; }

    const upstream = resolveUpstream(opts);
    if (!isLoopbackHost(opts.listenHost)) {
      process.stderr.write('warning: listening on ' + opts.listenHost + '; this proxy has no authentication\n');
    }

    const gateways = collectGateways({
      upstream,
      extra: opts.gateways,
      env: process.env,
      self: { host: opts.listenHost, port: opts.listenPort },
      onInvalid: (subject, reason) => process.stderr.write('warning: ' + subject + ': ' + reason + '\n')
    });
    const dispatcher = createDispatcher(Object.assign({}, opts, {
      upstreamHost: upstream.host,
      upstreamPort: upstream.port,
      upstreamAuth: upstream.auth,
      gateways
    }));
    const addr = await dispatcher.listen();
    dispatcher.startHealth();

    const proxyUrl = proxyUrlFor(addr);
    const claudeBin = process.env.CLAUDE_BIN || 'claude';
    process.stderr.write('[claude-dual-proxy] listening on ' + addr.address + ':' + addr.port +
      ' gateways=' + gateways.map((g) => g.host + ':' + g.port).concat('direct').join(',') +
      ' -> ' + claudeBin + '\n');

    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      try { await dispatcher.close(); } catch (e) { /* ignore */ }
    };

    const child = spawn(claudeBin, claudeArgs, {
      stdio: 'inherit',
      env: childEnvironment(process.env, proxyUrl)
    });

    child.on('error', async (err) => {
      process.stderr.write('failed to start ' + claudeBin + ': ' + err.message + '\n');
      await close();
      process.exit(1);
    });
    child.on('exit', async (code) => {
      await close();
      process.exit(code ?? 1);
    });

    const forward = (signal) => {
      // 让 claude 自己收尾，等它的 exit 事件再关代理，避免留下孤儿进程
      if (child.exitCode !== null || child.signalCode !== null) {
        close().finally(() => process.exit(0));
        return;
      }
      try { child.kill(signal); } catch (e) { /* ignore */ }
    };
    process.on('SIGINT', () => forward('SIGINT'));
    process.on('SIGTERM', () => forward('SIGTERM'));
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(err.message + '\n');
      process.exitCode = 2;
    } else {
      process.stderr.write('error: ' + (err && err.message ? err.message : String(err)) + '\n');
      process.exitCode = 1;
    }
  }
}

/** 入口判断：npm 通过符号链接调用时，argv[1] 与真实路径不同，必须 realpath 比较。 */
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (e) {
    return false;
  }
}

if (isMain()) {
  main();
}
