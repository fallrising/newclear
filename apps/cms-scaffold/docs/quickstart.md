# Quickstart — cms-scaffold

> Portfolio doc tier **A**. The authoritative local recipe stays in the component
> [README](../README.md) (§ 測試、§ 本機跑 API). This page is the short entry.
> Policy: [portfolio-doc-tiers.md](../../../docs/portfolio-doc-tiers.md).
> v2 status and roadmap: [docs/v2/README.md](v2/README.md).

## Prerequisites

- JDK **25** (the Gradle toolchain is pinned; 17/21 will not compile)
- Node.js 22+ and npm
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
npm test && npm run lint && npm run typecheck && npm run build
curl -fsS http://localhost:8080/actuator/health # when the API is running
```

## Known blockers

- 2026-09-24, cloud sandbox: Gradle could not resolve dependencies because Maven Central returned HTTP 429 (retried twice). The frontend checks above still ran and passed. This is an environment network limit, not a repository defect; see [v2 audit §1](v2/00-v1-frontend-audit.md#1-怎麼查的).
- v2 adds `npm run dev:mock` (the frontend runs against MSW without the API) in wave W0. It does not exist yet.
