# T-008 execution journal

Updated 2026-10-23T03:29:38Z. Worker scope only; root owns governance/acceptance. No Git mutation, delegation, KB reads or source-document writes.

## Coarse process

1. Read assignment/worker skill and listed SPEC/N03/ADR-002/N00/N01 authorities. Preserved pre-existing root governance changes.
2. Derived implementation/test plans and T01–T07 with actual source digests. Froze types/index API and real lock checker before implementation.
3. Installed exact ADR dependencies into shared task build/npm and captured behavioral RED against explicit throwing stubs.
4. Implemented unique synchronous pipeline, canonical model/DOM mapping, controlled adapters and isolated reader. Added snapshots and repeated determinism checks.
5. Root review identified disclosure visibility; captured RED and made details/summary inert visible blocks. Later captured RED for interior BOM/non-horizontal separators and corrected the whitespace class.
6. Ran frontend gates; retained failures from initial test-runner naming/type/lint issues, corrected them, reran full checks.
7. Measured unchanged 1MiB oracle. Compared browser-condition and Node-condition production bundles on identical bytes. Optimized measured local heading/leaf/normalization costs, then reran same fixture. Timing still fails; stopped affected performance slice and reported to root.

## Fine evidence

Evidence root: `<shared-workspace>/flowshot/tasks/n03-worker/preserve/evidence`. Commands ran via `python3 <workspace-launcher> run flowshot n03-worker -- bash scripts/linux-docker-check.sh ...`.

- `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`, `npm ci --ignore-scripts --no-audit --no-fund`: initial task build install; final lock-refresh and fresh separate build/npm-lock-verify install.
- `npm run check:n03-contract`: initial freeze and later9 real copied-source/metadata/authority tamper cases; now included in `npm test`.
- `npm test -- src/lib/document-model`: red-model.log seven behavior failures against stubs; green-model1.log retained one genuine hardbreak whitespace failure.
- `npm test -- src/features/reader`: red-reader.log two expected callback/asset failures against empty reader.
- `npm test -- src/lib/document-model/model.test.ts`: red-disclosure.log and red-horizontal.log show precise newly discovered failures before corrections.
- `npm test -- --update`: generated four synthetic regression snapshots; initial green-suite1.log also retains accidental Vitest loading of Node-test file. Renamed built-in test to check-contract.node.mjs.
- `npm test`, `npm run lint`, `npm run build`: completed tests2/3 and lint/build2/3; final logs list latest exact check results.
- `npm run benchmark:n03`: browser bundle baseline benchmark2.log/benchmark.json; first benchmark1.log retains missing document setup failure.
- `N03_NODE_CONDITIONS=1 npm run benchmark:n03`: benchmark-node2.log/benchmark-node-diagnostic.json; initial benchmark-node.log retains incorrect Node builtin externalization attempt.
- `N03_BENCH_LABEL=optimized-browser npm run benchmark:n03`: benchmark-optimized.log/benchmark-optimized-browser.json. Same exact fixture unchanged.
- Separate n03-worker-checks launcher attempt passed contract but failed npm executables because wrapper mounts only its task directory and source dependency symlink points at n03-worker. Repeated all checks in owning n03-worker; original failed execution remains retained under n03-worker-checks evidence.
- `git diff --check`: passed after source changes.
- Shared launcher n03-worker-report: teamctl validate-task .team/tasks/T-008.md passed; report validation follows handoff creation.

## Performance facts

Final source model SHA256 `51b5892df76e63ee8d3543def9db27525e42531dd3197d76509dbfac321242f1`. Fixture1048576UTF8 bytes, SHA256`b02f7cd9db316877a56618e0dca1a6e3e013860cdbe13273ccde2c9cb6067a68`;251-byte repeated mixed semantic blocks4177times, with only residual ASCII padding. Browser production ESM runs under Node24.18 with jsdom only supplying browser entity decoder DOM. This is not actual WebKit target acceptance. Node-condition diagnostic shows the same large delay and excludes jsdom entity decoding as the main cause.

Six final full-model runs range13579.436–14412.469ms; median mapped13872.246ms / baseline14125.247ms = 0.982089. `<300ms` failed; hints`<=2x` passed. Markdown parsing itself9.56–9.84s, raw conversion/prune2.28–2.89s; optimized canonicalization/segments/TOC0.40–0.45s. No alternate parser, fixture reshaping, caching or relaxed threshold was introduced.

## Root-supplied independent browser evidence

Root provided and worker read `<shared-workspace>/flowshot/tasks/n03-browser-probe/preserve/evidence/webkit.log`: actual WebKitGTK2.50.6, same optimized bundle and exact source hash, baseline9157ms, hinted7975/9139ms. Markdown parsing alone5403–6468ms. Canonical hash b43aa8ba0073cef11522a1683fdbb2f3a6e49e4437727085385ec6d2c525a764 and104426segments match across all browser rows. This confirms a real browser performance failure; no environment excuse or changed oracle. Worker did not run that independent harness.

Final whitespace scan of all new task files found one deliberate two-space CommonMark hardbreak in unicode.md. Changed spelling to backslash hardbreak to keep staged diff checks clean; targeted `npm test -- src/lib/document-model/fixtures.test.ts --update` passed4fixtures/100repeats (fixture-whitespace-final.log). Only expected source-hash/source-hint snapshot fields changed; model source and benchmark bytes stayed unchanged.

## Bounded T010 rework (root15minute assignment)

1. Root found caption unwrapping caused invalid table markup and browser foster-parenting, reversing canonical/DOM order. Proposed deterministic lifting of captions/invalid table contexts before owning table; root approved and amended ADR-002. Worker refreshed all derived source hashes and lock authority hashes before implementation. Initial attempted RED stopped on expected authority drift (red-table-dom-order.log); actual failing DOM-order RED is red-table-dom-order2.log.
2. Retained caption/tfoot through sanitizer and normalized tables bottom-up. Captions and other invalid table/section/row children lift into ordinary visible blocks; orphan table-only containers convert to divs. Valid cells/rows/sections remain and structural whitespace policy is preserved. Seven exact-content cases include nested/multiple captions, stripped wrappers and table sections. Final parsed DOM IDs must match segment order globally. Targeted GREEN and full25test check passed.
3. Added requested reader rejected/sync-throw/oversize callbacks; they passed existing error containment. Identical-HTML replacement RED showed loader called once instead of2 (red-reader-identical-model.log). Changed lifecycle dependency to model identity+loader and documented distinct-model/documentUUID-key integration requirement.
4. Latest final npm test/lint/build all passed:27frontend +9actualtamper cases, tests-rework-final.log/lint-rework-final.log/build-rework-final.log. No expensive benchmark rerun per root; previous precise timings remain attributed to previous recorded source. Latest model SHA17d1b18278acd7dbfdebfe0a83dc562a9ace99cf42f9ae51d7bcca7d4768b3a8; performance remains blocked. No additional paths, API/dependency changes, commits or delegation.
