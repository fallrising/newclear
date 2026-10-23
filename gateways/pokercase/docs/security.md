# Admin surface and credential safety

thinrouter is a single-user gateway: it holds personal subscription tokens and turns
them into an API. Anyone who reaches the admin surface can read usage, create gateway
keys and redirect traffic, so these rules hold on every listener, loopback included.

## Admin token

- `/admin` and `/admin/api/*` always require the admin token, sent as
  `x-admin-token: <token>` (scripts) or exchanged for a session at `/admin/login`.
- Without `--admin-token` / `THINROUTER_ADMIN_TOKEN`, `serve` loads
  `<data_dir>/admin-token`, creating it with 32 random bytes (hex, mode 0600) on first
  start. The log shows the file path only; read it with `cat ~/.thinrouter/admin-token`.
  A file readable by group/others is refused.
- Non-loopback listeners (`--host 0.0.0.0`, Docker) still require an explicit
  nonempty `--admin-token` at startup.
- Tokens are compared in constant time. A failed login waits 500 ms.
- The login cookie (`tr_admin`) holds a random session id, never the token:
  `HttpOnly; SameSite=Strict`, plus `Secure` when the proxy reports
  `X-Forwarded-Proto: https`. Sessions live in memory for 12 hours; restart or
  logout ends them.

## CSRF, Origin and Host

- Every admin write (non-GET) with a session cookie must carry that session's CSRF
  token: the hidden `csrf` form field the UI renders, or `x-csrf-token` for `fetch`.
  Header-token requests need no CSRF token because browsers cannot forge that header
  cross-site.
- Admin writes with `Sec-Fetch-Site: cross-site`, or with an `Origin` whose
  host:port differs from `Host`, are refused (403).
- Every route checks `Host` against DNS rebinding: IP literals and `localhost` are
  accepted, plus `--host` and each `--allowed-host` / `THINROUTER_ALLOWED_HOSTS`
  (comma-separated). Other names get 421. Add the Tailscale Serve or tunnel hostname
  here. There is no wildcard; the check cannot be turned off.

## Remote requests and keyless bootstrap

A request is **remote** if its TCP peer is not loopback or it carries any proxy header:
`Forwarded`, `X-Forwarded-For/-Host/-Proto`, `X-Real-IP`, `True-Client-IP`,
`CF-Connecting-IP`, `CF-Ray`, `CDN-Loop`, `Via`, `Tailscale-User-Login`,
`Tailscale-User-Name`, `Tailscale-Funnel-Request`. Tailscale Serve and cloudflared
connect from 127.0.0.1, so the listener address alone proves nothing.

`--allow-keyless-bootstrap` admits only requests that are not remote (see
[cost safety](cost-safety.md)). A forwarder that adds none of these headers (a raw TCP
forward, `ssh -L`) is indistinguishable from a local client, so never run bootstrap
while any forwarder points at the port.

## Upstream base URLs

OAuth tokens are only sent to the provider's official hosts (https, default port):

| Provider | Hosts |
| --- | --- |
| grok | `cli-chat-proxy.grok.com` |
| opencode | `opencode.ai` |
| agy | `cloudcode-pa.googleapis.com` |

The `claude` and `cursor` providers send no token at all (they run the local Claude Code
and Cursor Agent CLIs) and ignore their base URL. `cursor-agent` is a coding agent with
built-in tools; it always runs in `--mode ask` (read-only) with `--sandbox enabled` in an
empty workspace, never with `--force` or `--approve-mcps`. It can still use the Cursor account's plugins
(e.g. Gmail), which the CLI cannot disable, so the provider stays off unless
`--cursor-accept-account-plugins` is given. The admin UI/API rejects other base URLs for the providers above, and the proxy re-checks
stored rows before every call. An operator can add a base with
`--provider-base-override siwc=http://127.0.0.1:8080` (CLI/env only; used by tests and
egress proxies). An imported OAuth connection of an unknown provider cannot change its
base URL; re-import it with its token. API-key connections may use any base URL, but
changing it requires entering the API key again. Re-importing under an existing name
with a different provider or base URL requires a new refresh token.

## Secrets at rest

Connection API keys and OAuth access/refresh tokens are always stored as `enc:v2:`
(AES-256-GCM):

- with `--secrets-key` / `THINROUTER_SECRETS_KEY`: key = Argon2id(passphrase,
  per-database random salt);
- otherwise: a random key in `<data_dir>/secrets.key` (mode 0600, created on first
  open). This protects copies of the database (backups, sync); someone who can read the
  whole data directory can still decrypt it. Use a passphrase from a secret manager
  when that matters.

Opening a database migrates plaintext rows and legacy `enc:v1:` rows (single SHA-256
of the passphrase) to v2. Migrating v1 rows needs the original `--secrets-key` once.
A key that does not match the database (checked against a stored verifier) stops
startup without touching data. Decrypt failures are errors; ciphertext is never sent
upstream.

## Logs and errors

Logs and error bodies never contain gateway keys, admin tokens, session ids, OAuth
tokens or the secrets key. The upstream proxy URL is logged as scheme/host/port only.
Admin pages escape all values, including stored upstream error text.

## Tailscale Serve

```bash
thinrouter serve --allowed-host mybox.tailnet-name.ts.net   # listener stays 127.0.0.1
tailscale serve --bg 20128                                    # tailnet-only HTTPS
cat ~/.thinrouter/admin-token                                 # log in at https://mybox.tailnet-name.ts.net/admin
```

- Do not use `--allow-keyless-bootstrap`; create a gateway key and give clients
  `Authorization: Bearer <key>`.
- Do not use `tailscale funnel` (public internet) for this port.
- Keep `--host 127.0.0.1`; Tailscale Serve connects locally.
- cloudflared and other tunnels work the same way: add their hostname with
  `--allowed-host` and put access control (for example Cloudflare Access) in front.
