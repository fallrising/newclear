# Full Build Tasks

The authoritative per-worker prompts are stored in `.team/tasks/`. The
orchestrator updates this index only after reviewing actual diffs and rerunning the
listed verification commands.

| Task | Phase | Deliverable | Status |
|---|---:|---|---|
| T-001 | 0 | ADRs and risk decisions | accepted |
| T-002 | 0 | protected GitHub/security governance | accepted after report-only escalation |
| T-003 | 0 | templates and JSON schemas | accepted |
| T-004 | 0 | repository-native Phase 0 gate | accepted after scanner rework and report-only escalation |
| T-005 | 1 | constrained front matter and SDD validation | accepted after Terra reassignment |
| T-006 | 1 | deterministic lifecycle CLI | accepted after Terra reassignment |
| T-007 | 1 | CI-equivalent active-SDD validation | accepted after rework |
| T-008 | 2 | bounded execution and policy gates | accepted after strong escalation |
| T-009 | 2 | isolated worktree, sandbox, and Codex adapter | accepted after strong escalation |
| T-010 | 2 | staged orchestration and draft publication evidence | accepted after Terra reassignment |
| T-011 | 3 | OpenCode and read-only reviewer adapters | accepted after strong escalation |
| T-012 | 3 | provider routing and usage ledger | accepted after rework |
| T-013 | 3 | sequential independent-review pipeline | accepted after strong escalation |
| T-014 | 4 | content-addressed intake and taxonomy contracts | accepted after Terra reassignment |
| T-015 | 4 | synthetic PDF/PBM extraction and OCR cache | accepted after rework |
| T-016 | 4 | FTS5 retrieval and cited proposals | accepted after Terra reassignment |
| T-017 | 4 | four-stage knowledge CLI and two-PDF E2E | accepted after strong review |
| T-018 | 5 | retrieval, comparison, and integrity reports | accepted after rework |
| T-019 | 5 | digest-bound promotion and human gate | accepted after strong escalation |
| T-020 | 5 | synthetic horizontal comparison E2E | accepted after rework |
| T-021 | 6 | pure publication compiler | accepted after rework |
| T-022 | 6 | confined atomic publication boundary | accepted after strong escalation |
| T-023 | 6 | two-book shared-knowledge rebuild | accepted after strong review |
| T-024 | 7 | observability, quotas, and evidence semantics | accepted after strong escalation |
| T-025 | 7 | hardening contracts and local drills | accepted after strong escalation |
| T-026 | 7 | complete local hardening journey | accepted after strong escalation |
