---
project: products/hai-taskboard
purpose: 以可追溯工作圖與證據關卡控制人機軟體交付
kind: application
mainline: incomplete
usable_tag: none
reviewed: 2026-10-29
source_commit: 0111908492c32d0b01d561b24b6024737cb4f641
---

# HAI Taskboard 成功契約

剩餘工作與後續設計的順序、依賴及規劃驗收見 [2026-10-29 計劃](docs/plans/remaining-work-20261029.md)。
該文件工作不改下列產品 AC、歷史驗證日期或 Fake-only 範圍；提出的未來驗收仍未執行。

## 主線與範圍

[P0-A SDD](docs/SDD.md)要求單 operator 能由持久工作圖與 ContextPack 接續工作，經 subject-bound review/evidence 安全完成。
Fake executor 是第一版原定邊界；完整 P0-A 仍須滿足 UI、恢復與 Done gate，不以成功 Run 取代。

只允許 deterministic Fake，不執行真 agent、shell、provider credential 或聊天 channel integration。
Board/SSE 是 projection；WorkItem、Run、Candidate、Review、Evidence、Approval、CompletionRecord 不合併。

本契約核對的是上述來源版本中的文件與程式。
`complete` 只適用明列的主線範圍；沒有延伸為部署或生產保證。

## 驗收條件

歷史報告仍保留；下表的本次通過只涵蓋有新證據的條件。
`pending` 保留缺少證據或尚未實作的條件；程式存在不等於通過。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given 有效 application command 與持久 SQLite，When response-loss/retry/restart，Then 同一命令結果可重放且不重複啟動 Fake | passed | 2026-10-23 pinned full/race 重跑既有 Fake/replay oracles；新增 durable proposal 與真實雙 process replay 通過，T-982/T-985 獨立審查，詳見 [traceability](docs/traceability.md) |
| AC-02 | Given exact candidate 與政策／AC revision，When 嘗試完成工作，Then 缺失、過期或不獨立的證據不能產生 Done | pending | [traceability](docs/traceability.md)：完整 HAI-DONE-001..004 仍 NotRun，部分 kernel 通過不等於總 gate |
| AC-03 | Given operator 使用 board/detail/attention，When 遭遇斷線、拒絕與狀態變動，Then UI 可操作並從權威狀態恢復 | pending | [traceability](docs/traceability.md)：HAI-UX 全組及完整 UI acceptance 尚缺 |
| AC-04 | Given 備份、proposal import 與依賴圖變更，When 還原並接續，Then accepted binding、reconciliation 與 ContextPack 可完整恢復 | pending | [traceability](docs/traceability.md)：backup/restore、durable activation 與 full ops group 未完 |

## 現況與缺口

### 目前能用到哪裡

| 層次 | 現況 | 還需要什麼 |
| --- | --- | --- |
| 本機開發試用 | 已有 authenticated connected browser、project/Draft、明確接受規格、Ready/Fake、回應遺失查回與重連的局部歷史證據 | 依 quickstart/local-development 設定；Fake 成功仍停 Developing；本次文件工作未重跑 runtime |
| 完整 P0-A | 尚未完成；AC-02/03/04 pending | 完整 Candidate/Review/Evidence/QA/Done UI、detail/attention/impact、activation、backup/restore、ContextPack 接續及整組驗收 |
| 日常真實 agent 工作台 | 尚未啟用；目前不能派送真實 Codex/Claude 工作，也沒有已啟用的 MCP 取件流程 | 完整 P0-A 後，另行授權並驗收單一真實 adapter、agent 身分/權限、成果驗收與中斷接續 |

因此目前適合試用已完成的 Fake 流程，尚不適合作為日常真實 agent 工作台。
Fake-only 是 P0-A 的原定範圍；不以增加真 provider 作為補足本輪 AC 的捷徑。
2026-10-29 的更新只核對文件與來源；下列原有通過紀錄保留各自日期與驗證範圍。

Domain kernel、SQLite、HTTP/SSE、Fake vertical 與 local bootstrap 有獨立接受切片。
[交接](docs/HANDOFF.md)保留 T-062、T-077/079、T-047/082 等歷史 FAIL 與後續修復，不能抹成首輪全過。
Runnable loopback runtime 不是完整圖形工作管理產品。
真 agent integration 是刻意不在 P0-A，不列作本輪產品缺陷或要求開啟。

Owner 已啟用 START_DEVELOPMENT_PROMPT；本次恢復 P0-A 主線實作，原 AC 不縮小。
目前任務與依賴順序見 [BOARD](docs/tasks/BOARD.md)。Durable proposal、首次接受 HTTP、
current-input 儲存、Ready／派工、current-subject／Done 服務層、Run 產出關聯儲存及
專案列表 API 已局部驗收。Connected UI 的 reset/session 競態已修正並經獨立審查；
登入、明確接受規格、派工 Fake、回應遺失復原與斷線重連已跑過真實 Chromium。
Run 產出 consumer、六個完成／取消 HTTP 操作與 completion preparation 已局部驗收，
整合 Go full/race/vet/build、API lint 與基礎瀏覽器流程重跑均通過。完整 candidate/review/evidence/QA/Done UI、detail/attention/impact
與 activation/restore 尚未完成；局部通過不直接把整組 AC 改成通過。
驗證計畫：具體行為 Red/Green、Go full/race/vet/build、既有 web gates、
產品操作／重連／還原流程及獨立審查；命令及失敗原因保留於本次證據。
歷史結果若與現行 source 有相關差異，必須補驗而不能直接繼承。

## 啟動與驗證

[Quickstart](docs/quickstart.md)與[local development](docs/local-development.md)規定 Go、0700 私有資料根、loopback origin 與單次 session token。

已核對入口：[taskboard main](backend/cmd/taskboard/main.go)。
下列是該入口既有的啟動或驗證命令，並非本次執行紀錄；
需先完成連結文件中的依賴、設定及適用環境準備。

```sh
cd backend
go build -o /tmp/hai-taskboard-local ./cmd/taskboard
go test ./...
```

執行後應保留來源 SHA、必要設定的非秘密摘要、命令與結果，
並將 runtime 證據逐項對回 AC；不得只用 health 或 exit 0 宣告全部完成。

## 可用版本

目前 `usable_tag: none`；本次沒有建立或發布任何 tag。
既有版本號、合併紀錄與歷史驗收不自動轉換為可用版本標記。

須先完成 P0-A 自己的 Done、UI、持久 import/reconciliation 與備份還原驗收；維持 Fake-only 也能完成此主線，但目前證據尚不足。


## FE Round2 slice — T-0380 R2-AC-3/E / PR586 (LOCAL_VERIFIED; REVIEW/CI/DELIVERY_PENDING)

Approved ConnectedApp DESIGN items1–4 only: review-owned same-origin runtime/session/admission harness, real UI observations and only measured presentation corrections. This slice does not complete AC-02/03/04 or add detail, QA/Done, impact or restore features. Backend/Go/API/commands/stream/security/business logic/dependencies/CI are read-only.

Acceptance: current pinned web gate and root-owned backend gate; focused Red/Green review-harness safety tests; fresh private state outside checkout, owned graceful lifecycle, immutable synthetic repository admission and no token in argv/URLs/logs/storageState/traces/screenshots. Actual UI login/project/Draft/explicit exact-AC acceptance/Ready/Fake with successful Fake remaining Developing; same command identity for uncertain recovery, authoritative reconnect and existing status/alert feedback. Actual theme button, three viewport sizes, keyboard/focus/wrapping evidence and documented faults. Preserve failed/unrun observations and unresolved product-mainline gaps; targets verified only after original R2 evidence, no fullRound3 claim.

Local R2 evidence: pinned native web30tests/backendfull+race, review safety8tests,30unique actual-theme captures and true session/admission/Ready/Fake/fault/cleanup checks passed; see [scoped report](fe-review/tasks/round2/report.md). Existing legacy AC count and earlier refresh-warning/later Connected feedback remain unresolved. No product AC-02/03/04 or fullRound3 completion follows.

## Kanzo usability documentation — T-1029

2026-10-29 scope: clarify current usability and specify selected Kanzo-inspired follow-ups
before implementation. Documentation baseline is `0111908492c32d0b01d561b24b6024737cb4f641`;
this is a static documentation/source review, not a new runtime verification. Existing
AC-01 evidence retains its original date; AC-02/03/04 stay pending, mainline incomplete,
and usable_tag none. The Fake-only P0-A boundary and its full acceptance scope remain intact.

Documentation acceptance: DOC-01 accurately separates the current runnable slice, complete
P0-A and a future real-agent workspace; DOC-02 gives ordered feature contracts and named
future oracles without activating them; DOC-03 supplies navigation/contract checks and
independent review. Verification planned: exact upstream materialization, scoped diff,
local-link/identifier checks, project-success/index preflight, independent document review,
and applicable PR checks. No product tests or real providers are introduced by this task.
The proposed [Kanzo-inspired design](docs/sdd/kanzo-inspired-usability.md) records the follow-up
contracts, dependencies and named future oracles. All HAI-KZ feature oracles remain Proposed/NotRun;
they are not added to P0-A AC-01..04. Current task status and writable scope are in
[BOARD](docs/tasks/BOARD.md); actual document verification and independent review are recorded in
[the bounded report](docs/evidence/kanzo-usability-docs-20261029.md).


## M0 baseline reconciliation — T-0339 / 2026-10-29

Owner continued development after the reviewed remaining-work plan. This bounded task audits current source `1e70824e24161bafacfc1eca33bb31ba7045df5a` and runs the pinned backend/web gates plus existing real ConnectedApp foundation harness. It produces full clause/implementation/test/gap coverage and precise contract-conflict proposals before M1a. Acceptance is M0-01..03 in [BOARD](docs/tasks/BOARD.md); no production/spec changes or product AC promotion. Initial tests are NotRun for this source until recorded in the new evidence. Historical failures/partial results stay intact.

M0 current local result: pinned backend full/race/vet/build, web30tests/build and8harness safety tests pass; real ConnectedApp13steps/30captures pass with Fake remaining Developing/Succeeded andDone0. Two source inventories and independent T-003 review support only this baseline; [full evidence and limits](docs/evidence/m0-baseline-20261029.md) retain initial environment failures and all product gaps. Required Git/CI delivery is tracked separately in BOARD; no AC-02/03/04 promotion.

## M1a completion preparation — T-0339 / 2026-10-30

Owner approved C01/C02/C06 and requested current design authority. Source `6b7bf17c010f6a354f7abf3676f994f7ae2d19ec`
has the same HAI tree as M0 closeout; no newer open HAI design PR at intake. This bounded milestone
aligns bootstrap/preflight wording and implements the [snapshot-only completion preparation contract](docs/sdd/completion-preparation.md),
PREP-AC-01..04. Verify auth/scope, exact Review/QA snapshot with no writes, stale/policy precedence and
strict output/bounds/capability refusal using focused Red/Green and real SQLite; then pinned backend
full/race/vet/build, OpenAPI lint, existing web gate, document checks, independent review and PR CI.
Initial status NotRun; full product AC-02/03/04 remain pending. No UI or later M1/M2 slice is included.

M1a local evidence: PREP-AC-01..04 focused/real SQLite checks pass; pinned backend full/race/vet/build,
web30/type/lint/format/build and OpenAPI lint pass. Independent contract and implementation reviews
ACCEPT. [Evidence](docs/evidence/m1a-completion-preparation-20261030.md) retains meaningful Red and
environment/superseded runs; required Git/CI delivery is tracked in BOARD. Product ACs stay pending.

## M1b scoped output access — T-0339 / 2026-10-30

Owner continued with Claude Code plan/code review. [Bounded plan](docs/plans/m1b-output-access-20261030.md)
fixes ACCESS-AC-01..04 before implementation: authenticated Run output list and project-bound
verified artifact bytes, zero writes and historical restart readability. Initial status NotRun.
Checks: focused Red/Green and real SQLite, pinned backend full/race/vet/build, existing web gate,
OpenAPI/doc checks, independent Claude reviews and required PR CI. No product AC promotion.
