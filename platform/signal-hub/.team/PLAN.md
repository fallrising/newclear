# M4 delivery plan

Objective: complete AC-30–37 and delivery board/query/replay while preserving M1–M3, under the authorized M4 scope. Source baseline: c0e2bf9a68d4ce73128af37b435f378c6ad89dd1. Detailed design and frozen worker interfaces: [M4 contract](../docs/m4-design.md).

## Tasks and ownership

- T-401: subscription validation, outbound transport/SSRF/HMAC, scheduling and payload helpers; isolated built-in worker.
- T-402: SQLite durable queue/lease/retry/DLQ/replay/query; isolated built-in worker, depends on T-401 interface.
- T-403: delivery board and focused frontend/browser cases, preserving existing UI; isolated built-in worker.
- Root: design, contracts, API/runtime integration, actual services and receiver, native checks, CI and acceptance.
- T-404: independent read-only review after integration; no implementation ownership.

Built-in workers inherit the session model; no external CLI provider dispatch or model substitution. Each worker uses a separate worktree and disjoint writable paths; no nested delegation. Reports alone do not establish acceptance.

## Gates and decisions

1. Published task authorization, dependency acceptance and no scope conflict: confirmed before edits.
2. Design/contract: this plan and M4 contract precede implementation; exact public API already exists in M0 OpenAPI.
3. Worker tests and bounded scope reviewed before integration: T-401/T-402 accepted at bounded scope with root inspection; T-403 implementation integrated, PARTIAL report preserved pending Chromium.
4. Root native regression and M4 real TLS receiver/service gates: passed (10 Go packages with race, vet/format/build, 26 frontend tests/types/build, contracts 6/63/15/5, HTTP 34+39+69, actionlint 1.7.7).
5. Independent implementation review: passed; T-404 R1 reproduced and independently closed after native regression. Final evidence gate awaits mandatory Chromium/CI.
6. Required PR CI, normal merge and remote readback: pending.

Acceptance matrix and exact commands are in M4 contract. Historical M3 evidence remains in its reports and STATUS. No completion claim yet. Known local Chromium sandbox limitation persists; supported CI browser path remains mandatory. No production configuration, account, deployment or runtime dependency is authorized.

## Acceptance evidence map (pre-CI)

| Requirement | Visible evidence | Decision |
| --- | --- | --- |
| AC-30 retry | Real subprocess/TLS receiver 500×3→200; stable ID/body; `TestM4RealServiceDeliveryRecovery` | local passed |
| AC-31/32 DLQ/replay | Actual 400→DLQ event, invalid reason/read-only denied, same-ID replay, SQLite audit | local passed |
| AC-33 lease | Actual subprocess SIGKILL, reopen before expiry, advance clock then duplicate receipt; store fence tests | local passed |
| AC-34 HMAC/dedup | 15 fixed vectors + persistent reference receiver + original-byte signature tests | passed |
| AC-35 SSRF | Exact URL both channels, DNS answer pin/mixed/rebinding, TLS hostname/roots, redirect and production loopback denial | passed |
| AC-36 digest | empty/nonempty actual ntfy receipt; DST gap/fold, catch-up, first20/total, restart/late/start tests | local passed |
| AC-37 chain/board | Six true producer events/HTTP detail chain fixture; two new browser cases | Chromium pending |
| M1–M3 regression | final full Go race after R1 (store289.763s), original17+new9 frontend tests, HTTP34+39; old6 browser cases preserved | browser pending |
| Independent review | T-404 isolated snapshot; 4 independent adversarial probes and focused race pass after R1 fix | implementation accepted |
| Publication | normal PR, required CI/review, remote main readback | pending |

Historical failures: intentional pre-implementation config/API/allowlist red tests; actual 400 wrongly retrying due error-summary classification (fixed and retested); initial browser fixture invalid source wildcard (corrected and real HTTP probe passed); local Chromium missing libnspr4.so (CI required, no bypass). T-403 remains PARTIAL as a historical worker report until milestone-level browser acceptance. No failures/skips are converted into passes without replacement evidence.

Independent R1 closure: legal extreme-offset event timestamps exposed an invalid public digest boundary and a persisted cursor parse failure blocking immediate queues. Exact Unix-second cursors plus finite RFC3339 public/link formatting repair both; root red/green regressions and reviewer four-probe race verification passed. No contract validation was weakened. T-404 retains PARTIAL historical limitations; implementation review is accepted, milestone completion awaits Chromium and CI.
