# HAI Taskboard

> 主線、驗收條件、剩餘缺口與可用版本：[SUCCESS.md](SUCCESS.md)。


> **Portfolio doc tier: A (active)** — Runnable entry: [docs/quickstart.md](docs/quickstart.md). Policy: [docs/portfolio-doc-tiers.md](../../docs/portfolio-doc-tiers.md). Investment notes: [PORTFOLIO.md](../../PORTFOLIO.md).


HAI Taskboard is a human–AI software delivery control plane. Its Work Graph records current work,
execution attempts, immutable delivery candidates, reviews and evidence; Kanban, detail views and
attention queues are projections over that state.

Status: P0-A specification and deterministic Fake-core development. Real agent execution and channel
integrations are intentionally disabled.

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
