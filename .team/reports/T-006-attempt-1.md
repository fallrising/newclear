STATUS: DONE

## Summary

T-006 attempt 1 established behavior-preserving M1 architecture boundaries at implementation and tested commit `49e1b89754421cf0e2f76026416a1af184ceab94` (short `49e1b89`), based on main `50294b687d06f08e94290f6f327187e8f69248bc`. No M1 business behavior or seed expansion was introduced.

The application now has separate session/provider, shell, center-layout and route-registry modules; foundation and CMDB features export public indexes. API transport/identity/error/query-key core is separate from feature clients. Endpoint declarations are registered by core/session, CMDB/application/environment, topology/relation/search and future modules into one registry; the generated OpenAPI is byte-identical to the baseline. Demo HTTP transport composes core-session and domain handlers; core personas are a separate seed module. Shared domain queue, policy, integrity, persistence and audit were not moved or duplicated.

The first focused run found three App tests rejected by an action check that was stricter than M0. The correction retains `requiredAction` as route metadata while the M0 center layout continues to use evaluated `session.centers`; all seven focused tests then passed. No second SPA, workspace or microfrontend was added.

## Verification

Executed from `platform/dim-gate` against commit `49e1b89754421cf0e2f76026416a1af184ceab94` with Node 24.18.0 and pnpm 11.18.0:

- `pnpm install --frozen-lockfile` — passed; lockfile unchanged.
- `pnpm lint` — passed.
- `pnpm typecheck` — passed.
- `pnpm test` — 82 tests in 6 files passed.
- `pnpm check:docs` — 42 Markdown files and 123 repository links passed.
- `pnpm check:contracts` — 72 operations, 165 schemas and all local references passed; `docs/openapi.json` has no diff.
- `pnpm check:ci` — workflow scope, pins, authority and native gates passed.
- `pnpm check:architecture` — feature public-boundary check passed.
- `pnpm build --mode demo` — passed; output JS gzip 325.98 kB (the existing future M5 budget risk remains).
- `pnpm test:e2e` — 7 production Chromium tests passed, covering M0 center guards, persistence/reset/reload/copied-tab behavior, 1440/768/390 layouts, light/dark axe serious/critical, keyboard/focus/dialog behavior, `/dim-gate/` refresh and corrupt persistence recovery.
- actionlint v1.7.12 — passed for `.github/workflows/dim-gate-ci.yml`; official linux-amd64 archive SHA-256 matched `8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8`.
- `git diff --check HEAD^..HEAD` — passed.

The container lacked `libasound.so.2` and sudo. Browser evidence used the official Ubuntu `libasound2t64` package extracted only under `/tmp` via `LD_LIBRARY_PATH`; no system installation or repository dependency was added.

## Risks and follow-up

T-006 is accepted as the M1 prerequisite and the new M0 regression evidence is valid for this commit. Any subsequent domain/schema/seed/client/UI change invalidates the corresponding portion and requires the final full M1 integration run. M1 AC-04–08 and AC-20 remain unimplemented at this checkpoint. Next: fix the M1 integration contract and bounded task scopes, then implement shared contracts/seed before parallel feature slices.
