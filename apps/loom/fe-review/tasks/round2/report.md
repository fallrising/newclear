# Loom paired R2 evidence

Status: scoped synthetic Web runtime and local frontend gates passed; final independent acceptance, current-head CI, merge and remote readback remain pending in [PR598](https://github.com/fallrising/newclear/pull/598). T-0380 R2-AC-11/E pairs this unit with Flowshot. Full Round3 and native/product acceptance are not claimed.

## DESIGN coverage

| Item | Observed evidence | Outcome |
| --- | --- | --- |
| M1 review-only native boundary registry | Existing lockedTauri2.11 invoke/listen/callback pure proof; actual browser uses PTY/document/canvas/history/window-close/no-keyAI seams | Unknown invoke/invalid arguments fail; actual approved scenes record0unknown/0rejected; not native IPC proof |
| M2 responsive populated states | [loom002](../../runs/loom-002/capture.json):12 empty/populated ×3viewports ×2preferences keys with real keyboard editing/long content | Completed keys retained; original overall run stillfailed later at edge persistence |
| M2 remaining workflows | [loom006](../../runs/loom-006/capture.json):9captures/12step rows, real edge Run/Pin, editor Delete/Backspace, closeCancel/saveerror/conflict, windowCancel, save/reload/tombstones, discard andhistory | Passed with unchanged assertions; journey-only reuse of12matrix/canary, no rerun |
| M2 lifecycle | Same006receipt: actualdocclose/openDocuments0, terminaldetach/subscriptions0, then forceddispose callbacks/listeners/subscriptions/pending0; browser/server/listener cleanup | Passed; outer exit0/12.57s/containerRemoved |
| M3 executable entry and boundaries | [PROMPT](../../PROMPT.md), actual driver and source-pinned reviewVite config; loom001 externalHTTP/WS canary reused with exactSHA | Passed scoped wiring; genericcapture has no preload hook |
| Local frontend gates | `npm run typecheck:contracts` exit0/1.482s; `npm run typecheck:app` exit0/3.227s; `npm test` exit0/3.427s; `npm run build` exit0/8.073s | Retained local evidence; required native/contract-drift CI pending separately |
| Artifact/source audit | [audit](evidence/final-docs/audit.json):23total historicalPNG hashes/bytes/dimensions;21acceptedcaptures;22current006source entries plus retainedmatrix source subset | Read-only verified; no new browser/test execution |

Node24.18.0 / Playwright1.63.0 / Chromium153.0.8010.12 / axe4.13.0. Locale en-US. Matrix desktop1440×900/tablet834×1112/mobile390×844 uses light/dark preferences;006remaining workflows are desktop/light only. This does not claim every workflow ran at every size/preference. Sidecar reload proves only synthetic JSON seed continuity, not disk persistence or native crash recovery.

## Drag history and final evidence

loom001/diagnostic resolved an accessible-name mismatch; loom002 completedmatrix thenfailededge;003showed handleocclusion;004measuredseparation stillfailed. Owner approved an extra005attempt; author and reviewer missed component `nodeDragThreshold={4}` and assumed librarydefault1.005used2px and failed again. Its puretests modeledwrongconfiguration; actualfailure remains authoritative. All originals are retained.

After a separate explicit approval,006parses the actualReactFlow override with existingTypeScript, pins sourcebytes, uses5pxactivation+1pxtranslation witness, and rejects missing/duplicate/dynamic/spread/ambiguousconfig or unchanged/movingdocument/viewport. Actual006records witnessDelta1, remaining687, stablepositivegap and bothhandlecenterhits; DOMedge1 and persistedsidecaredge1. [Configured source/delta](evidence/configured-activation-006/source.json) retains3pass/2failRED and14passGREEN; browser006is the runtime evidence. No product/fixture/geometry acceptance gate was weakened.

## Findings retained for full Round3

- All21acceptedcaptures have0pageoverflow and clean normal browserhealth. Loom002has serious aria-input-field-name/color-contrast on populatedstates and moderate region on empty.006has serious name/contrast findings on documentstates and moderate region on history. Exact per-state node counts and all aria-prohibited-attr/color-contrast incomplete entries remain in audit/receipts.
- Matrix +terminal/+document keyboard focus records are active/focusVisibletrue.006closeCancel records active=true but focusVisible=false, outlineStyle=none, outlineWidth3px; keyboardactivation works, visiblefocus is not accepted.
- Realvault/PTY/filesystem/SQLite, provider/AI, nativewindow/crossplatform, completecontrast/a11y and product mainline remain outside this Web proof. No release/deploy/usable tag.

[Result](result.json) records pendingdelivery. Earlier preload-stage result/report are preserved in evidence/final-docs; allfailedruns remainfailed. Root owns finalreview/CI/normalmerge/readback/backup. Targets is true only for the observed synthetic Web runtime; delivery remains subject to independent review/current CI/merge; aggregate active/provider/token/cost unknown.

Original root native receipts (byte-identical copies, including historical failures): [loom-native.json](evidence/final-docs/loom-native.json). Their SHA256 and provenance are recorded in the final audit; these are retained results, not new executions.
