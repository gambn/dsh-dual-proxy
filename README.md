# dsh-dual-proxy

[中文](README.md) · [English](README.en.md)

[![CI](https://github.com/gambn/dsh-dual-proxy/actions/workflows/ci.yml/badge.svg)](https://github.com/gambn/dsh-dual-proxy/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/dsh-dual-proxy.svg)](https://www.npmjs.com/package/dsh-dual-proxy)

**Agent 的网关管理插件：在多个网关之间在线自动切换，让模型请求不再被一条不稳的路卡死。**

它把「agent 到模型端点的网络路径」当成可管理的资源：在配置的上游、额外指定的代理、启动环境里的代理和直连之间自动选一条能通的；运行中用真实请求持续验证，失败立刻切到下一条——不需要重启宿主，也不需要改客户端配置。

## 快速开始

```bash
# DSH 插件（npm）
dsh plugin --profile web add dsh-dual-proxy

# 独立 CLI
npm install -g dsh-dual-proxy
```

要求 Node.js ≥ 22.19.0；DSH 插件还要求 dsh ≥ 0.1.7。插件安装后确认 `dsh.profile.bundles` 含 `dsh-dual-proxy`，再重启 `dsh web`；细节见下文。

从源码安装（可选）：

```bash
git clone https://github.com/gambn/dsh-dual-proxy.git
cd dsh-dual-proxy
npm install
dsh plugin --profile web add "$PWD"
```

两种形态，同一份核心：

- **DSH 插件**（推荐）：随 DSH 启停，配置在「设置 → 插件」里改，可把宿主自身的模型请求接进来；
- **独立进程**：手动跑 CLI，或挂 systemd 用户服务，非 DSH 宿主的 agent 与脚本也能直接用。

## 它解决什么

上游代理并不稳定：同一个代理可能对 A 站通、对 B 站不通，也可能整段时间全挂；本机同时装着两个代理时，哪个能用还会变。只认一条路的客户端在这种时候会成片失败，而在死路上重试只是拖延。

这一层把候选路都握在手里，按 host 选：

```
客户端 → 127.0.0.1:7898
           ├── 网关 A（TLS 探测通过）→ 上游代理
           ├── 网关 B（TLS 探测通过）→ 上游代理
           └── 都探测失败 → 直连
```

健康检查用一个真实请求把同一组候选走一遍，谁先给出 <500 的响应，谁就成为全局首选。

## 行为

- 候选网关 = `upstreamHost:upstreamPort` + `gateways` + 启动环境的 `HTTP(S)_PROXY`/`ALL_PROXY`，去重并排除自身监听端口，最后补 `direct`。
- **CONNECT（HTTPS）**：443 上先对候选做 TLS 握手探测，通过的才用来开隧道；失败换下一条。
- **普通 HTTP**：请求体先缓冲（上限 8 MB），按同一顺序换路重放；建连用 `attemptTimeoutMs`（已知路径用 `fastFailTimeoutMs`），等响应头用 `responseTimeoutMs`，响应体开始流之后不再计时。
- **重放策略（仅普通 HTTP，CONNECT 隧道不重放）**：到网关/目标的 TCP 连接还没建立就失败时，任何方法都重放；连接建立后失败时，只重放幂等方法（`GET`/`HEAD`/`OPTIONS`/`TRACE`/`PUT`/`DELETE`）。`POST`/`PATCH` 等默认停止并回 502，响应体是 `non-idempotent request may have been delivered; not replayed`；需要旧行为时打开 `retryNonIdempotentAfterSend`。
- **已知路径的快失败只覆盖建连阶段**：缓存或健康首选的那条网关，TCP 连不上时 2 秒内换路；如果它连上了却迟迟不回响应头，仍要等满 `responseTimeoutMs`（默认 60 秒）。
- **健康检查**：每 `healthIntervalMs` 用 `GET healthUrl` 验证一次通道，`<500` 就算通（401/403 说明端点活着）；通过者设为全局首选，全部失败则清掉首选、下次请求重新扫描。设为 `0` 关闭。
- **每 host 偏好缓存**（默认 60 秒，最多 1000 条，LRU 淘汰）：缓存命中跳过探测；失败即切换。
- **失败网关冷却**（默认 30 秒）：某条路失败后进入冷却，期间排到最后，别的 host 不会再先撞它；健康检查证明它恢复时自动解除。
- **失败即复检**：任何一条路刚失败就踢一次健康检查（1 秒内只踢一次），不用等下一个 60 秒周期。
- **接入宿主**（`routeHostFetch`，插件形态）：用 undici 全局 dispatcher 把进程内的 `fetch` 引到本代理，模型请求因此真的经过这里选路；回环地址默认直连，禁用/卸载时恢复原来的 dispatcher。
- **逐跳标头**按 RFC 9110 过滤（`Connection` 及其点名的字段、`Proxy-Connection`、`Transfer-Encoding` 等），`Host` 重写为目标主机；响应方向的逐跳标头同样清掉。
- **IPv6**：CONNECT 支持 `[::1]:443` 这类字面量，host 统一去掉方括号、转小写、去掉 FQDN 末尾的点。
- **关闭**最多等 `shutdownTimeoutMs`（默认 1.5 秒，内部选项，不在设置页与 CLI 暴露）让在途请求自然结束，超时后强制断开所有 socket。
- 全部候选都失败时回 502；非幂等请求在连接建立后失败且未开 `retryNonIdempotentAfterSend` 时也会立即回 502，不再尝试剩余候选。
- 日志只写主机、网关与原因，不记录任何请求内容。

## 作为 DSH 插件

```bash
# 已发布到 npm 后
dsh plugin --profile web add dsh-dual-proxy

# 本地 / link 安装
cd /path/to/dsh-dual-proxy && npm install   # 链接安装不会把依赖装进项目目录
dsh plugin --profile web add /path/to/dsh-dual-proxy
```

运行要求 Node.js ≥ 22.19.0（`undici` 8 的要求）；版本不满足时 CLI 会直接报错退出，插件加载也会给出明确错误。插件形态需要 dsh ≥ 0.1.7（设置页的 volatile 表单从该版本开始提供）。

确认 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 里包含 `dsh-dual-proxy`（插件包里带 `cordis.patch.yml`，加进 bundles 才会被组合），然后重启 `dsh web`。启用后在「设置 → 插件」里可以看到并修改：

| 字段 | 默认 | 说明 |
| :--- | :--- | :--- |
| `listenHost` | `127.0.0.1` | 监听地址 |
| `listenPort` | `7898` | 监听端口 |
| `upstreamHost` | `127.0.0.1` | 第一个候选网关 |
| `upstreamPort` | `7897` | 第一个候选网关的端口 |
| `gateways` | 空 | 额外候选网关，`host:port` 逗号分隔 |
| `routeHostFetch` | `false` | 把宿主进程的 `fetch` 引到本代理（bundle patch 里默认打开） |
| `healthUrl` | `https://api.deepseek.com` | 通道验证地址；空则关闭后台验证（443 仍做 TLS 探测，普通 HTTP 只按顺序试） |
| `healthIntervalMs` | `60000` | 健康检查间隔；`0` 关闭 |
| `fastFailTimeoutMs` | `2000` | 已知路径（缓存/首选）的建连超时 |
| `cooldownMs` | `30000` | 失败网关的冷却时长；`0` 关闭 |
| `retryNonIdempotentAfterSend` | `false` | 连接建立后失败时也重放 `POST`/`PATCH`（危险，默认关） |
| `attemptTimeoutMs` | `5000` | 每次尝试/探测超时 |
| `responseTimeoutMs` | `60000` | 普通 HTTP 等响应头的上限 |
| `prefTtlMs` | `60000` | 每 host 偏好缓存 TTL |
| `verifyTls` | `true` | 443 上是否做 TLS 探测 |

**0.6.0 行为变更**：`POST`/`PATCH` 在连接建立后失败不再自动换路重放，改为 502；需要旧行为时打开 `retryNonIdempotentAfterSend`。

`routeHostFetch` 打开后，DSH 自己的模型请求会先到 7898 再按网关选路。它作用于进程内的所有 `fetch`（不止模型调用）；`pnpm`、`git` 这类子进程不继承，仍按启动环境里的代理走。插件被禁用或卸载时，原来的 dispatcher 会被还原。

**端口冲突**：插件会占用 `7898`。如果之前挂过独立进程版或 systemd 服务，先停掉：

```bash
systemctl --user disable --now dsh-dual-proxy 2>/dev/null
```

## 作为独立进程

```bash
node bin/dsh-dual-proxy.js --listen-port 7898 --upstream-port 7897 \
  --gateway 127.0.0.1:12334 --health-url https://api.deepseek.com
```

| 参数 | 默认 | 说明 |
| :--- | :--- | :--- |
| `--listen-host` | `127.0.0.1` | 监听地址 |
| `--listen-port` | `7898` | 监听端口 |
| `--upstream-host` | `127.0.0.1` | 第一个候选网关 |
| `--upstream-port` | `7897` | 第一个候选网关的端口 |
| `--gateway` | — | 额外候选网关，可重复 |
| `--health-url` | 空 | 通道验证地址 |
| `--health-interval-ms` | `60000` | 健康检查间隔，`0` 关闭 |
| `--fast-fail-ms` | `2000` | 已知路径的建连超时 |
| `--cooldown-ms` | `30000` | 失败网关的冷却时长 |
| `--timeout-ms` | `5000` | 每次尝试/探测超时 |
| `--response-timeout-ms` | `60000` | 普通 HTTP 等响应头的上限 |
| `--pref-ttl-ms` | `60000` | 每 host 偏好缓存 TTL |
| `--no-verify-tls` | 关 | 跳过 443 的 TLS 探测 |
| `--retry-non-idempotent-after-send` | 关 | 连接建立后失败时也重放 `POST`/`PATCH` |

环境变量同名（`LISTEN_HOST`、`LISTEN_PORT`、`UPSTREAM_HOST`、`UPSTREAM_PORT`、`GATEWAY`、`HEALTH_URL`、`HEALTH_INTERVAL_MS`、`FAST_FAIL_MS`、`COOLDOWN_MS`、`ATTEMPT_TIMEOUT_MS`、`RESPONSE_TIMEOUT_MS`、`PREF_TTL_MS`、`VERIFY_TLS=0`、`RETRY_NON_IDEMPOTENT_AFTER_SEND=1`）。

systemd 用户服务模板在 `contrib/`。

## 测试

```bash
npm test
```

测试面向仓库或源码快照；首次先在源码目录 `npm install`，再 `npm test`。npm 包不含 `test/`，安装后不能直接跑这套用例。

用例覆盖：HTTP 直连回退、经假代理转发、多个网关时跳过不通的、两条都不通返回 502、黑洞网关按超时换路、请求与响应两个方向的逐跳标头过滤、上游中途断开不带崩进程、CONNECT 直连隧道与经假代理隧道、CONNECT 200 同包早期数据、IPv6 字面量、缓存网关卡住时快失败换路、失败网关冷却后不再先撞、关闭时强制断开在途隧道、网关解析与去重（含自身端口排除与自环防护）、健康检查的选择与失败、健康循环记住首选、失败踢一次健康检查、健康检查重入锁、偏好缓存上限、CLI 参数校验与退出码、插件生命周期（启动/重启/双 context）、自签证书的 TLS 探测、非幂等重放策略（send 前后边界、方法分类、开关、日志与冷却）、以及 `fetch` 路由的安装/替换/回滚与回环绕过。

## 边界

- 只处理 HTTP/1.1 的 `CONNECT` 与普通 HTTP；不做透明代理、不接管 UDP。
- 不校验证书，不缓存内容，不做鉴权。默认只绑回环；把 `listenHost` 改成非回环地址会在启动时告警——那等于开放一个无鉴权代理，风险自负。
- 不支持上游代理认证：`http://user:pass@host:port` 里的凭证会被丢弃，实际以匿名方式连接上游。
- 只负责「到不到得了」，不负责「信不信得过」——证书校验仍是客户端的责任。
- 健康检查只发一个无凭证 `GET`，判据是「有没有 <500 的响应」，不代表凭证或模型权限有效。
- **不保证「至多一次」**：默认 `retryNonIdempotentAfterSend: false` 时，`POST`/`PATCH` 在连接建立后失败会直接 502（可能已送达、未重放），幂等方法仍会重放；打开该开关会恢复发送后重放，代价是可能重复执行。客户端 SDK 对 5xx 的自动重试不受代理控制，对计费或写入敏感的调用仍应在上游使用幂等键。

## License

MIT
