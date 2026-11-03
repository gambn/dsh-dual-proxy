// 宿主无关的核心导出：代理服务器与网关解析，不依赖 DSH/cordis。
// 宿主适配层（如 adapters/dsh.js）和独立进程（bin/）都基于这里。
export { createDispatcher, mergeOptions } from './server.js';
export { collectGateways, resolveUpstream, isLoopbackHost, parseGateway } from './gateways.js';
export { assertNode, MIN_NODE } from './engines.js';
