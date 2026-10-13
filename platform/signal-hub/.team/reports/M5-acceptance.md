STATUS: PARTIAL

## Summary

M5 AC-10–14 is implemented at product candidate `d73f10ac100e22be9571582007bab84c7e8e216d`, following design-first commit `2b3cd3ce`. Three bounded isolated workers supplied disjoint leaves; root inspected the actual diffs, integrated them and ran native and genuine service verification. Independent T-504 and remote CI/Chromium remain mandatory. [PR #352](https://github.com/fallrising/newclear/pull/352) is a draft, unmerged.

## Verification

- `go test -race -count=1 ./...`: all10 packages, store375.340s; exact root log `go-race-all.log` — passed
- `go vet ./...`, `test -z "$(gofmt -l .)"`, `go build -trimpath -o .local/run/signalhub ./cmd/signalhub`, `git diff --check`: clean; `go-vet.log` — passed
- `go test -v ./cmd/signalhub -run TestM5RealServiceArchiveBackupDeliveryRecovery -count=1`: real service/TLS receiver, archived pending/inflight/DLQ bodies, isolated backup restore/import/query, original seq/bytes, lease fence, same-ID retry/replay, durable receiver dedup and three audits; unchanged backup SHA; `m5-recovery-green.log`,0.265s — passed
- `npm ci`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build` from web:28 tests in6 files, original26 retained; `web-gates.log` — passed
- `.local/run/contracts/bin/python contracts/check.py`:6 schemas,64 positive/negative fixtures,15 webhook and5 canonical vectors, strict JSON/RFC4231/OpenAPI; `contracts-final.log` — passed
- Same Python `scripts/e2e_smoke.py`, `scripts/e2e_rules.py`, `scripts/e2e_delivery.py` with `--binary .local/run/signalhub`:34+39+69 real HTTP/OpenAPI responses; corresponding `http-*.log` — passed
- Same Python `scripts/e2e_archive.py --binary .local/run/signalhub`:61 real HTTP/OpenAPI responses and17 CLI outcomes; independent gzip/SHA/member/count/exact purge, write/corruption failure, immutable late part, permanent dedup, repeat import/audit/cursor, rule backfill, queue preservation, WAL snapshot and isolated recovery; `http-m5-first.log` — passed
- Node24 `startArchiveFixture` against production binary: actual archive/verify/import, repeated import, original seq/bytes and restored metadata; `browser-fixture-probe.log` — passed
- `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7 -shellcheck='' -pyflakes='' .github/workflows/signal-hub-ci.yml`; native task/report validators — passed
- Independent review T-504, supported sandboxed Chromium, exact-head remote CI, merge and post-merge readback — skipped

## Documentation

Design/runtime/quickstart/SDD/contracts/STATUS describe accepted retention and migration deferral, verify-before-purge transaction and orphan recovery, immutable late parts, original identities, restored TTL/audit/cursor semantics, rule gap refusal, unchanged materialized delivery state, snapshot companion manifest and exclusive restore. Optional daily maintenance requires explicit directories. No dependency, host security setting, real source/account, deployment or M6 scope changed.

## Risks and Follow-ups

This report remains PARTIAL until independent review and remote gates complete. Original worker failures and local missing `libnspr4.so` browser startup are retained; supported CI provides browser evidence without changing sandbox, assertion or timeout. T-502/T-503's original PARTIAL reports reflect isolation-time compile/browser limits and are not silently relabeled; root integration evidence closes their product wiring checks. Initial root recovery Red correctly rejected archive CLI before implementation; cleanup ordering was corrected separately.

Known operating limits: archive serializes file I/O under a writer reservation, so existing busy responses require producer retry. Paused cursors, pending rule work and unknown migrated retention can defer purge indefinitely. Rule gap protection is conservative. Backup files and DB identities/manifests do not include external config, credentials or archive payload copies. Interrupted publication leaves preserved unusable partial pairs/orphan parts requiring a new filename/part. Fsync tests do not simulate physical power loss. Tailnet/production deployment and offsite services remain unverified/out of scope.
