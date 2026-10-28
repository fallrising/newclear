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

> 2026-10-28 owner決定：依已交付18項結案，Fanzloud暫緩且未完成（8/27、007FAIL/consumed、PR604Draft）。停止延伸Chromium調查；下方舊「下一步」僅為歷史提案，不是待執行工作。唯一恢復入口：[issue706](https://github.com/fallrising/newclear/issues/706)；[結案範圍](https://github.com/fallrising/newclear/blob/main/docs/fe-review/ROUND2-CLOSEOUT.md)。沒有新runtime/build/model授權。


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


## T-0380 Claude-reviewed completion plan — 2026-10-27

Owner requested consultation on the current failure and plan, then documentation before further work. [The updated plan](../../docs/fe-review/FANZLOUD-COMPLETION-PLAN.md) separates verified conditional source behavior from unproven executed-build/007 attribution. It adds the error-to-cancel control and corrects abort, suspension, context-destruction and exception oracles. Scope is documentation only: no engine/application/dependency edit or new browser attempt.

Document acceptance requires source-backed advice mapping, explicit NOT_RUN/SLICE/engine/product evidence levels, a bounded upstream-test-patch next task, scoped project-success and diff checks, independent review, required CI and remote readback. The next test patch is not implemented or executed by this document. Recovery007 remains FAIL/consumed; canonical8/27,delivery18/19 and PR604Draft remain. Existing product ACs, mainline incomplete, usable_tag:none and targetsfalse are unchanged.


## T-0380 upstream regression test artifact — 2026-10-28

Owner continued the merged plan. Goal/scope: prepare a pinned-source test-only patch, helper/API mapping, per-row predictions and explicit NOT_RUN/GAP status; no engine/application/dependency change or runtime. [The artifact](../../docs/fe-review/fanzloud-completion-regression/README.md) adds nine upstream gtest cases for terminal cleanup and controls, leaving actual V8/context cases as gaps. Acceptance is exact-source static applicability/reversal, externally visible callback/data/cancel oracles, independent artifact review and required repository checks/CI/readback. This is artifact acceptance only; no Chromium compilation or executed RED/GREEN is claimed.

Static apply/reverse passed on exact source copies. Actual007 root cause/build correspondence remains unknown; original product ACs,18/19,canonical8/27,PR604Draft,targetsfalse/mainlineincomplete/usable_tag:none remain. The next recommendation is a bounded read-only feasibility check for an existing genuine Blink test route, not an implicit build/download/browser grant.


## T-0380 existing Blink environment feasibility — 2026-10-28

Owner continued with one bounded read-only check of existing source/build/test availability. [The result](../../docs/fe-review/fanzloud-completion-regression/ENVIRONMENT-FEASIBILITY.md) identifies no compatible route in the inspected scope; excluded/inaccessible paths, container contents and remote environments remain unknown. The nine-case patch stays NOT_COMPILED/NOT_RUN; no engine RED/GREEN, actual007 attribution or R9/R10 integration coverage is claimed.

Acceptance for this factual checkpoint is traceable inventory with honest coverage/errors, preserved patch/product bytes, focused documentation checks, independent review, required CI and exact remote readback. No build/download/browser/model or product/dependency edit occurred. The next recommendation is one bounded upstream fix/history lookup. Original product ACs,18/19,canonical8/27,PR604Draft,targetsfalse/mainlineincomplete/usable_tag:none remain.
