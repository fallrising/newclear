# Flowshot paired R2 evidence

Status: scoped synthetic Web runtime and local frontend gates passed; final independent acceptance, current-head CI, merge and remote readback remain pending in [PR598](https://github.com/fallrising/newclear/pull/598). This is T-0380 R2-AC-11/E, paired with Loom. No full Round3/product/native/Mac acceptance.

## DESIGN coverage

| Item | Observed evidence | Outcome |
| --- | --- | --- |
| M1 existing pre-import build-info promise | Real eager-source preload tests; controlled pending→resolve/reject only after loading; missing/late/collision guards | Scoped proof passed; initial RED retained |
| M2 owned synthetic three-state driver | [flowshot001](../../runs/flowshot-001/capture.json): loading/ready/error ×3 viewports ×2 preferences plus mobile long metadata | 19 captures, exact HTTP200/finalURL/state, normal health clean, no page overflow |
| Network/lifecycle | Same receipt: external HTTP/WS refusal; browser/server/listener cleanup; root outer receipt exit0/19.768s/containerRemoved | Passed; no native process or provider involved |
| Frontend gates | `npm run lint` exit0/3.878s; final `npm test` exit0/10.434s; `npm run build` exit0/4.207s from apps/flowshot | Retained source-compatible local results; required CI separately pending |
| Evidence/source | [final audit](evidence/final-docs/audit.json): all19PNG hashes/bytes/dimensions and11 current-source audit entries | Read-only verified; no green runtime rerun |

Runtime used Node24.18.0, Playwright1.63.0, Chromium153.0.8010.12, axe4.13.0, locale en-US, desktop1440×900/tablet834×1112/mobile390×844, light/dark preferences. Exact invocation was `node apps/flowshot/fe-review/run-review.mjs --run flowshot-001` inside the isolated root-owned namespace; that run ID is immutable. [PROMPT](../../PROMPT.md) describes the external tools/mount contract.

## Provenance and failures

Original runtime source receipt remains unchanged. `preload.test.mjs` was renamed to `.node.mjs` with identical bytes after the initial Vitest discovery failure; the run-review sourceFiles string changed accordingly. Shared runtime later gained Loom-only Vite loader/diagnostics and safe failure classification. [Final source audit](evidence/flowshot-final-source-audit.json) and its two reversible delta artifacts reconstruct the original runtime hash; [current audit](evidence/final-docs/audit.json) confirms current bytes still match those audited values. No Flowshot successful behavior changed. Original failed native discovery run exit1/7.855s remains failed; subsequent native pass does not erase it.

## Remaining limits

All19axe scans contain color-contrast incomplete (5nodes loading/error,10ready/long), despite0violations. Long metadata is visually ellipsized while full text remains in DOM. Both preferences use existing fixed palette. Neither screenshots nor source inspection establish complete pixel/a11y/focus acceptance. Native WebView/IPC, real workspace/DB, reader/annotation journeys, targetMac timing and product mainline remain outside this Web proof. No release/deploy/usable tag.

[Machine result](result.json) and [audit](evidence/final-docs/audit.json) distinguish completed checks from pending delivery. Original preload-stage result and report are preserved in evidence/final-docs. Aggregate active/provider/token/cost unknown. Root owns final review/CI/normal merge/readback and backup; targets is true only for the observed synthetic Web runtime; delivery still requires independent review/current CI/merge.

Original root native receipts (byte-identical copies, including historical failures): [flowshot-native.json](evidence/final-docs/flowshot-native.json), [flowshot-final-native.json](evidence/final-docs/flowshot-final-native.json). Their SHA256 and provenance are recorded in the final audit; these are retained results, not new executions.
