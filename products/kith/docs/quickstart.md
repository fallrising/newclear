# Quickstart — kith

> Portfolio doc tier **A**. Authoritative local recipe stays in the component
> [README § 本機 Wrangler 開發](../README.md). This page is the short entry.
> Policy: [portfolio-doc-tiers.md](../../../docs/portfolio-doc-tiers.md).

## Prerequisites

- Node.js (see `package.json` engines if present)
- Cloudflare Wrangler for Worker local/dev
- Run from `products/kith`

## Minimal path (local)

```sh
cd products/kith
npm install
npm run db:migrate:local
npm run db:bootstrap:local    # prints owner/guest passwords into gitignored .dev.accounts
npm run dev                   # Worker (default :8787)
# other terminal:
npm run dev:frontend          # Vite :5173
```

Open `http://127.0.0.1:5173`. Hosted demo (when deployed):
<https://kith.fallrising.workers.dev>.

## Verify

```sh
cd products/kith
npm test
# optional live checklist when credentials exist:
# npm run check:live
```

`check:live` needs operator-side Cloudflare access; skip if unavailable.

## Authoritative longer docs

- [README](../README.md)
- [SDD.md](../SDD.md)
- [docs/sdd/](sdd/)
- v2 proposals (not implemented): [docs/v2](v2/README.md)
