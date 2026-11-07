# Policy delivery CI follow-up — 2026-10-31

Task T-0339 / HMPOL. Primary feature #868 is merged and verified. BOARD closure #880 exposed an
existing frontend fixture failure in job124630916024 / run41233011735: local-session-browser.spec.tsx:82
expected DELETE at fetch call index3, observed GET. All30 web cases passed on both prior primary heads;
this failure is retained and is not treated as a passing rerun.

## Bounded correction and acceptance

The first session test both queues mock responses by call position and identifies logout by position.
ConnectedApp starts the project-list read from an authenticated effect; request order against a later
logout is not a behavior contract. The CI log does not expose the complete request sequence, so the
exact scheduler interleaving remains unknown. A valid explicit Refresh projects read will provide a
deterministic reproducer for the same positional assertion failure.

Scope: only that frontend test fixture/assertions plus this evidence, task/report records and BOARD
closeout. No production component, API, dependency, CI configuration or product policy changes.
Root owns implementation; one existing native leaf may independently review this separate test-only
correction for at most5minutes, no children/model/Git authority. Root checkpoint estimate remains
within the original120–150minute active estimate; exact active/wait remains unknown.

CI-FIX-01: with an additional valid project refresh, login still clears the secret immediately,
POST uses the exact session endpoint/same-origin credentials, and exactly one DELETE targets the
session endpoint with same-origin credentials; wait for the actual logged-out message and cleared
secret. Route mock responses by URL and HTTP method, reject unexpected routes, and do not assert
request ordinals. Preserve a deterministic Red with the old ordinal assertion, then normal focused
and full pinned web format/lint/tests/type/build Green, independent diff review and final PR CI.
No retry-to-green, timeout increase, weaker logout check or new product behavior is accepted.

## Observed results

- Original GitHub run41233011735 web job124630916024: 29 passed,1 failed; index3 was GET.
- Deterministic Red: `pnpm exec vitest run src/local-session-browser.spec.tsx -t 'inspects cookie session'`, exit1 in2.501s. The extra valid refresh reproduced expected DELETE/received GET while successful logout was already visible.
- First semantic assertion attempt: focused file exit1 in4.510s, because root wrote `secret` instead of the existing API `token` field. This was a test-author error; OpenAPI and client confirmed the existing contract, and only the expectation was corrected.
- Corrected focused file: same Vitest file command without `-t`, exit0 in2.611s,9/9 cases.
- Initial full `bash ../scripts/check-web.sh`: exit1 in2.547s at Prettier; formatting corrected with repository-native `pnpm exec prettier --write src/local-session-browser.spec.tsx`.
- Final full `bash ../scripts/check-web.sh`: exit0 in12.996s; existing frozen lockfile install, pin check, format, lint,30 tests/9 files, TypeScript and Vite build all pass. No production source changed. Existing jsdom canvas advisory does not establish browser acceptance; no browser run claimed.

Commands ran in existing pinned `fe-review-hai-web:20261024`, offline/read-only root with a writable web mount and shared pnpm cache, each timeout300s. Exact argv, output, exit, timing and test SHA are retained under the persistent backup `ci-repair` evidence. The deterministic Red source is retained separately. Final formatted test SHA-256 is `65e6ebff3ea5f6748cd646a80a58490dc46e3f140085285bc97f041386e73221`; the final full gate confirms it was unchanged throughout.

Independent T004 source review and root evidence acceptance are recorded in the task/report and shared plan. New final-head PR CI and normal merge/readback remain delivery conditions; this receipt records local acceptance, not a successful rerun of the failed original head. The primary policy implementation and its reviewed backend tree remain unchanged.
