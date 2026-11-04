# Changelog

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
