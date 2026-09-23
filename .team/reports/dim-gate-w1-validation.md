# W1 fixed-version validation

Run `DG-W1-20260923-01`, tasks T-030/T-031/T-032; sole owner Codex orchestrator. [PR33](https://github.com/fallrising/newclear/pull/33) is the single delivery PR. Product source `5cf495f60e22789b482b578b06e0ea64d135b177`; test-only reload repair `4ab62327b47c5924a22c84e99bab9c79e1dfbb0a`. Main00333ef was normally merged as0f9140a and changes no dim-gate/.team/workflow input. Later checkpoint edits are documentation only. W1 local gates are complete; final PR-head CI/acceptance/merge are separately recorded on PR33 and the next PLAN reconciliation.

## Requirements and actual behavior evidence

| Exit AC | Evidence |
| --- | --- |
| AC-WS-01 | `e2e/w1-workspaces.spec.ts`: visible single/multi/no-grant workspace control; Admin UI grant/revoke; independent Demo identity; same serialized domain/user through workspace switch; current-workspace sidebar and no-grant recovery; keyboard/tablet/mobile navigation. |
| AC-WS-02 | Same test: canonical environment drilldown, Back/reload URL filters, all/mine work from two real requesters, legal Admin scope, invalid/mismatched/partly-valid scope cleanup, failed target read/retry preserving origin, held real old-persona dashboard response. `w1-home-data.spec.ts`: real UI Request→Ops approve→failed execution→same RD request plus Admin draft/audit. Domain/HTTP tests cover authorization before totals, unknown/stale freshness and actual canonical source IDs. |
| AC-WS-16 | Domain snapshot/schema/seed IDs unchanged. Full original52 Chromium regressions retained: running execution reload, explicit reset, corrupt bytes, quota atomicity,1000 actual UI commands and1001st atomic rejection.4ab strengthens all3 provider stories with post-reload same incident ID/state/sample assertions before leaving. |
| AC-WS-17 | W1 three homes×light/dark×1440/768/390 gives18 actual axe/overflow/screenshot combinations; four extra768/390 light/dark readable group/label and keyboard cases. Full legacy keyboard/dialog suite retained.6/6 Firefox/WebKit smoke includes workspace switch with legal project and deep refresh. Fresh benchmark and2/2 actual sibling/live isolation pass. |
| AC-WS-18 | Persistent Demo marker, canonical readonly home projections, no new W2–W5 menu placeholders or fake commands. Network test asserts no external request. SDD/status/capability map distinguish W1 implemented/verification from W2–W5 pending, and future/unclear capabilities stay unavailable. Independent review checks this boundary. |

## Executed commands and fixed provenance

On clean5cf495f, Node24.18.0/pnpm11.18.0, lockfile SHA256 `0da752e9e75f7b22902ba601583d1979e0a0d63b34275bcc445c4286dec7a32b`:

- `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test` — passed245 tests/23files.
- `pnpm check:docs`, `pnpm check:contracts`, `pnpm check:ci`, `pnpm check:architecture`, `pnpm build --mode demo` — passed;73operations/173schemas.
- `DIM_GATE_TEST_PORT=4213 pnpm test:smoke` — passed6/6 Firefox/WebKit.
- `DIM_GATE_TEST_PORT=4213 pnpm test:e2e` — passed64/64 Chromium in20.7min; retries0, workers1; original52 plus12 W1 journeys.
- `pnpm benchmark` — passed3/3 with a fresh build; `pnpm test:isolation` — passed2/2.
- `/tmp/dim-gate-actionlint/actionlint .github/workflows/dim-gate-ci.yml`, `git diff --check` — passed.

On clean4ab6232: frozen install/lint/typecheck/docs/demo build/diffcheck and `DIM_GATE_TEST_PORT=4217 pnpm exec playwright test e2e/m4-observability.spec.ts --grep 'Guide story'` — passed3/3 in2.4min. This is the only test-code delta from5cf. No browser-health exception, retry, timeout, command mutation or store setup write was added. Final-head CI must run the entire updated suite, not reuse5cf CI as the new head result.

## Browser and performance evidence

Chromium153.0.8010.12; Firefox155/WebKit26.6 smoke. Linux test libraries and CJK fonts provided through process-local `LD_LIBRARY_PATH`, `FONTCONFIG_FILE` and `DIM_GATE_WEBKIT_EXECUTABLE`; no repository dependency or global configuration change. Local archive roots:

- `/tmp/dim-gate-w1-evidence/5cf495f-20260923T064215Z/results.json` plus per-command logs; `5cf495f-final-artifacts` contains HTML reports, screenshots and full test/smoke/performance/isolation outputs.
- `5cf495f-browser-summary.json`:30 browser-health attachments,21757 responses, zero pageErrors and failedRequests. Intentional denial/409 retirement classification remains governed by unchanged strict health assertions; no unexpected health error passed.
- `4ab6232-20260923T065129Z/results.json`, `4ab6232-readiness-artifacts`, `4ab6232-browser-summary.json`:3 health attachments,2070 responses, zero page/failed-request/HTTP/console errors.
-18 W1 role/theme/size screenshots plus4 readable-navigation screenshots are in fixed test-results. Lead and independent reviewer visually inspected tablet/mobile corrected navigation; axe alone was not used to assert readable groups.

Initial necessary JS (including Demo/MSW)302068gzip bytes =294.988KiB, within300KiB. Five isolated4×CPU cold loads median LCP692ms (budget2500ms);100 filtered/sorted engine reads across5000 CIs p950.5ms (150ms budget);100 persisted HTTP commands including150ms configured delay p95165.8ms (500ms budget). Benchmark metadata confirms5cf testedCommit and empty tracked diff SHA256. Budget unchanged; approximately5KiB initial-JS headroom remains.

GitHub workflow uploads browser evidence under `dim-gate-m5-<synthetic-merge-sha>` for30days; obtain actual artifact/run URL from PR33. Local paths are local-only, not cross-machine artifact storage. Source/tests/reports are SSH-saved; CI provides independently rerunnable remote evidence.

## Preserved failures and review

T-032 attempt1 found Admin scope loss, missing own-work selection and multi-grant diagnostic origin loss; attempt2 confirmed closure and found unreadable tablet groups and invalid scope retention. Attempt3 independently closes all five, including canonical failed-read/retry invariants. Reports preserve exact refs and uninvolved read-only routing; no Claude or multi-model claim.

Original7d full local gates passed but had unresolved findings, so was never accepted.03a full suite finished61passed/1failed: Aliyun Guide business flow succeeded but test reloaded then immediately navigated before SPA restoration, producing an old session404/body cleanup timeout. The failure trace/report are preserved in `03a7ee5-failed-artifacts` and T-031 attempt2.4ab adds explicit restoration assertions and passes all3 provider stories; the failure was not suppressed. Superseded PR CI runs may be cancelled by the existing concurrency rule; only final exact-head CI counts for merge.

No deployment, real cloud execution, external notifications, credentials, force push, direct main push or deleted worktree. W2–W5 remain unimplemented until their own sequential contracts, gates and merges.
