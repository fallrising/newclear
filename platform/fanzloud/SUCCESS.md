---
project: platform/fanzloud
purpose: 透過 Web 操作廠商中立的隔離 coding agents
kind: application
mainline: incomplete
usable_tag: none
reviewed: 2026-10-31
source_commit: 391aa1aa72f1dd550d8acc7323f00c7a6229c3d4
---

> **2026-10-31 M1**：[真實單任務閉環](docs/acceptance/M1-isolated.md) 已通過：正式 Claude Code、真 VM、真 Rust／AP 與 Chromium，固定 base diff／檢查及清理可核對。FN-01 與 FN-03 單任務部分已驗；FN-06 已補齊有區分的失敗／取消驗證，CI／合併依該報告，M2／M3與整體 FN-01–07 未完成。舊 Cloud AC-04、持久化 AC-05 不改為通過。


# Codebox / Fanzloud 成功契約

> 2026-10-29 desk T-0433 ([issue706](https://github.com/fallrising/newclear/issues/706)) delivered the Fanzloud FE Round2 unit (R2-AC-14): see the [R2 report](fe-review/tasks/round2/report.md). The evidence is a synthetic HTTPS/WSS review harness in a real browser; real backend wiring and live Cloud were not exercised. The product AC table below is unchanged: mainline stays incomplete, usable tag none, AC-04/AC-05 pending. Sections below record each milestone; the earliest ones describe superseded plans.


## 主線與範圍

[TD](docs/TD.md)的長期目標是 provider-neutral coding platform；已接受的 P0 是私人單 operator BYOS Codex Cloud 控制面。
P1 event store 與 T040A command planner 是後續獨立切片，尚未形成完整持久 actor/runtime。

Owner 於 2026-10-30 明確恢復私人單 operator P0 主線；本輪依 [T008 規格](docs/specs/SPEC-T008-p0-real-browser.md) 補真瀏覽器／Rust 串接及同來源 live Cloud 證據，取代舊 dormant 與前端限定範圍。AC-05 僅規劃下一個最小里程碑，不在本輪實作。
個人訂閱不得池化、轉售或供第二個人喚醒；不允許 local codex exec/cloud apply 進 P0 authority。

本契約核對的是上述來源版本中的文件與程式。
`complete` 只適用明列的主線範圍；沒有延伸為部署或生產保證。

## 驗收條件

下表 `historical` 是既有報告的結果，沒有在 2026-10-21 重跑。
`pending` 保留缺少證據或尚未實作的條件；程式存在不等於通過。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given 固定 CLI 與 fake provider，When 瀏覽器建立任務並觀看狀態與 diff，Then HTTP/WS、session 與 trusted runner 依契約運作 | passed | [T008 真 Chromium／Rust 證據](docs/acceptance/T008.acceptance.md)：一次 submit、WS 更新、頁面 final diff；非 live |
| AC-02 | Given durable event prefix，When append/replay/save/load 與重啟組合，Then 權威事件不被損壞 cache 掩蓋且錯誤維持 typed | historical | [T030 組合驗收](docs/acceptance/T030.acceptance.md) |
| AC-03 | Given 三種 typed command 與 v1 狀態，When 決策函式執行，Then 只產生不可變零或一事件 proposal | historical | [T040A 驗收](docs/acceptance/T040A.acceptance.md) |
| AC-04 | Given 真實 operator Cloud entitlement，When 提交、追蹤與取回 diff，Then 同版 live smoke 能證明 provider 邊界 | pending | [交接](docs/HANDOFF.md)：credential-gated live operator smoke 未跑 |
| AC-05 | Given durable session 與 host runtime，When crash/recovery 或沙箱執行，Then 完整 actor/store/runtime 閉環保留一致狀態 | pending | [交接](docs/HANDOFF.md)：P1 store 未接 P0；T040 後續、node-agent/boxd 尚未完成 |

## 現況與缺口

T001–T007 及 T010/T020 有歷史接受，不能外推完整 TD。
T030A/B/C/D store 已獨立接受；P0 session replay 仍只在 process lifetime 內。
取消本機監看不能保證 provider task 已終止；未知提交只能依既有對帳介面處理。
實際原生 agent、local sandbox、多使用者認證不是已交付能力。

本輪先執行 AC-01 真 Chromium → 正式 Rust binary → T007 fake executable → 頁面 final diff；再在同版來源執行 AC-04 live gate。歷史 T007 為 wire-equivalent flow，並非真瀏覽器。
歷史結果若與現行 source 有相關差異，必須補驗而不能直接繼承。

## 啟動與驗證

[README 啟動章節](README.md)列出 pinned Codex CLI、私人 CODEX_HOME、state、Cloud environment、HTTPS origin 與 bootstrap token。

已核對入口：[control-plane main](apps/control-plane/src/main.rs)。
下列是該入口既有的啟動或驗證命令，並非本次執行紀錄；
需先完成連結文件中的依賴、設定及適用環境準備。

```sh
cargo test --locked --workspace --all-targets --all-features
cargo run -p codebox-control-plane
```

執行後應保留來源 SHA、必要設定的非秘密摘要、命令與結果，
並將 runtime 證據逐項對回 AC；不得只用 health 或 exit 0 宣告全部完成。

## 可用版本

目前 `usable_tag: none`；本次沒有建立或發布任何 tag。
既有版本號、合併紀錄與歷史驗收不自動轉換為可用版本標記。

須取得明確復工範圍、真 Cloud 主線驗證並補齊承諾的 runtime/persistence 整合；現有接受的函式庫切片不能作全平台可用標記。


## FE round2 plan — 2026-10-24 (historical pre-implementation scope)

T-0380 R2-AC-14/E follows the existing approved [DESIGN](fe-review/DESIGN.md) M1–M3
and [T006R Ready task](docs/tasks/T006R.task.md)/[review specification](docs/specs/SPEC-T006R-fe-review.md).
Current work is documentation only; harness, measured presentation changes and runtime
are NOT_RUN. A separate root environment-only TLS trust probe passed; it served no
product assets/API/provider and does not satisfy those pending gates. Plan: finite synthetic HTTPS/WSS at loopback with private per-run TLS trust,
exact inherited contracts, three dark viewports/27 canonical states, focused no-resend/
secret/cleanup journeys, then required native gates and fresh independent acceptance.
Only baseline-proven index.html/p0.css/p0-app.js presentation changes may follow the
root document gate. Existing p0-client/backend/API/security/provider semantics stay
outside this change. Original offline native fake executables are allowed only as
retained regression tests; no production CLI/control-plane or newbackendbrowser run.
Targets remainsfalse until the scoped acceptance is evidenced. Existing product ACs,
mainline incomplete, usable_tag:none, dormant status and liveCloud/P1 gaps are unchanged;
no fullR3, deploy, release or ownercompletion is claimed.

## T-0380 approved native security prerequisite — 2026-10-24

Owner approved only Tokio1.53.1→1.53.3 lock version/checksum. Affected deny,306Rust
tests,clippy and build passed; unchanged earlier Node/fmt evidence retained. See
[exact commands and remaining FE blockers](../../docs/fe-review/ROUND2-RETRY-CHECKPOINT.md).
This closes the advisory prerequisite only; PR604 FE acceptance, full conformance,
mainline and usable qualification remain incomplete. Original failures are retained.


## T-0380 approved HTTP limit clarification — 2026-10-25

Goal and scope: clarify only SPEC-T005B's existing header/body limit classification,
as approved by the owner. An overlong header value is 422 `invalid_request`; an
oversized request body is 413. Runtime behavior, validation precedence, source and
tests remain unchanged.

Acceptance: apply the exact approved sentence, verify it against existing
`validate_headers` and `p0_http_bounds_content_type_and_error_schema_fail_closed`,
then pass the scoped project-success documentation check and diff check before
independent review. Existing FE/runtime gaps, mainline incomplete and usable_tag:none
remain unchanged; this documentation clarification grants no new runtime authority.

Validation: scoped project-success documentation and diff checks passed. Independent
review and normal publication remain pending; executable tests were not rerun.


## T-0380 diagnostic reason development — 2026-10-26

Goal: retain a bounded, safe reason when the initial lifecycle observer rejects an
event or cannot obtain a required phase. The single approved desktop recovery 005
ended before Authenticate with `REVIEW_INITIAL_TRACE_INCOMPLETE`; its initial 401
body, Playwright completion and original health gate passed. The stored trace is
invalid and lacks an accepted CDP terminal. Its unique cause remains unproven.

Scope: add separately named v2 observer/page/driver modules and focused pure tests;
preserve the v1 source checkpoint and all original failed evidence. Integrate current
main by a normal merge while retaining the approved HTTP limit clarification and
Tokio lock update. No product, protocol, dependencies or runtime authority changes.

Acceptance: meaningful RED then GREEN for missing reasons; finite reason/stage/event/
domain enums, strict clocks, safe immutable snapshots and a combined 128-record bound;
unchanged original request/body-read/health/assertion/cleanup behavior; changed-file
syntax, scoped documentation checks and independent source review. Required current
PR CI remains a publication gate. Previously green unchanged tests are retained.

Real-browser verification of v2 is NOT_RUN. Recovery 005 is consumed; no retry or
tablet/mobile continuation is included. FE acceptance remains 8/27 canonical states,
18/19 overall deliveries and PR604 Draft. M2 measured presentation, conformance and
final integration remain open; targets stays false, mainline incomplete and
usable_tag:none. This source work cannot establish the historical runtime cause.

Validation observed: Node24.18.0 `node --test fe-review/initial-lifecycle-v2.node.mjs`
passed35/35 with0failed/skipped; `node --check` passed for all four new files. The
initial v1 missing-reason regression failed as intended and is retained. The runner
restores byte-exactly to v1 after the documented diagnostic substitutions; all five
v1 file hashes remain unchanged. Scoped project-success and staged whitespace checks
passed. Independent exact-source acceptance is recorded separately in PR604.


## T-0380 v3 clock correction — 2026-10-26

Scope and AC: [v3 diagnostic specification](docs/specs/SPEC-T006R-initial-trace-v3.md) C01–C05. Correct only successful CDP completion versus response sampling; retain request lower bound, failed-terminal/host/page checks and original product health. Separate v3 sources preserve v1/v2 and006FAIL. Planned verification: meaningful v2 RED, v3 targeted pure suite, four syntax checks, inverse/source hashes, scoped project-success, independent document/source review and current-head CI. Source implementation now has meaningful v2 RED (exact006 triple rejected,13events), then48/48 v3 pure tests with0failed/skipped and four syntax checks on Node24.18.0. All nine v1/v2 reference hashes, v3 page equality and baseline inverse equivalence passed. T107 accepted the specification after explicit missing-anchor refusal. Exact-source independent acceptance and current-head CI are publication gates, recorded in PR604. Actual browser evidence for v3 remains NOT_RUN; no new runtime grant. Canonical8/27, delivery18/19 and DraftPR604 remain.


## T-0380 Claude-reviewed completion plan — 2026-10-27

Owner requested consultation on the current failure and plan, then documentation before further work. [The updated plan](../../docs/fe-review/FANZLOUD-COMPLETION-PLAN.md) separates verified conditional source behavior from unproven executed-build/007 attribution. It adds the error-to-cancel control and corrects abort, suspension, context-destruction and exception oracles. Scope is documentation only: no engine/application/dependency edit or new browser attempt.

Document acceptance requires source-backed advice mapping, explicit NOT_RUN/SLICE/engine/product evidence levels, a bounded upstream-test-patch next task, scoped project-success and diff checks, independent review, required CI and remote readback. The next test patch is not implemented or executed by this document. Recovery007 remains FAIL/consumed; canonical8/27,delivery18/19 and PR604Draft remain. Existing product ACs, mainline incomplete, usable_tag:none and targetsfalse are unchanged.


## T-0380 upstream regression test artifact — 2026-10-28

Owner continued the merged plan. Goal/scope: prepare a pinned-source test-only patch, helper/API mapping, per-row predictions and explicit NOT_RUN/GAP status; no engine/application/dependency change or runtime. [The artifact](../../docs/fe-review/fanzloud-completion-regression/README.md) adds nine upstream gtest cases for terminal cleanup and controls, leaving actual V8/context cases as gaps. Acceptance is exact-source static applicability/reversal, externally visible callback/data/cancel oracles, independent artifact review and required repository checks/CI/readback. This is artifact acceptance only; no Chromium compilation or executed RED/GREEN is claimed.

Static apply/reverse passed on exact source copies. Actual007 root cause/build correspondence remains unknown; original product ACs,18/19,canonical8/27,PR604Draft,targetsfalse/mainlineincomplete/usable_tag:none remain. The next recommendation is a bounded read-only feasibility check for an existing genuine Blink test route, not an implicit build/download/browser grant.


## T-0380 existing Blink environment feasibility — 2026-10-28

Owner continued with one bounded read-only check of existing source/build/test availability. [The result](../../docs/fe-review/fanzloud-completion-regression/ENVIRONMENT-FEASIBILITY.md) identifies no compatible route in the inspected scope; excluded/inaccessible paths, container contents and remote environments remain unknown. The nine-case patch stays NOT_COMPILED/NOT_RUN; no engine RED/GREEN, actual007 attribution or R9/R10 integration coverage is claimed.

Acceptance for this factual checkpoint is traceable inventory with honest coverage/errors, preserved patch/product bytes, focused documentation checks, independent review, required CI and exact remote readback. No build/download/browser/model or product/dependency edit occurred. The next recommendation is one bounded upstream fix/history lookup. Original product ACs,18/19,canonical8/27,PR604Draft,targetsfalse/mainlineincomplete/usable_tag:none remain.


## T-0433 ERR_ABORTED read-path fix — 2026-10-28

Goal: remove the browser-side ERR_ABORTED that blocks desktop recovery (R2-AC-14), without relaxing any body, health, identity, cardinality or cleanup gate. Evidence: [layer ablation](../../docs/fe-review/fanzloud-completion-regression/LAYER-ABLATION.md).

Scope:
- [SPEC-T006](docs/specs/SPEC-T006-private-operator-web.md) P-006-10: declared-length bodies are drained whole; chunked bodies keep the stream reader and its overflow cancellation.
- Test 8 gains declared-length partitions.
- The T007 loopback e2e samples `GET /session` (401 and 200) on a real server and asserts an exact `Content-Length` with no chunked framing. Other responses share the same `CachedResponse` constructor.
- [SPEC-T006R](docs/specs/SPEC-T006R-fe-review.md) R03: fixture JSON responses declare `Content-Length`.
- Excluded: browser runtime, recapture, tablet/mobile, M2 and merging PR604.

Acceptance:
- Test 8 fails first for the intended reason (a stream reader is used on a declared-length body), then passes.
- All 12 named T006 tests (2 Rust route tests and 10 Node tests) and all fe-review node suites pass, except hash pins that intentionally refuse the changed sources; those failures are recorded.
- The T007 e2e passes with the framing assertion.
- The workspace Rust gates pass, as do `check_project_success.py` and the required PR CI.
- An independent review accepts the change.

Changing the client and fixture invalidates reuse of the 8 previously accepted cells, so all 27 canonical cells need recapture under a separately approved runtime. Canonical stays 8/27 until then, and delivery stays 18/19.

## T-0433 desktop recovery v4 runner — 2026-10-28

The owner approved one desktop recovery run on the fixed source and a recovery-only runner, documentation first. The v3 runner cannot run on the fixed source: it pins the old client and fixture hashes and reuses eight cells. [SPEC-T006R recovery v4](docs/specs/SPEC-T006R-recovery-v4.md) V01–V05 defines a byte-traceable v4 copy. It changes only the source pins and removes reuse; every v3 gate is unchanged.

Acceptance:
- The v4 pure test passes and the v1–v3 node suites stay green.
- An independent source review accepts v4, and the required CI passes.
- Attempt `baseline-desktop-recovery-008` then runs once (at most 300 seconds, no retry).
- A PASS yields one candidate recovery cell that needs independent actual review. A FAIL is preserved and stops.

### Result — recovery 008 (2026-10-28)

`baseline-desktop-recovery-008` ran once on source `96d58678`.
- PASS in 2.446 seconds: exit 0, cleanup complete, container removed. Chromium 153.0.8010.12, Playwright 1.63.0.
- The post-authentication session GET and the login GET finished normally with exact bodies and a matching `Content-Length`. No `requestfailed` and no unexpected health entry occurred. 007 had hit ERR_ABORTED at this same step.
- The initial trace is complete, axe reports 0 violations, the PNG is present, and there was 1 effect and 0 turn starts.

An independent actual review returned CANONICAL_CANDIDATE_ACCEPT. That makes `recovery-required__desktop__dark` the first canonical cell on the T-0433 source. The review also recorded one serious color-contrast item that axe marks incomplete (not a violation), for design follow-up.

This is one run: it shows ERR_ABORTED did not occur here and does not measure a rate. The 8 earlier cells were accepted on the previous source and are not reusable. On the T-0433 source, canonical is 1/27, and the remaining desktop, tablet and mobile cells need separately approved recapture. Delivery stays 18/19.

## T-0433 desktop remaining v5 runner — 2026-10-28

The owner approved preparing a runner for the other eight desktop cells and running it once after review and CI. v4 cannot be reused here: its recovery-only gate rejects every non-recovery state by design. [SPEC-T006R desktop remaining v5](docs/specs/SPEC-T006R-desktop-remaining-v5.md) D01–D05 derives a byte-traceable v5 from the existing all-state `remaining-baseline.mjs`. v5 makes only the D01 substitutions (header, selection, scope, two source pins, runner name, reuse block, previous-phase read and `fullViewportFresh`); every other gate is unchanged. Tablet and mobile (18 cells) still need their own runner: `remaining-baseline.mjs` pins the old source and requires a previous desktop phase.

Acceptance:
- The v5 pure test passes and the existing fe-review suites stay green.
- An independent source review accepts v5, and the required CI passes.
- Attempt `baseline-desktop-remaining-001` then runs once (at most 300 seconds, no retry).
- A PASS yields eight candidate cells that need independent actual review. A FAIL is preserved and stops.

### Result — desktop remaining 001 (2026-10-28)

`baseline-desktop-remaining-001` ran once on source `e7bf285c`.
- PASS in 21.0 seconds: exit 0, cleanup complete, container removed. Chromium 153.0.8010.12, Playwright 1.63.0.
- All eight states passed with every health entry expected and zero `requestfailed`, including `disconnected`, where ERR_ABORTED appeared in earlier runs.
- Per-state counts, the bootstrap, device, turn, rejection, cancel and reconnect diagnostics, storage, DOM, keyboard, axe (0 violations) and the PNGs all passed.

An independent actual review returned CANONICAL_ACCEPT for all eight cells. With recovery 008, desktop is 9/9 on the T-0433 source and canonical is 9/27.

Review notes:
- The `disconnected` row does not store the stream status at capture time; the runner asserted it before the screenshot.
- At desktop width the diff does not overflow, so local scrolling is not exercised there (same as the earlier accepted cell); tablet and mobile should show it.
- axe marks color-contrast incomplete in every state.

Remaining: tablet 9 and mobile 9 (they need a runner on the fixed source), the M2 actual UI and finite HTTP/WSS conformance. Delivery stays 18/19.

## T-0433 tablet/mobile v6 runner — 2026-10-28

The owner approved preparing a tablet/mobile runner and running tablet once after review and CI. Mobile needs a tablet PASS and a separate approval. [SPEC-T006R tablet/mobile v6](docs/specs/SPEC-T006R-tablet-mobile-v6.md) P01 and V601–V604 derive a byte-traceable v6 from `remaining-baseline.mjs`. Tablet's previous-phase check becomes `assertPreviousDesktop` over the two accepted desktop results; mobile keeps the original chain. Every state gate is unchanged.

Acceptance:
- Both pure suites pass and the existing suites stay green.
- An independent source review accepts v6, and the required CI passes.
- Attempt `baseline-tablet-001` then runs once (at most 300 seconds, no retry).
- A PASS yields nine candidate cells that need independent actual review. A FAIL is preserved and stops.

### Result — tablet 001 (2026-10-28)

`baseline-tablet-001` ran once on source `c3dcab8f`.
- PASS in 21.0 seconds: exit 0, cleanup complete, container removed. Chromium 153.0.8010.12, Playwright 1.63.0.
- It chained on the pinned desktop evidence (`f942f5b8…`, `dea0e7dd…`).
- All nine states passed with every health entry expected and zero `requestfailed`, including `recovery-required` on the generic path. axe reported 0 violations and the page has no horizontal overflow at 834.

An independent actual review returned CANONICAL_ACCEPT for all nine tablet cells as baseline captures. Canonical is 18/27 on the T-0433 source.

Open M2 gaps (recorded, not passed):
- The diff and event lists never overflow at desktop or tablet, so R07/R10 local scrolling is not exercised.
- The diff region has no accessible name and `tabIndex` -1.
- axe marks color-contrast incomplete (serious) in every state; R07 treats incomplete as not passed.

Remaining: mobile 9 (needs separate approval), the M2 actual UI including these gaps, and finite HTTP/WSS conformance. Delivery stays 18/19.

### Result — mobile 001 (2026-10-28)

`baseline-mobile-001` ran once on source `0655f0bd`.
- PASS in 21.8 seconds: exit 0, cleanup complete, container removed.
- It chained on the accepted tablet result (`500ce82d…`) through the original `assertPreviousPhase`.
- All nine states passed with every health entry expected and zero `requestfailed`.

An independent actual review returned CANONICAL_ACCEPT for all nine mobile cells as baseline captures. **The canonical three-size dark baseline was 27/27 on the milestone-1 source.** M2 changed the served assets, so on the M2 source canonical is 0/27 until the v7 recapture below is reviewed. M2 is still not accepted.

M2 defects measured by the baseline are handled in [SPEC-T006R M2 repair](docs/specs/SPEC-T006R-m2-repair.md):
1. `device-pending__mobile__dark` overflows horizontally (390 wide, scrolls to 399). The computed cause is the unbreakable `#verification-url.mono` text. Repaired by wrapping `.mono`; to be confirmed at recapture.
2. `success-diff__mobile__dark` has axe `scrollable-region-focusable` (serious). Repaired: the event and diff regions are focusable (`tabindex` 0) and named by their headings. To be confirmed at recapture.
3. All 27 cells: axe marks color-contrast incomplete (serious). There is now bounded evidence: every text color is at least 6.96:1 against the lightest composited background, cross-checked with baseline PNG pixels. axe may still report incomplete.
4. Event local scrolling was not exercised by the baseline; diff local scrolling was exercised on mobile only.

Remaining: finite HTTP/WSS conformance, then final integration review and CI. The v7 recapture (27/27) covers the repaired source. Milestone 1 merged as PR604; delivery stays 18/19 until Fanzloud completes.

## T-0433 M2 repair — 2026-10-28

Milestone 1 (ERR_ABORTED fix and dark baseline 27/27) is merged: PR604, main `0111908492c32d0b01d561b24b6024737cb4f641`. The owner approved the M2 repair, documentation first, and asked to be consulted before any affected cell is recaptured. [SPEC-T006R M2 repair](docs/specs/SPEC-T006R-m2-repair.md) M2-01..03 fixes only measured defects:
- mobile horizontal overflow from the unbreakable verification URL;
- unfocusable, unnamed event and diff scroll regions;
- bounded contrast evidence for axe's incomplete results.

Acceptance: a focused RED, then GREEN, for M2-01 and M2-02; contrast lower bounds plus a PNG background cross-check for M2-03; existing suites green; independent review; required CI; merge. Browser recapture is a separate owner decision.

## T-0433 recapture v7 — 2026-10-28

Milestone 2 (M2 repairs) is merged: PR725, main `ed063534c333e5350582131a10a14b12006754b5`. The owner approved updating the runner and recapturing all 27 cells, one run each for desktop, tablet and mobile.

[SPEC-T006R recapture v7](docs/specs/SPEC-T006R-recapture-v7.md) R701–R705 derives one byte-traceable runner from `remaining-baseline.mjs` for all three phases. The source pins move to the M2-repaired source and reuse is removed; every state gate is unchanged. The phases run in order, and each needs an independent actual review that also judges the R07 M2 final-state gates before the next phase starts. Desktop mounts no previous result.

### Result — v7 recapture (2026-10-28)

All three runs used source `fa614871`, ran once each and were independently actual-reviewed before the next phase started.

| Run | Time | Cells | Review |
| --- | --- | --- | --- |
| `baseline-v7-desktop-001` | 22.6 s | 9 | CANONICAL_ACCEPT |
| `baseline-v7-tablet-001` | 21.3 s | 9 | CANONICAL_ACCEPT |
| `baseline-v7-mobile-001` | 21.6 s | 9 | CANONICAL_ACCEPT |

Every cell had all health entries expected and zero `requestfailed`. **Canonical is 27/27 on the M2-repaired source.**

R07 M2 final-state gates, judged in the reviews:
- No page horizontal overflow: PASS. M2-01 is resolved; mobile `device-pending` is now 390/390, previously 399.
- No axe critical or serious violations: PASS. M2-02 is resolved; the mobile `success-diff` focus violation is gone while the diff scrolls (831/448).
- Event and diff regions named and keyboard-reachable: PASS_WITH_BOUNDED_EVIDENCE. `tabIndex` is 0, `role=region` and `aria-labelledby` are set.
- Contrast: PASS_WITH_BOUNDED_EVIDENCE. M2-03 gives a minimum of 6.96:1, and the reviewers sampled v7 PNG corners within the bound. axe still marks it incomplete.

Not exercised:
- event-list local scrolling;
- an actual scroll action in the diff;
- keyboard traversal landing on the regions;
- a measured accessible name.

## T-0433 finite HTTP/WSS conformance C1 (2026-10-29)

Milestone 3 (v7 recapture, canonical 27/27) is merged as PR731, main `0ff9bab0`. The owner asked for a documented scope proposal before any implementation. [SPEC-T006R conformance proposal](docs/specs/SPEC-T006R-conformance-proposal.md) maps the gaps against the 12 named T006R oracles. It proposes C1 (offline real-transport R03/R04, R06 pure partitions, and R07/R08/R10/R11 evidence oracles) and C2 (one focused browser run for TLS, R06 and the R07 items not yet exercised). Real backend/Cloud integration is out of scope. The owner confirmed C1 on 2026-10-29 and asked to be consulted before C2 runs.

C1 result:
- 15 new oracles (including two findings recorded as tests): R03/R04 and Node-level TLS over the real loopback HTTPS/WSS transport, R06 pure partitions, and R07/R08/R10/R11 evidence over the v7 results.
- All pass; each was shown meaningful by a mutation check.
- Findings F1–F4 recorded where the review harness differed from T005C (subscriber cap returned HTTP 403; back-pressure close codes; error paths the harness could not reach; upgrade refusals were a bare 403 instead of 401/404 JSON). They are repaired below.

## T-0433 harness repair F1–F4 and the C2 driver (2026-10-29)

The owner approved repairing F1–F4 and preparing the C2 driver, with one C2 run after review and CI (「批准：修正 F1–F4 並準備 C2 driver，審查與 CI 通過後跑一次 C2。」). [SPEC-T006R-harness-repair-c2](docs/specs/SPEC-T006R-harness-repair-c2.md) specifies both.

- Harness: upgrade refusals are safe JSON in the product order (400/404/405/422/401/503/403/426). The ninth subscriber gets `subscriber_limit` with close 1013. Lag and serialization failures are typed 1013, and a stalled write drops only its connection. Review-only bounds make `history_gap`, `subscriber_lagged` and `stream_unavailable` reachable; their defaults equal the product's.
- Tests: the two finding tests are now contract oracles. Four oracles were added: the 503 socket bound, a graceful 1012 close under live events, the gap/lag/unavailable paths, and the R06 schedule run without a browser against the actual controller. Each repaired clause except the 10-second write bound, which the spec states, was shown meaningful by a mutation check. Historical v1–v7 pins stay on the pre-repair harness bytes. All fe-review suites pass with `REVIEW_MODULES` and `FE_REVIEW_RUNS` set, and T006 passes 10/10.
- C2 driver: `fe-review/conformance-browser.mjs` with pure verdicts in `conformance-browser-verdicts.mjs`. It covers R02 browser TLS, R06 no-resend in a browser, and R07 keyboard traversal, measured names and mobile diff scroll. The independent review returned ACCEPT_WITH_FIXES, and the re-review of the fixes returned ACCEPT. The fixes were the graceful 1012 close, the added oracles, R02 health before context close, stale proposal text, and `limits:null`. PR739 merged as `74b107e6`.

### C2 result: `conformance-001` PASS, actual review ACCEPT

One start on source `a126796a`, inside the pinned image with `--network none`. It took 10.8 s; the container was removed and ports 8443–8445 were proven free. The run used Node v24.18.0, Playwright 1.63.0 and Chromium 153.0.8010.12.

- **R02, TLS in the browser:** HTTPS and WSS work over the private CA. A wrong-name certificate gives `ERR_CERT_COMMON_NAME_INVALID`, an untrusted CA gives `ERR_CERT_AUTHORITY_INVALID`, and plain HTTP gives `ERR_EMPTY_RESPONSE`. None of the three negatives reached its transport.
- **R06, no resend:** the browser sent one bootstrap POST and one turn POST, and only GETs after the submit, through the 1012 restart, the gap, a reload and a keyboard Refresh. Frames: subscribe at 2, one `history_gap` (5/68), then resubscribe at 68. The fixture saw 17 turns.
- **R07, desktop and mobile:**
  - Tab from `body` lands on `#event-list` (7th Tab) and `#diff-output` (9th) with `:focus-visible` and Chromium's default `auto` 1px outline. The four screenshots show the ring.
  - Playwright's role query and Chromium's accessibility tree both report the names "Ordered activity" and "Final diff".
  - On mobile the diff overflows (831 > 448), and ArrowDown then PageDown increase `scrollTop` (0 → 1 → 9).
- **Health:** no request failures or page errors. The one console message per context is the expected 401 before authentication.

Limitations recorded by the actual review:
- The scroll values were sampled mid smooth-scroll. ArrowDown is shown to start a scroll, but PageDown's own effect is not isolated, and no settled value was recorded.
- Desktop regions and `#event-list` do not overflow, so keyboard scroll is shown only for the mobile diff.
- The "refresh snapshot before resubscribe" step is inferred, not timestamped.
- One headless browser and a synthetic fixture, not the product backend.

The results and screenshots stay private and are backed up (`t0433-c2-conformance-20261029T054119Z`, with SHA256SUMS).

## T-0433 focused journeys N01–N09 (2026-10-29)

The T0433-3 inventory found that SPEC-T006R R10 requires focused desktop journeys N01–N09 with actual receipts. N03, N04, N06 and N07, and parts of N01 and N02, had only Node-loopback or pure-partition evidence. R06 also requires at least one real browser timeout. The owner chose to add one focused browser run (「按你建議。」). [SPEC-T006R-focused-journeys](docs/specs/SPEC-T006R-focused-journeys.md) maps every journey to its evidence layer and specifies:
- five review-only, one-shot transport seams (H01–H05);
- a new driver, `fe-review/journeys-browser.mjs`, covering J01–J06;
- the `journeys-001` runtime boundary.

The spec was independently reviewed (ACCEPT_WITH_FIXES). All ten findings are fixed in it.

Tests:
- The seam oracle runs over the real loopback transport, and six mutations each made it fail.
- The pure verdict suite has a failing row for each pass condition.
- With `REVIEW_MODULES` and `FE_REVIEW_RUNS` set, all 290 fe-review tests pass; without them, 271 pass and 19 skip with a stated reason. T006 passes 10/10.
- The C2 driver's `transport.mjs` pin is now historical (`fcc6aba7…`). Its other pins and v4–v7 are unchanged.

`journeys-001` ran once after its own owner approval (「批准：跑一次 journeys-001。」) on `df10a299`: PASS, 11/11 verdicts true in 80.4 s, cleanup complete, port 8443 absent. The independent actual review accepted it with findings. It confirmed that the J03 client timer fired 15,009 ms after the press with no resend. It also recorded a product finding: after detecting an invalid frame itself, the client keeps its socket open until Refresh; the suspected cause, `close(1008)`, is not observed. The limitations are listed in the [spec's result section](docs/specs/SPEC-T006R-focused-journeys.md#journeys-001-result-2026-10-29).

The final integration below maps N01–N09 to these receipts.

## T-0433 shared capture gate R11 (2026-10-29)

The T0433-3 inventory found that SPEC-T006R R11 requires the unchanged shared `docs/fe-review/capture.mjs` to run against private targets, first as a dry run and then as a static capture, and that no run had used it. `targets.json` still named port 18443. The owner chose one bounded shared-capture run (「按你推薦做吧。」). [SPEC-T006R-shared-capture](docs/specs/SPEC-T006R-shared-capture.md) specifies:
- `targets.json` now names the review origin `https://127.0.0.1:8443`;
- a wrapper, `fe-review/shared-capture.mjs`, that serves the bootstrap fixture with the fresh trust, copies `targets.json` byte for byte to private state and runs `capture.mjs` unchanged;
- exact verdicts for the dry-run plan and the three-size capture, and the `capture-001`/`capture-002` runtime boundary;
- one review-only transport counter for Chromium's automatic `GET /favicon.ico`, which reaches the server because `capture.mjs` installs no route. Its 404 is recorded as a presentation finding, and any other unknown request still fails.

The independent review rejected the first version because the favicon request was missing from the expectations; this version fixes that. Tests: shared-capture tests including a real dry run of the unchanged shared script, a tool-resolution test against the real review tools, and one loopback transport oracle.

`capture-001` ran once after its own approval (「批准：跑一次 capture-001」) and FAILED in 0.3 s at the wrapper's tool precondition, before any server or browser started: the wrapper read the axe version with `require('@axe-core/playwright/package.json')`, which that package does not export. The FAIL is preserved and backed up. The fix (W09) reads the package files directly and adds a test that would have caught it. After the fix passed review and CI (PR764), `capture-002` ran once as its retry (「批准：跑一次 capture-002。」): PASS in 5.0 s, all four verdicts true, the unchanged `capture.mjs` dry run and three-size capture matched exactly, and cleanup was complete. The independent actual review accepted it with findings: the favicon 404 and a button that touches the input above it are recorded presentation findings, and TLS is shown positively only. Details are in the [spec's result section](docs/specs/SPEC-T006R-shared-capture.md#capture-002-result-2026-10-29-pass).

## T-0433 final integration (2026-10-29)

The [R2 report](fe-review/tasks/round2/report.md) records R2-AC-E for this unit: source commits, commands, tool versions, results per clause (R01–R12, N01–N09) with receipts, the mock and real boundary, cleanup and backups, PR/CI readback, limits and product findings. Every R2-AC-14 condition in ROUND2-SDD line 17 holds with linked evidence, so `fe-review/targets.json` is now `verified:true`. `capture-002` ran on the pre-flip bytes (`5aa2d64c…`, `verified:false`); `capture.mjs` does not read `verified`, and the wrapper pin and targets test moved with the flip. T006R is accepted ([ACCEPT-T006R](docs/acceptance/T006R.acceptance.md)).

Product findings, recorded and not fixed: the client socket stays open after a protocol error the client detected itself, until Refresh (suspected `close(1008)`, not observed); favicon 404; the Authenticate button touches the input above it. This does not change the product AC table: real backend/Cloud integration, AC-04, AC-05 and Round 3 stay open.

## T-0438 operator client fixes (2026-10-29)

Desk [T-0438](https://github.com/fallrising/desk/blob/main/tasks/T-0438-fanzloud-client-fixes/task.md) fixes two product findings from T-0433. The owner agreed (「按你建議」) and authorized delegating the code to coding CLIs.

- **Socket close after a self-detected protocol error.** [SPEC-T006](docs/specs/SPEC-T006-private-operator-web.md) P-006-11: the controller closes a failed connection with `close(1000, "")`. Browsers reject 1008 from a page. AC: T006 test 7's fake WebSocket rejects disallowed codes as browsers do; this fails (RED) on the current `close(1008)` and passes after the fix; T006 and all fe-review suites pass.
- **Authenticate spacing.** `p0.css` gives the Authenticate button a vertical gap below the bearer input at all sizes. AC: the CSS change is scoped to that control; no other layout changes.
- Historical runner pins stay on the bytes they ran on, using the existing `historical` pattern in the pin tests. No earlier result is reinterpreted.
- Out of scope: favicon 404 (it needs a new Rust route and a CSP change), backend/API/security/retry semantics, and any new browser run, which needs its own owner approval.

Delivery: Codex (GPT family) implements, an independent Claude review checks the result, then required CI, merge and readback.

## T-0440 favicon and browser follow-up — 2026-10-29

Scope: [SPEC-T006F](docs/specs/SPEC-T006F-browser-followup.md) AC-F01–F04. Add the embedded favicon without changing CSP, and observe the T-0438 close/spacing fixes in a bounded fresh Chromium run. Native route checks establish the Rust boundary; browser evidence uses the synthetic review fixture. All four AC have passing observations in the [follow-up report](fe-review/tasks/followup/report.md); [independent final acceptance](docs/acceptance/T006F.acceptance.md) is ACCEPT. Historical T-0433/T-0438 evidence stays versioned; mainline AC-04/AC-05 and usable qualification are unchanged.

## T-0442 execution gates — 2026-10-30

[Specification](docs/specs/SPEC-T008-p0-real-browser.md), [call chain and executable entry](docs/quickstart.md), [task board](docs/tasks/BOARD.md).
AC-01 real-browser run passed with a fake provider; AC-04 not run — credential/environment gate unavailable.
The official 0.145.0 executable is verified separately; the existing default credential directory does not satisfy private mode 0700 and no Cloud target/private HTTPS setup was supplied. No version or security check is relaxed.

## T-0442 M1 isolated Web implementation

[Prior contract](docs/specs/SPEC-M1-isolated-web.md) binds the approved T-0447
executor to a real browser submission. EX02 actual KVM tools/denials/cleanup passed;
EX03 and M1-WEB01–05 passed on33e1eb70; see [actual acceptance](docs/acceptance/M1-isolated.md).
Original Cloud AC-04 and persistent AC-05 are not changed to passed.

## T-0442 M2 — 2026-11-01 active scope

Owner requests the approved second-vendor/two-task milestone. [M2 contract](docs/specs/SPEC-M2-two-vendors.md) fixes scope and checks before implementation. Codex tool/credential separation and concurrent isolation are NOT_RUN. Existing host authority remains one4CPU/4GiB VM and coding<=600s; parallel2 requires separate approval. No M3, API spend, public deployment or release.

M2 checkpoint2026-11-01: sourcea51a8663 actual Codex Web run142e9aee passed
fixed-base repair/check/download and confirmed cleanup; code and single-live independent
reviews accepted, native and hosted CI green. Two simultaneous workspaces/current shared
Claude route remain pending explicit resource approval. max_claims remains1; temporary
services stopped, no resident URL, no M3/AC05 or full platform completion claim.
