# Paid upstream authentication contract

All Chat Completions, Anthropic Messages, Responses and model-list endpoints,
with or without the `/v1` prefix, require an enabled gateway API key by default.
An empty key table, an invalid or malformed credential, and a table containing
only disabled keys deny authorization before route resolution or upstream calls.
Disabling every key therefore stops subsequent inference requests. Requests
already admitted or sent to a provider may still consume paid resources.

Keyless local bootstrap is an explicit exception: `--allow-keyless-bootstrap`
or `THINROUTER_ALLOW_KEYLESS_BOOTSTRAP=true`, default false. It authorizes only
requests without either credential header, while the listener's configured IP is
an exact loopback address and the database contains zero total gateway keys.
Creating the first key closes this exception; disabling keys never reopens it.
A public/wildcard listener cannot enable this exception. Hostnames, forwarded
headers and client-supplied origin information cannot establish loopback safety.

The admin UI and API may remain keyless on an exact loopback listener for local
setup. Non-loopback listeners require a nonempty admin token at startup and deny
admin authorization without that token. This prevents creating gateway keys as
an unauthenticated alternative to inference authorization.

Normal opt-in is to create a gateway API key using the local admin UI/API and
send it as `Authorization: Bearer <key>` or `x-api-key: <key>`. Public operation
also requires `--admin-token` / `THINROUTER_ADMIN_TOKEN`. Remove the bootstrap
flag to restore the default; keep disabled keys rather than deleting them while
bootstrap is enabled. These controls do not change provider connections, routes
or authenticated request/stream behavior.

Authentication is an admission control, not a provider invoice cap. Existing
ordered fallback can try each configured target, a 401 OAuth refresh can retry
once, ordinary HTTP requests have a 300-second timeout and SSE has an idle
timeout. Valid-key traffic still needs operator-defined provider budgets and
appropriate exposure/rate limits. No actual deployed state or billed usage is
inferred from this source contract.

Verification uses local fake upstreams only. Store and HTTP integration tests
must cover empty/disabled stores, valid/invalid credentials, both endpoint path
families, explicit loopback bootstrap, public bootstrap refusal, and unauthorized
public admin key creation. Rejected inference requests must produce zero
upstream calls; valid requests must still succeed.
