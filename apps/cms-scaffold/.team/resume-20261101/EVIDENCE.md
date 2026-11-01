# T-0351 PP1b pre-approval checkpoint — 2026-11-01

Historical snapshot before owner approval; current runtime outcome and remaining gates are in [RUNTIME-REPORT.md](RUNTIME-REPORT.md). Original failures and pending statements below describe that earlier checkpoint.

Status: PARTIAL; PR334 remains Draft. No live PP1 run has started. Source is original68610e9513e1fce2ad2a0e7aad9cf6647723903b plus normal current-main merge and the narrowly reviewed E01 cleanup fix. Raw local output is ignored/private under `local/reconcile-20261101/`; no credentials or raw logs are committed.

| Check | Observed result |
| --- | --- |
| `JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900 ./gradlew test integrationTest :services:cms-api:bootJar --no-daemon --no-parallel` | PASS,8m10s; XML58unit files/517tests and16integration files/201tests; zero failures/errors/skips. |
| `npm run lint`, `npm run typecheck`, `npm test` | PASS;672workspace tests plus117PP1 helper tests. |
| `VITE_API_BASE=https://api.cms.test:8443 npm run build`, `npm run test:bundle`, `npm run measure:bundle` | PASS;10measurement regressions; gzip front85209/92160,back130917/163840,admin136667/163840. |
| `npx eslint e2e-pp1-local playwright.pp1-local.config.ts` | First FAIL at accounts.spec.ts finally ThrowStatement. Fixed by recording cleanup failure, preserving the sanitized original journey failure and checking cleanup after finally. Recheck PASS without suppression. |
| PP1 and existing E2E TypeScript | PASS with `npx tsc --noEmit --allowImportingTsExtensions --target es2022 --module esnext --moduleResolution bundler --esModuleInterop --skipLibCheck --types node e2e-pp1-local/*.ts playwright.pp1-local.config.ts` and the same flags for `e2e/*.ts playwright.config.ts`. Initial guessed `--project tsconfig.pp1-local.json` failed because that file does not exist; corrected invocation above passed. |
| `node --test scripts/record-frontend.test.mjs e2e/runner.test.mjs e2e/helpers.test.mjs`; `npx eslint e2e playwright.config.ts` | PASS,3file-level test wrappers; do not count them as named inner assertions. |
| PP1 config parser/list matrix | PASS: accounts/trusted lists one journey; runtime trusted/untrusted accepted; accounts/untrusted and unknown suite rejected. No browser execution or credential delivery inferred. |
| G07 true fresh-init, initialized SQL plus rollback-only semantic negatives, remaining live guard matrix | NOT RUN: original PP1a fixed old image is absent; concrete tooling exception awaits owner decision. |
| Trusted TLS accounts E01 | NOT RUN, same prerequisite. No replacement-image runtime adopted. |
| Independent acceptance | T1102 read-only source review found no confirmed P1/P2 in inspected seams; report PARTIAL, live evidence still missing. Root checked its actual source references and retained restricted-environment failed tests alongside successful normal-host117test baseline. |
| CI / merge | Pending updated PR; no merge or product-completion claim. |

`npm ci` used existing lockfile;20existing audit findings (15moderate/5high) and existing unapproved postinstall warnings retained. No dependency update or approve-scripts change. Gradle deprecated-feature/ByteBuddy warnings did not fail gates. No generated tracked bundle evidence changed.

Environment:Node24.18.0,Docker29.1.3,official Temurin25.0.5+8 SHA25668982529869257d0ee6b824ec5aa270ff8b118bb438670da0b97ebdab178d7fb,PostgreSQL16 Testcontainers. Testcontainers were native integration infrastructure, not PP1 acceptance. Product builds and frontend gates completed before only browser cleanup changed; affected lint/types were rerun.

Review of cleanup correction: success plus failed context.close remains a fixed-code failure; journey failure survives cleanup failure without being replaced; passwords are cleared in finally on all paths. Static regression was RED→GREEN. This does not claim the live E01 works.

Merge whitespace: inherited current-main whitespace in three unrelated paths is byte-identical to MERGE_HEAD; preserve it. Check actual proposed feature with `git diff --cached --check MERGE_HEAD`. Do not claim the historical-parent plain check passed.

Next: obtain the narrow PP1a tooling decision recorded in PLAN; if approved, amend only that requirement and validate pinned tools, then fresh source-bound runtime, G07 semantic/live negatives and E01, final independent acceptance, required CI, ready/normal merge and remote readback. PP1c remains a separate DRAFT with D01–D03 unresolved design inputs.

Accounting:2native worker launches,0external model CLI; complete outer/nested/provider calls,tokens,cost,active/wait totals unknown/null across compacted history. No hard tool-count budget. Required tests were bounded900s; actual Gradle elapsed490s,Node helper5.22s; do not sum overlapping commands into active effort.
