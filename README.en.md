# dsh-dual-proxy

[English](README.en.md) · [中文](README.md)

[![CI](https://github.com/gambn/dsh-dual-proxy/actions/workflows/ci.yml/badge.svg)](https://github.com/gambn/dsh-dual-proxy/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/dsh-dual-proxy.svg)](https://www.npmjs.com/package/dsh-dual-proxy)

**A gateway manager for agents: switch between multiple gateways online, so model requests are never stuck on one flaky path.**

It treats the network path from an agent to the model endpoint as a managed resource: it picks whichever configured upstream, extra proxy, launch-environment proxy, or direct connection can reach the target, keeps verifying that channel with real requests, and switches on failure — without restarting the host or touching client configuration.

## Quick start

```bash
# DSH plugin (npm)
dsh plugin --profile web add dsh-dual-proxy

# Standalone CLI
npm install -g dsh-dual-proxy
```

Requires Node.js ≥ 22.19.0; the DSH plugin also requires dsh ≥ 0.1.7. After installing the plugin, confirm `dsh.profile.bundles` lists `dsh-dual-proxy`, then restart `dsh web`; see below for details.

Install from source (optional):

```bash
git clone https://github.com/gambn/dsh-dual-proxy.git
cd dsh-dual-proxy
npm install
dsh plugin --profile web add "$PWD"
```

Two shapes, one core:

- **DSH plugin** (recommended): starts and stops with DSH, configured under Settings → Plugins, and can route the host's own model requests through this proxy.
- **Standalone process**: run the CLI, or install it as a systemd user service; non-DSH agents and scripts can use it directly.

## What it solves

Upstream proxies are not reliable: the same proxy may reach site A but not site B, or be down for a while entirely. When two proxies are installed on one machine, which one works can change from hour to hour. A client that only knows one path fails in bursts, and retrying on a dead path only adds delay.

This layer keeps all candidate paths in hand and chooses per host:

```
client → 127.0.0.1:7898
           ├── gateway A (TLS probe passes) → upstream proxy
           ├── gateway B (TLS probe passes) → upstream proxy
           └── all probes fail → direct
```

The health check runs the same candidate list with a real request; the first one that returns a response below 500 becomes the global favourite.

## Behaviour

- Candidate gateways = `upstreamHost:upstreamPort` (or `upstreamUrl`) + `gateways` + `HTTP(S)_PROXY`/`ALL_PROXY` from the launch environment, deduplicated, excluding the proxy's own listen port, with `direct` appended last.
- **Upstream proxy authentication**: `upstreamUrl`, `gateways`, or a proxy URL in the launch environment may carry `user:pass`; proxy connections then send `Proxy-Authorization: Basic`. 0.7.0 supports only `http://` upstream proxies: `upstreamUrl` with `https://` is an error, while `https://` in `gateways`/environment variables is skipped with a redacted warning. Basic is base64, not encryption; use it only on loopback or trusted networks.
- **CONNECT (HTTPS)**: on 443, each candidate gets a TLS handshake probe; only a candidate that passes is used to open the tunnel. On failure, the next one is tried.
- **Plain HTTP**: the request body is buffered first (8 MB limit), and the request is replayed along the same candidate order. Connect uses `attemptTimeoutMs` (`fastFailTimeoutMs` for a known path), waiting for response headers uses `responseTimeoutMs`; the timer stops once the response body starts streaming.
- **Idempotency-key replay**: with `retryNonIdempotentWithIdempotencyKey` on, a non-idempotent request is replayed after send only when it carries a non-empty `Idempotency-Key`/`X-Idempotency-Key`; the proxy does not verify that the upstream actually deduplicates.
- **Replay policy (plain HTTP only; CONNECT tunnels are never replayed)**: if the TCP connection to the gateway/target is not established yet, any method is replayed. Once the connection is established, only idempotent methods are replayed (`GET`/`HEAD`/`OPTIONS`/`TRACE`/`PUT`/`DELETE`). `POST`/`PATCH` and other methods stop by default with 502 and the body `non-idempotent request may have been delivered; not replayed`; enable `retryNonIdempotentAfterSend` for the old behaviour.
- **Fast-fail covers the connect phase only**: if the cached or health-preferred gateway cannot connect over TCP, it is skipped within 2 seconds; if it connects but never returns response headers, the request still waits the full `responseTimeoutMs` (60 seconds by default).
- **Health check**: every `healthIntervalMs`, a `GET healthUrl` validates the channel; anything below 500 counts as reachable (401/403 means the endpoint is alive). The winner becomes the global favourite; if all candidates fail, the favourite is cleared and the next request re-scans. Set to `0` to disable.
- **Per-host preference cache** (60 seconds by default, up to 1000 entries, LRU eviction): a cache hit skips probing; a failure switches immediately.
- **Gateway cooldown** (30 seconds by default): after a failure, that candidate moves to the end of the order so other hosts do not hit it first; a successful health check clears the cooldown.
- **Failure triggers a health check**: any failed path kicks a health re-check (at most once per second), instead of waiting for the next 60-second cycle.
- **Host integration** (`routeHostFetch`, plugin only): uses an undici global dispatcher to send the process's `fetch` calls through this proxy, so model requests really take this path. Loopback addresses bypass the proxy; disabling or unloading restores the previous dispatcher.
- **Hop-by-hop headers** are stripped per RFC 9110 (`Connection` and the fields it names, `Proxy-Connection`, `Transfer-Encoding`, etc.), and `Host` is rewritten to the target; response hop-by-hop headers are stripped too.
- **IPv6**: CONNECT accepts literals such as `[::1]:443`; hosts are normalised by removing brackets, lowercasing, and dropping a trailing dot.
- **Shutdown** waits up to `shutdownTimeoutMs` (1.5 seconds by default; an internal option, not exposed in the settings page or CLI) for in-flight requests, then force-destroys all sockets.
- A 502 is returned when every candidate fails, and also immediately when a non-idempotent request fails after the connection is established with `retryNonIdempotentAfterSend` off and no usable idempotency-key switch (remaining candidates are not tried).
- Logs contain the host, gateway and reason only; request contents are never logged.

## As a DSH plugin

```bash
# after the npm release
dsh plugin --profile web add dsh-dual-proxy

# local / link install
cd /path/to/dsh-dual-proxy && npm install   # a link install does not install dependencies into the project
dsh plugin --profile web add /path/to/dsh-dual-proxy
```

Requires Node.js ≥ 22.19.0 (required by `undici` 8). On older versions the CLI exits with a clear error and plugin loading fails with a readable message. The plugin requires dsh ≥ 0.1.7 (the volatile settings form starts there).

Confirm that `~/.dsh/profiles/web/package.json` lists `dsh-dual-proxy` under `dsh.profile.bundles` (the package ships `cordis.patch.yml`, and a bundle is composed only when listed), then restart `dsh web`. Once enabled, the following fields are editable under Settings → Plugins:

| Field | Default | Description |
| :--- | :--- | :--- |
| `listenHost` | `127.0.0.1` | Listen address |
| `listenPort` | `7898` | Listen port |
| `upstreamHost` | `127.0.0.1` | First candidate gateway |
| `upstreamPort` | `7897` | Port of the first candidate |
| `upstreamUrl` | empty | Full URL of the first candidate, may include `user:pass`; overrides `upstreamHost`/`upstreamPort` when set; an invalid value is a hard error |
| `gateways` | empty | Extra candidates, comma-separated `host:port` |
| `routeHostFetch` | `false` | Route the host's `fetch` through this proxy (enabled by the bundle patch) |
| `healthUrl` | `https://api.deepseek.com` | Channel check URL; empty disables background checks (443 still gets the TLS probe; plain HTTP just tries in order) |
| `healthIntervalMs` | `60000` | Health-check interval; `0` disables |
| `fastFailTimeoutMs` | `2000` | Connect timeout for a known path (cache/favourite) |
| `cooldownMs` | `30000` | Cooldown for a failed gateway; `0` disables |
| `retryNonIdempotentAfterSend` | `false` | Also replay `POST`/`PATCH` after the connection was established (dangerous, off by default) |
| `retryNonIdempotentWithIdempotencyKey` | `false` | Allow post-send replay of non-idempotent requests only when they carry a non-empty `Idempotency-Key`/`X-Idempotency-Key` |
| `attemptTimeoutMs` | `5000` | Per-attempt/per-probe timeout |
| `responseTimeoutMs` | `60000` | Upper bound for waiting on response headers |
| `prefTtlMs` | `60000` | Per-host preference TTL |
| `verifyTls` | `true` | Whether to probe TLS on 443 |

**0.6.0 behaviour change**: `POST`/`PATCH` are no longer replayed after the connection is established; they now return 502. Enable `retryNonIdempotentAfterSend` for the old behaviour.

With `routeHostFetch` on, DSH's own model requests go to 7898 first and then follow gateway selection. It affects every `fetch` in the process (not only model calls); child processes such as `pnpm` and `git` do not inherit it and keep using the launch-environment proxy. Disabling or unloading the plugin restores the previous dispatcher.

**Port conflict**: the plugin occupies `7898`. If a standalone instance or systemd service was running before, stop it first:

```bash
systemctl --user disable --now dsh-dual-proxy 2>/dev/null
```

## As a standalone process

```bash
node bin/dsh-dual-proxy.js --listen-port 7898 --upstream-port 7897 \
  --gateway 127.0.0.1:12334 --health-url https://api.deepseek.com
```

| Flag | Default | Description |
| :--- | :--- | :--- |
| `--listen-host` | `127.0.0.1` | Listen address |
| `--listen-port` | `7898` | Listen port |
| `--upstream-host` | `127.0.0.1` | First candidate gateway |
| `--upstream-port` | `7897` | Port of the first candidate |
| `--upstream-url` | — | Full URL of the first candidate, may include `user:pass`; overrides host/port |
| `--gateway` | — | Extra candidate, repeatable |
| `--health-url` | empty | Channel check URL |
| `--health-interval-ms` | `60000` | Health-check interval, `0` disables |
| `--fast-fail-ms` | `2000` | Connect timeout for a known path |
| `--cooldown-ms` | `30000` | Cooldown for a failed gateway |
| `--timeout-ms` | `5000` | Per-attempt/per-probe timeout |
| `--response-timeout-ms` | `60000` | Upper bound for response headers |
| `--pref-ttl-ms` | `60000` | Per-host preference TTL |
| `--no-verify-tls` | off | Skip the TLS probe on 443 |
| `--retry-non-idempotent-after-send` | off | Also replay `POST`/`PATCH` after the connection was established |
| `--retry-non-idempotent-with-idempotency-key` | off | Allow post-send replay when `Idempotency-Key` is present |

Environment variables use the same names (`LISTEN_HOST`, `LISTEN_PORT`, `UPSTREAM_HOST`, `UPSTREAM_PORT`, `UPSTREAM_URL`, `GATEWAY`, `HEALTH_URL`, `HEALTH_INTERVAL_MS`, `FAST_FAIL_MS`, `COOLDOWN_MS`, `ATTEMPT_TIMEOUT_MS`, `RESPONSE_TIMEOUT_MS`, `PREF_TTL_MS`, `VERIFY_TLS=0`, `RETRY_NON_IDEMPOTENT_AFTER_SEND=1`, `RETRY_NON_IDEMPOTENT_WITH_IDEMPOTENCY_KEY=1`).

A systemd user-service template lives in `contrib/`.

## Tests

```bash
npm test
```

The suite runs from the repository or the source archive; run `npm install` once in the source directory before `npm test`. The npm package does not include `test/`, so it cannot be run from an installed package.

The suite covers: HTTP direct fallback, forwarding through a fake proxy, skipping a dead gateway among several, 502 when every path fails, timeout-based failover from a black-hole gateway, hop-by-hop header filtering in both directions, upstream disconnects mid-response without crashing, CONNECT direct tunnels and fake-proxy tunnels, early data arriving with the CONNECT 200, IPv6 literals, fast-fail when a cached gateway stalls, cooldown after a failure, forced tunnel teardown on shutdown, gateway parsing/deduplication (including self-exclusion and self-loop protection), health-check selection and failure, the health loop remembering the favourite, failure kicking a health check, the health-check reentrancy lock, the preference-cache cap, CLI validation and exit codes, plugin lifecycle (start/restart/two contexts), self-signed TLS probing, the non-idempotent replay policy (send boundary, method classes, switch, logs and cooldown), upstream proxy authentication (CONNECT/HTTP/health, 407), the idempotency-key replay switch (presence checks and logs), and `fetch` route installation/replacement/rollback with loopback bypass.

## Boundaries

- Only HTTP/1.1 `CONNECT` and plain HTTP; no transparent proxying and no UDP.
- A plain HTTP request waits up to `responseTimeoutMs` (60 seconds by default) for response headers after the gateway connection is established; 0.7.0 does not shorten that wait, and the idempotency key only changes the replay decision after the timeout.
- Once a CONNECT tunnel is established the proxy only forwards bytes and TLS is end-to-end; an in-tunnel failure cannot be failed over. Covering it would require MITM decryption, which conflicts with this project's no-interception design.
- Certificates are not verified, contents are not cached, and there is no authentication. It binds to loopback by default; changing `listenHost` to a non-loopback address logs a warning at startup — that turns it into an unauthenticated proxy, at your own risk.
- Upstream proxy authentication is HTTP Basic only; `https://` upstream proxies (TLS-to-proxy) are not supported. Basic is suitable only on loopback or trusted networks; protecting credentials to a remote proxy is outside this project's scope.
- It only answers "can I get there", not "can I trust it" — certificate validation remains the client's responsibility.
- The health check sends one unauthenticated `GET`; the criterion is "a response below 500", not whether credentials or model permissions are valid.
- **At-most-once is not guaranteed**: with the default `retryNonIdempotentAfterSend: false`, `POST`/`PATCH` return 502 immediately after a failure once the connection is established (possibly delivered, not replayed), while idempotent methods are still replayed; enabling the switch restores replay-after-send at the cost of possible duplicate execution. Client SDK retries on 5xx are outside the proxy's control; for billing- or write-sensitive calls, use idempotency keys upstream.

## Feedback

Use GitHub Issues for questions, bugs, and suggestions: <https://github.com/gambn/dsh-dual-proxy/issues>. Do not paste tokens, keys, or full request contents into an issue; see [SECURITY.md](SECURITY.md) for security reports.

## License

MIT
