# Loom R2 review runner

Read [DESIGN](DESIGN.md), [SUCCESS](../SUCCESS.md), [REVIEW](REVIEW.md), [report](tasks/round2/report.md) and [PROTOCOL](../../../docs/fe-review/PROTOCOL.md). Only approved review-only Web simulation is in scope. Product/native/dependency/AI behavior is unchanged; dormant backlog remains closed.

## Executable interface and isolation

From repositoryroot inside a fresh root-owned isolated networknamespace:

```sh
node apps/loom/fe-review/run-review.mjs --run unused-run-id
```

This command owns Vite127.0.0.1:1420/strictPort, installs the fixture before navigation, runs matrix/workflow assertions and writes capture.json/REPORT plus ignoredPNGs. Node24.18.0, locked npm dependencies, external Playwright1.63.0/axe4.13.0 and Chromium153.0.8010.12 were observed. Root supplies REVIEW_MODULES and REVIEW_BROWSER to external read-only tools/browser locations. Source is mountedread-only; only fresh run output/state writable. Use nonroot UID, networknone, capdropALL/no-newprivileges, no hostports/socket/profile/secrets; reject TAURI_DEV_HOST. Server/browser share only their isolatedloopback, separate fromFlowshot. The reviewVite configuration is sourcehash-pinned to original Vite5 config.

No newrun is authorized merely by this documentation. Existing green evidence is reused unless a sourcechange or newly approved scope requires execution. The actual successful remaining invocation was:

```sh
LOOM_REVIEW_RESUME=journey-only node apps/loom/fe-review/run-review.mjs --run loom-006
```

loom006is already used and immutable. Root's reviewed outerlauncher supplied240s totalbound, owned cleanup and sourcefreeze; it mounted prior runs read-only. Journey-only verifies exactloom002 matrixreceipt/source andloom001canary before continuing remainingworkflow. It does not claim originalfailedruns passed. Full defaultmode is the future complete entry; do not execute it to repeat acceptedmatrix/canary.

Generic `docs/fe-review/capture.mjs` has no init-script hook and cannot install this stateful nativefixture. targets describes only basepage/devserver and observedmetadata; use this componentrunner for review evidence.

## Scope and checks

Fixture validates nativecommands/arguments and uses actual lockedTauriSDK callback/listener behavior; unknown use rejects. Actualscenarios include canvas/document/terminal creation, keyboardediting, edge/Run/Pin, Cancel/Discard/saveerror/conflict, windowCancel, sidecarreload/tombstones, sessionhistory/loading/error/empty/memory/restart/forget anddisposal. No realvault/PTY/provider or productionadapter fallback.

Focused pure test command from repo root:

```sh
node --test apps/loom/fe-review/preload.node.mjs apps/loom/fe-review/ui-steps.node.mjs apps/loom/fe-review/geometry.node.mjs apps/loom/fe-review/vite-review-config.node.mjs
```

Existing native/frontend gates from apps/loom: `npm run typecheck:contracts`, `npm run typecheck:app`, `npm test`, `npm run build`; requiredCI retainsRust/contracts/drift. These commands are documented, not newly executed by the documentation closeout.

## Evidence limits

[loom002](runs/loom-002/capture.json) supplies12complete empty/populatedkeys across3sizes×2preferences; overallfailedstatus preserved. [loom006](runs/loom-006/capture.json) supplies9desktop/lightworkflowcaptures/12steps. Allnormalhealth/overflow checks pass. Seriousaxe violations, incompletecontrast/aria andcloseCancel focusVisiblefalse remain [openfindings](REVIEW.md), so fullRound3is not accepted. Native/sourcechecks and finaldelivery are separate [reportgates](tasks/round2/report.md). PrivatePNG/rawlogs/authstate are never published.
