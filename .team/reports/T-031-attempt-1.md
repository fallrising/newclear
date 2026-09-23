STATUS: PARTIAL

## Summary

T-031 attempt1; run DG-W1-20260923-01; lead owner, branch `agent/dim-gate/mainline/w1-workspaces`, worktree `/home/ckc/test/codex/newclear-dim-gate-w1`. Base7a7b41b; initial remote contract checkpoint02a8b9a and draft PR33. This containing commit is the first integrated implementation candidate; no immutable product acceptance claimed yet. Domain worker released eight owned paths to lead; no competing writer remains. W1 contract revision2, AC-WS-01/02/16/17/18.

The Shell now separates workspace and Demo identity, limits grouped navigation to the active authorized workspace and retains diagnostic return context. RD/Ops/Admin homes use one scoped canonical dashboard with URL filters, freshness, source IDs and working destination filters. Existing Request/Release commands and snapshot versions are unchanged. Added seven real browser journeys; existing multi-role/Guide regressions follow the explicitly new navigation behavior.

## Verification

- Integrated working diff: `pnpm typecheck`, after correcting a navigation Map key type mismatch — passed
- Integrated working diff: `pnpm test`,240 tests/23 files,6.56s — passed
- Integrated working diff: `pnpm build --mode demo`, no manifest/lockfile changes — passed
- Preliminary Shell lint, `check:architecture`, `check:docs`146 documents/335 links and `git diff --check` — passed
- Initial docs-only02a8b9a CI35823661263 completed successfully; this does not validate W1 code — passed
- Preliminary W1 Chromium6/7: no-grant test used incorrect recovery link label; actual visible Session control preserved and corrected assertion rerun1/1 passed — failed
- Preliminary benchmark3/3 and representative RD1440/Admin768/Ops390 screenshot inspection — passed
- Fixed-commit native/full browser/smoke/performance/isolation gates and independent T-032 review pending — skipped

## Documentation

Contract, SDD01/04/05/06/07, OpenAPI, DEMO-GUIDE, task revisions and PLAN updated. Worker focused evidence/hashes retained in T-030-attempt-1. Preliminary browser logs under `/tmp/dim-gate-w1-evidence/preliminary-w1-browser.log` are local-only and not acceptance evidence. Node24.18.0, pnpm11.18.0, existing local browser libraries; production preview4213 avoids existing4173.

## Risks and Follow-ups

W1 NOT_ACCEPTED. Browser findings, initial JS300KiB budget and independent review unresolved. Preserve any failed evidence. Next: finish focused W1 browser checks, fix real failures, commit/push a fixed candidate, execute complete gate runner and uninvolved read-only review; require final-head CI before authorized merge. W2–W5 remain unimplemented. No deploy/cloud/notifications. Owner remains lead; worker released; PR33 remains draft.
