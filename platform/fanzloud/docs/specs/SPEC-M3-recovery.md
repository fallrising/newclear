# M3 explicit original-intent reconciliation — T-0442

Authority: owner approved PROPOSAL-M3-recovery U01–07 on2026-11-02; deskPR395.
The proposal remains the fixed scope, maintenance/window limits and stopping contract.
This specification fixes wire details for CU-M3-U01–04 before production changes.
No dependency, schema, Worker, lease, lifecycle, driver or SDD changes.

## Wire and trust contract

AP GET `/api/v1/commands/{key}/tasks` selects `tasks.create`;
GET `/api/v1/commands/{key}/runs/{source}/reviews|rework` selects the exact
`runs/{source}/reviews|rework` command. Both UUIDs must be canonical. Other families
are not exposed. Session supplies operator ID. Transaction is READ ONLY; no command
admission, locking-for-update, event, audit, queue or runtime side effect.

Envelope version `fanz-command-evidence-v1`: key, route, payload_hash, request,
receipt. `receipt` is original commands.result.body, not current run projection.
AP reconstructs request from that immutable receipt (task five fields; review artifact,
candidate hash and reviewer profile; rework empty object), validates the corresponding
existing Pydantic model and recomputes SHA256 with the same sorted compact JSON/
ensure_ascii encoding as Store.command. It must equal stored payload_hash. Task/run
identity, operator-created task, command run_id and parent review/rework lineage must
match. Status must be completed and original result status202. Query and serialized
response are bounded2MiB. Missing404, pending/inconsistent409, malformed422; no leak of
SQL, raw driver exceptions or secret settings. Same key under another owner is absent.

Fanz POST `/api/v1/submissions/{key}/reconcile` accepts only `{}` after session/CSRF
checks; no browser-supplied request/receipt/run accepted. Exact local owner/key lookup
must not depend on bounded history pagination. Unknown may request AP evidence;
confirmed returns the saved receipt, rejected refuses. Request and route come only
from immutable local intent. AP hash verification is performed by AP's existing
hashlib authority; Rust verifies envelope version/key/route/digest shape and exact
request equality, then delegates complete receipt/lineage binding to store.confirm.
It does not trust a browser hash or add a second hashing implementation/dependency.

Ordinary task inputs are already canonical UUID/base fields. For task title/goal,
only exact equality between the saved request and AP-normalized request is accepted.
Whitespace-normalized historical inputs that differ remain unknown, as already
required by receipt validation. Unicode and key-order variations in JSON are supported
as parsed-value equality; escaping is evaluated only by the existing AP hash encoder.
There are no review defaults; rework normalizes to `{}`. Unsupported representations
are not silently rewritten. No arbitrary unknown abandonment or resubmission.

Local confirmation remains atomic/idempotent and keeps original key/request. AP GET
and local commit are not atomic: failure before commit retains unknown; explicit
reconcile may repeat only the GET. Failure after commit reopens the same saved receipt.
Concurrent actions cannot rebind a run; other unknown intents still block new work.
Reconciliation status200 means submission was confirmed, not coding succeeded.

## Browser

Each saved unknown row has an explicit reconcile button. No automatic reconcile on
load/refresh/reconnect. Disable its action while pending; keep submission and handoff
locked until a fresh durable list confirms global state. Late responses after logout
or newer recovery must not replace the user's selected run or clear unrelated local
uncertainty. Failed reads/expired auth retain the lock and show a bounded reason.
A browser-only unknown with no durable matching key is never cleared by guessing.

## Test skeletons and evidence

U01 AP exact receipt, authentication/foreign owner and zero table changes;
U02 unknown/missing/pending/hash/route/run/lineage corruption and size failures;
U03 task Unicode/key order, review, rework; noncanonical normalization stays locked;
U04 native store concurrent confirmation/reopen and Rust lost/malformed GET/retry;
U05 browser explicit-only action, fresh list unlock, failure/logout/stale safeguards;
U06 original private DB/SQLite current evidence plus restart and zero command growth;
U07 reviewed-source journey and separate owner confirmation. U06/U07 must be actual.
Named tests are added before implementation; initial missing-route failures retained.

Archetypes: security session/CSRF plus exact owner/key; atomicity SQLite transaction;
retry explicit GET only; recovery same durable records; cancellation stays AP-owned;
concurrency immutable request/unique run; errors redacted; compatibility additive routes
and existing stores; limits2MiB evidence/64KiB original intent/10s transport. Proposal
windows apply; no window starts until source checks and preflight are ready.
