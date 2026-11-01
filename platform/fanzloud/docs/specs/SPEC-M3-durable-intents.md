# M3 durable-intent slice — T-0442

Authority: SDD §§3,5–7, ADR-0008; owner continuation2026-11-01 after accepted M2.
This implements the previously fixed AC05 minimum within M3, not all FN04/05/07.
AP remains the sole execution/lease/result authority. No AP implementation changes,
native agent loop, VM, new coding invocation, external dependency package or paid API.

## Scope and contract units

- CU-M3-01 / intent durability: isolated mode requires an administrator-selected absolute
  `CODEBOX_ISOLATED_STORE` SQLite file in an owned canonical private directory. Reuse
  codebox-event-store's path checks and existing rusqlite dependency; a separate versioned
  database prevents reinterpretation of P1 event stores. Open failures fail startup closed.
  Require AP authenticated session and matching CSRF before recording a mutation. Persist
  owner username, canonical UUID client key, canonical task JSON and an unknown/started
  record in one FULL-synchronous transaction **before** any task POST. No auth values stored.
  A committed intent authorizes this request's one POST only, never replay/dispatch after restart.
- CU-M3-02 / one run: atomic owner+key uniqueness and payload equality guard duplicate requests.
  Same confirmed key returns its saved receipt without POST; changed payload conflicts;
  same unknown key and new keys while that owner has unknown intent return409 without POST.
  Explicit, complete AP4xx rejects may terminalize rejected (same key remains rejected).
  Transport/truncation/5xx/malformed success/commit failure stays unknown. AP202 must have
  canonical task/run IDs and match the submitted project/base/profile/goal before confirmation.
  Persist its unique run reference before exposing confirmation. No unknown recovery POST,
  no automatic timeout/retry or inference resume. AP has no public client-key GET; unresolved
  unknown therefore stays pending trusted operator investigation. Do not guess from titles.
- CU-M3-03 / authenticated restart readback: GET `/api/v1/submissions` lists a bounded recent
  history and an independently computed unresolved flag (not limited to the page). AP session
  validation remains required; private local persistence does not bypass logout/expiry/CSRF.
  Each submitted intent retains its title/base/profile and confirmed run reference. Old M1/M2
  AP tasks remain readable; observing them does not fabricate a historical submit intent.
  The list is also capped at2MiB aggregate; omitted rows set history_truncated. This slice
  does not add pagination, and an oversized first row can leave a truncated empty list;
  the independently computed unresolved flag still prevents unsafe admission.
- CU-M3-04 / result and observed history: successful authenticated AP run GETs persist bounded
  run projections with base/profile/run identity, AP state_version/last_event_seq and immutable
  result bytes/reference. Append only changed observations with a monotonic product cursor;
  keep at most128 observation entries, explicitly showing retained-history truncation. Ignore
  older versions, reject identity/result mutation, never substitute a different run. State_version
  may stay equal while cleanup/result/event cursor advances; compare the full projection.
  These are observed AP snapshots, **not** a complete replay of AP event stream/tool logs.
  Each history entry is compact<=2KiB; state/cleanup<=64bytes, optional reason only when
  encoded<=1024bytes. Full snapshot retains the exact reason. Emitted projection<=4MiB.
  Returned run includes durable observation history/cursor; reload displays that history.
  AP remains the result source; normal authenticated download compares the exact displayed diff.
  Store errors are typed/redacted and fail closed, never silently fall back to sessionStorage.
- CU-M3-05 / browser: after login or fresh page load, read persisted intents before enabling
  submit; unknown blocks even with empty browser storage. Prefer a still-valid chosen run,
  otherwise reopen newest confirmed reference. Local sessionStorage remains a conservative
  uncertainty marker for a request that never reached the gateway. Read/reload/refresh never
  submits. A known durable confirmation may resolve its matching local key only. Preserve
  explicit multi-task selection and stale-list guards. New task submission remains explicit.

## Data and failure boundaries

Task body allows only project_id, base_sha, profile_revision, title and goal, using existing AP
shape/limits. Credentials/cookies/CSRF/password/host configuration are never in intent rows,
errors or browser storage. Owner is derived from validated AP session, never request JSON.
Store is trusted-local single-operator data, outside repository/guest mounts. Authenticated
AP availability is required to view it; this slice does not add offline login, backup automation
or cross-operator migration. Shared-user identity policy remains AP's existing private operator.

SQLite uses atomic transactions/uniqueness, bounded busy wait, private file checks and explicit
schema version/application identity. One submission is bounded64KiB, projection2MiB, recent
intents100, per-run observations128. No background workers, pruning of intents or destructive
migration. Limits apply before allocation/DB writes where possible; corruption fails closed.
Cancellation remains AP's existing run-bound endpoint and no-retry UI; this slice does not
add a second cancel lifecycle. Interrupted intent may block new tasks until external
investigation; this deliberate limitation is visible rather than automatic abandonment.

## Test skeleton and acceptance

| ID | Given / When / Then | Evidence layer |
| --- | --- | --- |
| M3-01 | fresh/reopened store / record then reopen / exact intent and unique receipt persist | SQLite native tests |
| M3-02 | concurrent same/different keys or changed payload / admission / one winner, no second dispatch; unknown blocks new key | transaction + real Rust transport contract |
| M3-03 | accepted AP request / reply lost or process killed before receipt save / restart GET exposes unknown; zero second POST | fault server + real process restart; mock explicitly labelled |
| M3-04 | confirmed run + result / Rust restart and fresh browser / same run/base/diff/checks, retained history/cursor | real Rust/AP/DB and Chromium, retained M2 result; zero new coding |
| M3-05 | no auth/wrong CSRF/foreign owner/unsafe path/corrupt store / access or start / denied without task POST; secret-free errors | native security/contract tests |
| M3-06 | new browser or interrupted list fetch / recovery / unknown remains locked; confirmed task selectable; no POST | JS regression + Chromium |

List named test skeletons before each production implementation. First capture meaningful RED;
then smallest implementation. Include failures/corrections and source pins in acceptance report.
Use native fmt/clippy/workspace tests/build, Web suites, project contracts and final fresh-context
document-driven review. Existing M1/M2 source receipts remain unchanged, not repeated.

## Archetype answers and execution budget

Security: AP session/CSRF plus private DB; no new credential authority. Atomicity: local commit
precedes external POST; external success and local commit are not atomic, so uncertainty is
durable. Retry: no automatic or key-based POST replay; only saved successful response replay.
Recovery: authenticated GET-only projection; unknown manual investigation due AP query gap.
Concurrency: SQLite uniqueness/transaction serializes claims, not a process mutex assumption.
Cancellation: existing AP lifecycle. Errors: bounded typed redacted failures. Compatibility:
explicit isolated-mode required config; P0 unchanged. Persistence has separate schema identity.

Start2026-11-01T14:25Z; estimated90–150 active minutes plus CI. One bounded store worker,
one independent reviewer; no nested delegation. Every20min progress checkpoint. Same issue
at most two evidence-based corrections; no unchanged green reruns. Build timeout25min;
CI observation30min then preserve status/entry if incomplete. Stop affected work if AP schema
changes, paid route, extra resources, new dependency or broader scope is necessary. No live
VM/provider calls; actual AP zero-worker queued task and read-only retained results are allowed.
Provider requests/tokens/cost and incomplete orchestration totals remain unknown/null.
