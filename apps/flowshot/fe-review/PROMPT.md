# Flowshot R2 review runner

Read [DESIGN](DESIGN.md), [SUCCESS](../SUCCESS.md), [REVIEW](REVIEW.md), [scenario map](tasks/round2/SCENARIOS.md) and [report](tasks/round2/report.md). Scope is synthetic Web foundation loading/ready/error only. D1 preload and D2 Web-only are owner-approved. Mainline/native/Mac gates are unchanged.

## Actual interface

Root prepares locked npm dependencies, Node24.18, external Playwright/axe and Chromium, then launches the following from the repo root **inside a fresh isolated network namespace**:

```sh
node apps/flowshot/fe-review/run-review.mjs --run flowshot-001
```

`flowshot-001` is already used and immutable; choose a new unused run ID for any independently justified future run. Root passes REVIEW_MODULES (external node_modules directory) and REVIEW_BROWSER (Chromium executable). It provides canonical source/modules/browser mounts, component runs writable, nonroot UID ownership, no host network/ports/socket/profile/secrets. No inherited TAURI_DEV_HOST. Current observed root execution used Node24.18.0 / Playwright1.63.0 / Chromium153.0.8010.12. Only root may launch services for this task.

The driver uses original Vite config with review-only runner config loading, owned cache in runs/<id>/.state, 127.0.0.1:1420/strictPort, a fresh context for each scene and pre-navigation promise injection. It first tests external HTTP/WS refusal; normal scenes have independent strict browser-health checks. The runner creates actual capture.json/REPORT and ignored screenshots. Shared capture.mjs is unchanged and has no preload hook; do not claim `capture --start` creates this fixture.

Focused tests from repo root:

```sh
node --test apps/flowshot/fe-review/preload.node.mjs apps/flowshot/fe-review/runtime-guards.node.mjs
```

Existing frontend gates remain `npm run lint`, `npm test`, `npm run build` from apps/flowshot; root owns these and all required native/CI gates. Review node tests originally used *.test.mjs and collided with Vitest discovery; the failed attempt remains recorded, and names now use *.node.mjs. No application test/config was excluded.

## Evidence and limits

Actual [flowshot-001](runs/flowshot-001/capture.json) covers 3 states × 3 viewports × 2 preferences and one mobile long revision. Fixed colors are observed under both preferences, not a new dark theme. Long revision is visibly ellipsized but exact full synthetic text remains in the DOM. Cleanup records browser/server close and listener absence; root outer receipt independently records container removal. Signal/failed-close guards have focused tests, not an invented actual TERM control run.

All 19 axe scans have color-contrast incomplete; zero violations is not proof that contrast passed. No native IPC, real workspace/DB, reader/annotation, Mac timing or full Round3 completion is claimed. Keep both initial fixture RED and original native discovery failure. Runtime manifest remains immutable; test filename references changed afterward and are explicitly reconstructed in the [audit](tasks/round2/evidence/flowshot-artifact-audit.json).

Post-runtime source note: after the filename rename, the paired runtime gained a `unit === 'loom'`-only Vite5 hash-pinned config loader. Flowshot options/behavior are unchanged. [Exact delta](tasks/round2/evidence/post-runtime-loom-loader-delta.json) and the artifact audit reconstruct the original runtime hash; green Flowshot browser evidence was not rerun.
