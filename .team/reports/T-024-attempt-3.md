STATUS: DONE

## Summary

AC-17–19 and AC-25 accepted at fixed implementation/test candidate `93a4bbc8cafe03588ff8ef12014eeb2523a93de3`. Production behavior was last changed in `c0ff3fc`; later commits correct asynchronous browser verification and preserve evidence. M4 supplies scoped RED metrics, trace/log correlation, incident lifecycle, scheduled recovery, integrations, notifications and a coherent eight-step Guide across AWS/Aliyun/IDC. Accepted work is not merged or deployed.

Three bounded implementation/review cycles are recorded in PLAN. Original worker handoffs, failed candidate attempts and independent checkpoints remain preserved. The third cycle's validation refinements corrected obsolete route expectations, classified proven retired reads and made the old in-flight search precondition deterministic; no production permissions or state transitions were weakened.

## Verification

All local commands ran from `platform/dim-gate` against the exact candidate; UTC execution and exit codes are in the manifest below.

- `pnpm install --frozen-lockfile`, pinned Node24.18.0/pnpm11.18.0 and unchanged lockfile — passed
- `pnpm lint`, `pnpm typecheck`, `pnpm test`: 21 files,207 tests — passed
- `pnpm check:docs`, `pnpm check:contracts`, `pnpm check:ci`, `pnpm check:architecture` — passed
- Fresh `pnpm build --mode demo`; real production Vite preview at4173 with no reused server — passed
- `/tmp/dim-gate-actionlint/actionlint .github/workflows/dim-gate-ci.yml` from repository root; `git diff --check` — passed
- `pnpm test:e2e`: 47/47 production Chromium journeys,10.0minutes; all existing40 M0–M3 regressions plus7 M4 cases — passed
- M4 browser: three provider Guide stories through request/provision/stable/next/metrics/trace/log/incident/acknowledge/investigate/rollback/healthy samples1/2/3, complete authoritative Guide, causal audit and reset; empty/window/duplicate/reopen/failure/no-target/reload/scope/Admin/integration cases — passed
- 42 M3/M4 route/theme/viewport axe records including24 M4 records (four pages × three widths × actual light/dark controls), zero serious/critical findings or document overflow; notification bounds; nine M4 initial-focus records, Tab containment, Escape and returned focus — passed
- Browser-health25 M3/M4 reports,4987 responses (M4:2675), zero page errors, failed requests or unexpected console/HTTP errors. Raw14 HTTP refusals retained:7 precisely evidenced obsolete-identity application GET409 STALE_IDENTITY;4 NOT_FOUND;1 FORBIDDEN;1 SELF_APPROVAL_DENIED;1 intentional ENVIRONMENT_BUSY — passed
- Deterministic M1 Data→Commerce response isolation: actual200 response contains data-worker and remains pending at switch; original bytes released afterward, MutationObserver leaks=[], current Commerce search empty. Three focused repeated runs and final full suite — passed
- Independent fixed-commit T-023 review and raw artifact inspection: no remaining blocker/high/medium finding — passed
- Product-head GitHub Actions35705801700 at synthetic merge `3a6670352f9e535dd95ff265f39f3b57d4177615`, all native207 tests and47 Chromium journeys; remote artifact 10684483634 retained — passed
- Existing worktree ownership/dirty-state protection, SSH branch durability and unchanged accepted M3 parent PR17 — passed

## Documentation

Local manifest and all command logs: `/tmp/dim-gate-m4-evidence/93a4bbc-20260922T083727Z/results.json`. Full HTML/DOM/PNG/network archive: `/tmp/dim-gate-m4-evidence/93a4bbc-full-browser-final.tar.gz`; parsed per-spec JSON and `summary.json`: `/tmp/dim-gate-m4-evidence/93a4bbc-final-browser/`. Browser report has61 screenshots; lead/reviewer inspected representative notification and integration/observation layouts, not every screenshot manually. Corrected search proof is the `held-data-response-persona-isolation` attachment in M1 report. Local artifacts are not remotely durable by themselves.

Portable evidence: [product CI](https://github.com/fallrising/newclear/actions/runs/35705801700), artifact 10684483634, `dim-gate-m0-3a6670352f9e535dd95ff265f39f3b57d4177615` (historical artifact-name prefix),30-day retention. Stacked [PR20](https://github.com/fallrising/newclear/pull/20) remains based on accepted unmerged [M3 PR17](https://github.com/fallrising/newclear/pull/17), parent7d20bbc. Final metadata-head CI and owner release are recorded on PR20 after they pass, avoiding an infinite self-referential commit.

Runtime: Playwright1.63, Chromium153.0.8010.12 rev1243; Node binary under `/home/ckc/test/codex/.toolchains/node-v24.18.0-linux-x64/bin`. Chromium libraries: `/tmp/dim-gate-playwright-libs/usr/lib/x86_64-linux-gnu`; CJK font config `/tmp/dim-gate-m3-fonts-kaBaS8/fonts.conf`. Lock SHA256 `0da752e9e75f7b22902ba601583d1979e0a0d63b34275bcc445c4286dec7a32b`. CI installs the standard Playwright Chromium and dependencies. Environment shell sandbox failures required approved narrow shell escalation; no denied external-source transfer was bypassed.

Updated SDD02/03/04/06/08, M4 integration contract, API/architecture docs, PLAN and STATUS. Canonical T-021/T-022 distinguish lead acceptance from immutable worker PARTIAL handoffs; T-023 records independent closure. Pinned kernel237aa277 validator checks task/report structure; source-only skills were used, not falsely claimed installed. Built-in collaboration lead/domain worker/UI worker/independent reviewer share inherited runtime with exact model slug unavailable; no verified multi-model claim.

## Risks and Follow-ups

M5 AC26–30 is not accepted or started. Current production JS gzip465.01kB exceeds its300KiB initial-JS budget; performance benchmarks, comprehensive keyboard-only story, extra-browser smoke, storage-limit/recovery completeness and final replayable user documentation remain M5 work. [M5 handoff](../../platform/dim-gate/docs/HANDOFF-M5.md) contains operational next steps and actual runtime.

Latest SSH-fetched main eb2023f had no changes to dim-gate, its workflow or `.team` relative to previous7bb80d0. Keep the stacked parent until an authorized merge/rebase decision. All accepted/source/worker/fixed-review worktrees remain preserved. No force push, main write, automatic merge, deployment or real cloud operation.
