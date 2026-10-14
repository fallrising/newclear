# P1 local operator contract

Status: P1a bounded offline core after independent design review. Full P1 is
partial: thin SSH executor, per-host Compose/auth runtime templates and separately
approved purge remain deferred. P2/P3 VPS operations are not executed here.
Research source and C01-C13 remain governed by SDD and the four-node plan.

## Boundary

Python 3.11 standard library only. CLI emits JSON and stable nonzero errors;
never invokes a shell, SSH or Docker. `plan` reads operator-supplied private JSON;
`fixture` subcommands operate only on a newly owned local state directory and a
synthetic backend. Do not describe fixture results as Redis/Mithril acceptance.
Fixture writes use a separate explicitly owned private state root outside source;
inventory data_root is a remote intent and is never a local write target. Raw
plan/status outputs are private operator data. A deliberate sanitized report omits
aliases, addresses, identities and paths. Errors do not echo arbitrary input.

## Inputs and plan

Use bounded UTF-8 JSON with duplicate-key and unknown-field rejection. Reject
booleans where integers are required, nonfinite numbers, symlinks and over-limit
files. Exact schema lives in the implementation/tests and documented examples.

Inventory: schema_version=1, a restrictive run_id, exactly H1-H4 once, distinct
SSH aliases (strict hostname tokens), four distinct machine identity SHA256 values, distinct tailnet
IPv4, absolute normalized owned data_root below a non-root user home and run ID,
available memory/disk, approved port matrix and observed occupied_ports, and explicit private access-policy
revision. No passwords or secret contents in JSON, stdout, plan or logs.
Resource floors: H1-H3 have >=4 GiB available RAM and >=10 GiB disk; H4 >=2 GiB RAM
and >=10 GiB disk. Never infer these facts from example data during actual use.

Runtime lock: fixed research commit, Linux amd64, fully pinned Redis image,
Mithril binary SHA256/provenance, builder pin/toolchain and independent native
verification evidence reference. Synthetic test values may exercise validation,
but checked-in production defaults must not manufacture unknown artifact IDs.

Plan binds canonical input contents, run ID, exact inventory/artifact identity,
fixed topology, candidate resource caps, data roots and an ownership label. It
contains its SHA256 computed over canonical content excluding the hash field.
Unknown artifact/access/mapping facts yield `executable=false` with specific
reasons. Runtime entry refuses drafts and altered/tampered plans. `executable`
means all *declared local prerequisites* validate, not live readiness/authorization;
set `lane=local-fixture` and `remote_execution_supported=false` on every plan.
No runtime input can enable a remote lane in P1a. Every result/evidence retains
the local-fixture lane and unsupported-remote label. On loading a plan, strictly
validate its schema and rederive topology, caps, paths, readiness and lane from
bound validated inputs. An unkeyed hash alone cannot validate changed semantics.
Require an independently supplied expected digest on fixture invocation and bind
it into initial durable state; the same run cannot silently rebind another plan.

## Local lifecycle

`fixture up`, `status`, `smoke`, `down`, `reconcile` require exact plan hash and
the same run binding. State and journal have a single process writer lock. A
new state directory must be absent/empty and an unowned/unknown preexisting scope
is refused. Writes are private, atomic, bounded and must reject symlink, hardlink
or unsafe path substitution. Exact backend IDs/labels are retained in a manifest.

Up creates six synthetic Redis roles and one proxy in staged order. Persist a
stable operation ID, action, intended exact backend ID and run/plan ownership
before each effect, including removals, and observed completion afterward. Retry/recovery never
replays an uncertain mutation. Injected crash/lost reply persists uncertainty;
reconcile only observes matching owned IDs and classifies outcome. Unknown or
foreign state is retained and blocks mutations; no overwrite/reset/prune.
Reconcile under the same lock classifies exact owned present, conclusively absent
or still unknown/foreign. Unknown blocks further mutations; a proved absent
create may be abandoned before admitting a new uniquely identified operation.
Reconciliation never repeats an effect, and repeated observation is idempotent.

Smoke verifies exact six-node/master/slot/replica placement and synthetic
cross-shard SET/GET/TTL/DEL semantics plus scoped authorization. Fixture state
persists a marker through down/up; this is simulated lifecycle evidence only.
Down stops/removes only observed objects matching exact IDs and ownership,
retains data/manifest/journal/evidence, and refuses foreign objects. There is no
purge command in P1a. A second safe up creates new process-instance IDs but reuses
retained data/node identity. It does not reinitialize markers/node identity or
silently recreate a cluster. Tests cover before-effect, lost-reply and after-ack
create/remove windows, repeated reconcile and unchanged foreign resources.

## Required behavior evidence

Tests precede implementation and show a real red command. Cover invalid/unknown
inputs, source drift, missing provenance, topology, port collisions, binding/hash
tamper, filesystem/lock hazards, foreign resources, crash/lost-reply recovery,
second-run retained marker and actual CLI subprocess behavior. Tests use owned
temporary fixtures through the common build launcher; never real aliases/hosts.

Root CI is Python 3.11, path-scoped, read-only, no secrets/network runtime or VPS
commands. Document verified artifacts separately from P2/P3 UNEXECUTED.
