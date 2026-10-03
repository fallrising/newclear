# Quickstart — dim-gate

> Portfolio doc tier **A**. Authoritative demo ops:
> [DEMO-GUIDE.md](DEMO-GUIDE.md) and status in [STATUS.md](STATUS.md).
> Policy: [portfolio-doc-tiers.md](../../../docs/portfolio-doc-tiers.md).

## Prerequisites

- Node **24.18.0**, pnpm **11.18.0**
- Run from `platform/dim-gate`
- Demo mode only — no live cloud credentials

## Minimal path

```sh
cd platform/dim-gate
pnpm install --frozen-lockfile
pnpm dev --mode demo
```

Open `http://127.0.0.1:5173/dim-gate/`.

Production-style demo preview:

```sh
pnpm build --mode demo
pnpm preview --port 4173
```

Open `http://127.0.0.1:4173/dim-gate/`.

## Verify

```sh
cd platform/dim-gate
pnpm test
# browser / Chromium journeys when Playwright browsers are installed:
# pnpm exec playwright test
```

Skip Playwright if browsers are not installed; record as environment skip.

## Authoritative longer docs

- [README](../README.md)
- [DEMO-GUIDE.md](DEMO-GUIDE.md)
- [STATUS.md](STATUS.md)
- [SDD tree](sdd/)
