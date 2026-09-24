# Portfolio documentation tiers

This policy governs how deep documentation may go for each component in
`fallrising/newclear`. It does **not** change investment decisions in
[PORTFOLIO.md](../PORTFOLIO.md); it only sets documentation depth.

Related: [taxonomy](taxonomy.md), templates under [templates/](templates/).

## Why tiers exist

This repository is a portfolio monorepo. Most components are dormant or
historical. Uniform quickstarts and tutorials for every directory create
rotten “looks runnable” docs. Depth must follow whether someone is expected
to run the component today.

## Tiers

| Tier | Name | README | Extra docs | Tutorials |
| --- | --- | --- | --- | --- |
| **A** | Active / invest | Full entry: status, boundary, verify links | Required: `docs/quickstart.md` (reproducible or explicitly blocked) | At most one golden-path tutorial when a real operator path exists |
| **B** | Maintain / public contract | Status + “what / not what” + links to SDD/bootstrap | Keep existing contract docs; no new tutorial series | None unless restoring to A |
| **C** | Dormant | Status page: dormant since, why kept, restore conditions, successor | Do not invent new how-tos | Forbidden |
| **D** | Retired / historical | Short status page | Preserve existing history only | Forbidden |

## Assignment authority

1. Default assignment for this program is the table in
   [PORTFOLIO.md § Documentation tiers](../PORTFOLIO.md#documentation-tiers).
2. Changing a component’s **investment** tier still requires an owner decision
   in PORTFOLIO.md. Documentation tier should follow, not lead.
3. `specs/` at the monorepo root is **not** “docs-only”. A tree with `cmd/`,
   tests, and Dockerfiles is a component (usually B or C), not material for
   root `docs/`.

## README banner

Every component README SHOULD start (after the H1) with a short portfolio
banner that names the doc tier and links here. Templates:

- [README-A](templates/README-A.md)
- [README-B](templates/README-B.md)
- [README-C](templates/README-C.md)
- [README-D](templates/README-D.md)
- [quickstart](templates/quickstart.md)

## Evidence rules for A-tier quickstarts

- Commands listed as “run locally” must either have been executed in the
  delivery evidence, or marked `skipped` with environment reason.
- Prefer linking to an existing authoritative local-dev doc over copying
  long recipes that will drift.
- Never claim production readiness from a quickstart alone.

## Root `docs/` vs component `docs/`

| Location | Holds |
| --- | --- |
| Root `docs/` | Monorepo policy: CI, taxonomy, consolidation notes, this file |
| `<component>/docs/` | That component’s SDD, runbooks, quickstart, evidence |

Do not move runnable components under root `docs/`.
