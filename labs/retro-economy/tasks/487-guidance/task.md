# Retro 提示修正 — issue #487

Session: Retro-20261022-1429. Base main: 251cb450. Owner direct authorization; Refs #487.

## Scope

Only position-aware gathering guidance and consistent tower return/town guidance; native client regressions and actual headless browser observations. Keep runtime Python 3.11 stdlib/native browser and all rules/economy/trading unchanged. Preserve RE-3 scope/results and historic evidence.

## Acceptance

- HINT-01: Both professions see remaining movement on approach, an executable gather action on arrival, then return/craft guidance when enough raw materials are held.
- HINT-02: Summit and return guidance remain consistent until town; reset correctly in town and permit a later ascent without incorrectly inferring return from lifetime reward alone. Reload/poll must not reintroduce misleading directions.
- HINT-03: Tests fail on original behavior before implementation; all existing tests and real Chromium journeys pass, with visible guidance snapshots/screenshots.

## Verification

Every build/test via existing agent-workspace launcher: Python unittest component suite; Node test_ui.mjs and test_explorer.mjs; browser_smoke.mjs; project-success and llms validators; git diff --check. Orchestrator reruns checks. Final SHA CI, independent different-family read-only review, latest main, merge readback; board-only follow-up records actual merge time. No deploy/tag/issue closure/AGENTS edit.
