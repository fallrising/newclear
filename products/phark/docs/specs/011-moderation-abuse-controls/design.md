# SDD-011 Design

## Smallest Viable Design

The feature stays inside the existing Spring MVC → service → JdbcClient →
SQLite monolith. No new library or process is introduced.

```text
Spring Security (authentication + CSRF)
  -> AbuseRateLimitInterceptor
       -> ClientSignalHasher (remoteAddr -> canonical IP -> HMAC only)
       -> RateLimitService (one transaction, one or two persistent policies)
  -> existing/new controller
       -> content/report service transaction
            -> domain row
            -> AbuseSignalRepository row
```

`AbuseRetentionService` deletes expired internal rows once at application-ready
and on a daily schedule. Deletion does not cascade into user content.

## Boundaries

### Network identity boundary

`ClientSignalHasher` is the only component allowed to receive the request's
resolved remote address. It accepts strict four-octet IPv4 or numeric IPv6
without a zone ID or DNS lookup, normalizes IPv4-mapped IPv6 to IPv4, and
partitions native IPv6 by /64. HMAC input uses a domain prefix, family byte, and
canonical network bytes. It returns only lowercase 64-hex. Invalid/non-numeric
input maps to one keyed fail-closed `unknown` partition and is never logged.

Base/test configuration uses `server.forward-headers-strategy=none`. Production
uses `framework`, but only behind the non-published application port and a
sanitizing Traefik edge. The local production-profile smoke explicitly sets
`SERVER_FORWARD_HEADERS_STRATEGY=none` because it publishes port 8080 directly.
Traefik explicitly keeps `forwardedHeaders.insecure=false`, drops client address
fields/query parameters from access logs, and is the sole public peer. Any
container on the shared `proxy` network is trusted infrastructure.

### Request-rate boundary

The MVC interceptor maps exact HTTP method/path shapes to a policy set. It runs
after Spring Security, so authentication and CSRF rejection remain authoritative.
The service computes aligned window start as
`floor(epochSeconds / windowSeconds) * windowSeconds` and atomically reserves all
applicable policies in stable account-then-IP order. A runtime exception on any
exhausted policy rolls back the whole reservation transaction. Allowed requests
bind to minimum remaining ratio; denied requests bind to the first exhausted
policy and expose remaining zero. Reset uses integer epoch seconds and is always
at least one second.

SQLite's single-writer boundary plus conditional upsert prevents the count from
exceeding the limit. Repository code never interpolates scope or subject into
SQL; all values are bound parameters.

### Domain-write boundary

- Plain post creation becomes one transaction containing the post and
  `POST_CREATED` signal.
- Image post creation keeps validation/file write outside SQLite; its existing
  short post+metadata transaction additionally writes `POST_CREATED`. Any DB
  failure retains the existing compensating file delete.
- Reply creation writes reply, notification, and `REPLY_CREATED` signal in its
  existing transaction.
- Report creation validates target existence, inserts the report, and writes
  `REPORT_CREATED` in one transaction. A duplicate constraint becomes the
  stable `DUPLICATE_REPORT` API error without exposing another reporter.

## V10 Data Model

### `abuse_rate_limit_buckets`

- Primary key: `(scope, subject_kind, subject_hmac, window_start_epoch)`.
- `scope` and `subject_kind` have strict CHECK constraints.
- `subject_hmac` is lowercase 64-hex.
- `request_count` is positive.
- `window_end_epoch` and `expires_at_epoch` are explicit integers with ordering
  checks; expiry is window end plus 24 hours.
- Expiry index supports retention deletion.

### `content_reports`

- Surrogate ID, reporter account FK, target type, exactly one nullable post/reply
  FK, reason, immutable `RECEIVED` status, created/expiry timestamps.
- CHECK constraints enforce target shape and the reason/status vocabulary.
- Partial unique indexes enforce one report per reporter/post and one per
  reporter/reply while the retained row exists. Create first deletes expired
  rows for that reporter/target in the same transaction.
- Target deletion cascades only its reports; reporter account deletion cascades
  its submitted reports. No reverse cascade can delete target content.
- Expiry index supports 180-day retention.

### `abuse_signals`

- Surrogate ID, action kind, non-null authenticated actor FK, exactly one of
  post/reply/report FK, keyed IP HMAC, created/expiry timestamps.
- CHECK constraints bind each action to its one valid reference shape.
- Unique partial indexes allow only one origin signal per newly created post or
  reply and one intake signal per report.
- IP/time and actor/time indexes support internal correlation without exposing
  a query API; expiry index supports 30-day deletion.
- No V10 backfill is attempted because historical IP origins do not exist.
- Target/account/report FKs cascade dependent signals. This deliberately favors
  privacy deletion and referential integrity over retaining orphan forensics.

## Errors and Headers

`RateLimitExceededException` carries only the client-facing limit, remaining,
and reset duration. `ApiExceptionHandler` renders the normal RFC 9457 body and
adds the documented quota headers. It does not log the scope/key/HMAC.

The interceptor writes the same quota headers immediately after an allowed
reservation, before controller invocation, so accepted 4xx/5xx responses retain
them. Existing `X-Request-ID` generation remains outermost. Reports and 429
responses are `private, no-store`.

## Frontend

Authenticated post cards and loaded replies receive a compact report control.
It offers only the supported reason codes, requires a deliberate submit, prevents
double submission while pending, and shows success/error locally. Anonymous
viewers are prompted to sign in. Report state is component-local and does not
mutate timeline, reply, like, repost, or notification state.

## Risks and Mitigations

| Risk | Mitigation / evidence |
|---|---|
| Spoofed forwarded headers bypass IP limits | Business code uses resolved `remoteAddr`; prod only trusts sanitized Traefik traffic; direct smoke disables forwarded headers; contract tests cover configured boundary. |
| Raw or pseudonymous IP leakage | Boundary returns HMAC only; app has no IP log calls; edge access logs drop client address fields and query parameters; DB/API/log redaction tests search for the known raw value and internal HMAC. |
| Counter races exceed a quota | Conditional SQLite upsert and single transaction; concurrent repository/service test. |
| One of two policies is consumed on rejection | Runtime exception rolls back the whole reservation; transaction test checks both counts. |
| Rate limits vanish on restart | Buckets live in V10 SQLite and Docker smoke restarts against the same volume/secret. |
| Signal and content diverge | Shared service transactions; forced signal-write failures prove rollback. |
| Image failure leaves bytes | Existing compensation remains around the expanded short DB transaction. |
| Report target-type confusion | Exact endpoints, exact authenticated matchers, path-owned target identity, DB CHECK/FK constraints, and negative schema/API tests. |
| Duplicate race creates multiple reports | Partial unique indexes are the authority; conflict mapping returns stable 409. |
| Sensitive free-form moderation data | Fixed reason enum only; no text or content copy in reports/signals. |
| Retention only works during traffic | Create-time expired-duplicate pruning plus startup + daily scheduled cleanup, tested with expired and live rows. |
| Migration damages populated V9 | Additive V10 only; clean, non-empty populated V9, and failed-V10 tests plus SQLite integrity/FTS checks. |
| New limiter breaks existing security/errors | MVC ordering tests for anonymous and CSRF cases; full regression suite. |
| Fixed-window/NAT collateral | Boundary bursts up to 2× and shared IPv4/IPv6-/64 quotas are explicit accepted limits; quotas/config remain documented and observable. |

## Rollout and Rollback

Before starting a V10 image, take the existing stopped-app database + media
snapshot. Configure one stable, random 32-byte base64url
`APP_ABUSE_IP_HMAC_SECRET` and keep it out of
source control and logs. Verify Flyway history through V10, schema/data integrity,
health, rate-limit/report smoke, and restart persistence. Rollback restores the
pre-V10 snapshot and old image; never edit Flyway history or downgrade in place.
