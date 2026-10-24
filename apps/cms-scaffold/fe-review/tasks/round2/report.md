# CMS FE review Round 2 — M1/M2

Status: **PARTIAL — local M1/M2 gates passed; independent review and current PR publication gates pending.** Targets are verified only for this R2 mock route contract. Full R3, real API, PP1 operations and owner acceptance remain outside this delivery; CMS mainline stays incomplete.

## Delivered scope

The stale21-page inventory is replaced by51 current route exemplars (Front18,Back15,Admin18), covering frontend SDD§7 plus Back `/login` alias and Admin `/entries` landing. All parameter values use existing fixtures. Protected targets carry their synthetic pack identity in `mockUser`; each capture/check uses a fresh context. Front logout must reach the anonymous selector, Back login alias must reach sign-in, and every other final URL must match exactly. Loaded-page selectors prevent accepting a login/skeleton/not-found fallback for a populated target.

[Six-wave prerequisites](prerequisites.json): W1/W2/W3/W3b/W4/W5 are VERIFIED, PR229/245/273/281/289/300 actually merged, all25 listed checks succeeded. Historical product evidence is attributed to those delivery reports, not rerun here. W5's historical failures and lost/overwritten artifact limitations remain in its retained delivery.

Only `fe-review/**` and this milestone's SUCCESS entry changed. No app/shared package/Vite/fixture/handler/backend/OpenAPI/dependency/lock/shared-capture/CI changes. D1(b) stays proposal-only; D2(b) uses loopback CLI overrides.

## Actual verification

| Gate | Observed result / evidence |
| --- | --- |
| Guard regression | Initial permissive stub rejected by intended RED; exact URL/origin/query/hash, identity, loaded content, status and pageErrors guard GREEN. [RED](evidence/guard-red.log), [GREEN](evidence/guard-green.log). |
| Source inventory + capture selection | Final `node --test apps/cms-scaffold/fe-review/route-guard.test.mjs apps/cms-scaffold/fe-review/inventory.test.mjs apps/cms-scaffold/fe-review/capture-selection.test.mjs`:21 passed,0 failed/skipped. [stdout](evidence/final-focused-green.log). Replacement selection has separate [RED](evidence/selection-red.log), including duplicate/missing/unexpected keys, replacing old green and unrepaired failures. |
| Native frontend | Root-owned `npm run lint && npm run typecheck && npm test && npm run build && npm run test:bundle`:exit0;648 workspace tests across70 files plus66 existing PP1-local unit tests; all three builds/bundle gates. [Receipt](native.json), raw-log SHA included. Root inspected the PP1 unit helpers; no actual PP1/Compose service ran. |
| Shared dry-run | Prescribed shared capture final dry-run enumerated51 targets:18/15/18. [Path-normalized stdout](evidence/final-dry-run.log). |
| Shared capture | Initial153 visits produced144 successful PNGs and9 loaded-selector timeouts. A single source-backed targeted repair produced only the9 affected PNGs. No successful144-key recapture. |
| Immutable capture audit |153 unique selected records =144 original +9 explicit replacements; all HTTP200,zero pageErrors, PNG width/minimum-height and SHA verified. [Audit](capture-audit.json) includes both immutable manifest hashes and per-image provenance. |
| Supplemental final URL proof |51/51 actual desktop route visits passed exact final URL, synthetic sessionStorage identity, HTTP200, all loaded selectors and zero pageErrors. No duplicate screenshots. [Route audit](route-audit.json). |
| Cleanup | Supplemental child exits and absent loopback listeners proved for all three apps. Original and repair containers both removal exit0 plus successful filtered inventory exit0/empty result: [initial](initial-supervisor.json), [repair](repair-supervisor.json). |
| Source correspondence | Runtime Node24.18.0, Playwright1.63.0, Chromium153.0.8010.12. [Runtime/final hashes](source-audit.json) differ only in targets verified/verifiedNote metadata; executable code and route contracts unchanged after successful runtime. |

Representative PNGs were actually inspected: Front appointment desktop; Back edit mobile; Admin role tablet; repaired Back new-entry mobile/composer desktop/board mobile. They show loaded synthetic content. This sampling is not full R3 visual acceptance.

## Commands and retained failure provenance

Commands run from repository root in an owned container (Node/npm supplied by root):

```sh
node docs/fe-review/capture.mjs apps/cms-scaffold/fe-review/targets.json --dry-run --out apps/cms-scaffold/fe-review/runs/round2-79fb3e28b3/capture
node docs/fe-review/capture.mjs apps/cms-scaffold/fe-review/targets.json --start --no-axe --out apps/cms-scaffold/fe-review/runs/round2-79fb3e28b3/capture
node docs/fe-review/capture.mjs apps/cms-scaffold/fe-review/targets.json --app web-back --page entry-new --page album-composer --page projects-board --start --no-axe --out apps/cms-scaffold/fe-review/runs/round2-repair-59327059/capture
node apps/cms-scaffold/fe-review/audit-captures.mjs apps/cms-scaffold/fe-review/runs/round2-79fb3e28b3/capture apps/cms-scaffold/fe-review/runs/round2-repair-59327059/capture
node apps/cms-scaffold/fe-review/verify-routes.mjs apps/cms-scaffold/fe-review/runs/round2-repair-59327059/routes
```

Isolation: `fe-review-agent-platform:20261024`, uid1000, `--init --network none --cap-drop ALL --security-opt no-new-privileges --read-only`; private tmpfs `/tmp` and image-owned home; repository read-only with only the CMS component writable for existing Vite caches/review outputs; browser cache read-only. No host ports/network/socket/credentials. Supervisor bounded initial run900s and repair+supplemental600s; finally removed its exact owned container and required successful empty inventory. Raw logs/manifests/PNGs remain ignored under the named runs, not committed as Round3 capture.json. Public focused stdout normalizes repository absolute paths; originals remain in ignored `runs/round2-static/`.

Initial run09:08:47–09:16:26Z exited1 and was cleaned. Back new-entry used card-publish, which only exists when editing an existing entry; replaced with actual `h1`新增Album and `#field-title`. Composer/board default API-first selections had no grid/cards; existing populated fixture IDs are now explicit `album=…0001` and `project=…0024` queries, with original grid/card assertions retained. Exactly these3pages×3sizes are replaceable; audit rejects any other change/duplicate/missing key, replacing old green, or a failing replacement. Old targets and raw manifest remain immutable. Repair run09:18:30–09:19:48Z exited0. [History and health](history-and-health.json) retains all9 first-attempt failures. No product behavior or validation threshold was weakened.

## Remaining findings and boundary

The selected153 captures record24 console error/warning events and27 requestfailed/HTTP-error events, not zero health:18 GET mock auth/me401,3 POST mock logout401,3 logout ERR_ABORTED,3 public album hero404. Anonymous401 follows existing mock auth; PageHero explicitly falls back on404 while the populated album collection is asserted. Logout cancellation/401 observations remain reported without globally suppressing aborts or claiming a proven cause. Supplemental counters use narrower handlers (8 console errors,1 requestfailed) and must not be compared as identical metrics. Observed capture overflow is0; no full accessibility/interaction/overflow acceptance is inferred.

Axe was deliberately not run (`--no-axe`) for bounded M1/M2. Full R3 states/keyboard/accessibility/copy/skeleton/performance, real API, PP1 operation/recovery and mainline usability remain unverified. Required independent review/current CI/merge/readback and ledger are root-owned. Owner completion is not performed by this worker. Exact aggregate active/provider cost across context is unknown; runtime timestamps above are measured receipts, not an invented total.

Parent publication check initially found two trailing-whitespace lines in the normalized selection RED log; only publication-copy trailing spaces were removed, original prepublication bytes retained locally. All failure details remain. Independent R19 FINAL ACCEPT; root42project contracts passed. The exact staged payload/link check includes six reviewed diagnostic logs previously ignored by the component-wide log rule; raw runtime captures and PNGs remain ignored.
