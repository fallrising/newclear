# Quickstart — cms-scaffold

> Portfolio doc tier **A**. The authoritative local recipe stays in the component
> [README](../README.md) (§ 測試、§ 本機跑 API). This page is the short entry.
> Policy: [portfolio-doc-tiers.md](../../../../docs/portfolio-doc-tiers.md).
> v2 status and roadmap: [docs/v2/README.md](v2/README.md).

## Prerequisites

- JDK **25** (the Gradle toolchain is pinned; 17/21 will not compile)
- Node.js 24 and npm (matching CI)
- For running the API: PostgreSQL 16 on `localhost:5432` (database, user and password default to `cms`), or Docker Compose
- Run everything from `apps/cms-scaffold`

## Minimal path (local)

```sh
cd apps/cms-scaffold
./gradlew :services:cms-api:bootRun            # API on :8080
# other terminal:
npm ci
npm run dev -w @cms/web-front                  # :5173
npm run dev -w @cms/web-back                   # :5174
npm run dev -w @cms/web-admin                  # :5175
```

Seed passwords never go into Git. If none of `CMS_SEED_PASSWORD_<USERNAME>` or `CMS_SEED_PASSWORD` is set, the API writes them to the gitignored `local/seed-passwords.txt` on first start.

With Docker instead of a local PostgreSQL:

```sh
docker compose -f compose.yaml up --wait --build
```

## Verify

```sh
./gradlew test                                  # no Docker, no running PostgreSQL
./gradlew integrationTest                       # Docker + PostgreSQL 16 Testcontainers
npm test && npm run lint && npm run typecheck && npm run build
npm run test:bundle && npm run e2e:mock
curl -fsS http://localhost:8080/actuator/health # when the API is running
```

## Known blockers

- 2026-09-24, cloud sandbox: Gradle could not resolve dependencies because Maven Central returned HTTP 429 (retried twice). The frontend checks above still ran and passed. This is an environment network limit, not a repository defect; see [v2 audit §1](v2/00-v1-frontend-audit.md#1-怎麼查的).
- W0 is implemented: `npm run dev:mock -w @cms/web-back` starts the mock-backed UI without Java/PostgreSQL. Browser verification requires `npx playwright install chromium`. Mock UI checks do not establish real API integration.
- See [personal-use readiness](v2/03-personal-use-readiness.md) for current limits. Preserve data volumes during upgrades; never use `down -v` on data you intend to keep.
