# Provenance-bound knowledge synthesis implementation plan

## Scope and design

Build two independent foundations followed by one integration slice. T-018 owns
immutable notes, retrieval comparisons, and deterministic integrity reports.
T-019 owns digest-bound promotion records and independent critic/human gates.
T-020 composes the accepted APIs into a synthetic two-experience journey and
documents the local-only workflow. Runtime evidence remains under `.ice-maker/`.

## Requirement-to-evidence mapping

| Requirement | Change | Verification | Rollback |
|---|---|---|---|
| FR-1, FR-2 | retrieval and integrity scanner | graph/report unit tests | revert T-018 |
| FR-3, FR-4, FR-5 | synthesis artifacts and promotion gates | state-machine unit tests | revert T-019 |
| FR-6 | independent critic and synthetic horizontal comparison | synthesis E2E tests | revert T-020 |

## Risks and dependencies

- Fabricated provenance: every grounded conclusion must resolve to an immutable
  Phase 4 chunk identity; hypotheses are structurally distinct.
- Self-approval: builder, critic, and human identities and decisions are bound
  to the same candidate digest and validated as distinct roles.
- Order-dependent reports: normalize bounded inputs before comparison and sort
  all report records by stable identifiers.
- Evidence overclaim: fixtures carry an explicit `synthetic` marker and reports
  state that no real production evidence was used.

## Migration and rollback

No production migration. New state is versioned, local, and rebuildable. A
rollback reverts the Phase 5 code checkpoint; no lower-phase data is rewritten.

## Review gate

The orchestrator reads every diff, reruns focused and repository-wide checks,
and verifies actor separation, stale-decision rejection, order independence,
and exact citation retention before accepting the phase.
