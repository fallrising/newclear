STATUS: PARTIAL

# T-020 — independent M3 review, attempt 1

## Summary

Fixed candidate `2abbec9ca4ca812b9be0278e6a5ca14c303c87b9`, base `e760d8e988c0e2a837b226c600805a659a362c10`, isolated read-only checkout `/home/ckc/test/codex/newclear-m3-review`. A fresh in-environment reviewer who did not implement M3 returned **REWORK**, four medium findings, no independently substantiated blocker/high finding. Exact inherited runtime model identifier was unavailable; this was independent multi-agent, not claimed multi-model review.

Claude CLI preflight was successful, but source transmission to that external service was denied by the environment. The source-review command did not execute and that rejection was not bypassed. No private source/credentials were copied into this report.

## Verification

- Independent read-only inspection of applicable instructions/specifications, fixed source, tests and full diff — passed
- Independent dynamic tests/browser execution; isolated checkout had no installed dependencies, lead execution evidence is separate below — skipped
- Final independent approval of correction `b58298e`; user requested checkpoint/handoff before re-review — skipped

## Findings and lead reproduction

1. **Scope leak, medium.** `src/domain/engine.ts` clock branch (candidate lines 1116–1135) copies all global progress references into the caller's `changed` receipt and summary event. Repro: Data RD triggers `env-data-dev`, Commerce advances 3 ticks. Focused lead test reproduced extra `run-0001`, `release-0004` and `demo-fnv1a-603134096b41874d` despite empty Commerce pipeline list. Correction returns session-only clock references; scoped reads refresh through store revision, entity-scoped transition audit remains intact. Receipt replay regression included.
2. **Invalid persisted step, medium.** `delivery-integrity.ts` checked task presence but not scheduler position; `delivery.ts` directly indexes stages. Repro: queued run task `stepIndex=2` or `99` was accepted during restoration. Lead tests first failed because no exception was thrown. Correction validates run/release state, stage progression, exact next due tick, and rejects impossible snapshots before execution. Six valid tick-resume cases, altered positions/due ticks and controller original-byte-preservation/reset tests pass.
3. **Missing playback, medium.** SDD03 §1 requires per-second logical playback; original `shared.tsx` provided only manual tick controls. Correction adds explicit view-local playback with no overlapping requests, terminal/approval pause, identity/policy/reset/route cleanup, error pause and no offline catch-up. Browser playback/resume/cleanup regression still must be added and executed.
4. **Premature completion notice, medium.** `shared.tsx` announced clock completion before refreshing queries; `dialogs.tsx` freezes the displayed version on open. Lead Chromium reproduced immediate prod-awaiting cancellation returning `409 VERSION_CONFLICT`. Correction awaits refresh inside the mutation before announcing completion, keeping the clock control pending during refresh. Existing browser journey must be rerun; no browser closure is claimed yet.

## Documentation

The original candidate remains fixed in the review checkout. Lead correction is `b58298e9ddc2498830f1fd144277b1c6345359b1`; its 170 tests, lint, typecheck and architecture checks passed, but these do not substitute for reviewer closure. [T-018 attempt 1](T-018-attempt-1.md) records original browser failures; [canonical checkpoint](T-018.md) records the resumption boundary.

## Risks and Follow-ups

Send a fresh immutable corrected candidate to independent review after missing browser coverage and full gates are completed. This was the initial review; one same-approach follow-up remains, within the three-cycle lead budget. Do not mark M3 ACCEPTED or merge/deploy on this report.
