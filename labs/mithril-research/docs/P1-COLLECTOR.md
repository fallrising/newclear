# P1d: six-node read-only collector

`scripts/collector.py` collects CLUSTER NODES, CLUSTER INFO and INFO keyspace
from the six independently bound Redis roles. Its fixed SSH helper checks host
and container identity before and after one authenticated direct connection.
This is a develop-only tool verified with mocks. Actual SSH, Docker and Redis
collection remains UNEXECUTED; full P1 and MR-004 are incomplete.

The exact schemas, limits and APIs are in [P1-COLLECTOR-CONTRACT](P1-COLLECTOR-CONTRACT.md)
and [design T-011](../.team/reports/T-011.md). Existing
[P1c bootstrap](P1-BOOTSTRAP.md), [P1b tools](P1-TOOLS.md) and
[P1a synthetic lifecycle](P1-LOCAL.md) keep their separate contracts.

## Inputs and read boundary

Supply a validated bundle manifest and independently retained bundle digest,
exact ownership for M1/M2/M3/R1/R2/R3, an independently retained six-role node-ID
map, the existing five-credential input and the reduced SSH transport mapping.
The resolved runtime declaration is retained as an input gate; it does not
prove installed image provenance. Do not discover or adopt IDs from the new
responses. Endpoints come from the manifest, and full container IDs come from
ownership. H4/proxy responses cannot substitute for direct backend observations.

All input files stay outside source, owned by the current user, mode 0600 with
one link and a 0700 parent; symlinks and traversal are refused. The credential
file retains its 64 KiB limit. Only the backend_operator password is sent to
each helper, through SSH stdin and RESP AUTH bytes. No password is put in argv,
environment, remote shell text, result documents, public output or hashes.
Do not record secret-bearing requests or AUTH wire frames as receipts.

The helper has a fixed command surface: inspect the exact running container,
connect to the derived IPv4/data port, authenticate as backend_operator, query
the three fixed commands and inspect identity again. It does not start/stop
containers, execute inside containers, create files remotely, upload credentials,
change configuration, follow redirects or invoke arbitrary commands.
Pre/post machine hashes, full container IDs, labels and StartedAt/Pid must match.
The same connection must return the independently bound myself node ID.

## Complete and partial results

Each node is attempted once. A complete node requires successful authentication,
three fully length-framed RESP2 bulk replies, write-half-close followed by EOF
without trailing bytes, unchanged pre/post identity, and strict raw parsers.
Fragmentation is supported; truncation, errors, extra frames, timeouts, lost
replies, malformed input or identity drift produce unknown with no retained
partial payload for that node. Other exact targets are still attempted.

The collection contains six ordered entries and is complete only if all six
are complete; otherwise it is partial and preserves successful records.
Complete means response acquisition and binding checks passed. It does not
mean healthy, empty, fresh, atomic across six nodes, phase-admitted or authorized.
Header-only Keyspace describes the acquired payload, not physical disk emptiness,
completed loading or client quiescence. No retry or cancellation inference exists.
The collector never reads or clears mutation uncertainty journals.

Raw payload caps are 64 KiB NODES, 16 KiB CLUSTER INFO and 4 KiB keyspace.
Each helper/SSH output stream is bounded at 512 KiB while running; Docker
streams at 64 KiB. Serialized collection output is bounded at 2 MiB.
The helper's single 20-second monotonic deadline covers all operations, including
fragmented reads and final EOF. Transport configuration supplies a strict
1–60 second per-node SSH deadline. Killing local SSH cannot prove remote work
has ended. Half-close compatibility still needs separately authorized runtime
verification against the pinned Redis environment.

## Private CLI and API

This is an interface form for future separately authorized read-only collection,
not a recorded live invocation. FILE/DIR are private placeholders. Run from the
component directory through the shared workspace launcher:

```text
python3 scripts/collector.py collect --manifest FILE --expected-bundle-digest SHA256 --ownership FILE --node-ids FILE --credentials FILE --transport-config FILE --output NEW_PRIVATE_DIR --execute-approved
```

The switch records intent; exact session authorization must already exist.
There is no mock/command/helper override on the CLI. Development success tests
use Python dependency injection, labelled mock-ssh, and never contact a host.
An injected helper dependency always marks mock origin; mock transport rejects
responses claiming ssh.

Output is an exclusively new private directory containing only collection.json.
Existing output is never overwritten or cleaned. Partial acquisition is also
saved: complete exits 0, partial exits 2, refusal exits 2. Stdout contains only
lane/origin/status/counts and unsupported-execution/readiness flags; raw identities,
addresses, paths and payloads remain private. Partial filesystem output is
retained after a write failure. File safeguards assume cooperating users, not
protection against arbitrary malicious same-UID modification.

Python APIs are Transport, collect, validate_collection and write_collection;
exact signatures and shapes are fixed in T-011. Validation binds the original
raw data against independently supplied manifest/ownership/node IDs and rechecks
before output creation. Imported collection JSON is still an assertion, not a
signed receipt or proof that the helper actually ran.

## Bootstrap and remaining gates

The new redis-collection schema deliberately differs from P1c offline-snapshot.
There is no automatic conversion or bootstrap-plan generation. Parser-valid
intermediate observations can be collected, while P1c still refuses those states
and accepts only pristine or exact already-converged snapshots. A complete
collection is not an instruction to resume bootstrap.

Separate phase-aware validation was evaluated in T-011 D6 and deferred. A future
pure validator needs explicit exact barrier predicates for pristine, assigned
epochs, fully met empty masters, exact slots with empty prospective replicas,
and final topology. It must preserve P1c unchanged. Even those predicates would
not advance phases, admit effects, clear uncertainty or prove freshness.

A future executor additionally needs fresh observations before/after phases,
per-effect identity checks, independent exact operation approval and durable
uncertainty fencing. Remaining live gates include process-to-endpoint and image/
configuration provenance, effective host/network/ACL checks, loading/quiescence,
replication health/lag, retained-data lifecycle, proxy smoke and independently
approved exact purge. Pre/post Docker inspection plus node IDs cannot prove
that the TCP peer's process belongs to that container or rule out unobserved ABA.
Results keep live_ready=false, phase_execution_supported=false and
live_runtime=UNEXECUTED. Actual test evidence is recorded in [VALIDATION](VALIDATION.md).
