# Monorepo taxonomy

How top-level directories in `newclear` are meant to be used. Descriptive, not
a rename plan.

| Path | Intent | Typical contents |
| --- | --- | --- |
| `products/` | User-facing products with their own UX | App + API + product SDD |
| `gateways/` | Protocol / multi-provider routing edges | Gateway services |
| `systems/` | Infrastructure-shaped services (queue, log, messaging, …) | Long-lived system software |
| `platform/` | Multi-tenant or operator platforms / platform tools | Control planes, compilers, OCR adapters |
| `apps/` | Desktop or scaffolded applications | Tauri/desktop/CMS kernels |
| `tools/` | Small operational utilities | Scripts, converters |
| `labs/` | Experiments, MVPs, stopped prototypes | Bounded experiments |
| `examples/` | Demos that consume published contracts | Thin demos |
| `specs/` | **Misnamed historically** — currently holds implementable public-contract components (e.g. Fleet Catalog). Treat as a component bucket, not documentation. | Go/services + schema |
| `docs/` | Monorepo-only policy and CI specs | Markdown only |
| `refs/` | Third-party reference index | Index, not first-party products |
| `.team/` | Delivery ledger | Plan / tasks / reports |

## Ambiguous edges

- **products vs platform:** If the primary promise is a multi-operator control
  plane or shared platform substrate, prefer `platform/`. If it is a single
  product experience (chat, bookmarks, social deck), prefer `products/`.
- **systems vs specs/fleet:** Fleet is a thin VPS service catalog / control
  plane with binaries. Taxonomically it belongs with `systems/` or a future
  `contracts/` bucket; path `specs/fleet` is retained for now and documented
  as a B-tier public contract component.
- **labs vs examples:** Labs may contain substantial code and live evidence;
  examples should stay thin and disposable.

## Related

- [Portfolio doc tiers](portfolio-doc-tiers.md)
- [PORTFOLIO.md](../PORTFOLIO.md)
- [Monorepo CI](specs/monorepo-ci.md)
