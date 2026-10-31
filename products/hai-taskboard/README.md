# HAI Taskboard

> 主線、驗收條件、剩餘缺口與可用版本：[SUCCESS.md](SUCCESS.md)。

> 剩餘主線與未實作設計的分階段計劃：[remaining-work plan](docs/plans/remaining-work-20261029.md)。已交付切片與目前進度以 [BOARD](docs/tasks/BOARD.md) 為準。


> **Portfolio doc tier: A (active)** — Runnable entry: [docs/quickstart.md](docs/quickstart.md). Policy: [docs/portfolio-doc-tiers.md](../../docs/portfolio-doc-tiers.md). Investment notes: [PORTFOLIO.md](../../PORTFOLIO.md).


HAI Taskboard is a human–AI software delivery control plane. Its Work Graph records current work,
execution attempts, immutable delivery candidates, reviews and evidence; Kanban, detail views and
attention queues are projections over that state.

Status: **P0-A implementation is incomplete; the local Fake workflow is available for development
and bounded evaluation.** Real agent execution and channel integrations are intentionally disabled.

## Current usability

| Use | Current boundary |
| --- | --- |
| Try the local workflow | Authenticated browser, project/Draft creation, explicit specification acceptance, Ready/Fake dispatch and reconnect have bounded historical evidence. Start with [quickstart](docs/quickstart.md) and its connected-browser recipe. |
| Use the complete Fake-only product | Not yet accepted: connected Candidate/Review/Evidence/QA/Done, full detail/attention/impact, activation, backup/restore and ContextPack resume still have gaps. |
| Delegate everyday work to a real coding agent | Not available. There is no enabled real provider or MCP workflow; those require a later, separately authorized and verified integration. |

The product remains `mainline: incomplete`, `usable_tag: none`. A runnable Fake slice and a passing
health check do not establish full-product readiness. [SUCCESS](SUCCESS.md) owns the acceptance
status; its historical evidence is not a new runtime verification by this documentation update.

[Kanzo-inspired usability](docs/sdd/kanzo-inspired-usability.md) specifies later quick capture/search,
progress notes, export and agent-facing workflow improvements with acceptance criteria. It is a
proposed follow-up design, not an implemented feature list; the current P0-A scope stays Fake-only.

## Session-first 角色控制室（設計，未啟用）

[控制室 mini-SDD](docs/sdd/session-control-room.md)將角色視為 Session 的互動投影，沿用 HAI
的 WorkItem／Run／Candidate／Review／Evidence／Approval／CompletionRecord；不另造任務權威。
包含啟用時間、runner／sandbox、回合、Context、最後輸入／輸出用量及來源可信度，並區分唯讀觀測與受管派工。

[真實 provider 主線診斷與 L1 提案](docs/plans/provider-critical-path-20261030.md)區分現行
Fake-only 門檻與建議的一個 provider 真實閉環；MCP、第二 provider、跨機與角色地圖不自動成為前置。
**此提案只融合設計文件，不改 AGENTS／已接受 SDD、不啟用 provider，也不代表產品驗收。**
採用提早 L1 路線仍須明確批准有界 scope、成本與權限；未批准時仍依 BOARD 的 Fake-only 主線推進。
文件任務與實際驗證見 [BOARD](docs/tasks/BOARD.md) 與[證據](docs/evidence/session-control-room-20261030.md)。

## Implementation checkpoint

The owner resumed P0-A mainline development on 2026-10-23. Current work is tracked in
[the task board](docs/tasks/BOARD.md); [SUCCESS](SUCCESS.md) distinguishes current checks,
historical accepted slices and missing full-product acceptance. The runtime persists commands,
polls Pending Fake work and serves board/SSE reads. Explicitly approved local Git repositories
can now produce durable proposals through authenticated HTTP, with exact replay after process
restart. [Configuration and usage](docs/local-development.md#approved-local-proposal-import)
are documented. First acceptance and immutable current-input storage are accepted locally;
current-head Ready/dispatch and initial-acceptance HTTP are also accepted locally after
independent review and actual two-process execution/replay checks. The React entry now uses
real authenticated project/board reads, explicit specification acceptance and Fake dispatch.
An actual Chromium flow also covers response loss and reconnection; the old fixture components
remain test fixtures. Candidate/review/evidence/QA/Done operations still need connected detail UI
and artifact/report access. Full attention/impact, activation and backup/restore remain unfinished.
See [browser setup](docs/local-development.md#connected-browser-foundation) and the current board.

See `docs/SDD.md`. The class A ledger is archived at journal `archive/team-ledgers/newclear/products/hai-taskboard/.team/`.


M0 基準對帳與缺口：[baseline report](docs/evidence/m0-baseline-20261029.md)。新一輪 pinned backend/web 與真實 ConnectedApp foundation 已跑；完整產品仍未完成；後續 M1a 契約已依 owner 批准交付。

M1a: [完成準備 API 契約](docs/sdd/completion-preparation.md)與[驗證紀錄](docs/evidence/m1a-completion-preparation-20261030.md)。
讀取只提供 exact snapshot，不代表可以完成；完整完成 UI 與其他 P0-A 缺口仍按 [BOARD](docs/tasks/BOARD.md) 推進。

M1b: [Run 產出與 artifact 讀取計劃](docs/plans/m1b-output-access-20261030.md)。
只允許讀取已授權 project 的既有產出關聯；下載內容須先核對雜湊與大小。
完整完成介面仍待後續切片，交付狀態以 BOARD 為準。

M1c: [人工 report 封存與提交計劃](docs/plans/m1c-human-reports-20261031.md)已經 Claude 審查，
實作、本機驗證與代碼複核已通過，交付狀態見 BOARD。新路徑以明確人工意圖提交 text/plain 或 Markdown，保存 actor／exact subject／
digest，再原子建立獨立 Review 或 Evidence；不自動完成工作。讀取與重送邊界見
[操作說明](docs/local-development.md#human-report-api)與[驗證紀錄](docs/evidence/m1c-human-reports-20261031.md)。


M2 identity repair is delivered. The approved [immutable project-policy contract](docs/sdd/local-project-policy.md)
and [evidence](docs/evidence/project-policy-20261031.md) track exact project/AC configuration and durable
startup binding; see BOARD HMPOL and [operator setup](docs/local-development.md#immutable-per-project-completion-policies).
Verified coverage and full P0-A remain incomplete.
