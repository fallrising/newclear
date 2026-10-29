---
id: SPEC-T006R
title: Finite HTTPS operator review and measured presentation regression
status: verified
contract_unit: CU-WEB-P0-01
module: codebox-control-plane/web
milestone: T-0380 R2-AC-14/E
archetype: F
atomicity: inherited_per_action
invariants: [INV-007, INV-010, INV-012]
depends_on: [SPEC-T005A, SPEC-T005B, SPEC-T005C, SPEC-T006, SPEC-T007]
td_sections: [8.5, 9.3, 9.4, 10, 11, 14, 15.0, 19]
adr_refs: [ADR-0001, ADR-0002, ADR-0004]
risk: high
---

# Intent and responsibility

[T006R](../tasks/T006R.task.md) realizes already approved
[DESIGN](../../fe-review/DESIGN.md) M1–M3. This spec describes review scaffolding and
presentation acceptance of existing CU-WEB-P0-01. It adds no production authentication,
provider, protocol, retry, recovery or persistence authority. Existing accepted
[SPEC-T006](SPEC-T006-private-operator-web.md) remains normative for browser behavior;
[SPEC-T005A](SPEC-T005A-p0-session-lifecycle.md),
[SPEC-T005B](SPEC-T005B-p0-http-api.md) and
[SPEC-T005C](SPEC-T005C-p0-websocket-stream.md) determine every wire shape/state.
Contradictions stop the affected task; they are not resolved by permissive mocks.
The commands and files named below were the planned interfaces; the commands actually run (`remaining-v7-baseline.mjs`, `conformance-browser.mjs`, `journeys-browser.mjs`, `shared-capture.mjs`) and their results are in the [R2 report](../../fe-review/tasks/round2/report.md).

# Archetype F answers

| Required question | Answer and clause |
|---|---|
| How does each error map outward? | R03/R04 inherit exact T005B status/code and T005C frame/close tables. T006 ignores server messages and uses fixed safe labels. Unknown/malformed input never becomes success. Harness faults emit only fixed stage/reason/count, never raw exception/frame/header. |
| What is idempotency behavior? | R05: every explicit authenticated mutation has one new UUID key and current instance. Equal accepted key/request has at most one fixture effect; conflict409; logout later duplicate401 after invalidation. Timeout/disconnect never replays a mutation; one readonly observation may follow. No new recovery operation. |
| What are size/time/rate limits? | R03/R04/R06 use accepted32KiB prompt/40KiB request/64KiB JSON+WS/2MiB diff, one HTTP operation and one WS generation,15s browser deadline,5s subscribe/10s send/2s close; bounded reconnect250→5000ms. Fixture sessions≤4, idempotency≤128entries/8MiB, history256/subscribers8/livequeue32. R02/R09 bound lifecycle and scenario duration. |
| What is redacted? | R08: bearer/cookie/prompt/code/diff/raw frames/provider values/private paths excluded from public artifacts/logs/URLs. Synthetic diff/code are visible only where the existing UI permits and in ignored private PNGs. Record booleans/counts/hashes/fixed categories. |

Scaffolding B/D concerns are explicit: exact owned-path containment and cleanup in
R02/R09; ordered bounded stream, termination, close and no mutation in R04/R06.
These are test implementations of inherited semantics, not new production CUs.

# Normative clauses

## R01 — source, authority and finite interfaces

Only source-hash-pinned GET/HEAD / and /assets/p0-app.js,/assets/p0-client.js,
/assets/p0.css are served. Exact T006 MIME/security headers, including explicit
same-origin WSS CSP source, remain. HEAD has zero body. Unknown path/method/scenario,
path traversal, arbitrary upstream, filesystem listing and external fallback fail
closed before effects. Browser origin is one canonical HTTPS loopback origin with
an owned non-default port, no credentials/query/fragment. UI has only its existing
page/actions. Scenario selection is private runner input, not a product query/API.
Root environment supplies approved existing observer modules read-only, pinned by
version/hash. No npm install or production dependency/lock/CI change is authorized.

## R02 — environment and TLS prerequisite

Root-owned isolated network namespace: nonroot, no host ports/network/socket,
dropped capabilities/no-new-privileges; browser and server share loopback. Source,
SDK/modules/browser cache RO; only fresh owned0700 state/output RW; secrets0600.
Reject existing/symlink/nonowner state, occupied listener, inherited CODEBOX/CODEX/
provider settings and missing fixture; use a clean child environment. Do not mount
existing HOME/credentials/browserprofile or repurpose global HOME.

Generate a per-run CA/loopback-SAN leaf, trusted only inside the fresh browser
container/profile. No global trust update, HTTP bypass, ignoreHTTPSErrors,
ignore-certificate-errors or SPKI exemption. Before broad UI tests prove actual
HTTPS AND WSS success with this CA/name and rejection for unknown CA and wrong SAN.
A previous component's TLS proof is not this environment's proof. The root standalone
trust-001 prerequisite below is this prepared environment's proof; reuse its negative
certificate matrix only after recording identical image/browser/trust recipe/source.
The eventual fixture still proves actual asset/API/WSS wiring; changed trust inputs
require affected revalidation. Browser external
HTTP/WS and unexpectedroute attempts fail; OS network isolation independently holds.

## R03 — exact HTTP fixture

The finite surface is T006's nine HTTP operations plus WSS, not all backend APIs:

| Method / suffix under /api/p0/v1 | Exact success |
|---|---|
| POST /operator/session | 201 application/json {actor:"operator",expires_in_seconds:300,p0_session_id,instance_id}; both IDs non-nilUUID; matching secure cookie |
| DELETE /operator/session | 204 zero-body, cookie invalidated |
| GET /login | 200 exact logged_out/logged_in, or device_login_pending/outcome_unknown with operation_id |
| POST /login/device | 202 {operation_id,verification_url:"https://auth.openai.com/codex/device",verification_code,expires_in_seconds:900} |
| POST /login/cancel | 200 exact login-status, empty request |
| GET /session; POST /session/cancel | 200 exact T005A snapshot, empty cancel request |
| POST /session/turns | exact {prompt};202 {turn_id,high_water_seq} |
| GET /session/diff | 200 text/plain; charset=utf-8, bounded completed text |

Bootstrap bearer32–128noncontrolUTF8 bytes; opaque cookie32randombytes encoded43
unpaddedbase64url, __Host-codebox_p0; Secure;HttpOnly;SameSite=Strict;Path=/;
Max-Age300, no Domain. Logout same attributes/emptyvalue/Max-Age0. Protected routes
require valid cookie; mutations additionally exact Origin/current instance/key.
All response shapes deny unknown fields. Fixed safe errors use exact T005B envelope
and status table, including401authentication_required,403origin_forbidden,
409instance_changed/idempotency_conflict; operation_id only for permitted codes.
Do not claim production authentication conformance from this synthetic mirror.
Fixture JSON and diff responses declare the exact `Content-Length` of their body, matching the product
transport's full-body framing. Chunked framing is not product-faithful and is not used for fixture API responses.

Snapshot exact identity/session/instance,state,current_turn,high_water_seq. Present
turn is {turn_id,projection}; obey T006 reachable state/projection combinations.
Running queued/starting/cloudpending, ready terminalcloud, recovery_required cloud
outcome_unknown, monitoring_degraded matching operation/lastknownpending; no invented
submitting event or ready+pending snapshot. Use actual controller imports and
source-derived constructors to detect fixture drift; do not copy a relaxed parser.

## R04 — exact ordered WSS fixture

Before upgrade validate cookie/exactOrigin/fixedpath. Accept one text subscribe with
exact {type:"subscribe",protocol_version:1,session_id,after_seq},≤1024UTF8bytes in5s.
One captured H: replay_begin→event*→snapshot atH→replay_end→live events>H. Envelope
exact {schema_version:1,session_id,seq,turn_id,payload}; safe nonnegative integers,
non-nil identities, allowed T005A payloads only. Duplicate≤cursor ignored by client;
gap/future/wrongidentity must not be displayed as complete. No raw prompt/diff/code.

Use exact T005C error optional fields and close codes: history_gap oldest/latest,
future_cursor latest, unsupported_version supported_version1; subscriber_lagged base
or latest shape. Policy1008, limit/lag/unavailable1013, shutdown1012. No compression;
64KiB frame bound,10s send,2s close grace,5s subscribe. Unknown/binary/repeated/malformed
application frames close without effects. Logout/expiry invalidate connections within
inherited250ms idle observation (or bounded pendingwrite+250ms). Keep subscribers
bounded and release on every exit. No WS input invokes cancel/submit/login/diff.

## R05 — explicit actions, ambiguity and effects

Actual Tab/Enter actions drive authenticate/device/submit/cancel/diff/logout. Maintain
private in-memory action/request/effect counters and require one matching mutation
per direct action, zero automatic mutation on load/refresh/reconnect/recovery.
Idempotency follows T005B: exact method/route/body/currentinstance identity, bounded
inflight/completed registry; invalidcookie/Origin/instance/key/body admit no effect.
Original E1/E2/ambiguous browser dispositions are unchanged; synthetic effects are
only fixture memory and never a provider request. Timeout/drop after admission keeps
its admitted fixture outcome; controller does not resend. Same-key replay/conflict
and logout invalidation are focused tests, not new UI controls.

## R06 — bounds, refresh and negative journeys

Retain actual15s browser HTTP timeout, normal reconnect250/500/1000/2000/4000/5000ms,
one HTTP operation and one WS generation. Do not shorten product timers or modify
p0-client.js for testing. Controller pure tests may use their existing fake clock;
at least one real browser timeout must observe the actual timer and no resend.
Prompt≤32KiBUTF8 and serializedrequest≤40KiB; JSON/WS≤64KiB; diff≤2MiB. Test limit and
limit+one, UTF8 byte boundaries, exact status/media, malformed/unknownfields and
impossible projections in focused contracts. No unknown failure is globally ignored.

Same-tab refresh validates cursor schema and identity, reconnects without submit;
fresh context starts independently. Gap/staleinstance/futurecursor adopt current
snapshot high-water rather than retry fromzero. Protocolerror stops automatic
reconnect until manualrefresh. Recovery-required displays the fixed instruction;
no resolve/reconcile UI or hidden mutation. Cancel only local monitoring and retains
provider_may_continue; a socket close never cancels.

## R07 — measured presentation and accessibility

Only baseline-proven index.html/p0.css/p0-app.js changes permitted: existing wrap,
minwidth/local scroll/focus-visible/status/description/live-region semantics. Preserve
all IDs, controller interface, action order and text-only sinks. No visual redesign,
light theme, broad CSS cleanup or business behavior change. No defect is assumed.
Actual three-size dark baseline and focused meaningful RED precede each repair.

All canonical final states require no unexpected page horizontal overflow, readable
named keyboard-accessible event/diff localscroll, visible focus, correct busy controls,
no axe critical/serious violations and WCAG2.2AA contrast as required by DESIGN M2.
Record actual incomplete results; incomplete is not pass. Resolve relevant contrast
incomplete with bounded manual rendered-color/background evidence or report remaining
acceptance unknown. Do not rewrite this M2 requirement as merely futureR3. Avoid
announcing every event/diff chunk through a live region.

## R08 — secrets and inert presentation

Use only synthetic values, never existingaccount/session/CODEX_HOME/provider config.
Bearer and prompt fields clear before dispatch and before capture; status refresh,
mutation, logout/disposal clear volatile fields at inherited transitions. HTML-looking
diff must remain exact inert text with no elements/script effects. Verification URL
is fixed text, never navigated. SessionStorage contains only exact cursor identities/
sequence; no bearer/prompt/code/diff/cookie. No trace/video/HAR/body dumps. Private
PNG may show approved synthetic UI text; never commit rawPNG/state/key/token/frame.
Public evidence contains fixed categories/counts/booleans/source+artifacthashes only.
Canary tests cover error/debug/exception/URL/DOM/storage/publicreceipt paths. Do not
print assertion objects containing raw requests. Preserve sensitive failure detail
only when needed in owned0600 private state, then publish a safe fixed summary.

## R09 — owned bounded lifecycle

Register acquisition ownership before awaits; signal cancellation prevents new work,
drains bounded late acquisitions and closes any arriving resources. Bounded independent
closers always attempt browser/context, WS/server/listener and ownedchild cleanup even
when another rejects/hangs. Preserve original failure, record unknown/timeout false;
never equate timeout/daemonfailure with absence. Write safe receipt before exit.
Root outer launcher verifies exact owned container removal and positive inventory
absence; no broad cleanup or deletion of unknown state. Focused lateacquire/stalledclose/
signal/childfailure tests plus actual normal and observedfailure cleanup support this
boundary; do not invent extra fullmatrix repeats for cleanup-only tests.

## R10 — canonical captures and focused journeys

Exact product route /; dark only. Viewports mobile390×844,tablet834×1112,
desktop1440×900. Key is <state>__<viewport>__dark: exactly nine states below ×3=27.
Every key records sourceidentity, requested/finalURL,200assetload, substantive DOM
oracle, health, overflow, axe including incomplete, PNGhash/dimensions and privatepath.
Reject duplicate/unexpected/missing keys. If a failed key needs repair, keep immutable
original manifest and replace only explicitly affected keys with exact provenance.

| State | Required observed UI and fixture boundary |
|---|---|
| bootstrap-empty | freshcontext, Authenticate heading and emptybearer, no mutation |
| authenticated-ready | explicitbootstrap, loggedin+ready/no retained activity, currentidentity, emptyfields |
| device-pending | explicitdevice action from loggedout, syntheticcode/fixedofficialURL text only, cancel available |
| turn-busy | one explicit longChinese submit, promptcleared, runningpending/busy controls and orderedactivity |
| success-diff | same-contract terminalready and explicit Show diff; longChinese/longunbroken/HTML-looking inertdiff, local scroll |
| action-rejected | fixture403 origin_forbidden for one explicit action, exact fixedclienterror, no retry/effect |
| canceled-local | explicitcancel from running, canceled_locally/provider_may_continue and no providerterminationclaim |
| disconnected | observedsocketclose/disconnectedstatus; finite fixture gate holds reconnect≤5s for capture, then release and prove recovery without mutation |
| recovery-required | exact outcome_unknown snapshot, fixed trusted-recovery instruction, no newrecoveryaction |

Fixture gates are bounded test orchestration, not product timer overrides. Each
state receives a fresh explicit scenario/context, except intentional within-journey
transition/refresh; document any canonical key reuse only from the same exact state.
Long prompt is inspected before dispatch for geometry but is not stored in screenshots
or public artifacts; long diff is deliberately synthetic and private as above.

Focused desktop journeys (no duplicate fullmatrix): N01gap+futurecursor;N02staleinstance/
restart401;N03actual15stimeout after admitted mutation;N04malformed/binary/unknownfield
frames;N05refresh+disconnect no mutation;N06cookie/Origin/instance/key denial and replay;
N07logout/dispose latecallback/secret cleanup;N08unsafeHTMLdiff exacttext;N09network
fallback/TLSnegative. Pure boundary partitions cover excess sizes and impossible states.
Canonical matrix separately proves all three-size M2 states; these focused journeys
must have actual fixed stage/counter/identity receipts, not screenshot filenames alone.

## R11 — native and shared capture gates

Use exact task native commands and pinned Node24.18/Rust1.97.1, existing sharedcaches.
Unchanged original offline test fixtures may launch only their supervised synthetic
fake executables under task authorization. No new backend-browser/fakeCLI integration,
production CLI/control-plane/provider or live smoke. Preserve all native failures/skips;
full workspace/deny prerequisites cannot be passed by a mock browser result.

Planned review commands from componentroot (interfaces to be implemented after docgate):
`node --test fe-review/contracts.node.mjs fe-review/lifecycle.node.mjs`;
`node fe-review/run-review.mjs --run <fresh-safe-id>` inside root-owned namespace.
The runner owns startup/auth/fixture/trust, produces private ephemeral targets, then
uses unchanged repository `docs/fe-review/capture.mjs <private-targets> --dry-run` and
actual initialstaticcapture. A trust-aware review browser adapter preserves genuine
TLS validation. Dedicated driver supplies canonical authenticatedstates; sharedstatic
captures are separate and never substitute for them. Exact final invocation/output
paths/tool versions are written in execution evidence, not fabricated here.

## R12 — evidence and acceptance

Sourcecommit+filehashes, exactcommands/tools/exitcounts, canonicalkeys+negativejourneys,
publicsafehealth/axe/overflow, privatePNGhashes, sourcechanges/timeboundaries, native
results and exactownedcleanup must be linked perclause. Documentation-only status is
NOT_RUN for all runtime gates; targets staysfalse until originalR2conditions pass.
Independent fresh-context review starts from TD/ADRs/task/spec, verifies actual evidence
and reports decision. Root owns CI/normalpublication/remoteproof and ledger. Existing
mainlineincomplete/usable none/AC04–05 pending and fullR3unaccepted remain. Mock is not
truebackendTLSintegration, liveCloud or completedplatform. Aggregate costs unknown/null.

# Named machine acceptance skeletons

Before implementation, compile/run these meaningful failing oracles; do not substitute
placeholder skip/todo. Existing accepted T006 tests remain unchanged. Proposed locations:
fe-review/contracts.node.mjs, lifecycle.node.mjs and dedicated browser driver.

| Clauses | Exact new oracle name | Evidence layer |
|---|---|---|
| R01 | review_exact_assets_and_unknown_routes_fail_closed | fixedbytes/MIME/header/path contracts |
| R02 | review_fresh_state_origin_and_environment_are_contained | ownership/symlink/existingstate/env refusal |
| R02 | review_tls_https_wss_trust_and_negative_names | actual privateTLS browser positive/negative |
| R03 | review_http_fixtures_match_actual_controller_contract | actualcreateP0Controller + exact endpoint success/error |
| R04 | review_replay_live_bounds_and_invalid_frames_fail_closed | sequence/schema/limit/cleanup |
| R05 | review_explicit_actions_are_the_only_mutations | actionlog=requesteffectlog, replay/conflict/ambiguity |
| R06 | review_gap_restart_timeout_and_refresh_preserve_no_resend | purepartitions + realfocusedbrowser |
| R07 | review_measured_presentation_is_accessible_at_three_sizes | baseline/RED/final27+axe/keyboard/contrast |
| R08 | review_secrets_clear_and_diff_is_inert | predispatch clearing/storage/canary/exacttext |
| R09 | review_late_acquisition_and_stalled_cleanup_fail_honestly | focusedasyncfaults + actualownedreceipt |
| R10 | review_canonical_capture_keys_are_complete_and_immutable | exact27set/hash/source/replacement rules |
| R11,R12 | review_evidence_keeps_native_and_mock_boundaries | artifact/source/native/limits inspection |

TD§11.2 partitions: empty/one/many/limit+one, ordered/duplicate/interleaved, concurrency/
replayedkey, timeout/cancel/networkloss, path/symlink/invalidUTF8, partialJSON/unknownfields
apply to the above. Production diskfull/crashdurability/providerrecovery are not added;
private output-writefailure still exitsfailed and root preserves cleanup evidence. No
new production atomicity contract or actor/store test is implied.

# Acceptance evidence, traceability and TD gaps

Current state: verified. Every R01–R12 clause and N01–N09 journey is mapped to its
command, receipt and result in the [R2 report](../../fe-review/tasks/round2/report.md),
with limits and product findings. The fresh-context acceptance record is
[ACCEPT-T006R](../acceptance/T006R.acceptance.md). Rustdoc signatures are unchanged
(inspected; one added Rust test only); no automatic drift tooling is claimed.

No unresolved inherited semantic TD-GAP identified. Missing TLS tooling/trust proof is
a startup gate; missing fixture is implementation work. If a measurement needs an
out-of-scope controller/security/retry/recovery change, stop and produce a concrete
specification/TD-GAP proposal. Do not weaken inherited contracts to finish R2.


## Root environment prerequisite — observed separately

Root prepared fe-review-trust-terminal:20261024 image SHA256
f659591ff6a2df30b6d644236056a7f1b185a4161852f5b6639f45f042427884,
UID1000 ubuntu with actual container HOME /home/ubuntu, Node24.18, OpenSSL3.0.13,
certutil, external Playwright1.63 and Chromium153.0.8010.12. HOME is container-owned,
not a host mount or overwritten environment setting. No product dependency changed.

Root trust-001 probe sourceSHA256
e52a6da43ee4b683650761b182bc73bcf714a0122da6ad49013547f56226cd71
completed exit0 in3.824s; actual correct-CA/SAN HTTPS+WSS passed, unknownCA rejected
ERR_CERT_AUTHORITY_INVALID and wrongSAN rejected ERR_CERT_COMMON_NAME_INVALID.
Acquisition/browser/three listener cleanup passed; outer containerRemovedtrue.
Receipts were read by the documentation worker; execution was root-owned. The probe
served no product assets/API/provider. This proves available trust capability only,
not M1 fixture or M2/M3. Root will retain/archive the exact probe and private receipt;
the later component result must reference their hashes and equivalence conditions.
Do not repeat this green negative matrix merely to duplicate evidence; actual
same-config fixture HTTPS/WSS success and reviewed wiring remain required.
