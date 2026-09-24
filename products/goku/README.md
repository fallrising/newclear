# Goku

> **Portfolio doc tier: C (dormant)** — Preserved bookmark product; not an
> active investment.
> **Dormant since:** 2026-09-04.
> Restore only with an explicit owner decision in
> [PORTFOLIO.md](../../PORTFOLIO.md).
> Policy: [docs/portfolio-doc-tiers.md](../../docs/portfolio-doc-tiers.md).

Bookmark ingestion and management: CLI, HTTP API, MQTT consumer, and Web UI.
Originally separate repositories; now colocated under `products/goku/`.

| Subdir | Role |
| --- | --- |
| [`api/`](api/) | Bookmark CRUD API |
| [`cli/`](cli/) | Bookmark CLI (import/export, crawl helpers) |
| [`consumer/`](consumer/) | MQTT consumer → API batches |
| [`web/`](web/) | Web UI |

## Why kept

Historical portfolio product with working Go tests at last inventory; retained
as source, not as an active roadmap item.

## Restore conditions

- Confirmed weekly operator/user for the bookmark workflow
- Explicit PORTFOLIO.md promotion from dormant

## Canonical successor

None. Knowledge / reading workflows should not compete with the Ice Maker +
Knowledge Base line without an owner override.

## Subcomponent docs

See each subdirectory README for build notes. No monorepo-level quickstart is
provided while the component remains tier C.
