STATUS: PARTIAL

## Summary

Independent reviewer for T-040 attempt2, run DG-W3-20260923-02, reviewing fixed candidate `25ba5ca9a4e5d7e8cb3b2aa4448165801390a89c` (HEAD in this isolated checkout, matches `testedCommit` in root's `fixed-gates.json`) against accepted W2 base `91626851fb17df7ab31c96dee9353b9ee4d42c92`. Runtime model: **claude-sonnet-5** (Sonnet 5), per the environment's own system reminder — not independently re-derivable beyond that declaration.

**Confirmed HIGH-severity unpatched regression, same bug class as the commit under review:**

`src/features/delivery/dialogs.tsx:26` — `const command = useMutation({ mutationFn: deliveryApi.createPipeline })`.

- `deliveryApi = api` (`src/features/delivery/shared.tsx:14`), and `api.createPipeline` is produced by `deferredClient(...)` (`src/api/client.ts:137-139`, `createPipeline: true`), i.e. it is exactly `async (...args: unknown[]) => { const input = structuredClone(args); ... }` (`src/api/core/deferred-client.ts:8-19`).
- TanStack Query 5.103.1 (pinned in `package.json:31`, present in `node_modules`) calls `mutationFn(variables, mutationFnContext)` unconditionally — confirmed in the installed package's runtime source at `node_modules/.pnpm/@tanstack+query-core@5.103.1/.../build/modern/mutation.js:142`, with `mutationFnContext = { client: <QueryClient>, meta, mutationKey }` (type at `.../hydration-DwR10Hi-.d.cts:2473-2478`).
- Because `createPipeline` is passed bare instead of wrapped in an explicit arrow (`(input) => deliveryApi.createPipeline(input)`, the exact pattern this commit applied elsewhere), `args = [variables, mutationFnContext]`. `structuredClone` throws `DataCloneError` as soon as it reaches the `QueryClient` instance (its prototype is `QueryClient.prototype`, not `Object.prototype`/a supported built-in), *before any network call*.
- **Effect**: every click of "確認觸發" (Confirm Trigger) in `TriggerPipelineDialog` (`/rd/pipelines` → "觸發 Pipeline") fails; the mutation rejects synchronously with a raw clone error (not a typed `ApiRequestError`), rendered via `<ErrorState>`; no pipeline is ever created through this dialog. This is a core delivery golden path.
- **Reproducer**: open `/rd/pipelines`, click "觸發 Pipeline", fill the form, click "確認觸發" → dialog shows an error instead of navigating to `/rd/pipelines/:id`.
- `e2e/m3-delivery.spec.ts`'s shared `trigger()` helper (lines 30-40) is used by numerous specs, including lines 223-235 and 330+, and asserts `toHaveURL(/\/rd\/pipelines\/[^/?]+$/)` after this exact click — this spec would fail if executed against this candidate's dependency tree.
- Confirmed via `grep -rnE "(queryFn|mutationFn):\s*\w+\.\w+"` and `\s*[a-zA-Z_$]+\s*[,}]` across all of `src/` that this is the **only** remaining bare-reference instance of the pattern the commit otherwise correctly eliminated (`observability/integrations.tsx`, `self-service/routes.tsx` are both now correctly wrapped, and the new `observability.test.tsx` case exercises the real `useQuery` call convention and passes by inspection).
- This line pre-dates W3 (`git log`: introduced in `4cb7dd5`, "M3 pipeline and release interaction views"), so it is a pre-existing latent defect rather than something newly introduced by this commit — but it is squarely the same anti-pattern this commit's stated purpose ("isolate API inputs from query callback contexts") was meant to eliminate project-wide, and the newly added `docs/sdd/05-frontend-architecture.md` invariant now documents a rule this line violates. No lint rule or generic guard was added to prevent recurrence of this pattern, which is presumably why it slipped through.
- The `deferred-client.test.ts` unit tests only ever call `client.command(explicitArgs)` with one argument, so they cannot catch the two-argument `mutationFn` wiring bug — the gap is structural (no test exercises a bare deferred-client method wired directly into `useMutation`).

No other findings were confirmed within the time budget.

## Verification

Lead formatting addendum: the following two entries normalize the report contract only; the original reviewer response is preserved below and verbatim at `/tmp/dim-gate-w3-resume-evidence/T-040-attempt-2-source.md`. The claimed HIGH defect is disputed by actual runtime/browser evidence in PLAN DG-D085.

- Read-only Claude source review returned a PARTIAL report on25ba5ca — passed
- Independent verification script could not execute under that CLI permission configuration — skipped

## Original reviewer verification (verbatim)

- `git rev-parse HEAD` / `git status --short` — passed (HEAD = `25ba5ca9a4e5d7e8cb3b2aa4448165801390a89c`, clean tree)
- `git show 25ba5ca` (the reviewed fix commit) — passed (read in full; touches `.team/PLAN.md`, `docs/sdd/05-frontend-architecture.md`, `integrations.tsx`, `observability.test.tsx`, `self-service/routes.tsx`)
- Static/runtime-source audit of `deferredClient`, `api/client.ts` wiring, and installed `@tanstack/query-core@5.103.1` source for the `dialogs.tsx:26` finding — passed (defect confirmed by direct inspection of installed dependency source, not by execution)
- Repo-wide grep for remaining bare `queryFn:`/`mutationFn:` references — passed (found exactly one remaining instance, above)
- `bash /tmp/dim-gate-w3-resume-evidence/reviewer-verify.sh` (mandated script: `git rev-parse`, `pnpm test`, `pnpm build --mode demo`, W3 Playwright specs on port 4355) — **skipped**: sandbox permission layer returned "This command requires approval" with no interactive approval available in this session, for the script itself, for plain `pnpm`/`node` on `$PATH`, and even for a local `node_modules/.bin/vitest` invocation. This blocked all command execution beyond pre-approved read-only git/`rg`/`find`/`cat`-equivalent tools. I did not attempt to bypass the sandbox.
- Read `/tmp/dim-gate-w3-resume-evidence/fixed-gates.json` (root's concurrent gate run for this exact `testedCommit`) — passed: `install`, `lint`, `typecheck`, `test` (vitest native), `check:docs`, `check:contracts`, `check:ci` all report `PASS`/exit 0; `check:architecture` was `RUNNING` (no result yet) at read time — **pending, not a finding**, per instructions.
- Root e2e/browser gate results for this exact commit — **skipped/unavailable**: not present in the `fixed-gates.json` snapshot at read time; no PNG evidence files were available to inspect via Read.
- `.team/reports/T-040-attempt-1.md` remaining checklist items (UI editors/keyboard/triage pass, schema-split parity count, engine lazy-import boundary, full W1/W2 fixture-provenance/migration reproduction) — **skipped**, not reached within the 35-minute budget after the confirmed regression was found and verified.

## Documentation

Read: `.team/tasks/T-040.md`, `.team/reports/T-040-attempt-1.md` (prior partial evidence), component `AGENTS.md` (scope boundaries, shared entity/API/state-machine rule, no self-acceptance, evidence must bind to tested commit), the reviewed commit's diff including its `docs/sdd/05-frontend-architecture.md` addition (documents the new queryFn/mutationFn explicit-callback invariant this review is checking compliance with), and the `.team/PLAN.md` DG-D084 handoff entry embedded in that commit (confirms current run context, PR37 draft/open, and that T-039 attempt4/T-040 attempt2 are the active work items).

Not read this round due to budget: `W3-INTEGRATION-CONTRACT.md` revision 3 in full, `docs/sdd/09–14`, `affected01–08`. This is a real coverage gap — the finding above was reached via direct source/dependency audit rather than full contract cross-referencing, so I cannot yet confirm whether AC-WS-10/11/15–18 are otherwise met.

## Risks and Follow-ups

1. **Fix the `dialogs.tsx:26` regression** before any acceptance/merge: wrap as `mutationFn: (input: CreatePipelineInput) => deliveryApi.createPipeline(input)`, matching the pattern already applied in this same commit to `self-service/routes.tsx`. Re-run `e2e/m3-delivery.spec.ts` (all `trigger()`-based cases) after the fix, plus a new regression test asserting a `useMutation` wired directly to a bare deferred-client method does not throw when TanStack Query passes its `mutationFnContext`.
2. Consider adding a structural guard (lint rule or a generic test that calls every `api.*`/`deliveryApi.*` etc. method with `(variables, {client: queryClient, meta: undefined})`-shaped extra args) so this class of bug can't silently reappear at a third call site — manual vigilance alone already missed one instance in this very fix.
3. Sandbox/tooling blocker: this session could not execute `pnpm`/`node`/Playwright at all (every non-trivial exec required approval that was never granted), including the explicitly pre-authorized `reviewer-verify.sh`. The parent/orchestrator should either grant that approval in a follow-up session or supply the resulting logs/PNGs directly, since independent execution could not be completed here.
4. Remaining attempt-1 checklist items (UI/editors/keyboard/triage visual pass at 1440/768/390, schema-split parity count, engine lazy-import/current-policy boundary, full W1/W2 fixture-provenance and atomic-migration reproduction, affected-doc 01–08 reconciliation) are still open and were not reached this round.
5. Root `check:architecture` was still `RUNNING` and no e2e/browser gate result existed yet for this exact commit at read time — track to completion before treating the candidate as gate-clean; this is a pending-evidence gap, not a code finding.
6. Given item 1 is a confirmed functional break of a core delivery flow, this candidate should not be accepted/merged until it is fixed and re-verified, independent of the otherwise-sound narrow fix in `integrations.tsx`/`self-service/routes.tsx`.
