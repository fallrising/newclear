# Reproducibility contract

Status: Accepted bootstrap pins; bounded kernel/web evidence exists; SQLite evidence is Candidate
pending T-062; broader G1 remains NotRun
Observed: 2026-09-05

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

## Persistence candidate evidence

- T-043/T-054/T-056 with T-058/T-061 repairs resolved `modernc.org/sqlite v1.58.0`, linked SQLite
  3.53.4 and passed network-disabled Go 1.27.1 module verification, format, vet, named adversarial,
  full and race tests plus license/import inventory.
- The candidate covers project-scoped UnitOfWork atomicity, rollback seams, guarded Done load,
  Approval-consumption cardinality, byte-exact command-result replay, verifier-role reconstruction,
  immutable identities, controlled database paths and typed real-lock busy behavior.
- These are worker reports, not acceptance. T-062 must independently rerun and attack the final
  combined bytes before this section can move to accepted evidence or unlock T-044.

## Evidence still NotRun

Playwright browser/contrast/zoom/coarse-pointer checks, application-command integration, the Fake
vertical slice, SQLite backup/restore and disk-full/migration interruption, full SBOM/CVE inventory,
action/image provenance, root workflow policy/path selection and TypeScript 7 migration are NotRun.
The executed SQLite worker evidence is still unaccepted pending T-062. These gaps prevent a G1,
release or production-complete claim.

## Primary sources

Version/policy observations come from Go downloads/release history, Node release/download pages,
npm publisher metadata, Vite/Vitest/Tailwind release notes, TypeScript and typescript-eslint support
pages, shadcn Vite/changelog docs, Playwright system/Docker docs, Docker Hub official image metadata
and MCR artifact metadata. Full links and observation evidence are retained in `.team/reports/T-006.md`.
