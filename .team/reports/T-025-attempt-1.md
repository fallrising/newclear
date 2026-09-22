STATUS: DONE

## Summary

T-025 attempt 1 completed the assigned local AC-27 implementation and measurements. This is a worker result, not milestone acceptance. Source-only `codex-task-worker` instructions were read from fixed kernel `237aa277`; no skill was installed. Lead approved task revision 2 for narrow `src/api/contracts.ts` and `src/features/foundation/routes.tsx` edits, then revision 3 for public lazy exports in `src/features/cmdb/index.ts`.

Tested worktree: `/home/ckc/test/codex/newclear-m5-performance`. Actual Git HEAD at final measurement: `01ee259e6c1c9791469a0c00ad8979bf0cfe69d1` plus the uncommitted scoped changes below; tracked source/Vite diff SHA-256 `b1d3ad368cc21c1ba7c73e82b5caeda168ff700b1545c5f4a28f50f79266cef9`. The task's original base field was `36415c54b4a65726e5a3507231e1c5ee81f9c948`; the evidence records the observed HEAD rather than assuming that field stayed current. No worker commit, push, merge, dependency, lockfile, PLAN, deployment, cloud or other-worktree mutation occurred.

Changes:

- `src/app/routes/AppRoutes.tsx`: lazy Admin, delivery, observability and self-service modules with an accessible pending state.
- `src/features/cmdb/index.ts`: retain the public feature boundary and eager inventory summary; lazy public CMDB route/dialog exports preserve inferred prop contracts.
- `src/features/foundation/routes.tsx`: lazy GuideStory with pending feedback, retaining public CMDB imports.
- `src/api/contracts.ts`: pass the used Zod constructors to registry modules instead of the complete namespace. All runtime validation, 73 operations and 173 schemas remain unchanged.
- `src/app/main.tsx`: dynamically load demo runtime only for explicit demo mode, including recovery. Initial-byte accounting still includes the awaited demo runtime. Live startup retains its visible unavailable message without loading demo code.
- `vite.config.ts`: emit manifest and disable Rolldown imported-constant inlining. The locked tldts suffix constant was duplicated at conditional `charCodeAt` uses; preserving one constant saves approximately 64 KiB gzip without altering MSW/cookie behavior or dependency resolution.
- `scripts/benchmark.mjs`, `scripts/benchmark-query.ts`, `playwright.performance.config.ts`, `e2e/m5-performance.spec.ts`: fresh-build native runner and exact browser measurements with all samples and provenance.

Final results: initial necessary JavaScript **297,787 bytes (290.808 KiB)**, including entry, policy, awaited demo/MSW engine module and registered service worker. All five runs loaded the same four scripts, each gzipped independently once using Node default gzip level 6. Every file has a SHA-256 in evidence. Five cold 4× CPU LCP samples: **[748, 772, 800, 768, 772] ms**, median **772 ms**. Browser engine 100-query p95 **0.600 ms**. Persisted HTTP 100-command p95 **171.800 ms**, including the real 150 ms mock delay. No fastest-run selection or discarded warmup observations.

The 5,000-CI profile consists of baseline 60 CIs plus 4,940 deterministic provider-preserving clones with unique canonical identities, explicit synthetic pool capacity, and unchanged original references. It uses the production engine in a separately bundled browser memory harness, with no HTTP delay and no persistence; before/after snapshots prove read-only behavior. All 100 operations filter by provider/health, vary search/page/sort/order, and record returned IDs and totals. Mutation samples use baseline session storage and 100 distinct `POST /__demo/v1/clock/advance` commands with `ticks:1`, recording every receipt and checking +100 command count, clock, audit, events and idempotency entries. The profile has no queued work and does not fabricate business success.

## Verification

All commands ran from `platform/dim-gate` with process-local pinned runtime:

```sh
export PATH=/home/ckc/test/codex/.toolchains/node-v24.18.0-linux-x64/bin:$PATH
export LD_LIBRARY_PATH=/tmp/dim-gate-playwright-libs/usr/lib/x86_64-linux-gnu
export FONTCONFIG_FILE=/tmp/dim-gate-m3-fonts-kaBaS8/fonts.conf
```

Node `v24.18.0`, pnpm `11.18.0`, Chromium `153.0.8010.12`; `linux 6.8.0-139-generic x64`; `AMD Ryzen 7 PRO 8700GE w/ Radeon 780M Graphics`, 16 logical CPUs. LCP uses 1440×900, fresh contexts with empty session/cache/service-worker state, CDP cache disabled and 4× CPU throttling; no network throttling. Query and mutation samples use normal CPU speed as specified. Sandbox startup failed with `bwrap: loopback: Failed RTM_NEWADDR`; subsequent commands used narrow approved escalation, without bypassing a denied action.

- Component-local `pnpm install --frozen-lockfile` (pinned Node/corepack pnpm, 334 warm-cache packages; unchanged lockfile) — passed
- Final `pnpm lint` — passed
- Final `pnpm typecheck` — passed
- Final `pnpm test`: 21 files, 207 tests including App/native regressions — passed
- Final `pnpm check:architecture`: public feature boundaries retained, checker unchanged — passed
- Final `pnpm check:contracts`: 73 operations, 173 schemas, complete local reference resolution — passed
- `pnpm check:docs` after report: 117 Markdown files, 233 links — passed
- `pnpm check:ci`: scope/action pins/authority/native commands — passed
- Final `node scripts/benchmark.mjs`: fresh `pnpm build --mode demo` followed by isolated port-4175 Chromium performance suite, 3/3 tests, exact 5/100/100 observations — passed
- `git diff --check` — passed

Full final raw evidence is in `platform/dim-gate/test-results/performance-results.json`, with the named JSON attachments `initial-route-and-lcp.json`, `engine-query.json`, and `http-mutation.json` stored as base64 bodies by the Playwright JSON reporter. The five cold-navigation PNGs are in `platform/dim-gate/test-results/performance/m5-performance-AC-27-five--fa51b-nd-all-necessary-initial-JS-chromium-performance/`. Decoded copies plus exact source-file SHA-256 manifest are saved under `/tmp/dim-gate-t025-evidence/final/`; the earlier pre-boundary-fix complete measurement is under `/tmp/dim-gate-t025-evidence/pre-boundary-fix/`. These artifacts are local evidence, not committed binaries.

## Documentation

No product schema/contract or budget changed. This report documents benchmark methods and handoff. Lead owns package scripts, CI artifact wiring, demonstration documentation and PLAN; the native package script can invoke `node scripts/benchmark.mjs`. Normal E2E should ignore `**/m5-performance*.ts` and run this dedicated configuration separately. Set `DIM_GATE_PERFORMANCE_PORT` to override isolated default 4175.

## Risks and Follow-ups

Lead must independently integrate and rerun full regression, performance, extra-browser, isolation and review/CI gates on an immutable integrated commit. Worker measurements intentionally name an uncommitted diff and do not claim final acceptance or remote CI. Main's explicit demo import gate should be exercised by the lead/T-026 live-isolation suite.

Historical probes are retained honestly: route splitting alone was over budget; the first actual measurement reported 360,793 gzip bytes and failed that budget while query/mutation/LCP passed. A direct foundation-to-private-CMDB import tripped the architecture gate; it was removed and replaced by public lazy exports. An intermediate registry subset missed `literal`/`coerce` and typecheck identified it; the final exact subset and final complete gates pass. Final results above are the last complete run after source corrections, not selected fastest samples.

Vite still warns that one uncompressed entry exceeds 500 kB; the actual contract is the complete initial-route gzip sum, which is below 300 KiB with approximately 9.2 KiB headroom. Future additions must rerun the complete startup accounting, including awaited imports and MSW. No dependency workaround, stripped library feature, fake size exclusion or domain query behavior change was used.
