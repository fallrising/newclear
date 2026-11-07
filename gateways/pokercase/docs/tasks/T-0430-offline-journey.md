# T-0430 — Repeatable offline user journey

Demand: [desk T-0430](https://github.com/fallrising/desk/tree/main/tasks/T-0430-thinrouter-offline-journey). Claim [PR261](https://github.com/fallrising/desk/pull/261) merged `4c6fbb7f65d6fd4bae3599b7757677c12ff9fb38` before product edits. Baseline `965399f769b5f9834041b64623d5c4fa67e32a87`; started 2026-10-28T05:14:23Z.

## Fixed acceptance

- J-1: Given a built thinrouter binary and a fresh launcher-owned data directory, when the offline walkthrough runs, then it verifies admin/gateway auth, creates synthetic connections/routes/key, exercises exact text and streaming completion plus a two-turn local tool exchange through Chat/Messages/Responses, proves fallback dispatch order, a failed request and downstream cancellation, restarts with preserved configuration/history, and cleans up only owned processes/resources. A broken supported journey fails the command; no real upstream/CLI/account is used.
- J-2: Given the actual walkthrough requests, when inspecting authenticated admin JSON/HTML and event CSV, then buffered observed usage matches the fixture, stored rows/cost summary reconcile for the same scope, unknown streaming/cancelled telemetry remains explicit and is never invented as zero/success. HTTP transport status is not presented by the walkthrough as terminal success. Report existing D-01–D-05 limits with issue links; do not lock tests to missing data if a future valid settlement supplies the fixture's exact values.
- J-3: Given an operator following the short guide, when using --check or --serve, then one entry runs and reports the journey, while --serve leaves only the owned loopback demo available for inspecting existing admin pages until stopped. Diagnostics/report contain stage/status/counts/digests and safe paths, never keys, session IDs or request/tool content. No credentials/private DB are discovered. Use existing Python standard library and pinned locked Rust only; safe bounded startup/cleanup and explicit synthetic labels.
- J-4: Given the final bounded product diff, then full locked Rust tests/fmt/Clippy, focused Python fixture/launcher regressions, the actual --check run, --serve shutdown verification, repository validators/contracts/indexes, independent source review and required product CI/normal merge/readback pass. Original failures remain visible. This does not close original17coreAC, fullT1102 or live provider acceptance.

## Design and ownership

Deliver `scripts/offline_walkthrough.py` with a focused stdlib fake-upstream module. It starts the real binary with an empty owned data directory and cleared/controlled child environment, uses authenticated public admin APIs to configure it (no direct SQLite seeding), then acts as a deterministic HTTP client. --check terminates after verification; --serve runs the same verified journey and keeps the owned demo available for manual admin inspection until SIGINT/SIGTERM. A persistent report directory receives only sanitized evidence; credentials stay in the temporary owned directory and are not printed. An explicit binary digest is separate from source-checkout identity. No provider-specific import/login or model discovery.

Existing source already supports the main route: `tests/e2e_mock.rs` creates a key/connection/route and sends text/stream/fallback; Responses and Claude tests cover tool conversion. Start by running the new actual journey against unchanged Rust. If it works, keep runtime unchanged and retain meaningful regression. If a supported step fails, preserve the exact failure before any minimal correction. Do not manufacture RED by asserting old missing telemetry must exist without implementing its specified settlement model.

A non-forwarding proxy locally generates fixture responses only for the exact owned upstream URL, rejects all other destinations/CONNECT, and never resolves or forwards externally. This is needed because the existing explicit `Proxy::all` does not apply `NO_PROXY`; runtime stays unchanged. This constrains fixture HTTP traffic, not the host network. The launcher never creates named real provider connections. Child liveness plus authenticated fresh-store readiness identifies the owned instance; reserve/drop ports are not claimed collision-free. Per-request, startup and cleanup deadlines are bounded. No blanket process killing or deletion of user-supplied directories.

The walkthrough reports terminal success from received protocol events, separately from the current ledger's HTTP status. Existing token/cost gaps remain unknown; new correct settlement may supply exact fixture counts without breaking a regression. CSV is an event export, not a new aggregate schema. Caller-facing upstream error body semantics stay unchanged; D-06 protects persisted usage/error surfaces, not whole-response anonymization.

## Remaining issues

- [#698](https://github.com/fallrising/newclear/issues/698): stream settlement, terminal outcomes and time definitions.
- [#699](https://github.com/fallrising/newclear/issues/699): remaining token coverage, provenance/price basis, precision and history.
- [#700](https://github.com/fallrising/newclear/issues/700): client/version decision and live AC-01/04/08; real integration is last.
- [#701](https://github.com/fallrising/newclear/issues/701): intermittent fixture startup/auth failures; cause unknown.
- [#702](https://github.com/fallrising/newclear/issues/702): Antigravity fake-upstream isolation/HTTP coverage; no retry of historical synthetic401.

## Plan and delivery

Estimate90–120active minutes,20minute checkpoints, command/CI600s and each initialfailure≤2justified corrections. Opus coordinator with one Sonnet leaf returned a source-only plan in58.23s; actual one Agent call, child0tools. Root accepts executable-journey focus but rejects blanket non-blocking telemetry, bug-pinned null expectations and unsupported caller-redaction promises. Full-turn tools/provider/token/cost/activewait unknown/null.

Product acceptance and whole-round delivery are distinct: after product CI/merge/readback, close its technical board rows in a board-only PR; publish reviewed journal/desk facts, verify complete backup, then remove only this round's clean merged worktrees and retain branches/cache. Final handoff, not a pre-merge board row, records those completed management obligations. Mainline incomplete, usable_tag none; original specification/17criteria/other tracked plans stay intact.

Local evidence (2026-10-28): unchanged Rust baseline completed all nine journey stages. Final walkthrough creates17usage rows,11with exact5/3token counts and synthetic $2 estimates,6unknown; cost coverage stays partial. Twenty Python regressions include actual --serve/admin access/SIGTERM cleanup and negative terminal/cleanup/deadline cases. Full254Rusttests/21groups,fmt,Clippy,20validator tests and44contracts/7indexes passed. No Rust/Cargo changes or runtime bug claimed. Independent review found launcher cleanup exit0, failed-stream acceptance and missing total request deadline; preserved failing regressions now pass. Sandbox sccache/socket EPERM failures remain environment observations; approved execution passed without permission/configuration changes. Required CI/merge/readback and management delivery remain separate gates.

Use the [operator guide](../OFFLINE-WALKTHROUGH.md). No browser-click or real client/provider validation is claimed; authenticated HTML/API and actual command lifecycle are verified. Mainline remains incomplete; usable_tag none.
