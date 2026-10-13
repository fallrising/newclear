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
3. Worker tests and bounded scope reviewed before integration: pending.
4. Root native regression and M4 real TLS receiver/service gates: pending.
5. Independent review and evidence gate: pending.
6. Required PR CI, normal merge and remote readback: pending.

Acceptance matrix and exact commands are in M4 contract. Historical M3 evidence remains in its reports and STATUS. No completion claim yet. Known local Chromium sandbox limitation persists; supported CI browser path remains mandatory. No production configuration, account, deployment or runtime dependency is authorized.
