# Security Policy

## Supported versions

0.6.x receives security fixes. Older versions are not supported.

## Reporting a problem

Use GitHub Issues: <https://github.com/gambn/dsh-dual-proxy/issues>

This project does not use an email address for support or security reports. Do not include tokens, API keys, proxy credentials, request bodies, or logs containing secrets in an issue. If a report needs sensitive details, open an issue with a short, non-sensitive summary and ask for a private channel first; do not post the sensitive material publicly.

## Scope

- The plugin runs a local, unauthenticated HTTP proxy on loopback by default. Exposing it on a non-loopback address is outside the supported configuration and is warned about at startup.
- The proxy does not validate upstream certificates, does not cache content, and does not authenticate clients.
- Upstream proxy authentication is not supported; credentials in proxy URLs are discarded.
- Reports about the plugin's own code, dependency handling, or the release artifacts are in scope. Reports about third-party gateways or the model provider are not.
