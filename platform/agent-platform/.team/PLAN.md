# Safe result diff delivery

Objective: make persisted run diffs safely downloadable by the authenticated operator and verify untrusted result/event content remains inert in the workbench. This is a bounded result transport slice, not artifact storage, remote Git export or full M3 completion. Billing remains deferred.

Orchestrator owns this plan, integration, independent review and acceptance.

Tasks:
- T-003: backend worker in isolated worktree; red-green pure validation plus authenticated HTTP download.
- Orchestrator: download UI, UI tests, real browser fixture/security case, documentation, sanitized evidence and checks.
- T-004: independent read-only final review.

Contract: GET /api/v1/runs/{run_id}/result.diff; authenticated read; retrieve only that run's persisted diff; UTF-8 bytes at most 256 KiB, exact diff_bytes and lowercase SHA-256, matching run base SHA. Missing diff returns 404; corrupted data returns 409. Valid empty diff is downloadable. No mutation or interpretation of patch text. Content-Disposition attachment with server-generated run UUID filename; text/plain UTF-8, nosniff/no-store and restrictive download CSP.

Frontend: operator invokes a download button; fetch same-origin session credentials; verify response success before creating blob/download; show errors. Offer only when diff metadata is present and structurally valid, without requiring verification passed (failed/unknown results remain inspectable). No HTML renderer/preview.

Verification: make platform-check; make web-check; relevant browser suite using real PostgreSQL/API and fake runtime records; git diff --check and team contracts. No live VM/provider operations.

Acceptance: backend T-003 accepted after inspected diff and root targeted7passed; full platform45unit+260SQL/HTTP, frontend37 and browser2passed. Independent T-004 final review accepted after source/evidence inspection; no required findings. Scope is only this M3 slice.

Frontend scope includes web/src/api.ts to declare the persisted diff byte count and base commit fields already returned by the API.

Rebased cleanly onto current main 10d5729 (mock tool broker); all required checks rerun. Platform: 45 unit and 260 SQL/HTTP; frontend37, browser2; no skips. Backend worker scope inspected; no code conflicts with latest main.

Evidence gate: all defined checks map to code tests, final logs and sanitized evidence; tasks/reports valid, scope bounded. Slice accepted for Draft PR review.
