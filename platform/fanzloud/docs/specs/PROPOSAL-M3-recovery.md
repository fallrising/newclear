# M3 original-installation recovery and final journey — T-0442

Status: **approved by owner2026-11-02 (“批准。”), claim deskPR395 merged**.
The original proposal wording below records the approved scope; no window has started.
This is a bounded continuation of SDD §§3,5–6 / FN04,FN07, not a fourth milestone
or a change to the accepted SDD. T-0447/T-0449 remain dependencies, not blanket
authority to extend AP. Owner requested investigation and independent work on
2026-11-02. See [current evidence](../acceptance/M3-recovery-readiness.md).

## Outcome and smallest implementation

The original installation must be able to bind its unresolved local intent to the
existing AP command's exact receipt through an authenticated operator action. It
must never submit again to discover the outcome. New-installation success cannot
stand in for this recovery. Only positive, exact matches can unlock admission;
absence, ambiguity or error stays unknown. This intentionally does not implement
abandon, automatic retry, arbitrary in-flight reasoning resume or a new scheduler.

The required AP extension is one authenticated read-only command lookup, backed by
the existing `commands` table. No migration, queue, Worker, lease, runtime, provider
driver or resource-limit change is proposed. Fanzloud adds explicit reconciliation
and confirmation using its existing durable store and Web, with no raw DB editing.

## Proposed contract units (not yet executable acceptance)

- CU-M3-U01 / AP evidence: authenticated GET lookup by canonical client UUID and
  allowlisted operation identity (`tasks.create`, the exact source-run review route,
  or the exact source-run rework route). Derive operator ID from the AP session;
  never accept it from the caller. Query exact operator/route/key, without invoking
  `Store.command`, a command handler, dispatch or any mutation. A completed row
  returns its original immutable receipt, key, route and payload fingerprint.
  Do not substitute the latest run projection for the original receipt. Missing,
  incomplete, conflicting or malformed evidence cannot authorize a local transition.
  Bound request/response sizes and reject all other command families. No passwords,
  cookies, arbitrary SQL or database connection settings enter this interface.
- CU-M3-U02 / explicit local confirmation: an authenticated, CSRF-protected Web
  action addresses the saved local key; the server derives route/body from that
  record. It performs only the new AP GET, checks identity, AP-normalized payload
  fingerprint and complete receipt binding, then uses the existing transactional
  `SubmissionStore::confirm`. The browser cannot supply an arbitrary receipt/run.
  Define shared canonicalization against AP `model_dump(mode="json")` plus sorted,
  compact JSON with Python's current Unicode escaping; test Unicode, key order and
  review/rework defaults explicitly rather than hashing a Rust serialization by
  assumption. A mismatch or unsupported historical representation stays unknown.
  Keep the original key/request; never delete, reject or reset the intent to unlock.
- CU-M3-U03 / atomicity and retry: the AP GET and local commit are not one transaction.
  Crash before local commit retains unknown; an explicit repeated reconciliation
  may repeat the GET and idempotently confirm the identical receipt. Crash after
  commit reopens the saved confirmation. Concurrent action must not bind a second
  run, and unrelated unknown rows continue blocking new work. No startup, polling,
  refresh, reconnect or failed response issues task/review/rework POSTs. Recovery
  of a cancelled run records confirmation of submission, never successful coding.
- CU-M3-U04 / original installation: use the same original private SQLite file and
  retained AP database, preserving immutable archives and pre-change backups.
  Verify current command evidence afresh, not solely the historical audit. Confirm
  exactly the original unknown row; assert unchanged key/request, same AP run,
  zero new command/run/job/agent counts and unchanged retained writer/review bytes.
  Restart Rust/AP and open a fresh browser; the lock is cleared only by committed
  positive evidence and the run remains cancelled/not_allocated. A missing match
  is a stop, not permission to repair data or submit a probe.

## Fixed verification scenarios

| ID | Given / When / Then | Required evidence |
| --- | --- | --- |
| U01 | completed command / exact authorized lookup / immutable receipt, zero writes | AP native DB/API test; unauthorized and foreign-operator denial |
| U02 | absent/pending/wrong route/key/hash/owner or malformed receipt / lookup/confirm / unknown retained | AP and Rust fault/contract tests; zero dispatch assertions |
| U03 | ordinary task, Unicode input, review and rework / canonical match / exact intent lineage only | cross-language fingerprint vectors and existing store tests |
| U04 | concurrent confirmation or crash before/after commit / restart / at most one run binding, no resend | SQLite transaction and real Rust transport tests |
| U05 | fresh browser, expired session, bad CSRF, unrelated unknown / explicit action or refresh / safe lock state | Web tests; explicit action cannot accept browser-supplied receipt |
| U06 | original retained installation / positive reconciliation and Rust/AP restart / same cancelled run and archives, zero coding/VM | current-source private browser/DB evidence, before/after counts and snapshots |
| U07 | same reviewed source and original recovered installation / owner journey / select agent, submit, progress, diff/checks, cross-vendor review, reopen | bounded live journey and separate owner confirmation |

Before implementation, turn U01–05 into named test skeletons and capture a meaningful
RED for missing lookup and recovery action. Run scoped AP/Rust/Web tests, native
format/lint/build and required hosted CI once per changed source. Independent review
must map U01–07 separately; native tests cannot pass U06/U07. Existing M1/M2 live
receipts remain accepted and are not repeated. FN04 does not require arbitrary
model continuation: retained AP snapshots have a bounded observation cursor and
must not be described as a complete event/tool transcript.

## Private DB credential incident and bounded maintenance proposal

The previous review exposed a private PostgreSQL credential in a tool transcript.
No Git/artifact leak or external use was observed; broader transcript access is
unknown. The original and reviewer acceptance configuration refer to the same
retained DB container and password; their endpoint port snapshots differ. The
container is stopped, restart policy is disabled and published bindings are loopback.
Its initialization environment also retains the old password. Never print it.

The existing AP CLI/runbooks provide bootstrap and offline backup/restore, but no
DB-role password rotation command. Bootstrap changes the operator login, not the
PostgreSQL credential; it must not be used here. Use the existing private database
administration channel only after approval, in one maintenance window <=20 minutes:

1. Keep API, workers, Connector/runtime and browser stopped. Check only the known
   container/config references; establish a finite consumer allowlist and fail if
   any active consumer cannot be accounted for. Preserve the DB volume, original
   SQLite and exact private config copies/hashes; verify a current-schema backup.
   AP native backup has an exact catalog gate: a stale fingerprint is a stop, never
   bypassed. Roles and credentials are outside its bundle and need private handling.
2. Start only the retained loopback PostgreSQL. Preserve a private rollback receipt
   for this single role and stage a fresh random password in private0600 files.
   Apply only that role's password through the existing local administration channel,
   without placing the value in argv, logs or tool output. Atomically update the
   two identified runtime config references; keep inactive historical evidence intact.
3. Verify a fresh password-authenticated connection succeeds and the old password
   fails against the actual mapped TCP endpoint; local socket trust is not a test.
   Verify unchanged DB/run/archive identities and stop PostgreSQL. Container seed
   environment will contain a revoked old value, explicitly recorded as stale;
   do not recreate/delete the container or volume as part of rotation.
4. On failure, keep all product services stopped. Prefer restoring coherent config
   to the new credential through local administration; if rollback is necessary,
   restore only this role/config set, record that the exposure remains unresolved,
   and stop. Never reset data, other credentials, authentication policy or ownership.

No rotation is performed by this proposal. Private execution scripts must suppress
raw driver/subprocess errors and prove redacted failure output before use.

## One requested approval, with separate finite phases

Approval would cover the above narrow AP read contract plus Fanzloud recovery,
the single-role maintenance procedure, U06 zero-worker validation, and U07 journey.
It grants no AP feature work beyond these clauses and no new milestone.

- Implementation: estimated120–180 active minutes plus CI, one bounded reviewer and
  at most one correction follow-up; no nested workers. Same issue at most two
  evidence-based corrections. Build25min, CI observation30min, preserve failures.
- U06: one <=15min local Rust/AP/DB/HTTPS/browser window, workers stopped, zero VM,
  zero model invocation and zero task/review/rework POST; one explicit local confirm.
  If old data cannot be positively matched, stop U06/U07 without new store fallback.
- U07: only after rotation, U01–06 and independent source review pass. A separately
  clocked <=30min private operator window on the same pinned source/installation,
  one4CPU/4GiB VM at a time, zero-warm, <=600s per coding/review invocation, maximum
  two new invocations (one writer, one other-vendor reviewer), final5min cleanup only.
  No rework/second review in this window; a rework verdict is a clear non-passing
  journey result and stops. Conditional rework remains native-only. No M2 parallel
  rerun, new API billing, dependency, deployment, resident URL or release.
- Fix source before opening windows. Stop on unknown, failed prerequisites,
  unconfirmed cleanup, insufficient disk (<15GiB), unexpected consumer/schema,
  source drift or exhausted time. Do not restart/extend a consumed window.
- Owner's short operation confirmation remains distinct from automated Chromium
  evidence. If owner is unavailable during the window, stop and retain the result;
  FN07 stays pending, without silently extending service uptime. Provider requests,
  tokens, cost and incomplete tool totals remain unknown, not bounded by CLI count.

## Final journey gaps, without changing the acceptance bar

M1/M2 provide accepted real-vendor execution and concurrent isolation. T-0449
provides accepted candidate-only review and archive reopening on a separate store.
What remains is trustworthy recovery of the original installation, one current
reviewed-source integrated journey, a bounded private entry usable by the owner,
and owner confirmation. A cancelled recovered run does not provide the new successful
writer part of FN07. Neither a fresh store nor manual SQL can meet that requirement.
Whole M3/FN07/platform and old Cloud AC04 remain incomplete.
