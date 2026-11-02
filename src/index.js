import Schema from '@deepseek-ai/schemastery';
import { createDispatcher } from './server.js';
import { collectGateways, isLoopbackHost } from './gateways.js';
import { installFetchRoute, uninstallFetchRoute } from './fetch-route.js';
import { createRestarter } from './restart.js';
import { assertNode } from './engines.js';

/**
 * DSH 插件入口（cordis）。
 *
 * 与独立进程版的区别：服务器起在 DSH 进程内，随插件启用而监听、随 dispose
 * 而关闭；配置由 cordis.patch.yml 提供，并在「设置 → 插件」里可改。
 *
 * routeHostFetch 打开时，把宿主的全局 fetch 引到本代理上，模型请求才会真的
 * 经过这里选路；默认关闭，由 bundle patch 打开。
 */
export const name = 'dsh-dual-proxy';

/** 把字段标记为 volatile：dsh ≥ 0.1.7 才会为它提供设置页表单 */
function live(schema) {
  if (typeof schema?.volatile === 'function') return schema.volatile();
  if (typeof schema?.extra === 'function') return schema.extra('volatile', true);
  return schema;
}

export const Config = Schema.object({
  listenHost: live(Schema.string().default('127.0.0.1')),
  listenPort: live(Schema.number().min(1).max(65535).step(1).default(7898)),
  upstreamHost: live(Schema.string().default('127.0.0.1')),
  upstreamPort: live(Schema.number().min(1).max(65535).step(1).default(7897)),
  gateways: live(Schema.string().default('')),
  routeHostFetch: live(Schema.boolean().default(false)),
  healthUrl: live(Schema.string().default('https://api.deepseek.com')),
  healthIntervalMs: live(Schema.number().min(0).max(3600000).step(1000).default(60000)),
  fastFailTimeoutMs: live(Schema.number().min(100).max(60000).step(100).default(2000)),
  cooldownMs: live(Schema.number().min(0).max(600000).step(1000).default(30000)),
  retryNonIdempotentAfterSend: live(Schema.boolean().default(false)),
  attemptTimeoutMs: live(Schema.number().min(100).max(60000).step(100).default(5000)),
  responseTimeoutMs: live(Schema.number().min(100).max(600000).step(100).default(60000)),
  prefTtlMs: live(Schema.number().min(0).max(3600000).step(1000).default(60000)),
  verifyTls: live(Schema.boolean().default(true))
});

/**
 * 读取一个 Config 字段的当前值。
 *
 * dsh ≥ 0.1.7 会把 volatile 字段包成 `{ get(), [Symbol.for('cosmokit.volatile.write')] }`
 * 访问器；老宿主与测试里则是普通值。两种都要能读。
 */
function fieldValue(config, key, fallback) {
  const node = config?.[key];
  if (node !== undefined && node !== null && typeof node.get === 'function') {
    const value = node.get();
    return value === undefined ? fallback : value;
  }
  return node === undefined || node === null ? fallback : node;
}

/** 解包成一份独立的普通配置，避免把访问器对象传进服务器 */
function plainConfig(config) {
  return {
    listenHost: fieldValue(config, 'listenHost', '127.0.0.1'),
    listenPort: fieldValue(config, 'listenPort', 7898),
    upstreamHost: fieldValue(config, 'upstreamHost', '127.0.0.1'),
    upstreamPort: fieldValue(config, 'upstreamPort', 7897),
    gateways: fieldValue(config, 'gateways', ''),
    routeHostFetch: fieldValue(config, 'routeHostFetch', false),
    healthUrl: fieldValue(config, 'healthUrl', 'https://api.deepseek.com'),
    healthIntervalMs: fieldValue(config, 'healthIntervalMs', 60000),
    fastFailTimeoutMs: fieldValue(config, 'fastFailTimeoutMs', 2000),
    cooldownMs: fieldValue(config, 'cooldownMs', 30000),
    retryNonIdempotentAfterSend: fieldValue(config, 'retryNonIdempotentAfterSend', false),
    attemptTimeoutMs: fieldValue(config, 'attemptTimeoutMs', 5000),
    responseTimeoutMs: fieldValue(config, 'responseTimeoutMs', 60000),
    prefTtlMs: fieldValue(config, 'prefTtlMs', 60000),
    verifyTls: fieldValue(config, 'verifyTls', true)
  };
}

/** 额外网关：逗号或空白分隔的 host:port 列表 */
function extraGateways(value) {
  return String(value || '').split(/[\s,]+/).filter(Boolean);
}

/** 监听地址 → 代理 URL（0.0.0.0/:: 视为回环） */
function proxyUrl(addr) {
  const address = addr.address === '0.0.0.0' || addr.address === '::' ? '127.0.0.1' : addr.address;
  return 'http://' + (address.includes(':') ? '[' + address + ']' : address) + ':' + addr.port;
}

export async function apply(ctx, config) {
  assertNode();
  let running = null;
  let starting = null;
  let disposed = false;

  const log = (msg) => { try { ctx.logger?.info?.(msg); } catch (e) { /* ignore */ } };
  const error = (msg) => { try { ctx.logger?.error?.(msg); } catch (e) { /* ignore */ } };

  const start = async () => {
    if (disposed) return;
    try {
      // 先把 fetch 还原，再换监听：中途失败时宿主还能走启动时的代理策略
      uninstallFetchRoute();
      if (running) {
        const old = running;
        running = null;
        try { await old.close(); } catch (e) { /* ignore */ }
      }
      if (disposed) return;

      const { gateways: gatewayText, routeHostFetch, ...dispatcherConfig } = plainConfig(config);
      if (!isLoopbackHost(dispatcherConfig.listenHost)) {
        log('warning: dsh-dual-proxy listens on non-loopback ' + dispatcherConfig.listenHost + '; the proxy has no authentication');
      }
      const gateways = collectGateways({
        upstream: { host: dispatcherConfig.upstreamHost, port: dispatcherConfig.upstreamPort },
        extra: extraGateways(gatewayText),
        env: process.env,
        self: { host: dispatcherConfig.listenHost, port: dispatcherConfig.listenPort }
      });
      const dispatcher = createDispatcher(Object.assign({}, dispatcherConfig, { gateways, log }));
      const addr = await dispatcher.listen();
      // listen 期间可能已经被释放：别把新实例挂上去
      if (disposed) {
        try { await dispatcher.close(); } catch (e) { /* ignore */ }
        return;
      }
      running = dispatcher;

      if (routeHostFetch) {
        const url = proxyUrl(addr);
        try {
          await installFetchRoute(url);
          if (disposed) return;
          log('dsh-dual-proxy routes host fetch through ' + url);
        } catch (err) {
          error('dsh-dual-proxy could not route host fetch: ' + (err && err.message));
        }
      }
      dispatcher.startHealth();
      log('dsh-dual-proxy listening on ' + addr.address + ':' + addr.port);
    } catch (err) {
      error('dsh-dual-proxy failed to listen: ' + (err && err.message));
    }
  };

  // 每次重启都记录在途的启动 promise，disposer 会等它落定再收尾
  const task = () => {
    const pending = start();
    starting = pending;
    pending.finally(() => {
      if (starting === pending) starting = null;
    }).catch(() => { /* start 自己已经记日志 */ });
    return pending;
  };

  const restart = createRestarter(task);

  if (typeof ctx.on === 'function') {
    // 设置页保存后，宿主会通过 volatile 访问器写入并发出此事件
    ctx.on('loader/volatile-update', () => { restart(); });
  }
  if (typeof ctx.effect === 'function') {
    // cordis 4 没有 'dispose' 事件：清理由 effect 的 disposer 承担，卸载/禁用时才会真正执行。
    ctx.effect(() => async () => {
      disposed = true;
      if (starting) {
        try { await starting; } catch (e) { /* ignore */ }
      }
      uninstallFetchRoute();
      const current = running;
      running = null;
      if (current) {
        try { await current.close(); } catch (e) { /* ignore */ }
      }
    }, 'dsh-dual-proxy.listener');
  }

  // 先注册 disposer 再启动：初次 start 期间 context 被释放时，仍有清理入口
  await restart();
}
