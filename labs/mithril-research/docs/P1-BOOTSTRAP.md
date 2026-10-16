# P1c: offline Redis bootstrap proposals

`scripts/bootstrap.py` checks six imported Redis observations and writes a
private bootstrap proposal. It binds the existing bundle, exact owned container
IDs and an independently retained Redis node-ID map. It accepts only pristine
isolated nodes or the exact already-converged initial topology. No SSH, Redis
connection, container startup, phase execution, automatic repair or data deletion
is implemented. Full P1 and MR-004 remain incomplete.

Read the [contract](P1-BOOTSTRAP-CONTRACT.md) for exact schemas and barriers.
Use [P1-TOOLS](P1-TOOLS.md) for the existing bundle/down tools and [P1-LOCAL](P1-LOCAL.md)
for the original synthetic lifecycle. Their evidence lanes remain separate.

## Inputs

Keep all inputs and generated output outside every source checkout, in owned
0700 directories and 0600 regular files with one hard link. The tool refuses
symlink components, traversal, public modes, existing output and output paths
within or containing a declared remote data root. JSON files and the serialized
proposal are limited to 1 MiB. Partial output is retained on failure.

The four input files are:

| File | Contents |
| --- | --- |
| manifest | Existing P1b manifest; independent expected bundle digest is also required. All declared artifacts must resolve, including Mithril runtime image/provenance. Declarations do not authenticate artifacts. |
| ownership | Existing P1b ownership object, restricted to exactly six Redis targets, M1/M2/M3/R1/R2/R3. No proxy or partial set. |
| node-ids | Exact object with keys M1/M2/M3/R1/R2/R3 and six distinct 40-character lowercase hexadecimal Redis node IDs. |
| observations | The complete bounded snapshot envelope below, with one direct backend record for every Redis role. |

The independently retained node map is essential: replacing all six IDs in all
six observations still fails against that map. The tool has no discovery or
trust-on-first-use mode. An operator must obtain/review the initial identity
binding within separately authorized collection work. Keep the original map
and approved document digest independently; inventing a new map/digest cannot
authorize adopting replacement nodes.

The checked-in inventory/runtime examples deliberately contain UNRESOLVED
fields and cannot produce a P1c proposal. Tests use clearly synthetic resolved
declarations. Do not copy invented test image hashes into actual inventory.

## Snapshot format

The envelope has exactly schema_version (integer 1), lane (`offline-snapshot`),
origin (`synthetic` or `operator-supplied`), snapshot_id (32 lowercase hex),
run_id, plan_sha256, bundle_sha256 and nodes. Run/digests match the manifest;
nodes is an array of exactly six records with these exact keys:

| Key | Meaning |
| --- | --- |
| host, role, container_id | Exact ownership target; full 64-character container ID |
| machine_identity_sha256 | Exact bound inventory identity |
| labels | Exact four P1b run/plan/bundle/role labels |
| container_state | Exactly running |
| cluster_nodes | Complete successful direct CLUSTER NODES payload, at most 64 KiB |
| cluster_info | Complete successful direct CLUSTER INFO payload, at most 16 KiB |
| info_keyspace | Complete successful direct INFO keyspace payload, at most 4 KiB |

These are imported assertions, including origin, container state and response
completeness. A snapshot ID is not a timestamp, signature or freshness proof.
Mithril's virtual CLUSTER output cannot establish backend topology. This module
has no collector and never invokes the existing SSH transport.

Responses use complete LF or CRLF lines and ASCII content. NODES requires
canonical IPv4 data/bus endpoints matching the bundle; nonempty announce
hostnames and nodes.conf auxiliary fields are outside this profile. Exactly
one myself row binds each observer to the independently expected node ID.
Unknown flags, failed/disconnected nodes and migration/import markers refuse.
Duplicate or overlapping slot tokens are rejected before normalization.
Equivalent row/flag/split-range order is accepted; ping/pong counters need not
agree across observers. The saved digest still binds the exact raw input.

CLUSTER INFO requires all nine topology/epoch fields. Optional numeric message
counters are restricted to the pinned version's known fields. INFO keyspace
requires its literal Keyspace header and at most one db0 record, with keys,
expires, avg_ttl and optional subexpiry. A missing/error/truncated payload is
unknown. A supplied header-only payload describes zero keys; it cannot prove
transport completion, empty storage, completed loading or later emptiness.
INFO is already allowed by the candidate backend operator ACL; runtime ACL
effectiveness remains unverified.

## Results and conditional phases

A pristine snapshot has six isolated empty masters, each knowing only itself,
no slots, state fail and zero epochs. It produces four conditional phases:

| Phase | Proposed operations | Required following observation |
| --- | --- | --- |
| set-config-epochs | M1/M2/M3/R1/R2/R3 receive 1/2/3/4/5/6 | Six still-isolated empty nodes, assigned epochs |
| meet | M1 meets each of the other five exact endpoints | Six connected empty masters, consistent identities and epochs |
| assign-slots | M1 0–5460; M2 5461–10922; M3 10923–16383 | Full unique coverage, prospective replicas still empty |
| replicate | R1 follows M1; R2 follows M2; R3 follows M3 by actual node ID | Exact final topology in all six direct views |

The target placement remains H1=M1+R3, H2=M2+R1, H3=M3+R2. Each master and its
replica are on different hosts. Fixed action objects contain typed fields,
never shell strings, arbitrary commands, credentials or executable argv.

Already-converged means every view agrees on that exact topology, full slots,
three masters and replicas, positive distinct master epochs and consistent
INFO values. Replica published epochs follow their masters. Retained nonempty
keyspace is allowed; the result has zero actions. This checks a supplied topology
snapshot only, not replica synchronization/lag, persistence, ACLs or live health.

Partial bootstrap, role failover, nonzero epochs on isolated empty nodes,
unknown/foreign identities, wrong complete slot assignments and inconsistent
views all refuse. The tool deliberately cannot resume intermediate phases.
A future executor needs fresh authenticated whole-set observations and per-effect
identity checks, phase-aware validation, exact session approval and admission,
durable intent and uncertainty handling. On lost reply, stop and reconcile;
unchanged observations cannot prove cancellation. A generated plan or its
hash satisfies none of those live requirements.

## CLI and Python API

Run from this component through the common workspace launcher. The following
are interface forms, not recorded live commands; FILE/DIR are private paths:

```text
python3 scripts/bootstrap.py plan --manifest FILE --expected-bundle-digest SHA256 --ownership FILE --node-ids FILE --observations FILE --output NEW_PRIVATE_DIR
python3 scripts/bootstrap.py validate --plan FILE --expected-bootstrap-digest SHA256
```

Generation writes only `bootstrap.json` under the exclusively new directory.
Stdout/help/errors contain sanitized JSON counts/classification/digest and
offline flags. Exit 0 means offline generation/validation; refusal exits 2.
Retain the returned bootstrap digest independently before later reload.
There is no execute-approved option or credential input.

The Python API includes three raw parsers, validate_observations,
build_bootstrap_plan, validate_bootstrap_plan and write_bootstrap_plan; exact
signatures are in the contract. Validation reconstructs all proposal semantics
from the bound original inputs. Rehashing altered action order, slot range,
replica ID, barriers, lane or unmet requirements cannot bypass that check.
A fully consistent new set of declarations can produce a different document;
an unkeyed digest does not authenticate claims or authorize any operation.

## Verification and next gates

`make check` discovers the new tests automatically. Actual Red-Green, root CLI,
Python 3.11 and independent review results are recorded in [VALIDATION](VALIDATION.md).
All P1c behavioral evidence uses synthetic snapshots and local subprocesses.
The recorded origin never upgrades offline-bootstrap results to live runtime.

Remaining work includes authenticated collection, provisioning/upload/create/up,
phase execution and uncertainty journals, verified runtime image/environment,
network/ACL and replication-health checks, two retained-data lifecycle rounds,
proxy smoke and separately approved exact purge. MR-004 remains BLOCKED_ENV;
C01–C13 and P2/P3 runtime acceptance are not established by this tool.
