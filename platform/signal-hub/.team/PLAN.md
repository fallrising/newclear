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
3. Worker tests and bounded scope reviewed before integration: T-401/T-402 accepted at bounded scope with root inspection; T-403 implementation integrated, PARTIAL historical report preserved; Chromium verified at milestone gate.
4. Root native regression and M4 real TLS receiver/service gates: passed (10 Go packages with race, vet/format/build, 26 frontend tests/types/build, contracts 6/63/15/5, HTTP 34+39+69, actionlint 1.7.7).
5. Independent implementation review: passed; T-404 R1 reproduced and independently closed after native regression. M4 implementation evidence gate passed on CI38379149575 with 8/8 Chromium and inspected artifacts.
6. Product CI passed at `10316c7948e9f6b8192915344dfbd9ad79827b3a`; [PR #351](https://github.com/fallrising/newclear/pull/351) is the normal merge/readback record. Final documentation commit repeats required CI before integration.

Acceptance matrix and exact commands are in M4 contract. Historical M3 evidence remains in its reports and STATUS. Implementation AC-30–37 accepted; integration is recorded by PR #351. Local Chromium limitation is retained; the supported sandboxed CI browser path passed. No production configuration, account, deployment or runtime dependency is authorized.

## Acceptance evidence map (verified product)

| Requirement | Visible evidence | Decision |
| --- | --- | --- |
| AC-30 retry | Real subprocess/TLS receiver 500×3→200; stable ID/body; `TestM4RealServiceDeliveryRecovery` | local passed |
| AC-31/32 DLQ/replay | Actual 400→DLQ event, invalid reason/read-only denied, same-ID replay, SQLite audit | local passed |
| AC-33 lease | Actual subprocess SIGKILL, reopen before expiry, advance clock then duplicate receipt; store fence tests | local passed |
| AC-34 HMAC/dedup | 15 fixed vectors + persistent reference receiver + original-byte signature tests | passed |
| AC-35 SSRF | Exact URL both channels, DNS answer pin/mixed/rebinding, TLS hostname/roots, redirect and production loopback denial | passed |
| AC-36 digest | empty/nonempty actual ntfy receipt; DST gap/fold, catch-up, first20/total, restart/late/start tests | local passed |
| AC-37 chain/board | Six true producer events/HTTP detail chain fixture; two new browser cases | passed in CI38379149575 |
| M1–M3 regression | final full Go race after R1 (store289.763s), original17+new9 frontend tests, HTTP34+39; old6 browser cases preserved | passed including old 6 browser cases |
| Independent review | T-404 isolated snapshot; 4 independent adversarial probes and focused race pass after R1 fix | implementation accepted |
| Publication | [PR #351](https://github.com/fallrising/newclear/pull/351); normal required-check merge and remote readback | integration record on PR |

Historical failures: intentional pre-implementation config/API/allowlist red tests; actual 400 wrongly retrying due error-summary classification (fixed and retested); initial browser fixture invalid source wildcard (corrected and real HTTP probe passed); local Chromium missing libnspr4.so (CI required, no bypass). T-403 remains PARTIAL as a historical worker report until milestone-level browser acceptance. No failures/skips are converted into passes without replacement evidence.

Independent R1 closure: legal extreme-offset event timestamps exposed an invalid public digest boundary and a persisted cursor parse failure blocking immediate queues. Exact Unix-second cursors plus finite RFC3339 public/link formatting repair both; root red/green regressions and reviewer four-probe race verification passed. No contract validation was weakened. T-404 retains PARTIAL historical limitations; implementation review is accepted, milestone completion awaits Chromium and CI.

CI38377908329: Go race/vet/build, frontend26/reproducible assets, contracts and HTTP passed; Chromium7/8. The delivery case timed out locating the implicit select label while its accessible snapshot exposes combobox “投遞狀態”. Corrected two selectors to exact role/name; no assertion or timeout change. T-405 independently accepted this correction; required full CI rerun remains pending.

## Final M4 implementation acceptance

Product `10316c7948e9f6b8192915344dfbd9ad79827b3a`, [CI38379149575](https://github.com/fallrising/newclear/actions/runs/38379149575): all required gates passed. Go race10packages (store236.166s), vet/format/build; frontend26tests/types/reproducible assets; contracts6/63/15/5; HTTP34+39+70; sandboxed Chromium8/8 (19.0s). HTTP poll counts can vary by one without changing assertions (local final34+39+69). The real subprocess/TLS test covers retry, DLQ/replay, ntfy/digest and SIGKILL/lease/dedup; all four independent R1 probes pass.

Root visually inspected desktop delivery,390px mobile delivery and AC-37 correlation-chain PNGs: Chinese text, state badges, escaped attempt errors, reason field, action and readonly notice are readable; no visible overlap or horizontal overflow. Browser assertions establish role denial, owner audit, navigation, pagination, logout and empty browser storage; expected replay403 is explicitly scoped, unexpected console/pageerror/HTTP errors are zero. Native Playwright handles authenticated fixture capture; no claim of standalone CDP-runner or full accessibility audit is made.

Evidence gate: accept T-401/T-402 bounded implementations, T-403 integration using successful CI replacement evidence, T-404 R1 closure and T-405 selector correction. Historical PARTIAL/failed records remain unchanged. AC-30–37 and M1–M3 regression are verified; no unresolved implementation blocker. Only normal publication/readback remains to establish integration, via PR351 and final delivery record; no M5/M6 or deployment acceptance is implied.
