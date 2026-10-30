# HAI Taskboard

> 主線、驗收條件、剩餘缺口與可用版本：[SUCCESS.md](SUCCESS.md)。

> 剩餘主線與未實作設計的分階段計劃：[remaining-work plan](docs/plans/remaining-work-20261029.md)。本輪只交付規劃與審查，不啟動產品實作。


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
完整完成介面與人工 report 寫入仍待後續切片，交付狀態以 BOARD 為準。
