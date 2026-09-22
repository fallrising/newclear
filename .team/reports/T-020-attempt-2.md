STATUS: PARTIAL

# T-020 — independent M3 review, attempt 2

## Summary

Independent in-environment reviewer returned **REWORK** for fixed candidate `f7905bbab0c3032b28387d4596795c3a64800c58`, compared with base `e760d8e988c0e2a837b226c600805a659a362c10`, in unchanged checkout `/home/ckc/test/codex/newclear-m3-review2`. One medium finding remains. No blocking/high findings or additional medium findings were substantiated in inspected domain/API/UI paths. The inherited runtime's exact model slug was not exposed; no multi-model review is claimed.

### Medium: pausing playback permits overlapping clock requests

Fixed-source references: [playback.ts lines 13–28](https://github.com/fallrising/newclear/blob/f7905bbab0c3032b28387d4596795c3a64800c58/platform/dim-gate/src/features/delivery/playback.ts#L13), [shared.tsx lines 80–81](https://github.com/fallrising/newclear/blob/f7905bbab0c3032b28387d4596795c3a64800c58/platform/dim-gate/src/features/delivery/shared.tsx#L80).

Cleanup only marks the effect stopped and clears its timer. It retains no pending-request ownership across pause/resume. Controls derive busy from playback.playing and the separate manual mutation, so pause immediately enables manual stepping/restarting while the earlier request remains pending. The stopped invocation also returns before its explicit refresh.

Reproduction: trigger app-checkout / env-checkout-dev; delay delivery of genuine clock responses by 2500ms without altering response contents or domain data; start playback, wait for its pending request, pause, and click manual advance. Two requests are pending. Pause/restart can similarly launch another tick after one second before the first settles. Expected: future scheduling stops, but manual stepping/restart stay blocked until the outstanding request and refresh settle. Domain serialization protects atomic writes but does not enforce the playback non-overlap contract.

Lead independently reproduced against the fixed production build: `manualEnabledDuringPending=true`, `pending=2`, `maxPending=2`, `requests=2`. Reviewer inspected `/tmp/dim-gate-m3-resume-evidence/probe-playback.mjs` and `.json` without executing them. This is explicitly lead runtime evidence, separate from independent static review.

## Verification

- Fixed HEAD, instructions/contracts, original findings and changed domain/API/UI/test source inspected; checkout remained clean — passed
- Original receipt/replay/summary-event scope leak closed by session-only references; delivery audit/read scope includes environment stage — passed
- Original persisted-step defect closed by matching active task state, stages, step and next due tick, with recovery validation before storage writes — passed
- Playback normal scheduling and lifecycle cleanup exist, but the pending-request pause boundary violates the no-overlap requirement — failed
- Original premature manual clock notice now awaits affected query invalidation; awaiting-approval cancellation journey covers its original sequence — passed
- Authorization before replay, derived locks, artifact reuse, health activation, approval separation, cancellation, retry/rollback history and atomic persistence inspected without another medium-or-higher finding — passed
- Independent dynamic execution, excluded by the read-only task contract; lead tests remain separate — skipped

Existing playback tests check normal timing and pause after observing build success, not a pending request across pause/manual/resume.

## Documentation

The reviewer changed no files, dependencies, commits, PRs or external services. This lead-preserved report normalizes headings and repository links without upgrading the verdict. Attempt 1 remains preserved separately.

## Risks and Follow-ups

Replace effect-local cancellation as the sole pending-state guard; retain in-flight ownership and disable manual/restart until request plus refresh settle. Add delayed-response Chromium evidence for pause/manual and pause/resume, then review a new immutable candidate. This report does not accept M3.
