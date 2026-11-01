# fe-review — cms-scaffold

Round 2 M1/M2 local gates passed:153 selected captures and51 exact final-URL/identity/loaded checks, native gates and owned cleanup. Six frontend waves are merged and VERIFIED; the inventory contains51 routes (Front18, Back15, Admin18). Targets are verified only for this R2 contract; independent review/current publication gates remain root-owned. Full Round 3, real API and PP1 acceptance remain outside this delivery.

- [DESIGN](DESIGN.md): approved M1/M2, packages/ui proposal-only and loopback CLI override.
- [PROMPT](PROMPT.md): route/fixture/identity and execution contract.
- [REVIEW](REVIEW.md): current evidence and deferred findings.
- [targets](targets.json): three apps, light preference, source-backed loaded selectors and exact final URL contracts.
- [Round 2 report](tasks/round2/report.md): actual results, retained failures and limitations.
- `verify-routes.mjs`: fresh-context loaded-page/final-URL/identity checks; 51 desktop visits without duplicate screenshots.
- `audit-captures.mjs`: 153 unique capture records, HTTP200/pageErrors0 and PNG dimensions/hash.

Use the existing shared [capture script](../../../docs/fe-review/capture.mjs) and [protocol](../../../docs/fe-review/PROTOCOL.md). Raw Round 2 captures, screenshots and browser logs stay in ignored `runs/round2-*/`; only concise safe audits are published. See the report for exact run directories and measured versions when available.
