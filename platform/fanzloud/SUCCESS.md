---
project: platform/fanzloud
purpose: 提供單人 Codex Cloud 任務控制與可追溯事件儲存
kind: application
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# Codebox / Fanzloud 成功契約

> 2026-10-28 desk T-0433 resumed Fanzloud ([issue706](https://github.com/fallrising/newclear/issues/706)). An app-free [layer ablation](../../docs/fe-review/fanzloud-completion-regression/LAYER-ABLATION.md) reproduced the ERR_ABORTED signature on Chromium 153. The trigger is a no-store response consumed through a stream reader; `arrayBuffer()` gave 0/600 and Playwright interception is not necessary. The current unit fixes `p0-client.js` bounded reads and fixture framing. All 27 canonical cells, including the earlier 8, must be recaptured on the new source, and each runtime needs its own owner approval. recovery007 stays FAIL/consumed and PR604 stays Draft. Earlier closure text and "next" recommendations below are history.


## 主線與範圍

[TD](docs/TD.md)的長期目標是 provider-neutral coding platform；已接受的 P0 是私人單 operator BYOS Codex Cloud 控制面。
P1 event store 與 T040A command planner 是後續獨立切片，尚未形成完整持久 actor/runtime。

保留 [README](README.md) 的 dormant 投入狀態；盤點不恢復開發。
個人訂閱不得池化、轉售或供第二個人喚醒；不允許 local codex exec/cloud apply 進 P0 authority。

本契約核對的是上述來源版本中的文件與程式。
`complete` 只適用明列的主線範圍；沒有延伸為部署或生產保證。

## 驗收條件

下表 `historical` 是既有報告的結果，沒有在 2026-10-21 重跑。
`pending` 保留缺少證據或尚未實作的條件；程式存在不等於通過。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given 固定 CLI 與 fake provider，When 瀏覽器建立任務並觀看狀態與 diff，Then HTTP/WS、session 與 trusted runner 依契約運作 | historical | [T007 驗收](docs/acceptance/T007.acceptance.md)、[README](README.md) |
| AC-02 | Given durable event prefix，When append/replay/save/load 與重啟組合，Then 權威事件不被損壞 cache 掩蓋且錯誤維持 typed | historical | [T030 組合驗收](docs/acceptance/T030.acceptance.md) |
| AC-03 | Given 三種 typed command 與 v1 狀態，When 決策函式執行，Then 只產生不可變零或一事件 proposal | historical | [T040A 驗收](docs/acceptance/T040A.acceptance.md) |
| AC-04 | Given 真實 operator Cloud entitlement，When 提交、追蹤與取回 diff，Then 同版 live smoke 能證明 provider 邊界 | pending | [交接](docs/HANDOFF.md)：credential-gated live operator smoke 未跑 |
| AC-05 | Given durable session 與 host runtime，When crash/recovery 或沙箱執行，Then 完整 actor/store/runtime 閉環保留一致狀態 | pending | [交接](docs/HANDOFF.md)：P1 store 未接 P0；T040 後續、node-agent/boxd 尚未完成 |

## 現況與缺口

T001–T007 及 T010/T020 有歷史接受，不能外推完整 TD。
T030A/B/C/D store 已獨立接受；P0 session replay 仍只在 process lifetime 內。
取消本機監看不能保證 provider task 已終止；未知提交只能依既有對帳介面處理。
實際原生 agent、local sandbox、多使用者認證不是已交付能力。

這次僅新增驗收入口，未改變 runtime 或原有驗收 oracle。
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
