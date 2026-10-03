STATUS: DONE

## Summary

Added an explicit editor for creating a new attempt with a revised goal and showing each selected attempt's goal as inert multiline text. One-click unchanged retry remains available; prior goals and results are preserved. Pending controls, draft retention, new-attempt resets and error/idempotency behavior are covered.

T-009 frontend diff inspected and accepted after root integration. T-010 independent source/evidence review accepted with no required corrections and all nine log hashes verified. Intermediate sibling-key and test-typing failures are retained in evidence and resolved.

## Verification

- Root inspected red evidence (10 new failures, 27 baseline passes), intermediate failures, and final targeted 38 tests — passed
- Root `make web-check`: TypeScript, formatting, 68 frontend tests and production build — passed
- Root `make browser-test`: all 7 real Chromium/API/PostgreSQL cases, including one edited submission, pending controls, unchanged original run, history selection and reload; test-owned container removed — passed
- Root fixture `ruff check` and `ruff format --check`, `git diff --check`, team task/report validators — passed
- Independent T-010 source/evidence review and parent main SHA confirmation — passed

## Documentation

Added `docs/RETRY-GOAL.md` and sanitized `docs/evidence/retry-goal-2026-10-04.json`, plus bounded task/report and acceptance records. Documents distinguish frontend raw submission from existing API normalization.

## Risks and Follow-ups

Only the goal is edited; latest base/profile and existing API version checks remain. The backend keeps its existing request byte-size limit and trims outer whitespace. Drafts are local and reset for a different latest attempt. Backend/API/schema/dependencies unchanged; backend suite was not rerun locally for this slice. No live VM/provider, billing, deployment or full-M3 completion claim.

Precommit main fast-forward to532e587 changes only an unrelated component. `git diff --quiet c4b1ad6 532e587 -- platform/agent-platform` passed, proving this component matches the tested base; no source/test changes followed verification.
