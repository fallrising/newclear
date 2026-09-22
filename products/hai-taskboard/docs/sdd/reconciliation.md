# Mini-SDD: Specification import and incremental reconciliation

Status: Accepted at G0 for P0-A
Parent: `../SDD.md` clauses HAI-AUTH-003 and HAI-RECON

## Manifest and graph

A Git candidate manifest names repository binding, immutable commit OID, schema version, stable node
IDs, node paths/digests and typed edges. Validation rejects dirty-tree sources, missing referenced
nodes, duplicate stable IDs, invalid edge kinds and cycles. Rename is stable-ID continuity; delete is
a tombstone and cannot activate while required references remain unresolved.

## Import protocol

1. Resolve approved repository/ref to an immutable commit and read bytes outside SQLite write lock.
2. Validate/canonicalize manifest and compute its digest.
3. Reuse or create a proposal keyed by repository binding, commit, manifest digest and schema.
4. Compare accepted graph `G_old` with proposal `G_new`.
5. Persist an immutable ImpactPlan; no accepted binding changes.
6. Activation rechecks graph/project version, policy and exact Approval/plan digest.
7. One transaction moves accepted heads, records applicability changes, audit and outbox work.

## Impact algorithm V1

```text
direct = nodes whose content digest, accepted binding, required AC set, recipe or incident edge changed
affected = direct
         U reverse_closure(G_old, direct)
         U reverse_closure(G_new, direct)
```

Traversal uses stable-ID lexical ordering for deterministic output. Each affected entry records all
shortest cause paths needed for explanation, capped by an explicit capacity limit that rejects the
plan instead of truncating silently. `ImpactPlanV1` binds old/new graph digests, direct set, affected
set, cause paths, algorithm version, policy revision and read-set aggregate versions.

## Reuse fingerprint

V1 reusable identity includes candidate/input digest, ordered required AC revisions, accepted graph
revision, policy, verification recipe, environment, integration base, adapter and verifier class.
Presentation path, refreshed HANDOFF text and non-normative summary bytes do not enter it. Unknown or
missing dimensions make reuse `Unknown`/not automatic, never Passing.

## Test oracles

- `TestManifest_RejectsCycleDanglingAndDuplicateIDs`
- `TestImport_CrashDoesNotChangeAcceptedGraph`
- `TestImpactPlan_UsesOldAndNewReverseClosure`
- `TestImpactPlan_DeterministicOrderAndCausePaths`
- `TestImpactActivation_RejectsStalePlan`
- `TestReuseFingerprint_RecipeEnvironmentAndBaseMatter`
- `TestDoneStale_PreservesCompletionAndBlocksDownstreamReadiness`
