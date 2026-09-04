# SDD-011 — Moderation and Abuse Controls

## Context

Phark accepts account creation, login, content, and social mutations without a
server-side request quota. It also has no supported way for a signed-in person
to report a post or reply. Existing ownership records identify an authenticated
author, but the application deliberately keeps no minimized network-origin
signal that can help correlate short-lived abuse.

This change is security- and privacy-sensitive. It must preserve the existing
Session, CSRF, RFC 9457 Problem Details, request-ID, ownership, notification,
SQLite transaction, and single-instance deployment contracts.

## Goal

Add restart-persistent fixed-window rate limits, authenticated content-report
intake, and short-lived author/IP abuse signals without storing, logging, or
returning raw client IP addresses.

## Non-goals

- Automated content removal, account suspension, shadow banning, scoring, or
  any other moderation decision.
- A moderator role, moderation queue API, or operator UI.
- Anonymous reports, free-form report text, appeals, report status queries, or
  reporter-to-reporter visibility.
- Device fingerprinting, browser fingerprinting, geolocation, third-party
  reputation services, CAPTCHAs, Redis, or a new production dependency.
- Distributed rate limiting or multiple application replicas; SQLite still
  requires one application writer.
- Rate limiting public reads, health checks, CSRF-token retrieval, logout,
  profile edits, or notification read-state updates in this slice.
- Deploying the application.

## Terms

- **Account subject**: a keyed HMAC of the authenticated account ID, used only
  as a rate-limit partition key. It is not the public account ID.
- **IP subject**: a keyed HMAC of the canonical IPv4 address or IPv6 /64
  network selected at the trusted reverse-proxy boundary. Raw IP bytes are
  never persisted.
- **Accepted request**: a request that consumes quota and is allowed to reach
  the controller. It may later fail request validation or domain validation.
- **Report lifecycle**: `RECEIVED` at creation, immutable through public APIs,
  and deleted after its retention deadline. A later SDD must define moderator
  disposition before adding `ACTIONED` or `DISMISSED` states.

## Constraints

- One application instance and one SQLite writer; reservation correctness does
  not claim multi-instance coordination.
- No production dependency or external service is added.
- Fixed windows permit a boundary burst of up to twice the nominal quota.
  Shared IPv4 NATs and IPv6 /64s share a quota and can experience collateral
  throttling; this is accepted for the first single-VPS release.
- Rate limiting is abuse resistance, not authentication or authorization.
- Every peer that can directly reach the application on the shared `proxy`
  Docker network is trusted infrastructure. The app port must not be publicly
  reachable when forwarded-header handling is enabled.

## Assumptions and Unknowns

- Verified: Spring Security filters run before MVC interceptors, so exact
  authenticated matchers and CSRF rejection can prevent quota/domain writes.
- Verified: the deployment template does not publish the app port; Traefik is
  the intended sole external ingress.
- Verified: the initial template enabled Traefik access logs with raw
  `ClientAddr`/`ClientHost`; SDD-011 must drop all client address fields and
  query parameters to meet the privacy contract.
- Accepted limitation: signup/login are IP-/network-only quotas. There is no
  account-handle login partition in this slice because MVC interception does not
  parse credentials and account enumeration resistance must remain intact.
- Accepted discontinuity: rotating the HMAC secret resets effective partitions
  and makes old HMACs unlinkable. There is no pre-V10 production signal set;
  dual-key rotation is deferred until a concrete rotation requirement exists.
- Unknown moderation dispositions are deliberately unresolved; this intake-only
  SDD does not invent takedown, suspension, or appeal policy.

## Acceptance Criteria

### Rate limiting

```gherkin
Scenario: Requests inside a fixed-window quota are accepted
  Given a protected mutation scope with remaining quota
  When a subject makes a request
  Then the request reaches the existing controller
  And the response includes the applicable limit, remaining quota, and reset delay

Scenario: The first request beyond the boundary is rejected
  Given a subject has consumed exactly the configured quota in the current window
  When the subject makes one more request in that scope
  Then the API returns 429 application/problem+json with code RATE_LIMITED
  And Retry-After and rate-limit headers describe the binding policy
  And no controller, content, interaction, notification, report, or signal write occurs

Scenario: Accepted domain errors still disclose the consumed quota
  Given a protected request passed authentication, CSRF, and quota reservation
  When its controller returns validation, conflict, or not-found
  Then the response includes the same rate-limit headers as an accepted success
  And a duplicate report consumes one report quota unit

Scenario: Security errors disclose no quota
  Given a protected request fails authentication or CSRF before MVC
  When the security layer returns 401 or 403
  Then no rate-limit header is present
  And no bucket is written

Scenario: Quota recovers at the next window
  Given a subject is rate limited in one fixed window
  When the aligned window has elapsed
  Then a new request is accepted with a fresh quota

Scenario: Rate-limit state survives process restart
  Given a subject has consumed quota in a file-backed SQLite database
  When the application restarts against the same database and HMAC secret
  Then the consumed quota remains in force until the window resets

Scenario: Dual account and IP policies cannot bypass one another
  Given an authenticated mutation is governed by account and IP policies
  When either policy is exhausted
  Then the request is rejected by the more restrictive binding policy
  And the other policy is not partially consumed by that rejected request

Scenario: Nested report routes are charged only as reports
  Given an authenticated account reports a post through /api/posts/{id}/reports
  When the report request is accepted
  Then it consumes REPORT_WRITE account and IP quota only
  And it does not consume CONTENT_WRITE quota
```

### Authentication and CSRF

```gherkin
Scenario: Anonymous content reporting is rejected
  Given no authenticated session
  When a client submits a post or reply report with a valid CSRF token
  Then the API returns the existing AUTHENTICATION_REQUIRED contract
  And no report or abuse signal is written

  # SecurityConfig must authenticate POST /api/posts/*/reports and
  # POST /api/replies/*/reports before its final permit-all rule.

Scenario: A report without valid CSRF is rejected before quota or domain writes
  Given an authenticated session
  When the client submits a report without the current CSRF token
  Then the API returns the existing CSRF_TOKEN_INVALID contract
  And no report, signal, or rate-limit bucket is written

Scenario: Auth endpoints remain anonymous but IP limited
  Given no authenticated session
  When a client registers an account or attempts login with a valid CSRF token
  Then the existing auth behavior is preserved inside the IP quota

Scenario: Production refuses an unsafe signal secret
  Given the prod profile has a missing, malformed, short, or committed development HMAC secret
  When the application starts
  Then startup fails before serving traffic

Scenario: Direct-port smoke ignores spoofed forwarding headers
  Given port 8080 is published directly with forwarded-header handling disabled
  When a client supplies Forwarded or X-Forwarded-For
  Then the IP subject is derived from the TCP remote address rather than the header
```

### Content reports

```gherkin
Scenario: A signed-in account reports an existing post
  Given an authenticated account and an existing post
  When it submits one supported reason with valid CSRF
  Then a RECEIVED report owned by that reporter is created atomically
  And the response is 201, private, and contains no author or IP signal

Scenario: A signed-in account reports an existing reply
  Given an authenticated account and an existing reply
  When it submits one supported reason with valid CSRF
  Then a RECEIVED report tied to exactly that reply is created atomically

Scenario: A duplicate report is rejected
  Given an unexpired report by one account for one target
  When the same account reports the same target again for any reason
  Then the API returns 409 with code DUPLICATE_REPORT
  And the original report and signal remain unchanged

Scenario: An expired report can be submitted again before scheduled cleanup
  Given a retained report row whose expiry has passed
  When the same account reports the same target
  Then expired reports are pruned in the report transaction
  And a new RECEIVED report is accepted

Scenario: Different reporters remain isolated
  Given one account has reported a target
  When another authenticated account reports the same target
  Then a distinct report is accepted
  And neither reporter can list, read, update, or delete reports through a public API

Scenario: Invalid reports do not damage data
  Given an authenticated account
  When it uses a non-positive ID, missing target, malformed body, or unsupported reason
  Then the API returns the documented RFC 9457 error
  And no report or signal is written
```

### Signal minimization, integrity, and retention

```gherkin
Scenario: Content origin is stored as a minimized abuse signal
  Given an authenticated account creates a post or reply
  When the content and its abuse signal commit
  Then the signal contains the account ID, target reference, keyed IP HMAC, and expiry only
  And content and signal either both commit or both roll back

Scenario: Raw network identity is never exposed
  Given a request with a known client IP
  When content, a report, or rate-limit state is stored and returned
  Then the database contains no raw IP value
  And response bodies, headers, and application logs contain no raw IP or internal signal value

Scenario: Signals and reports expire
  Given abuse signals older than 30 days, reports older than 180 days, or expired buckets
  When startup cleanup or the daily retention job runs
  Then expired rows are deleted without deleting accounts, posts, replies, or notifications

Scenario: Legacy content remains reportable without fabricated signals
  Given a V9 post or reply whose historical IP and account origin is unknown
  When SDD-011 migrates or the content is reported
  Then no origin signal is backfilled
  And a valid report may still be received

Scenario: Deleting a source deletes only its dependent moderation data
  Given content, reports, and abuse signals exist
  When a referenced target or reporter account is deliberately deleted
  Then its dependent report/signal rows cascade according to V10 foreign keys
  And no cascade from a moderation table deletes an account, post, reply, interaction, notification, or media row
```

## Rate-limit Contract

All windows are UTC epoch-aligned fixed windows. The counter key is
`(scope, subject_kind, subject_hmac, window_start_epoch)`. The account and IP
quotas for one authenticated request are reserved in one SQLite transaction.

| Scope | Requests | Subject | Limit | Window |
|---|---|---|---:|---:|
| `REGISTER` | `POST /api/accounts` | IP | 5 | 1 hour |
| `LOGIN` | `POST /api/auth/login` | IP | 10 | 15 minutes |
| `CONTENT_WRITE` | `POST /api/posts`, `POST /api/posts/{id}/replies` | account | 20 | 1 minute |
| `CONTENT_WRITE` | same | IP | 60 | 1 minute |
| `SOCIAL_WRITE` | like/unlike, repost/unrepost | account | 120 | 1 minute |
| `SOCIAL_WRITE` | same | IP | 240 | 1 minute |
| `REPORT_WRITE` | post/reply report creation | account | 10 | 1 hour |
| `REPORT_WRITE` | same | IP | 20 | 1 hour |

The first `limit` requests are accepted; request `limit + 1` is rejected.
Requests blocked by authentication or CSRF never reach the MVC interceptor and
do not consume quota. Requests that pass those gates consume quota even when a
controller later returns validation, conflict, or not-found, preventing cheap
invalid requests from bypassing the limiter.

Every response that passed a configured rate-limit policy includes:

- `RateLimit-Limit`: decimal request limit of the binding policy.
- `RateLimit-Remaining`: decimal accepted requests still available, never below zero.
- `RateLimit-Reset`: positive decimal seconds until that aligned window resets.

Account policy is always evaluated before IP policy. On an allowed request, the
binding policy is the one with the smallest remaining-to-limit ratio after
reservation; ties choose the shortest reset and then account before IP. On a
denied request, the binding policy is the first exhausted policy in that stable
order; all attempted reservations roll back and its public remaining value is
zero. Reset is `windowEndEpoch - currentEpochSecond`, so it is an integer of at
least one second for both allowed and denied responses.

`429` additionally includes `Retry-After` equal to `RateLimit-Reset` and
`Cache-Control: private, no-store`. Its RFC 9457 code is `RATE_LIMITED` and it
does not disclose scope, subject kind, subject HMAC, IP, account ID, or counters
other than the client-facing quota fields.

All protected mutation responses set `Cache-Control: private, no-store`. One
shared quota-header writer is used by the interceptor immediately after an
allowed reservation and by the dedicated rate-limit exception handler, so later
controller errors retain headers and 401/403 responses never acquire them.

New stable Problem Details codes are:

| Code | Status | Type |
|---|---:|---|
| `RATE_LIMITED` | 429 | `urn:phark:problem:rate-limited` |
| `INVALID_REPLY_ID` | 400 | `urn:phark:problem:invalid-reply-id` |
| `REPLY_NOT_FOUND` | 404 | `urn:phark:problem:reply-not-found` |
| `DUPLICATE_REPORT` | 409 | `urn:phark:problem:duplicate-report` |

## Content-report Contract

Endpoints:

- `POST /api/posts/{postId}/reports`
- `POST /api/replies/{replyId}/reports`

Both routes require explicit authenticated matchers in `SecurityConfig` before
the final permit-all rule, authenticated Session identity, and the existing
CSRF token. Request JSON is:

```json
{ "reason": "SPAM" }
```

Supported reason codes are `SPAM`, `HARASSMENT`, `HATE_OR_VIOLENCE`,
`SEXUAL_CONTENT`, and `OTHER`. No free text is accepted or stored. The reporter
may report its own content; the report is intake, not a policy verdict. A target
may have reports from multiple accounts, but at most one unexpired report from
the same account. Target type and ID come only from the route; body fields can
never retarget a report. Expired rows for the target/reporter are deleted inside
the create transaction before insertion. The successful response is:

```json
{
  "id": 42,
  "targetType": "POST",
  "targetId": 17,
  "reason": "SPAM",
  "status": "RECEIVED",
  "createdAt": "2026-09-04T12:00:00Z"
}
```

It returns `201 Created` and `Cache-Control: private, no-store`; no GET
location is advertised because there is no public report-read API. Duplicate
reports return `409 DUPLICATE_REPORT`. Non-positive IDs use
`INVALID_POST_ID`/`INVALID_REPLY_ID`; missing targets use
`POST_NOT_FOUND`/`REPLY_NOT_FOUND`; unsupported reasons use the existing
`VALIDATION_FAILED` shape. Non-numeric route IDs map to the corresponding
invalid-ID code. Partial unique indexes are required exactly on
`(reporter_account_id, post_id) WHERE post_id IS NOT NULL` and
`(reporter_account_id, reply_id) WHERE reply_id IS NOT NULL`.

## Privacy, Minimization, and Trust Boundary

- The application consumes `HttpServletRequest.getRemoteAddr()` only after
  Spring's forwarded-header handling. It never parses a client-supplied
  forwarding header in business code.
- Production may enable forwarded-header handling only because the application
  port is not published and Traefik is the sole network peer. Traefik must strip
  untrusted standard and `X-Forwarded-*` inputs before adding its canonical
  client values. Direct/local HTTP smoke disables forwarded-header handling.
- The signal boundary rejects whitespace, zone IDs, hostnames, shorthand IPv4,
  and non-literals without DNS lookup. Strict four-octet IPv4 hashes its four
  network bytes. IPv4-mapped IPv6 normalizes to IPv4. Native IPv6 zeroes the
  lower 64 bits and hashes the first eight network bytes, so compressed and
  expanded forms share one /64 partition. The HMAC input is domain prefix,
  one family byte, then canonical network bytes; raw/string IP is not returned.
- Account rate keys use a separate domain string,
  `HMAC-SHA-256(secret, "phark-account-v1:" + accountId)`.
- Production requires `APP_ABUSE_IP_HMAC_SECRET` as unpadded base64url that
  decodes to exactly 32 random bytes. Startup rejects a missing/malformed value
  and the committed development value. Test/development uses that explicit
  non-production value. Changing the secret intentionally
  breaks correlation and resets effective IP/account partitions; old rows age out.
- Abuse signals store only action kind, authenticated actor ID when available,
  exactly one target/report reference, the IP HMAC, timestamps, and expiry.
  They store no user agent, forwarded-header chain, credentials, session ID,
  CSRF token, content copy, report text, or generated risk score.
- Abuse signals are kept for 30 days. Reports are kept for 180 days. Rate-limit
  buckets are kept until 24 hours after their window ends. Cleanup runs at
  startup and daily; it is safe and idempotent.
- The Traefik template pins `forwardedHeaders.insecure=false` on both entrypoints,
  drops access-log `ClientAddr`, `ClientHost`, and `ClientPort`, drops query
  parameters, and retains no request headers by default. General logs must not
  add either raw or HMAC network identity. Anyone on the shared proxy network is
  inside this infrastructure trust boundary.
- Tables and HMACs are internal-only: no public repository/controller method
  lists them, no response serializes them, and normal application logging names
  neither raw nor pseudonymized subjects.

## Migration and Compatibility

SDD-011 requires V10 because rate-limit state must survive restart and reports
and minimized signals are relational records. V10 creates new tables and
indexes only; it does not alter, rebuild, or backfill V1–V9 content. The upgrade
must preserve populated accounts, posts, replies, interactions, notifications,
FTS, image metadata, and media bytes. Clean V1→V10 and populated V9→V10 are both
required evidence. Rollback remains backup restore; V10 is immutable after merge.

Every V10 foreign key and `ON DELETE` action is explicit. Dependent reports and
signals use `ON DELETE CASCADE` for privacy minimization and consistency; rate
buckets have no FK. V10 partial unique indexes enforce report and one-origin-
signal shapes. A failed V10 migration must leave V9 history and pre-existing
objects intact, matching the repository's fail-closed migration tests.

Existing API success payloads remain unchanged. Existing errors, Session/CSRF,
request-ID, ownership, recipient isolation, cursor, notification transaction,
media integrity, and cache contracts remain in force.

## Verification

- Focused unit tests for keyed hashing, fixed-window arithmetic, binding-policy
  selection, atomic reservation, repository constraints, and retention.
- MVC contract tests for all protected scopes, headers, 429 Problem Details,
  authentication/CSRF ordering, report success, invalid targets/reasons,
  duplicates, and response redaction.
- Transaction regression tests proving post/reply/report plus signal atomicity.
- Schema tests for clean V1→V10, populated V9→V10 (including non-empty
  `post_images`), and failed V10 with row-count, IDs/timestamps, FK/cascade,
  partial uniqueness, CHECK, FTS integrity, image metadata, history, and
  `PRAGMA integrity_check` evidence.
- Full backend tests, frontend lint/build, Docker image build, and a file-backed
  runtime smoke covering quota boundary/recovery, reports, redaction, retention,
  data integrity, and restart persistence.

## Steps

1. Accept an adversarial contract review and close critical/high gaps.
2. Add V10 migration tests (RED), then the additive migration (GREEN).
3. Add signal hashing and persistent rate-limit core tests/implementation.
4. Wire exact MVC scopes, error/header behavior, and security ordering.
5. Add report intake, atomic origin/report signals, and retention cleanup.
6. Add the typed frontend report controls and synchronize all runbooks.
7. Run focused/full/migration/Docker/runtime gates and an independent final review.
8. Commit/push, verify PR final-head CI, merge, verify master CI; do not deploy.
