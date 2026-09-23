STATUS: PARTIAL

## Summary

T-033 attempt 2 delivers the bounded DG-D060 performance correction. The measured integration baseline is `285b46f2d30db729db001ed99f5be35b0dbaf58b` (W2 checkpoint). Worker remains on `agent/dim-gate/task/t033-resource-domain` at `7086a443416fbc9876612e66bac889e83c8200ad`; every domain file was byte-compared with fixed 285b46f before editing and was identical. The measured candidate consists of that fixed component source plus the seven owned files hashed below. The worker did not commit, push, delegate or self-accept.

The unchanged complete benchmark now passes all three cases. Five isolated cold initial transfers each total **303,891 bytes gzip**, including awaited Mock bootstrap, all initial scripts and the actual service worker. This reduces the lead-reported fixed 285b46f baseline of 314,429 by 10,538 bytes and leaves 3,309 below the unchanged 307,200-byte budget. Median cold LCP is 720 ms under 4x CPU throttling; real 5,000-CI query P95 is 0.400000095 ms; 100 persisted HTTP command P95 is 168.299999952 ms including 150 ms mock latency.

The engine now dynamically imports engine-commands inside its existing serialized queue. The command module contains the original synchronous execute implementation, provisioning/clock progression and command-only helpers. Loading completes before the current state is passed to executeCommand, so authorization, expected versions and replay inspect the state after every preceding queued command. The executor synchronously clones, validates and persists, returning the committed state only after persistence succeeds; engine state replacement follows that successful return. Failed loading/execution/persistence leaves the queue rejection handling intact.

Synchronous read and startup snapshot/integrity validation remain eager. Nine small shared helpers moved unchanged to engine-shared; nine command-only helpers moved unchanged to engine-commands. resourceConflictKey moved unchanged to a type-only pure resource-identity helper, removing the startup integrity dependency on the resource mutation module. No schema, validator, business action, five-step scheduler, quota, retry, authorization or source ID semantics changed. API/UI/controller/router/manifest/build configuration/budget/measurement sources were not authored or edited.

## Verification

All native commands used component cwd, Node 24.18.0 through `/home/ckc/test/codex/.toolchains/node-v24.18.0-linux-x64/bin` on PATH and component-pinned pnpm 11.18.0. Read-only dependency files are exact fixed 285b46f bytes; they are not part of the seven-file owned handback.

- Pre-edit byte comparison of every existing domain file with fixed 285b46f — passed
- Initial attempt to run `pnpm --dir platform/dim-gate typecheck` from repository cwd invoked the root pnpm 12.5.1 through Corepack and rejected the required 11.18.0; no bypass or package-manager configuration edit, corrected to component cwd — failed
- `pnpm install --frozen-lockfile` from component cwd: already up to date, 235 ms, pnpm 11.18.0 — passed
- `pnpm typecheck` after extraction — passed
- `pnpm exec vitest run src/domain`: 168/168 tests across 8 files, 1.38 s — passed
- `pnpm test -- src/domain`: this prescribed command discovers the complete integrated suite; 301/301 tests across 28 files, 7.19 s — passed
- `pnpm exec eslint src/domain` — passed
- `pnpm check:contracts`: 91 operations, 209 schemas, all local references resolved — passed
- `pnpm check:architecture`: feature import boundaries — passed
- `pnpm build --mode demo`: production build passes; manifest emits engine-commands only as a dynamic entry with no initial import; Vite reports approximately 12.57 kB gzip for the deferred command chunk — passed
- Unchanged `pnpm benchmark`: fresh production build then all 3 Playwright performance cases, 26.9 s; five cold totals 303,891 bytes, LCP median 720 ms, query P95≈0.4ms, command P95≈168.3ms — passed
- Explicit byte comparison: synchronous read body and 18 moved helpers retain original fixed 285 implementation; all 193 copied non-domain dependency files retain their recorded fixed 285 SHA-256 — passed
- First `git diff --check` after extraction found one trailing blank line at engine.ts EOF; removed — failed
- Final `pnpm build --mode demo` after EOF whitespace cleanup: every emitted dist file SHA-256 matches the artifacts measured by the successful benchmark — passed
- Final `git diff --check` — passed
- Pinned `python3 /tmp/dim-gate-w1-evidence/teamctl.py validate-report .team/reports/T-033-attempt-2.md` — passed
- Lead final fixed-commit integration, all UI/browser regression, independent review and latest exact-head CI remain outside this worker correction and are not claimed here — skipped

Two new delayed-import regressions verify that invalid startup integrity still throws synchronously and read never loads mutation code; commands wait inside the queue; a queued role revocation applies before the following proposal's authorization; input is copied before an outstanding import; storage 507 publishes no state or receipt; and the next queued command uses the unchanged version and succeeds. Existing domain and HTTP/persistence suites cover replay, quota races, current scope, failure/retry and all original scheduler transitions.

Benchmark runtime used installed Chromium 153.0.8010.12 with `LD_LIBRARY_PATH=/tmp/dim-gate-m5-webkit-libs/usr/lib/x86_64-linux-gnu:/tmp/dim-gate-playwright-libs/usr/lib/x86_64-linux-gnu`, `FONTCONFIG_FILE=/tmp/dim-gate-m3-fonts-kaBaS8/fonts.conf`, and isolated `DIM_GATE_PERFORMANCE_PORT=4179`. No custom benchmark source, alternate exclusion or threshold was introduced. Initial transfer contains browser, index, policy and mockServiceWorker scripts; the mutation chunk is fetched by actual subsequent commands. Browser console/request/error assertions passed.

## Documentation

Exact owned handback manifest: `/tmp/t033-attempt2-owned-manifest.json`. Copy these seven files plus this report only:

- `src/domain/engine-commands.ts`: `d8cb8a9939073705bb19d4348bca3e92646eac83b52c5a3707b197a7c7e21300`
- `src/domain/engine-loading.test.ts`: `7d0d51062b96a041faab084a1ceb6cdbd37c80c794bb633ae6ca8a6ca0cbdbeb`
- `src/domain/engine-shared.ts`: `2c55b61338e236a23df5e64ef51c73817d7f148f43b29a09d5b43c06cb708f73`
- `src/domain/engine.ts`: `90209ae4bc1a231353afe58b28136105cd6b1ce4f4772ff98d49687d4e61ed6b`
- `src/domain/resource-identity.ts`: `959ecc567c62e653213e8d7c89f8d8ad6405b556176267ffe22d9def000eff0b`
- `src/domain/resource-integrity.ts`: `0b7a2eeaaf1311b7797f45fbd3c28c0cc4406c0f684f769676122111cf208739`
- `src/domain/resources.ts`: `e9d26cc7aba71f31c868b3a378f9ef71da71e57b8cb5da9b77865f22e00cb09c`

Approved read-only dependency manifest: `/tmp/t033-attempt2-dependencies.json`, 193 non-domain component files copied byte-for-byte from fixed 285b46f. These include API/UI/demo/generated files and configuration required to build and run integrated tests, but were never authored by this worker and are excluded from handback. Original attempt 1 report/history remains preserved.

Decoded original benchmark attachments and complete JSON reporter output are preserved here:

- `/tmp/t033-attempt2-evidence/engine-query.json`: `9be2203061afbd38a7c32b0deb97d3c60d35d9eb471537c48211bb738c5a1c61`
- `/tmp/t033-attempt2-evidence/http-mutation.json`: `e9064b3a1ab1a6c208c4e68e887c65ead53aad6a051fc6f0914ae4c88b2c0bb2`
- `/tmp/t033-attempt2-evidence/initial-route-and-lcp.json`: `96e87388646baee8ef1c5e4f18d374ccb56afcb208de0f470c64c02fe85a4fba`
- `/tmp/t033-attempt2-evidence/performance-results.json`: `e7eb6a121d3e7a6e1f2ba036c4e3a5e34c48a091a12128e8cd9792e7ebaac16f`

The benchmark's built-in git metadata reports the actual worker HEAD 7086a44 and tracked diff; because this isolated tree also contains untracked handback files and approved dependency copies, this report's exact source/dependency manifests and measured asset hashes identify the candidate more completely. This is not a false claim that the worker committed or tested a new fixed integration commit. Final whitespace cleanup was followed by a production rebuild and byte-equivalence comparison against `/tmp/t033-attempt2-bench-dist-hashes.json`.

## Risks and Follow-ups

- The correction is implemented and measured successfully. Report status remains PARTIAL because historical failed invocations and the final lead-owned delivery gates are explicitly retained; this is no worker self-acceptance.
- Lead should integrate the seven owned files and rerun the unchanged budget on the final combined UI/API/domain commit. Remaining initial budget headroom is 3,309 bytes; later UI changes are not included in the fixed 285 dependency build.
- The first actual command performs a dynamic module fetch. The original HTTP benchmark includes that real first command and all 100 commits; queue/current-state checks and atomic persistence remain authoritative. No required startup validation is deferred.
- A standard Vite large-chunk informational warning remains on the main bundle; no chunk-size warning limit or performance budget was raised.
- After validated report and handoff, the worker stops all writes and releases domain ownership to the lead. No deployment, real infrastructure operation or external notification was performed.
