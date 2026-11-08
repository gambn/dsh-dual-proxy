# Changelog

## 0.7.3

### Added

- 人工目的地分流规则：`preferDirect` / `--prefer-direct`（`PREFER_DIRECT`）与 `preferProxy` / `--prefer-proxy`（`PREFER_PROXY`），按目标 host 指定先直连或先走代理；逗号分隔，支持 `*` 通配。DSH 插件、独立 CLI 和 `claude-dual-proxy` 三个入口贯通，`--print-config` 输出规则。
- 规则优先级：规则 > per-host 缓存 > 全局健康首选 > 默认顺序；两名单同时命中时直连优先；未命中规则的 host 候选顺序不变。

### Changed

- 冷却从单一网关级改为两档：代理自身 TCP/DNS/建连失败、407、代理沉默/响应头前 reset 全局冷却；direct 建连失败、经代理 CONNECT 到目标失败、TLS 失败、direct 等头超时、direct 响应头前 reset 按 `host + gateway` 冷却；收到响应头后的流式中断不记冷却。
- fast-fail 只对真正的缓存/健康首选生效；规则命中不制造“已知路径”，`preferDirect` 首条仍用完整 `attemptTimeoutMs`。
- 健康检查仍是单 URL 全局信号，规则命中的 host 不受它影响；只作为未命中规则 host 的兜底。
- `src/paths.js` 增加 phase 分类，CONNECT 路径区分代理建连失败与目标 CONNECT 失败。

### Notes

- Node 门槛仍为 `>=22.19.0`，`undici` 仍为 8.12.3；DSH 的 `routeHostFetch` 依赖它的全局 dispatcher。
- 总用例 158；`rules.js` 行/分支 100%；项目级行覆盖 94.40%。

## 0.7.2

### Added

- `portFallback` / `--port-fallback` / `PORT_FALLBACK`: retry port+1 on `EADDRINUSE` and log the actual bound port. Plugin default `0` keeps the known 7898 entry; `claude-dual-proxy` defaults to 10 and passes the actual port to the child.
- `--print-config` (alias `--dry-run`) for the standalone CLI: prints the effective listen/upstream/gateway/health/timeout/replay configuration and exits. Auth is shown as booleans; health URL userinfo, query, and hash are stripped.
- `EADDRINUSE` diagnostics distinguish a listening process from TIME-WAIT sockets and use platform-specific hints (`ss` or `Get-NetTCPConnection`).

### Changed

- After a port fallback, candidates are rebuilt against the actual bound port so a gateway cannot point at the proxy itself.
- socks upstream candidates are skipped with a self-explanatory warning, deduplicated across case variants of the environment variables.
- README troubleshooting covers TIME-WAIT, socks warnings, and the fixed-vs-fallback port tradeoff.

### Notes

- Node floor remains `>=22.19.0` and `undici` remains 8.12.3 because `routeHostFetch` depends on its global dispatcher.

## 0.7.1

### Added

- `claude-dual-proxy` launcher: starts the proxy, points the child Claude Code process's `HTTP(S)_PROXY`/`ALL_PROXY` at it, adds loopback to `NO_PROXY`, and closes the proxy when `claude` exits. Listens on 7896 by default so it does not collide with the DSH profiles.
- `dsh-dual-proxy/core` export with the host-neutral dispatcher and gateway helpers.
- Local identity endpoint `GET /__agent_dual_proxy__` returning `x-agent-dual-proxy: 1` for port-reuse checks and operations.

### Changed

- The DSH cordis entry moved to `src/adapters/dsh.js`; `src/index.js` re-exports it, so the package entry and existing imports keep working.

## 0.7.0

### Added

- HTTP upstream proxy authentication: `upstreamUrl`, `gateways`, and launch-environment proxy URLs may carry `user:pass`; CONNECT, plain HTTP, TLS probes, and health checks send `Proxy-Authorization: Basic`.
- `retryNonIdempotentWithIdempotencyKey`: allow post-send replay of non-idempotent plain HTTP requests only when they carry a non-empty `Idempotency-Key` or `X-Idempotency-Key`. Off by default.
- `upstreamUrl` configuration/CLI/env field, overriding `upstreamHost`/`upstreamPort` and failing fast when invalid.

### Changed

- A proxy `407` is now treated as a failed gateway instead of being forwarded to the client; `407` bypasses the non-idempotent stop logic because the target never received the request.
- `https://` upstream proxies are rejected explicitly; 0.6.0 treated them as plaintext CONNECT, which could not work safely.
- `SECURITY.md` and `CHANGELOG.md` are included in the npm package (18 files).

### Known limits

- Plain HTTP requests still wait up to `responseTimeoutMs` (default 60 seconds) for response headers; the idempotency-key switch only changes what happens after that wait.
- A CONNECT tunnel is opaque after establishment; an in-tunnel failure cannot be failed over without MITM, which this project does not do.

## 0.6.0

- `POST`/`PATCH` are no longer replayed after the connection is established by default; they return 502 with `non-idempotent request may have been delivered; not replayed`.
- Added `retryNonIdempotentAfterSend` (default off) to restore the old replay behaviour.

## 0.5.3

- Hardened listener lifecycle, CLI symlink handling, and initial-start disposal.

## 0.5.2

- Code-quality and audit follow-ups.

## 0.5.1

- P0/P1 hardening.

## 0.5.0

- Automatic gateway selection, TLS reachability probes, health checks, per-host preference cache, cooldown, and fast-fail.
