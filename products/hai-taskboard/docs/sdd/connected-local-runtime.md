# Mini-SDD: Connected local browser runtime

Status: HAI-CONNECT-001/002 runtime transport accepted locally on 2026-10-23 after
T-003 implementation, retained T-005 REWORK, T-006 correction review and root pinned
backend plus actual Chromium gates. T014/T019/T024/T028 subsequently supplied the connected
foundation after retained reset/session/timestamp/accessibility corrections and independent
T022/T025/T029 reviews. Actual connected login/admission/dispatch/reconnect is verified;
full HAI-CONNECT-003/004 detail/attention/impact/Done and accessibility acceptance remain pending.
Parents: ui-interaction, local-fake-runtime, persistent-fake-runtime, executor-and-security.
HAI-local T-990 is static input, not acceptance. This contract does not enable missing admission,
current-input, output association, evidence or impact behavior by inference.

## Browser session and static shell

**HAI-CONNECT-001**: Retain the existing canonical HTTP loopback listener and exact Origin,
single configured operator and constant-time session authority. Retain `__Host-hai_session`;
do not weaken its Secure, HttpOnly, SameSite=Strict, Path=/ and no-Domain attributes or introduce
query/header credentials. Root's pinned Chromium loopback probe confirms cookie set/send, but
does not replace a real application login test or prove other browsers.

Add bounded JSON POST `/api/v1/session` with only `token` (maximum request 2048 bytes).
Require the configured byte-exact Host and Origin before parsing/authentication. Reject duplicate
or unknown JSON fields, malformed token and ambiguous headers. Successful authentication sets
the session cookie and returns only authenticated actor/status; never echo the token in a body,
error, URL, log or artifact. This explicitly amends the earlier runtime rule “never returned”
only for the protected Set-Cookie response needed by the browser. Token authority remains the
existing configured secret, not a newly claimed production login service. Use Cache-Control:no-store.

GET `/api/v1/session` requires the existing cookie and returns actor/status. DELETE at the same
path requires session, exact Host/Origin and clears the cookie with matching attributes. This
logs out this browser; it does not rotate the configured operator secret or claim global revocation.
Reject nonconfigured Host on runtime requests, retaining loopback configuration validation.
The login form uses a password input, submits only on explicit action and clears it immediately
after the request. No URL, localStorage, sessionStorage or built-asset token persistence.

**HAI-CONNECT-002**: Serve the built React shell and a finite verified asset list from the same
runtime origin. An optional trusted absolute clean web-root selects a prebuilt directory; validate
root/regular asset files and reject symlink/traversal/ambiguous names. Never directory-list, execute
content or fall back from unknown API/assets to HTML. Use only `/`, `/index.html` and explicit
asset routes discovered from the approved build entry; hash navigation supplies the four product
surfaces without arbitrary filesystem routes. The public shell contains no project/private data;
all projection, result, detail and artifact requests retain authentication and project authorization.
Do not embed secrets or read private runtime paths into the shell. With no web-root, existing API
runtime remains available and health describes the UI as unavailable.

## Connected behavior

**HAI-CONNECT-003**: The React entry uses authenticated server projections and application command
results. Existing fixture components/tests may remain isolated fixtures, never runtime authority.
Use one command-submission path for every supported click/keyboard/move action. Capture expected
version, command ID and UUID idempotency key once per explicit intent. Keep the authoritative lane
while pending. A timeout retains exact bytes/identity and queries the original result URL; do not
make a new command or retry a conflict automatically. Rejection preserves focus, intent and exact
unmet guards; acceptance/refetch announces the resulting server state and focuses the heading.
Draft→Ready and Ready→Developing use their existing commands; later moves require explicit
candidate, review/QA and Done gates. An unsupported target cannot directly write a phase.

Snapshot first, then subscribe from its cursor. SSE is invalidation plus authoritative refetch,
not local domain mutation. Reconnect with the last applied cursor; avoid contradictory query and
Last-Event-ID values by recreating the subscription. Reset/epoch/retention requires a fresh snapshot.
Deduplicate events, retain a visible disconnected label/cursor and revalidate risky actions.
Authentication failure stops automatic reconnect until login. Unknown, cancellation requested,
stale and Done-Stale stay distinct; successful Run alone never renders Done or fabricated coverage.

**HAI-CONNECT-004**: Preserve named Red and real runtime/browser evidence for
`local-session-browser.spec.ts` (set/send/logout, wrong Host/Origin, ambiguous cookie and secret
non-disclosure), `connected-board-command.spec.ts` (same command path, pending lane, rejection and
conflict focus), and `connected-attention-reconnect.spec.ts` (response loss/result lookup, disconnect,
cursor reset and no automatic uncertain retry). Existing responsive/accessibility requirements at
320px, zoom, keyboard/coarse pointer and both themes remain mandatory. Static fixture DOM tests
cannot substitute for these. Current-head readiness/Done, durable output selection, impact and
backup/restore need their separate implementation/evidence before full P0-A acceptance.

## Usable local verification policy (accepted locally)

**HAI-CONNECT-005**: Before exposing Review/Evidence/Done commands, replace the old runtime
`VerifierClass:"local"` placeholder, which is outside the command's accepted class vocabulary,
with an explicit supported local human-verification profile. Revision is SHA256 of
`local-policy-v2`; recipe remains SHA256 of `local-recipe-v1`; required AC key is `local`.
Its verifier class is `human`, independence is required, producer role is prohibited, and
its environment is SHA256 of `local-fake-environment-v1`. Keep ApprovalRequired=false unless
a separate policy explicitly enables it; completion still needs explicit exact-subject intent.

This profile permits the authenticated operator to record their independent review and
verification of the local Fake candidate. It does not make arbitrary producer text independent
proof, automatically create Passing evidence, execute AC instructions or claim real-agent work.
Client evidence forms must identify the exact subject/AC/recipe/environment and explicit human
verdict/report; automatic success from a Run remains forbidden. Tests may create explicitly
labeled synthetic human reports only as fixture evidence, never real-world task acceptance.
Changing the runtime policy revision makes old accepted bindings ineligible for new work until
explicit acceptance/activation; exact committed replay and historical results remain available.
Preserve a named regression proving the configured runtime profile uses supported verifier
classes and reaches its existing independent review/evidence guards. Final real UI/Done
acceptance still requires the complete connected workflow and negative evidence matrix.

## Project directory prerequisite (accepted locally)

T015/T017 independently reviewed; root current-output-directory-integrated-20261023
full/race/vet/build and directory-api-integrated-20261023 lint passed. UI acceptance separate.

**HAI-CONNECT-006**: Implement GET `/api/v1/projects` and GET
`/api/v1/projects/{project_id}` using optional application projection ports and a consistent
SQLite read snapshot including the durable stream cursor. Read-only operations never allocate
events/audit or take the command writer transaction. Authenticate before reading; filter every
listed project through current project authorization and mask denied/missing scoped reads.
Return all projects in deterministic ID order, at most1000; reject capacity instead of truncating.
Bound each stored string in SQL by byte length before materialization, then validate IDs, text,
positive versions and cursor. Missing capability/storage errors fail closed with bounded errors.

Project repository root_hint/approved_ref are the stored legacy user-supplied display values,
not approved repository authority. They must not be joined to private configured Git paths.
Amend Project.repository.binding_id to explicit null: this metadata projection cannot invent
an approved binding from a legacy hint. The explicit repository-binding description/admission
path retains authority. This does not alter command identity or accepted bindings.

Preserve named compiling Red TestConnectedProjects_DurableDirectory. Verify real SQLite empty,
sorted populated, scoped, reopen/read-only cursor/count preservation, authentication/authorization,
malformed/oversized metadata and capacity. Frontend fixture data cannot substitute for these reads.

## Existing completion command HTTP boundary (accepted locally)

**HAI-CONNECT-007**: Expose the existing SubmitCandidate, PublishFixtureReview,
PublishFixtureEvidence, ApproveSubject, RequestQA and RequestCancellation service methods
through the existing authenticated same-origin idempotent command endpoint, as optional
capabilities. Use existing OpenAPI payloads and application DTOs; preserve command identity
and stored outcomes. The authenticated actor remains trusted separately; caller actor fields
never grant identity or independence. No observation endpoint or implicit success/Done.

Strictly reject unknown/duplicate/case-variant/null/missing required fields, wrong scalar
types, invalid timestamps, out-of-range positive signed integers, scope mismatches and
noncanonical wire digests before service calls. Preserve bounded body/collection reads.
Candidate manifest must be nonempty, complete and bounded1024; service owns current-input/
output authority and all byte verification. Review/evidence remain explicit human fixture
intent, not automatic producer proof. Evidence report locator does not upload or create
bytes. Exact approved subject/AC/recipe/environment and fences are required.

Required AC IDs follow accepted UTF8 identity bytes<=120, no whitespace/control/separators;
completion subject decoding must match accepted vocabulary rather than legacy ASCII80 and
must never return nil error for invalid AC IDs. Explicit absent integration-base uses the
existing optional field. Preserve canonical domain/app validation after transport validation.
Missing optional capabilities fail closed. No storage/codec change. Tests exercise all six
routes, auth/origin, strict nested parsing, maximums, actor/scope rejection and identical
stored replay. Full real accepted Fake→human evidence→Done process proof follows the
separate output-consumer, prepared-read and artifact-boundary work.

## Exact completion preparation (service accepted locally)

**HAI-CONNECT-008**: A bounded application read prepares the existing exact completion
subject for a named project, WorkItem and Candidate. Authenticate before storage. Read
current Candidate→Run→immutable input→accepted heads and trusted policy; reject missing,
stale, unknown or unavailable material. Review returns the existing prospective QA version;
QA returns its current version. Return the actual item version separately for commands,
complete wire-prefixed subject/digest, exact required AC rules/environment and lease epoch/
restore generation. Do not choose an arbitrary candidate or fabricate rules/approval.

Use bounded metadata transactions with no audit/event/result/phase writes, verify complete
candidate artifact bytes outside writer transactions (max1024 objects,10MiB each,50MiBtotal),
then repeat current semantics, head/input identity and full metadata/fence comparison before
return. This snapshot is not a reservation, not Passing evidence, and not permission to Done.
Commands recheck all guards. Tests preserve actual accepted Fake candidate preparation,
Review→QA same subject, unauthorized/scope/legacy/stale/missing bytes, outside-IO changes,
unchanged history and deterministic output. HTTP exposure and full detail UI follow separately.

T012/CONNECT005, T020/CONNECT007 and T021/CONNECT008 service are accepted locally after
independent T027/T026/T023 review and root completion-integrated-20261023 full/race/vet/build;
completion-api-integrated-20261023 lint passes. Completion preparation HTTP exposure remains
pending. Actual completion-connected-browser-20261023 verifies the foundation under the new
policy, not a completed review/evidence/Done UI. Original failed checks remain in task reports.
