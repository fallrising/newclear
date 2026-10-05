STATUS: DONE

## Summary

Root accepts the local implementation of HAI-IMPORT-001..007: two new internal packages for
strict immutable proposal import. This report closes the local evidence gate only. Exact pushed-head
Draft PR CI and delivery review are separate publication gates and are not claimed here.

Baseline: `e58840115bc93deceaf3cde053159d0ee2cc799e`.
Fifteen-file source inventory SHA-256:
`57c3e5762585c2a726e5d1931372263645c8719a692bbe4141506bf7b306a568`.
Sixteen-file code/SDD manifest SHA-256:
`d629c2355ff37c2c180fa6ddb31ba5683ad78160fcc6ec1693efd6e416324d5b`.
Root rechecked these bytes after all local gates and independent review.

## Verification

The commands below actually ran. Environment-specific executable/cache paths are normalized;
exact commands, raw output and failed attempts remain in private evidence.

- Exact mini-SDD/root ACK preceded production. Root reran the compilable stub with valid literal fake and real Git fixtures: six semantic `not_implemented` failures, also reproduced with Git 2.39.5. Original positive assertions remain unchanged — passed
- Native Go 1.27.1/Git 2.47.3: `bash scripts/check-ci-pins.sh backend`, `go mod download`, `go mod verify`, `gofmt -l .`, `go vet ./...`, `go test -count=1 ./...`, `go build -buildvcs=false ./...` — passed
- Fixed Go 1.27.1 image with Git 2.39.5: unchanged `bash scripts/check-backend.sh`, including module verification, formatting, vet, full tests, `go test -race -count=1 ./...` and build; then `go test -count=1 -v -run '^(TestProposalCore_|TestGitReader_)' ./internal/specification ./internal/gitobject`: seven groups, 212 tests/subtests, zero skips — passed
- `bash scripts/check-web.sh`: exact Node/pnpm pins, frozen install, format, lint, eight tests, TypeScript and Vite build. All 31 input hashes were rechecked unchanged after integration — passed
- T-152 independent native semantic review: seven groups/212 tests and 65 additional checks, both final-Close cancellation cases repaired, no unresolved findings or required skips — passed
- T-153 independent hash/oracle inventory: all 16 hashes, seven uniquely owned groups and unchanged existing source/SQL/Store/migrations/dependencies/workflow — passed
- Root read every new source/test file and inspected all scoped diffs; original Red fixture/assertion comparison showed only import grouping and additional controls — passed
- Task/report validators, protected-file hashes, public-path/scope inventory and `git diff --check` were rerun for the integrated documentation and reports — passed

| Receipt | SHA-256 |
| --- | --- |
| Root native backend | `2a8a3ce71351783e2fd3a39a508460fa3f39f95abf764b6b78c3ea843e19d1e3` |
| Root pinned backend | `e1f343bb9d0ca470f18a4ac22eea1a22e07e150f941acc6a277bb7544abc8c6d` |
| Root web | `2490c521af2d84ef36650da336ed847e48068462e5279ba2f9e416895559d668` |
| T-151 final report | `8ec70ddffb16fa510b0f10052d483b0490e61f11b449ba3a2ff24ff53420bab8` |
| T-152 final report | `719d4eb645f274a7e20b56354467a2e75d616f8731cb55f48886cbe73e4480d5` |
| T-153 final report | `eb41a93dac16d4659b24b34329ec24f3c6be38577f30e64d3ca2b9ceb7e8acb8` |

## Documentation

Updated PLAN, mini-SDD lifecycle status, HANDOFF and traceability; added bounded task envelopes
and reports. Initial ACK and receiver clarification hashes remain in PLAN. T-150's original
report is preserved; its public copy only normalizes private CLI locations and records the lineage.
No predecessor report was rewritten.

Initial invalid-author fixtures, interim compile/fixture failures, cancellation regression Red,
native race setup failures and sandbox denials remain retained. Missing packages/compilers and
invalid fixtures were never accepted as semantic Red. Native race could not start without a C
compiler; the required race gate actually passed in the pinned environment. Native full tests
initially hit the sandbox's localhost socket restriction and passed on the approved rerun.
The first root-report validation rejected wrapped verification bullets; root normalized their
layout and reran the validator without changing results. These diagnostics do not represent
unresolved product failures or skipped required coverage.

## Risks and Follow-ups

Trusted caller approval, protected local filesystem/executable and same-filesystem scratch are
prerequisites. This is not an OS sandbox for a compromised Git decoder or hostile same-UID actor.
Canonical re-read checks internal consistency; absent raw objects cannot authenticate provenance.
Local raw artifacts are retained with hashes, not represented as cross-host durable storage.

Durable proposal commands, authorization/transactional binding recheck, acceptance, activation,
current-head consumers, runtime/API/UI, restore and providers remain outside this child.
Complete exact pushed-head Draft PR CI and delivery review; do not merge, release, deploy or
start another child under this local acceptance.
