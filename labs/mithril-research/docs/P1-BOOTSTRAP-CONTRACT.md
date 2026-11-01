# P1c offline bootstrap contract

Root-frozen revision p1c-v1, 2026-10-17. The exact D1–D5 schemas, parser limits,
classification rules and adversarial cases in [independent design T-008](../.team/reports/T-008.md)
are binding with the clarifications below. Python 3.11 standard library only.
This adds a parser/planner and private CLI; it does not extend the SSH helper,
create services, collect Redis responses, advance phases or perform mutations.
Full P1 remains incomplete and MR-004 remains BLOCKED_ENV.

## Private inputs and identity

Reuse the existing validated bundle and exact ownership schema; require exactly
M1/M2/M3/R1/R2/R3, no A or partial set. The bundle runtime declaration must be
resolved; this is a declared-input gate, not authenticated image provenance.
Expected node IDs are a separately supplied exact six-role map of unique
40-lowercase-hex IDs. Never derive this map from the snapshot being checked.
The caller independently retains the map or original reviewed bootstrap plan
and its expected digest. New consistent assertions can produce a new digest;
none supplies authority, authenticity, freshness or evidence of physical storage.

The observation envelope has exactly schema_version=1, lane=offline-snapshot,
origin=synthetic|operator-supplied, snapshot_id (32 lowercase hex), run_id,
plan_sha256, bundle_sha256 and nodes (six exact records). Each record has host,
role, container_id, machine_identity_sha256, labels, container_state=running,
cluster_nodes, cluster_info and info_keyspace. Bind identity/labels to the source
manifest and ownership, not independently asserted endpoint values. Preserve
raw responses privately. Origin is a declaration, never ssh/live verification.

JSON files/output are bounded to 1 MiB. Raw response bounds are 64 KiB NODES,
16 KiB CLUSTER INFO, 4 KiB INFO keyspace. Exact parser/type/line/slot rules are in
T-008 D1/D2, including pinned Redis 7.4.11 subexpiry and replica epoch behavior.
Header-only Keyspace is an empty supplied payload, not proof of transport
completion, loading completion, empty disk, a new run or client quiescence.

Only two classifications are admitted: pristine six isolated empty master
snapshots with all epochs zero; or already-converged exact six-node placement
with complete unique slots, cross-host replicas and matching views/epochs.
Nonempty converged data is retained and accepted as topology observation only.
All mixed, partial, failed, migrating, unknown and drifted states refuse.
Equivalent row/flag/slot ordering normalizes for semantic comparison; the plan
digest still binds the exact supplied raw observation bytes and array order.

## APIs and fixed proposal

- parse_cluster_nodes(raw), parse_cluster_info(raw), parse_info_keyspace(raw)
- validate_observations(manifest, expected_bundle_digest, ownership, expected_node_ids, observations)
- build_bootstrap_plan(manifest, expected_bundle_digest, ownership, expected_node_ids, observations)
- validate_bootstrap_plan(plan, expected_bootstrap_digest)
- write_bootstrap_plan(plan, expected_bootstrap_digest, output_path)

Malformed inputs raise fixed public-safe labctl.LabError codes. The normalized
return of validate_observations is internal; it must not become a second accepted
unvalidated public input. Public build/reload/write always validate original
inputs. Input objects must be detached and unchanged by these functions.

The proposal has exactly schema_version=1, lane=offline-bootstrap,
execution_supported=false, live_ready=false, live_runtime=UNEXECUTED,
source_manifest, ownership, expected_node_ids, observations, classification,
phases, unmet_requirements and bootstrap_sha256. The digest is canonical JSON
excluding bootstrap_sha256. Reload reconstructs every field from validated
bound inputs and compares exact canonical output. A recomputed digest cannot
change generated semantics, remove barriers or add a command/permission.

Each phase has phase_id, actions, requires_before, requires_after. The last two
are ordered arrays of fixed identifiers. Every phase requires_before starts
with these common identifiers in this order:

1. fresh-authenticated-direct-observations
2. exact-session-approval-and-phase-admission
3. durable-intent-and-uncertainty-fence
4. bound-runtime-config-network-and-storage
5. quiescent-clients-and-per-effect-identity-recheck

Append one phase-specific before identifier; requires_after contains its one
specified after identifier:

| phase_id | Before | After | Actions |
| --- | --- | --- | --- |
| set-config-epochs | pristine-isolated-empty-zero-epochs | isolated-empty-assigned-epochs | M1/M2/M3/R1/R2/R3 epochs 1/2/3/4/5/6 |
| meet | isolated-empty-assigned-epochs | six-connected-empty-masters-epoch-six | M1 meets M2/M3/R1/R2/R3 |
| assign-slots | six-connected-empty-masters-epoch-six | exact-slots-with-empty-prospective-replicas | M1 0..5460; M2 5461..10922; M3 10923..16383 |
| replicate | exact-slots-with-empty-prospective-replicas | exact-converged-topology-snapshot | R1/R2/R3 follow actual M1/M2/M3 IDs |

The action/target/peer exact keys and fully derived values are T-008 D3.
Actions count 6/5/3/3. An already-converged proposal has no phases/actions.
The before/after identifiers refer to the conditions described in T-008 D3;
these conditions are **unimplemented future live gates**, not admission receipts.
No intermediate-state validator, executor or retry interface exists. A future
executor must stop after an unknown/lost reply, not infer cancellation from
unchanged observations or blindly replay the plan.

unmet_requirements is always this exact ordered array, even when converged:

1. authenticated-live-collection-and-freshness
2. exact-session-approval-and-admission
3. phase-aware-live-validation
4. durable-journal-and-uncertainty-fencing
5. runtime-artifact-config-filesystem-network-verification
6. replication-link-health-and-lag
7. persistence-and-proxy-smoke

## Filesystem and CLI

All four JSON inputs are bounded owned 0600 regular single-link files reached
through no-follow directory handles in an owned 0700 parent. Reject traversal
and source paths for private input/output; no secret-bearing credential input
or network/SSH/runtime interface. Output is one exclusively new owned 0700
directory containing 0600 bootstrap.json, outside source and remote data-root
ancestry. Validate the complete serialized proposal and size before creating
anything. Retain partial output on failure; never overwrite/remove it.

Command forms (FILE/DIR are private placeholders):

```text
python3 scripts/bootstrap.py plan --manifest FILE --expected-bundle-digest SHA256 --ownership FILE --node-ids FILE --observations FILE --output NEW_PRIVATE_DIR
python3 scripts/bootstrap.py validate --plan FILE --expected-bootstrap-digest SHA256
```

Both interfaces are required for this slice. Emit only fixed sanitized JSON
for success/help/errors, with lane/classification/counts/digest/offline flags.
No raw values, aliases, addresses, paths, node/container IDs, machine hashes or
argparse diagnostic echoes. Exit 0 means offline generation/validation only;
refusal exits 2. There is no execute-approved option.

## Verification and evidence

Tests must precede implementation and preserve failing Red logs. D5 is the
required adversarial matrix; root reruns full tests, real offline CLI cases and
Python 3.11, then independent Astra review. Existing local-fixture/mock-ssh tests
remain unchanged and required. Snapshot origin is preserved distinctly from
offline-bootstrap validation, and every reported runtime result stays
UNEXECUTED. This contract cannot satisfy the four-node P2/P3 gates.
