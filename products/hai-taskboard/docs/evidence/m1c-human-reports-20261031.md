# M1c human reports — review and verification

Status: plan accepted; implementation/gates pending. [Plan](../plans/m1c-human-reports-20261031.md),
[BOARD](../tasks/BOARD.md#t-0339--m1c-sealed-human-reports). Source9e536de1dc1a532c8e3d78355e770bc757e190da.
Desk T-0339 continuation PR334 merged; Session/provider proposals do not change current Fake-only authority.

## Plan review

Claude Code2.1.312, requested and observed claude-opus-5-5/high, installed safe-mode/no tools/MCP/
session persistence. Host process-group deadline480s per call, one revision follow-up; no denied tools,
spawned agents, authentication/config changes or fallback. Reviews inspected supplied public sources.

| Finding | Disposition |
| --- | --- |
| B1 human authorization | Exact independent human rule/nonzero environment/recipe and prohibited actor/role guards before Put and final commit. |
| B2 exact text | Original concern assumed JSONv1; actual pinned JSONv2 rejects raw-invalid UTF-8 and lone surrogates. Explicit NUL rejection plus actual HTTP tests required. |
| B3 failure replay | Preflight/external-I/O failures unrecorded; final execute decisions use existing recordableFailure; late mutations roll back all rows. |
| B4 immutable capacity | Metadata-only prospective collection/object/50MiB admission mirrors completion sets, checked before Put and commit; Done predicates unchanged. |

Original REWORK retained, revised ACCEPT with no blocker. Six optional points addressed: deliberate
immutable MIME conflict, semantic-ID collisions, per-operation result fields/phases, exclusive FKs,
Evidence column mapping and fixture-compatible projection refresh. Final reviewer conditions are
part of worker acceptance, not claims of completed implementation.

## Observed checks and accounting

- Root pure standard-library probe on pinned Go1.27: raw invalid UTF-8/high surrogate/low surrogate
  rejected; valid pair decoded exactly; NUL accepted by JSON and therefore requires explicit content check.
- Initial `go doc` inside the module attempted unavailable offline transitive metadata; moved the same
  standard-library check outside the module. No dependency, network or product-source change.
- Native audit inspected source only; compiling implementation Red reports unsupported command400
  versus expected capability503 and missing human_reports table. No production behavior existed then.
- Final implementation, code review, backend/web/API/docs gates and PR CI will be recorded below.

Two observed plan subprocesses:91.818s and59.343s, exit0, one reported turn each, no tools/denials/children.
Provider-reported list-price estimates0.3542778 and0.238677USD are not actual bills. Original JSON
retains exact per-call token/cache telemetry; aggregate orchestrator/nested/provider calls, actual
billing and precise active/wait remain unknown/null. One native agent performed the audit and then
received a separate bounded implementation assignment; no recursive delegation.

No browser, real provider adapter, UI, M2, release or deployment acceptance is claimed.
