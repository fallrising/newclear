# Fleet R2 M1–M9 — scoped implementation and evidence ready

Desk T-0380 R2-AC-7/E, PR #591. Approved R2 implementation and runtime checks pass; independent final review, publication/CI and remote/ledger verification remain orchestrator-owned. This is not owner acceptance, usable-product, deployment or full-R3 completion. `mainline: incomplete`, `usable_tag: none`, AC-03 Cloudflare email OTP pending.

## Outcome and scope

M1–M8 change only the allowed CSS/templates and catalog presentation data: responsive viewport/table containment, approved Health colors/symbols, table/accessibility semantics, catalog-only polling, stable/disabled action buttons, correct service swap/reload, JSON Rollback and safe text-only error alert, defined empty states. Existing API/auth/store/provider behavior, eight catalog columns, routes/methods/form field/cookie flags, fragment tr IDs, vendor/dependencies/CI remain unchanged. M9 is an owned synthetic runner using actual APIs, true form login and the unmodified shared capture script. No fleet-agent, workload, CF token, host port/network/socket or external service was used.

Two measured implementation adjustments stay within approved outcomes. M5: inherited `hx-select=table` excluded row fragments and disabling blurred the action before swap; exact row selector plus a catalog-only WeakMap restores the original focused ID only when the replacement exists/enabled and the current active element is BODY. Actual Tab-away to the retained header link proves that focus is not stolen in that scenario. M1: the absolute hidden Actions label escaped its scroll wrapper through BODY; one `position: relative` property makes the wrapper its containing block. Neither adjustment changes the approved specification or adds a feature.

## Required checks and visible evidence

| Requirement | Actual evidence |
| --- | --- |
| Focused RED→GREEN | [initial rendering RED](evidence/render-red.log), [M7/API GREEN](evidence/render-final-green.log), [M5 selector RED](evidence/focus-render-red.log) → [GREEN](evidence/focus-render-green.log), [inline-script behavior RED](evidence/focus-behavior-red.log) → [2 tests GREEN](evidence/focus-behavior-green.log) |
| Observer boundaries | [8 pure tests PASS](evidence/observer-final-tests.log): rejected waits, positive button/row recovery, safe route/console classification, contrast formula and focus negatives |
| Original native gate | `make test vet validate-schema build`: initial23.899s, focus-fix2.182s, final CSS-fix2.262s, all exit0. [Final receipt](evidence/native-overflow-fix.json), [9-source equality audit](evidence/source-audit.json). Actual module toolchain Go1.23.0; no fabricated per-case count |
| M7 browser RED before fix | [baseline003](evidence/baseline-003.json): true login303/cookie flags/catalog200; exact older release selected from3 releases/2 Rollback buttons; actual form body→400 invalid_json/current release unchanged. Actual `declaredJSON:false`, despite the old template's attempted header |
| Actual interactions | [final003](evidence/final-003-overflow.json): Tab/Enter Stop/Start200 and stable focus, real poll14823ms, bounded real request delay disabled/re-enabled and Tab-away/no-steal, service3reloads, JSON/header Rollback202/current release, real controlled404 literal text-only alert/no reload, empty states |
| M1 actual RED→GREEN | [overflow metrics](evidence/overflow-001.json): document759 vs viewport390, absolute Actions offsetParentBODY. [repair001](evidence/repair-001.json): document390, wrapper350/scroll821, label contained and accessible |
| Responsive artifacts | [artifact audit](evidence/artifact-audit.json): 12 unique selected PNGs, dimensions/SHA,11 original green keys + only service/mobile replacement; failed original retained; duplicate/missing-key canaries rejected |
| Final loaded/axe checks | repair001: all12 finalURL/heading/overflow guards HTTP200 on final binary; 4 desktop axe4.13.0 scans, exact findings below |
| Cleanup | final003 and repair001: owned capture group, heartbeat, browser, server, listener and private state all true; serverexit0/no forced kill. [final outer](evidence/final-003-outer.json), [repair outer](evidence/repair-001-outer.json) positively confirm owned container removal |

Runtime: Node24.18.0, Playwright1.63.0, Chromium153.0.8010.12, axe4.13.0. Final CSS binary SHA256 `8bebec96a8ba6d791c86ecc120d0dd9f8c776dd2ff3d0ead8f9bad1a85acc55c`. The accepted interaction/eleven-PNG binary is `0f26868e41b3e27fe6b10f5092714eae9281b97fe78d1501684f2c82f5e0af9f`; the only product delta is the one-property CSS containing-block fix. All twelve loaded checks and four axe scans use final CSS. Fresh repair seed has equivalent presentation categories but different generated IDs/generation/timestamps. Do not describe all screenshots as one final-source run.

Root launches `node /work/specs/fleet/fe-review/run-review.mjs final /fleetd /evidence/<unique-run>` in the prescribed isolated container. The runner owns startup, inline API seed (replacing the proposed `seed.sh` filename), heartbeat, true login and private storageState. It generates separate anonymous/protected targets and invokes shared `capture.mjs <private-targets> --dry-run --out <run>/matrix`, then normal `--no-axe` capture; no ineffective `--start` is claimed. `repair` mode captures only the failed mobile key and runs the remaining guards/scans. Token/state/rawPNG/log output is private/ignored; only sanitized UTF-8 receipts are public.

## Retained axe and visual limits

| Desktop page | Actual axe violations | Incomplete |
| --- | --- | --- |
| login | none | 0 |
| catalog | color-contrast serious,1 header muted node | 0 |
| node | color-contrast serious,1 header node; meta-refresh critical,1 node | 0 |
| service | color-contrast serious,1 header node; meta-refresh critical,1 node | 0 |

Total: **3 serious contrast occurrences and2 critical refresh occurrences**, not zero violations. Health colors/symbols were observed, no Health color-contrast violation occurred, and the approved colors pass the formula regression. Root read DESIGN/task and accepted the existing R2 boundary: M2 changes Health colors; M4 explicitly retains node/service15s refresh. All-critical/serious-zero is a full-R3 requirement, which has **not passed**. No threshold was weakened and no out-of-scope header/refresh change was made. Mobile release IDs still wrap into tall cells under the approved wrapping/scroll treatment; no nowrap/table redesign was added. Login failure JSON and missing-page plain404 remain unchanged.

Interactive health in final003 is separately measured: one real controlled-missing-stop POST404, one browser resource404 console event, one htmx404 console event; no other recorded event/requestfailed/pageerror. The selected static captures and12 loaded checks report zero console/request/pageerror observations. Expected negative events are not called zero events. No-audit is proven by native rendering; it is not claimed as a separate browser assertion.

## Preserved failed attempts and provenance

| Attempt | Observed outcome / disposition |
| --- | --- |
| baseline001 | LOGIN/COOKIE assertion failed with URL-filtered cookie observation; later unfiltered jar succeeds. Inner cleanup proved; do not infer missing earlier metadata |
| baseline002 | unhandled pending wait masked original error; **no inner receipt**. Only [outer removal](evidence/baseline-002-outer.json) proved. Ambiguous locator is a source-backed diagnosis, not a recovered original exception |
| baseline003 | actual malformed Rollback400 RED and true login/cookie/cleanup PASS before M7 fix |
| final001 / focus001 | real focus loss; diagnostic timeline proves removed row and BODY focus until15s poll. [Failure](evidence/final-001-fail.json), [timeline](evidence/focus-001-fail.json) retained; [focus002](evidence/focus-002.json) passes after approved repair |
| final002 | CATALOG_KEYBOARD timeout; exact sub-action was not recorded. Observer later waits actual htmx settle and true reload DOMContentLoaded; diagnosis does not retroactively identify the lost sub-action |
| final003 | all interactions pass; only service/mobile overflow fails. All12 raw matrix records/PNGs preserved; do not relabel this run exit0 |
| overflow001 / repair001 | metrics-only reproduction is not a full gate; targeted correction and previously-unrun checks pass in repair001 |

Focused logs also retain the empty-fixture helper compile typo and the M7-before failure after a cwd typo. They are not product failures introduced by a passing change. See [receipt provenance](evidence/README.md). No successful interaction or11 green screenshots were rerun to hide history. Dedicated TERM/child controls were not required or run; actual normal and multiple failure cleanup paths plus outer absence are the evidence boundary.

`targets.verified=true` is metadata promotion for approved R2 only. [Promotion receipt](evidence/metadata-promotion.json) distinguishes its post-runtime note/boolean change from the frozen runtime target hash. Final source checks match nine current product/test files to both native and runtime snapshots. Provider/tool/active totals across compaction remain unknown; exact outer runtimes belong to their receipts. No recursive delegation, worker Git mutation or new dependency occurred. Root owns final review, CI, publication, backup and ledger/owner status.

## Independent acceptance

[Author-other R24 review](evidence/independent-review.md) accepts the original R2 M1–M9 implementation and evidence. Historical failed attempts and five R3 axe findings remain explicit; root publication/current CI/normal merge are pending. Root `python3 scripts/check_project_success.py`: PASS42 contracts.
