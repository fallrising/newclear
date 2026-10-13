# M4 delivery implementation contract

This milestone implements AC-30–37, subscription/delivery queries and owner replay. M1–M3 remain regression gates. No runtime dependency, deployment, real notification account, archive implementation or new action execution is included.

## Activation and durable projection

Strict JSON subscriptions reuse the typed rule filter semantics and the M0 schema. Both webhook and ntfy URLs must exactly match `webhook_allowlist`; credentials load from file references before activation, never enter SQLite/API/logs. Webhook secrets are raw bytes (including trailing newline); ntfy tokens follow bearer validation. Failed reload retains all old configuration and secrets. Source, rule and subscription activation commit in one transaction before in-memory credentials switch.

New `start: now` subscriptions start after the maximum committed event seq at activation; `earliest_hot` starts at zero. Each active subscription persists its scan cursor. Queue insertion and cursor advancement are atomic, including internal events. Stable IDs and unique constraints prevent restart/reload duplication. Removing a subscription pauses scanning and attempts; re-adding the same identity resumes. A subscription ID's filter, mode, start, digest schedule and channel kind are immutable; changes require a new ID. URL and secret-reference rotations under that identity are allowed; already queued messages retain their bytes, and future attempts use the currently activated target and credentials. No endpoint/credential material is persisted.

Immediate payloads preserve original event bytes. Digest windows use event time `[start,end)` bounded by the subscription activation seq and the events committed when a completed window is materialized. Late arrivals after materialization do not rewrite an already queued digest. Daily local-time boundaries follow the M0 DST policy; restart catches up completed windows in bounded batches. `now` begins with the window containing activation but includes only post-activation events; `earliest_hot` begins with the window containing the earliest hot event. Empty windows advance the durable boundary even when skipped. Digest payloads freeze total count and first 20 matching events ordered by seq. Unmatched events are never counted.

## Attempts and recovery

A single dispatcher periodically projects and claims due work without holding a SQL transaction across network I/O. Claims persist an opaque lease token, a two-minute deadline and an attempt increment before sending. Completion compares the token and inflight state so a stale worker cannot overwrite a recovered attempt. Expired claims become eligible after restart; interrupted attempts remain recorded with a sanitized error. Each replay starts a fresh 12-attempt budget while lifetime attempt_count remains cumulative. Retry delays start at 30s with bounded jitter, grow exponentially to 1h and respect a valid Retry-After (capped at 1h). 2xx succeeds; 408/429/5xx/transport failures retry; other status codes including redirects go to DLQ. At budget exhaustion the delivery goes to DLQ. Each DLQ episode emits one append-only internal event with subject=subscription ID. Replay requires a nonblank reason, commits an audit row and pending transition atomically, and keeps the same ID and payload.

## Outbound security and payloads

HTTPS only, no userinfo/fragments, exact URL allowlist for both channels, TLS certificate verification, no redirects or environment proxy, 10s request timeout, no connection reuse. Every dial resolves anew, rejects the whole answer if any address is outside Tailscale IPv4 100.64.0.0/10 or IPv6 fd7a:115c:a1e0::/48, and dials a validated IP directly while keeping the original TLS hostname. No arbitrary LAN, public, loopback, link-local, metadata or mapped-address bypass. Test-only dependency injection permits only the synthetic TLS receiver's loopback address and trusted fixture certificate; no production flag disables these restrictions.

Webhook HMAC/header bytes are exactly M0 vectors. ntfy immediate mapping follows SDD (safe single-line headers, summary/subject fallback, priority, source suffix tag, origin URL or board event URL); digest lists first 20 and total and links to the board time window. Board URL is the explicit server listener origin (no forwarded-header trust). Receiver bodies and raw transport errors are not retained. A reference receiver in tests verifies signature/timestamp before durable ID deduplication and returns 2xx only after acceptance.

## Worker interfaces

`internal/delivery` has no config/store imports. It provides:

- `Subscription { ID string; Filter rules.Filter; Channel Channel; Mode, Start string; Digest *Digest }`, standard JSON tags. Channel has `Kind, URL, SecretRef, TokenRef string`. Digest has `Every, At, Timezone string; SkipEmpty bool`.
- `Parse([]json.RawMessage, []string) ([]Subscription,error)` validates complete subscriptions and exact allowlist; `Safe(Subscription) Subscription` removes URL/references for persistent definition; `Match(Subscription,*event.Event) bool`.
- `Window(Digest,time.Time) (start,end time.Time)` and `NextBoundary(Digest,time.Time) time.Time` implement daily DST boundaries.
- `Message { Body []byte; ContentType string; Headers map[string]string }`; `Immediate(Subscription,seq int64,raw []byte,boardURL string) (Message,error)`; `DigestMessage(Subscription, []json.RawMessage,total int64,start,end time.Time,boardURL string) (Message,error)`.
- `Result { HTTPStatus *int; DurationMS int64; Error *string; RetryAfter time.Duration }` and `RetryDelay(attempt int,retryAfter time.Duration) time.Duration`.
- `NewSender([]Subscription,[]string) (*Sender,error)` loads/validates all secrets and creates secure clients; `Send(context.Context,subscriptionID,deliveryID string,Message,time.Time) Result`. Test constructors may inject resolver/dial/TLS roots but cannot expose a production bypass.

Store provides:

- Extend `ConfigureRuntime(ctx,sources,rules,now,audit, subscriptions ...[]delivery.Subscription)`; omitted vararg preserves compatibility for existing tests/callers, product runtime always supplies subscriptions.
- `QueueDeliveries(ctx,now,boardURL) error` (bounded work per tick); `ClaimDelivery(ctx,now) (*DeliveryWork,error)` (nil when idle); `FinishDelivery(ctx,work,result,now) error`.
- `DeliveryWork { DeliveryID, SubscriptionID, LeaseToken string; Message delivery.Message; Attempt int }`.
- `ListSubscriptions(ctx, cursor string,limit int) (SubscriptionPage,error)`; `ListDeliveries(ctx, DeliveryQuery{Subscription,State,Cursor string; Limit int}) (DeliveryPage,error)`; exact OpenAPI response types.
- `ReplayDelivery(ctx,id,reason string,now time.Time) error`; errors `ErrNotReplayable`, `ErrInvalidReason`, existing not-found/query/unavailable/config errors. Lists bind cursors to filters, bound size, return no secrets. Subscription list includes active subscriptions; delivery list retains history.

The orchestrator owns HTTP/CLI wiring, OpenAPI adjustments, real-service harness, native/CI gates, documentation and final acceptance. Workers must announce interface changes before implementation.

## Verification matrix

AC-30: real TLS receiver returns 500×3 then 200, same ID/bytes, four attempts; deterministic clock-driven focused retry tests plus service integration. AC-31/32: 400→DLQ event→missing reason/role rejected→audited replay→success. AC-33: durable claim/reopen, lease expiration and stale-token fence. AC-34: all M0 vectors and persistent receiver dedup. AC-35: URL/redirect/DNS/mixed answers/rebinding/TLS tests, failed reload retains prior runtime. AC-36: empty/nonempty/catch-up/DST digest tests and actual ntfy HTTP receipt. AC-37: six decision/execution fixtures and real Chromium correlation-chain navigation.

Commands: `go test -race -count=1 ./...`, `go vet ./...`, `test -z "$(gofmt -l .)"`, `go build -trimpath -o .local/run/signalhub ./cmd/signalhub`; web `npm ci`, `npm run format:check`, `npm test`, `npm run build` and committed dist equality; contract venv `python contracts/check.py`, `python scripts/e2e_smoke.py --binary ...`, `python scripts/e2e_rules.py --binary ...`; browser `npm ci && npm test` with actual binary and supported sandboxed Chromium (CI is the known supported host); team task/report validators and `git diff --check`. Independent review must inspect actual diff and reproduce risk cases.
