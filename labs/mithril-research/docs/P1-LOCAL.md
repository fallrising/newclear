# P1a: local plan and synthetic lifecycle

This segment delivers an offline Python 3.11 standard-library core. It does not
connect SSH, start Docker/Redis/Mithril, write a VPS or establish live readiness.
The separate [P1b tools](P1-TOOLS.md) add private Compose/auth generation,
fixed SSH observation/down and purge preview. Full P1 remains partial:
startup/cluster orchestration, purge application and P2/P3 are UNEXECUTED.

## Artifact evidence

[runtime.lock.json](../runtime.lock.json) keeps the original research commit and
locks the observed Redis 7.4.11 amd64 manifest plus the built Mithril binary hash.
[Native evidence](evidence/native-build-2026-10-15.json) records exact source,
builder base manifest, derived local builder ID, versions, stage exits/log hashes
and 121 passing upstream unit tests. Release build, Clippy and format checks also
passed. Binary/native tests do not prove Redis Cluster compatibility or deployment.

The official Rust base image has the fixed compiler but lacks Clippy/rustfmt.
The local derived builder added those components to that same toolchain. Earlier
failed attempts are retained in the evidence summary. No image was published.
The runtime lock's `builder_image` is the immutable base manifest; the actual
derived local image configuration ID is recorded separately in native evidence.
Redis's registry manifest was inspected; its runtime was not started in this segment.
The older v0.1.7 release tag does not match the research commit and was not used.

## Strict private inputs

[inventory.example.json](../examples/inventory.example.json) contains synthetic
identities, aliases, addresses and paths. Its `UNRESOLVED` access policy makes a
non-executable draft. Real inventory/plan/status files are private operator data;
use a 0700 directory outside the checkout and a 077 umask. Do not publish them.

Inventory has exactly `schema_version`, `run_id`, `access_policy_revision`, `hosts`.
Every host has `role`, `ssh_alias`, `machine_identity_sha256`, `tailnet_ipv4`,
`data_root`, `available_memory_mib`, `available_disk_mib`, `approved_ports`,
`occupied_ports`. Roles are exactly H1-H4, machine/alias/IP identities are distinct,
and the port matrix is fixed by the four-node design. `data_root` describes a
remote intent, never a local fixture write destination. Current declared free
resources and occupied ports are checked; fresh live observations are deferred.

Runtime-lock fields are exactly those in the checked-in lock. Hash/identity
validation cannot authenticate arbitrary operator claims or grant deployment
permission. Every labctl fixture result is labelled `lane=local-fixture` and
`remote_execution_supported=false`; the separate transport has its own origin.

## Commands

Run from this component directory:

```sh
make check
python3 scripts/labctl.py plan --inventory examples/inventory.example.json --runtime-lock runtime.lock.json
```

The example deliberately produces a draft. The local fixture exercise copies
that synthetic inventory into a new private output scope and explicitly labels
its policy as synthetic; it does not resolve a real tailnet policy.

`make demo DEMO_OUTPUT=<new-private-directory-outside-source>` runs eight actual
CLI subprocesses through plan, up, smoke, down, a second up/smoke/down and report.
Replace the placeholder with a fresh directory under the common launcher's
`AGENT_ARTIFACTS_DIR`. It retains private receipts and a sanitized `report.json`.
The output path must not already exist or contain parent traversal/symlinks;
directory creation and private file writes use no-follow directory handles.
Acceptance requires successful smoke, an owned final observation and zero
remaining synthetic resources or uncertain operations. Nothing is automatically
cleaned up. Filesystem protection covers cooperating processes, not arbitrary
same-user mutation.

For `fixture up`, `status`, `smoke`, `down`, `reconcile`, `report`, supply a private
plan file, independently retained `--expected-digest` and a new owned
`--state-root` outside the source checkout. `report` emits the sanitized surface;
other results and plan stdout remain private. Do not redirect private output to
a public artifact. There is no purge or remote executor in P1a.

## What the fixture proves

Strict input/plan validation, semantic rederivation and independently bound digest;
private no-follow state files and a cooperating-writer lock; staged synthetic
create/remove intents; crash/lost-reply observation without blind replay; exact
ownership; retained marker/node identity through recreated process instances;
synthetic three-shard read/write/TTL/delete and denied key-prefix access.

These are local contracts. Synthetic six-node health, marker persistence and
authorization are not real Redis/Mithril health, disk durability or network ACL
acceptance. Shared-machine P0 inventory remains private and needs a fresh
preflight before any later live operation.

## Next gates

Review the separate P1b generated bundle and exact action plan; complete remaining
startup/cluster orchestration and destructive cleanup tooling. Then, within separately approved P2/P3 scope, verify effective
tailnet/host admission, actual binary/image provenance, all six backend nodes,
proxy reads/writes, retained-data restart and exact cleanup. Any missing gate
keeps MR-004 incomplete; P1a does not change the formal 4 DONE/5 unfinished count.
