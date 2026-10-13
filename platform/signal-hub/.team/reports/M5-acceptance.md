STATUS: DONE

## Summary

M5 AC-10–14 implementation is accepted at corrected product `e4d4cbca92096d2b8028246b6e6cdd61872e7324`, following design-first commit `2b3cd3ce`. Three bounded isolated workers supplied disjoint leaves; root inspected the actual diffs and native/service evidence. Independent T-504 rejected the first candidate for R1; bounded T-506 correction and T-507 unchanged-probe closure pass. Exact product CI38397285845 passes all gates, including9 sandboxed Chromium journeys. Normal integration is tracked by [PR #352](https://github.com/fallrising/newclear/pull/352); this report records product acceptance, not an unobserved deployment or merge. Final documentation changes no executable content.

## Verification

- `go test -race -count=1 ./...`: all10 packages after R1, store356.341s; exact root log `r1-go-race-all.log` — passed
- `go vet ./...`, `test -z "$(gofmt -l .)"`, `go build -trimpath -o .local/run/signalhub ./cmd/signalhub`, `git diff --check`: clean; `r1-go-vet.log` — passed
- `go test -v ./cmd/signalhub -run TestM5RealServiceArchiveBackupDeliveryRecovery -count=1`: real service/TLS receiver, archived pending/inflight/DLQ bodies, isolated backup restore/import/query, original seq/bytes, lease fence, same-ID retry/replay, durable receiver dedup and three audits; unchanged backup SHA; `r1-service-recovery.log`,0.243s — passed
- `npm ci`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build` from web:28 tests in6 files, original26 retained; `web-gates.log` — passed
- `.local/run/contracts/bin/python contracts/check.py`:6 schemas,64 positive/negative fixtures,15 webhook and5 canonical vectors, strict JSON/RFC4231/OpenAPI; `contracts-final.log` — passed
- Same Python `scripts/e2e_smoke.py`, `scripts/e2e_rules.py`, `scripts/e2e_delivery.py` with `--binary .local/run/signalhub`:34+39+70 real HTTP/OpenAPI responses after R1; corresponding `r1-http-*.log` — passed
- Same Python `scripts/e2e_archive.py --binary .local/run/signalhub`:61 real HTTP/OpenAPI responses and17 CLI outcomes; independent gzip/SHA/member/count/exact purge, write/corruption failure, immutable late part, permanent dedup, repeat import/audit/cursor, rule backfill, queue preservation, WAL snapshot and isolated recovery; `r1-http-archive.log` — passed
- Node24 `startArchiveFixture` against production binary: actual archive/verify/import, repeated import, original seq/bytes and restored metadata; `browser-fixture-probe.log` — passed
- `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7 -shellcheck='' -pyflakes='' .github/workflows/signal-hub-ci.yml`; native task/report validators — passed
- Independent T-507 on e4d4cbca: seven byte-identical original probes under race5.374s; backup/restore native race9.088s, vet and diff-check. R1 closed; original T-504 failure preserved — passed
- [CI38397285845](https://github.com/fallrising/newclear/actions/runs/38397285845), exact e4d4cbca:10 Go race packages,28 frontend tests/reproducible build,contracts,203 HTTP responses/17 CLI outcomes,9 genuine Go/Chromium journeys in23.5s with sandbox preserved; `ci-r1-full.log` and downloaded artifacts — passed
- Actual desktop1440×1000 and mobile390×844 screenshots inspected: readable Chinese/restored context/related history, no observed clipping; deterministic no-overflow, browser-health, original JSON and token/logout checks pass. UI files are byte-identical between first and corrected CI — passed

## Documentation

Design/runtime/quickstart/SDD/contracts/STATUS describe accepted retention and migration deferral, verify-before-purge transaction and orphan recovery, immutable late parts, original identities, restored TTL/audit/cursor semantics, rule gap refusal, unchanged materialized delivery state, snapshot companion manifest and exclusive restore. Optional daily maintenance requires explicit directories. No dependency, host security setting, real source/account, deployment or M6 scope changed.

## Risks and Follow-ups

Original worker failures, independent R1 rejection and local missing `libnspr4.so` browser startup are retained; supported CI provides browser evidence without changing sandbox, assertion or timeout. T-502/T-503's original PARTIAL reports reflect isolation-time compile/browser limits and are not silently relabeled; root integration evidence closes their product wiring checks. Initial root recovery Red correctly rejected archive CLI before implementation; cleanup ordering was corrected separately.

Known operating limits: archive serializes file I/O under a writer reservation, so existing busy responses require producer retry. Paused cursors, pending rule work and unknown migrated retention can defer purge indefinitely. Rule gap protection is conservative. Backup files and DB identities/manifests do not include external config, credentials or archive payload copies. Interrupted publication leaves preserved unusable partial pairs/orphan parts requiring a new filename/part. Fsync tests do not simulate physical power loss. Tailnet/production deployment and offsite services remain unverified/out of scope.


## Acceptance mapping

| Requirement | Observed evidence |
| --- | --- |
| AC-10 verify before delete | archive focused tests plus independent gzip/SHA/membership/exact-ID checks in real CLI/HTTP drill; reopened-file validation inside purge transaction |
| AC-11 failures retain hot data | write/read/hash/count/member/purge/commit/success-observation failures; cross-day rollback and orphan retry independent probe |
| AC-12 immutable late parts | unchanged old bytes/SHA, new late/orphan part; no-replace filesystem behavior |
| AC-13 queryable idempotent import | actual query404→restored original seq/content, repeat no duplicates/deadline extension, audit/no-op generation stability, corrupt-day atomic rejection and Chromium provenance |
| AC-14 consistent isolated restore | live committed-WAL snapshot, SHA/integrity, original backup unchanged, isolated service query/new ingest/pending/inflight/DLQ/replay, schema rejection/no-clobber/legacy upgrades |
| M1–M4 preservation | permanent identity retry200/conflict409, seq high-water, accepted retention upgrade, paused cursors/digest/rule windows, missing-input rollup guard, retained materialized delivery bytes/attempts/leases/replay, native/HTTP/all9 browser regressions |

Tool accounting records four built-in agent starts and three bounded followups (UI fixture, R1 implementation, independent closure); no nested workers. Root aggregate tool/provider/token/cost totals remain unknown/null across compactions. Worker counters retain their own explicit snapshot/coverage, and observed command durations are not provider time.
