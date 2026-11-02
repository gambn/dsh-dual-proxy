# Changelog

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
