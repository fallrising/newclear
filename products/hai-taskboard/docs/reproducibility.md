# Reproducibility contract

Status: Accepted bootstrap pins and bounded kernel/web/SQLite/application-command/Fake/HTTP-SSE
evidence; T-047 and broader G1 remain NotRun
Observed: 2026-09-09

## Toolchains and packages

| Concern | Exact P0-A selection |
| --- | --- |
| Go module/toolchain | `go 1.27`; `toolchain go1.27.1` |
| Backend image | `golang:1.27.1-bookworm@sha256:648f440f42a0958804efb24df176f806f9d353b41f1c0627f666428e40310f6b` |
| Node/pnpm | Node `24.20.0` LTS; pnpm `11.25.0` |
| Web image | `node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e` |
| React | `react@19.2.8`; `react-dom@19.2.8` |
| Build | `vite@8.2.2`; `@vitejs/plugin-react@6.1.1` |
| CSS/UI generation | `tailwindcss@4.3.3`; `@tailwindcss/vite@4.3.3`; controlled `shadcn@4.21.0` with base explicitly selected |
| Type/lint/format | `typescript@6.0.3`; `eslint@10.10.0`; `typescript-eslint@8.69.0`; `prettier@3.9.6` |
| Unit/component | `vitest@5.0.0`; `@testing-library/react@16.3.3`; exact peers resolved in the lockfile task |
| Browser/a11y | `@playwright/test@1.62.1`; `@axe-core/playwright@4.13.0` |
| E2E image | `mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e` |
| OpenAPI lint image | `redocly/cli:2.51.2@sha256:2dcc3939c2180e1da96db06a40aa079cb32c4ef3bac8b35ff061f2140322da64` |

TypeScript 6.0.3 is deliberate: the current typescript-eslint line declares support below 6.1,
while TypeScript 7's stable programmatic tooling boundary is not yet compatible. A future update is
a reviewed candidate, never silent drift.

## Lock and generation policy

- `backend/go.mod` plus `go.sum` form one module; no `go.work` without a second module.
- `web/package.json` plus `pnpm-lock.yaml` form one private frontend package; no JS workspace without
  a second package. Direct versions have no ranges and `packageManager` pins pnpm 11.25.0.
- shadcn output is committed source. Its exact command, registry/preset/base/icon choices and
  generated-file hashes are retained; CI never regenerates from a moving registry.
- OpenAPI lint disables telemetry/update checks, mounts `api/` read-only and executes the immutable
  Redocly image digest; a mutable tag or runtime package install is not acceptance evidence.
- Component scripts are the stable gate entry points. Local and root CI call the same scripts and
  mechanically compare duplicated image/tool pins.

## Root CI contract

`.github/workflows/hai-taskboard-ci.yml` is the only HAI workflow. It is path-scoped to
`products/hai-taskboard/**` plus itself, runs on PR, push to main and manual dispatch, uses read-only
contents permission, cancellation concurrency, explicit timeouts and checkout v7.0.1 pinned at
`3d3c42e5aac5ba805825da76410c181273ba90b1` with persisted credentials disabled.

Backend, frontend and E2E jobs call the component scripts in the three digest-pinned environments.
E2E depends on backend/frontend. The workflow uses no secret, release, publish, deploy or external
mutation permission.

## Gate commands

- Backend: assert version; module download/verify; gofmt check; vet; unit/contract/fault/integration
  tests; race tests.
- Web: assert Node/pnpm; frozen install; format; lint; `tsc --noEmit`; Vitest/a11y; production build.
- E2E: assert package/image equality; readiness without sleep; Playwright/axe; bounded failure
  artifacts; deterministic cleanup.

## Accepted bounded evidence

- T-024 accepts the dependency-free Go domain/reconciliation kernel after pinned Go 1.27.1 format,
  vet, unit, race, oracle inventory and authority/module checks.
- T-033 accepts the exact web lockfile and static fixture shell after pinned Node 24.20.0/pnpm
  11.25.0 frozen install, format, lint, typecheck, 8 Vitest/full jsdom-axe tests and Vite build.
- T-067 accepts T-044/T-066 application commands after pinned Go 1.27.1 module/format/vet,
  application/SQLite/full/race, real-Store completion/replay/late-rollback, executor timing, strict
  canonical OpenAPI, idempotency and completion-gate attacks.
- T-073 and T-076 accept T-045/T-069/T-075's deterministic `fake/v1` package and fenced in-memory
  worker seam after fresh lifecycle, capability, fence, uncertainty, alias, artifact, hostile-path,
  repeated/concurrent deterministic and bounded-import/API attacks. T-076 report SHA-256 is
  `14a3e6832fdad1680173d7b6c05a2cfadd5d45107e66da8d984a204d64b33aaa`; the orchestrator's
  separate pinned module/format/vet/named/repeated/full/race rerun also passed.
- T-081 accepts T-046/T-078/T-080's HTTP/SSE transport and composition seam after preserving T-077
  and T-079 as historical FAIL evidence. Fresh checks cover strict authenticated/same-origin command
  translation, immutable canonical result lookup, exact SHA-256 wire spelling, contiguous durable
  replay, OpenAPI cursor-bound SSE, revocation/epoch precedence and independent 129-event and
  1,048,577-byte overflow limits. T-081 report SHA-256 is
  `6b5aedcefe6f0e466ab05869761038f8f27768f847652a8903debe754ba4e9eb`; the orchestrator's
  separate digest-pinned, network-disabled, read-only module/format/vet/named/ten-repeat/full/race
  rerun exited 0 with SQLite race 17.587s and HTTP/SSE race 1.028s.

## Accepted persistence foundation evidence

- T-043/T-054/T-056 with T-058/T-061/T-063 repairs resolved `modernc.org/sqlite v1.58.0`, linked SQLite
  3.53.4 and passed network-disabled Go 1.27.1 module verification, format, vet, named adversarial,
  full and race tests plus license/import inventory.
- The accepted foundation covers project-scoped UnitOfWork atomicity, rollback seams, guarded Done load,
  Approval-consumption cardinality, byte-exact command-result replay, verifier-role reconstruction,
  immutable identities, controlled database paths and typed real-lock busy behavior.
- T-063 adds allocator-first canonical result storage with commit-deferred transaction-local result
  references and missing-result rollback. T-064 independently reran and attacked the combined bytes;
  report SHA-256 `bdd7bfd9522d1cc7e488823ef3e3151b9852c1f036f9b8b9c7fd37f4e984dd8e` is accepted.

## Evidence still NotRun

Playwright browser/contrast/zoom/coarse-pointer checks, Fake-to-application persistent worker
execution and T-047 vertical integration, SQLite backup/restore and disk-full/migration interruption,
full SBOM/CVE inventory,
action/image provenance, root workflow policy/path selection and TypeScript 7 migration are NotRun.
Every later vertical-slice family remains unaccepted. These gaps prevent a G1, release or
production-complete claim.

## Primary sources

Version/policy observations come from Go downloads/release history, Node release/download pages,
npm publisher metadata, Vite/Vitest/Tailwind release notes, TypeScript and typescript-eslint support
pages, shadcn Vite/changelog docs, Playwright system/Docker docs, Docker Hub official image metadata
and MCR artifact metadata. Full links and observation evidence are retained in `.team/reports/T-006.md`.
