const STATE_KEY = Symbol.for('dsh-dual-proxy.fetch-route');
const DEFAULT_NO_PROXY = 'localhost,127.0.0.1,::1,[::1]';

// 延迟加载 undici：让 Node 版本检查能在 undici 之前给出可读错误
let undiciPromise = null;
function undici() {
  undiciPromise ??= import('undici');
  return undiciPromise;
}

/**
 * 把宿主进程的 `fetch` 引到本地代理上（undici 全局 dispatcher）。
 *
 * 回环地址默认绕过代理：本机服务、以及代理自身，都不该再经一次隧道。
 * 重复用同一地址安装不会叠层；换地址会先拆掉上一次。
 */
export async function installFetchRoute(proxyUrl, noProxy = DEFAULT_NO_PROXY) {
  const { EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher } = await undici();
  const existing = globalThis[STATE_KEY];
  if (existing) {
    if (existing.proxyUrl === proxyUrl && existing.noProxy === noProxy) return existing.agent;
    uninstallFetchRoute();
  }

  const previous = getGlobalDispatcher();
  const agent = new EnvHttpProxyAgent({
    httpProxy: proxyUrl,
    httpsProxy: proxyUrl,
    noProxy
  });
  setGlobalDispatcher(agent);
  globalThis[STATE_KEY] = { agent, previous, proxyUrl, noProxy, getGlobalDispatcher, setGlobalDispatcher };
  return agent;
}

/** 撤销安装：只在全局 dispatcher 仍是自己时恢复原值，避免覆盖别人后装的。 */
export function uninstallFetchRoute() {
  const state = globalThis[STATE_KEY];
  if (!state) return;
  if (state.getGlobalDispatcher() === state.agent) state.setGlobalDispatcher(state.previous);
  try {
    state.agent.close();
  } catch (e) {
    /* ignore */
  }
  delete globalThis[STATE_KEY];
}

export function isFetchRouteInstalled() {
  return Boolean(globalThis[STATE_KEY]);
}
