# M2 second vendor and concurrent isolation — T-0442

Status2026-11-01: **ACCEPT_M2_LIVE — FN02 and concurrent FN03 passed; PR906 delivery pending**.
The single-route sections below are historical; the approved concurrent result supersedes their pending-approval status.
[Normative scope](../specs/SPEC-M2-two-vendors.md), [independent review](../../../../.team/fanz-m2-t0442/review-report.md).
M1 is preserved at live33e1eb70 / final391aa1aa; no CloudAC04 or M3 acceptance is implied.

## Implemented call chain

Same private HTTPS Web → Rust gateway → AP catalog/task/run/result → matching
Claude or Codex subscription driver → existing run/generation-bound Connector tools
→ Cocoon VM. Official CLIs retain inference; AP alone owns allocation/leases/cleanup.
Codex app-server has empty thread/turn execution environments, isolated startup config,
pinned official CLI/model metadata, three dynamic VM tools and no uncertain relaunch.

## Evidence before live

- Official Codex0.166.0 binary SHA256
  `b8a11fedf24b2dfb59a70c9e52b030f9a508dcd49cd2dd0d41956f4c785156b8`;
  source tag commit `6ff1e1ca3b30fc8b914720681fcf5fe62e95f856`.
  Model gpt-6.1-sol, unmodified catalog SHA256
  `7317e3d0e2d527e430c9604f2da589184a566d2c51974d74c29244f0abcfe915`.
- Actual CLI startup/config audit passed without a turn. Actual CLI plus local synthetic
  Responses provider denied nested host patch, Node/file imports, file media and unknown
  resources; no host marker, MCP empty, inert dynamic callback succeeded. **Mock provider,
  no vendor coding or VM acceptance.** Earlier unqualified/failing probes retained.
- Native adapter fake-process8 tests passed; startup route/config refusal before thread,
  exact callback binding, no-tool/failed turn refusal, watchdog and no second invocation.
- Web17 tests passed, including confirmed second submission versus unknown lock, delayed
  cancellation and pending/failing task selection. UI regression was observed RED first.
- Native PostgreSQL backup31 passed including both vendors' real dump/restore histories
  and negative proof mutations. Earlier failure exposed queued-cancel gen1 and missing
  subscription backend support; exact durable proof restored, validation not removed.
- Rust formatting, clippy, all workspace/all-target/all-feature tests and binaries passed;
  offline evidence parser3 and repository project-success50 passed.
- Independent review: original REWORK findings R1–R3 corrected, then ACCEPT_CODE.
  Full AP `make platform-check` passed lint/format,45 base tests and809 platform tests
  against a fresh real PostgreSQL instance; owned test container removed. All four
  hosted workflows passed on a51a8663: AP41275675180, Fanzloud41275675220,
  project contracts41275675179 and workflow validation41275675200.

Private raw evidence lives in the task's local handoff and eventual private backup;
only sanitized source/run/hash/check summaries belong here. Provider requests, aggregate
model tokens/cost and historical orchestration totals are unknown unless explicitly measured.
No resource expansion: one VM4CPU/4GiB, coding<=600s, zero warm; concurrent experiment
requires a separate explicit bounded approval. No standing operator URL or full MVP claim.


Commands at this checkpoint (component working directories):

```sh
# platform/agent-platform; retained locked native-venv, PYTHONPATH=src:tests_platform
make platform-check
python scripts/test-postgres.py python -m unittest test_backup -v
python -W error::ResourceWarning -m unittest test_subscription_codex -v
# platform/fanzloud
node --test --test-isolation=none apps/control-plane/web/p0-client.test.mjs acceptance/m2-isolated.test.mjs
python3 -m unittest discover -s tools -p 'test_m1*.py' -v
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
cargo test --locked --workspace --all-targets --all-features
cargo build --locked --workspace --bins --all-features
# repository root
python3 scripts/check_project_success.py
git diff --check
```


## Actual second-vendor single-VM result

Source `a51a86634a27d84e52fe95e2d42d4ea7ac541ec0` (AP/Fanzloud bytes identical to
reviewed/tested `6ad8261f5e2ce7beeb4896711802973f69aec089`), [PR895](https://github.com/fallrising/newclear/pull/895).
Same Chromium153 Web offered both Codex and Claude profiles; one real Codex POST
created run `142e9aee-179a-426e-b0c6-330df9f4a677`. Observed queued → provisioning →
running → finalizing → succeeded, tests passed, cleanup confirmed, zero browser errors.
Official app-server called fanz_read twice, fanz_write once, fanz_exec once. No fake
provider or model/API fallback; existing trusted ChatGPT login, empty environments,
effective configuration verified and CLI process group stopped.

Fixed base `55bd36a47d3ca619b0a10bcad427b9fb9b8c99c5`; only totals.py changed,
285-byte diff. Page, downloaded bytes and AP artifact share SHA256
`c5134c8015bad2104fceb70e5c4c79086d6ec9bd85a0b4fa0f833b4ed3ef6fdb`.
Downloaded patch applied to a fresh base archive and all3 fixture tests passed.
Actual VM probe passed UID2000/NoNewPrivs, host/control-secret denial, no provider/control
credentials in environment, direct public/private/metadata and HTTP/CONNECT proxy denial.
AP unreleased reservations0; actual runtime absence proof retained separately.

One new live coding CLI invocation; provider requests, tokens and billed cost unknown.
The retained remote Connector/runtime source remains M1 `33e1eb70d66eb74644e8ad81e64e8bdc69c9fe07`;
new current-source AP driver/lifecycle and Rust/Web are not misattributed to that source.
M1 Claude receipt remains accepted; new simultaneous Claude/Codex and cancellation
independence must still pass, and neither same catalog nor one Codex task proves them.

Environment repairs before submission were not coding retries: missing old browser
image was rebuilt from retained recipe and fixed Debian digest; Node24.18.0/
Playwright1.63.0 came from existing binary/shared cache, Chromium153.0.8010.12 retained.
New test image `sha256:05505689fab0f13b972bfe45004f20aca04bfafe20bb3f0819f711ecd73ed736`.
PostgreSQL initialization readiness race was reconciled while database had zero public
tables; SSH default cleared forwarding until a per-command explicit loopback override;
node startup corrected to the existing sealed egress launcher before admission; first
browser container mount failure occurred before process/intent/task creation. All failed
logs preserved; exactly one task was submitted. SSH Git authentication stalled, so the
same local commit was pushed with existing HTTPS credential helper, without secret output
or global config changes. Current main merged normally, no rebase/force push.


Evidence limitations retained: the config-response log redaction keyed by RPC ID also
redacted one colliding incoming write callback request. Its official dynamicToolCall
started/completed events, matching receipt call ID, resulting source and exact diff
still establish the successful write; do not claim four raw request records. The first
cleanup script counted22 kernel cgroup control files; corrected directory-only query
returned0 VM cgroups. Both snapshots had zero claims/VMM. Neither diagnostic was hidden
or treated as a provider/task retry.


## Single-route closeout

Independent new-evidence audit: [ACCEPT_SINGLE_LIVE](../../../../.team/fanz-m2-t0442/live-evidence-report.md),
overall M2 remains PARTIAL. Actual runtime claims/VMM/VM-cgroup counts0. Temporary
API/Rust/browser/tunnel/PostgreSQL and remote owned services/registry stopped;
fixed runtime/configuration and DB volume retained. max_claims never exceeded1.
Native AP backup of this actual completed Codex history passed creation and verification,
118344 bytes, SHA256`813bde5b5208a2b460d4e46d023e6a4db9bfdab7bef5cb2cb71ae6192a6dadcd`.
The initial backup destination was correctly refused for group-writable shared ancestors;
verified in a private temporary directory and copied unchanged for retention, without
weakening checks. This preserves evidence, not a Fanzloud M3 restart/recovery acceptance.

A concrete two-VM plan was presented after single-route success. Until the owner explicitly
approves it, no second concurrent allocation or additional coding invocation is permitted.
The proposed window is15min,2×4vCPU/4GiB,zero-warm,at most2 new real CLI invocations;
restore max_claims1 and prove cleanup. Six host logical CPUs means explicit CPU overcommit.
Do not infer approval from this document, CI, merged code, or elapsed waiting time.


## Approved concurrent result — 2026-11-01

Owner approved the exact prior proposal in the current conversation. Original window
11:15:40.893343Z–11:30:40.893343Z remained unchanged. Two4CPU/4GiB VMs, zero warm,
at most2 new coding invocations, no new API billing or provider fallback. Actual
pair source `d008fc47e16eb51ad44e0289119288ec3ffb87ce`, [PR906](https://github.com/fallrising/newclear/pull/906),
Rust binary SHA256 `7f03ba0c9fcf0eac6525557e5302a5d6bbebf47f03d0e7886622b16015e82279`.
AP sources are byte-identical to accepted PR895; retained remote runtime remains33e1eb70.

| Contract | Actual evidence |
| --- | --- |
| M2-01/02, FN02 | Same Chromium HTTPS Web selects both real vendors. Prior Codex successful repair remains accepted without replay; current Claude Code2.1.312/Opus5.5 completes the same bounded repair through shared AP routing. |
| M2-03, concurrent FN03 | Distinct actual VM IDs and sandbox bindings simultaneously present; each sees its own differing same-path marker and not the other's marker. Both reject traversal422, run as UID2000/NoNewPrivs, deny host/control secrets, direct public/private/metadata sockets and HTTP/CONNECT proxy access. Markers removed before coding. |
| Actual overlap | Official Codex dynamicToolCall and Claude assistant tool_use invoke the bounded45s command. Trusted read-only existing SDK attach verifies A/B/A live sleep PID/starttime, exact AP binding/generation/deadline, remote fence and VMM identity. No inference from prompt text or mere VM existence; no repository tool expansion or allocation by observer. |
| Cancellation independence | Browser cancelsA once at11:20:49.744215Z. B remains running on its original generation1/binding immediately afterward. A cleanup completes11:21:33.738735Z; B later finalizes11:21:41.452338Z and succeeds11:21:42.047657Z with checks and downloaded diff. |
| M2-04/05 | Active tasks selectable without reload; older list response cannot replace newer list. Failed list read preserves confirmed submit. Unknown-submit/no-resend regressions retained;20Web tests pass. |

A Codex run: `eb8b36fc-4f1b-4457-b1e4-2ea606bc6926`; cancelled, generation3 after native
cancellation reconciliation, cleanup confirmed. Its CLI receipt is correctly
`unconfirmed` after interruption and process group stopped; it is not a successful
coding result. AP independently confirms cancellation and real resource absence.
B Claude run: `69ca2054-3563-4436-957f-819bc1a01d9a`; succeeded generation1, cleanup
confirmed, CLI completed/processes stopped. Only totals.py changed,285bytes, the same
base and `c5134c80...fdb` full SHA256 above. Page/download/AP hash match; applying the
patch to a fresh fixed-base archive passes all3 original tests. Zero browser errors.

There were5 Web task POSTs in the whole window, not2: first harness expected201 but
actual API returned202; its uniquely reconciled queued run was cancelled before any
VM/CLI. Next pair encountered duplicate historical titles; both queued runs were
cancelled/not_allocated. A distinct-cause correction used unique UUID titles and the
original deadline; no third pre-inference correction was allowed. The final pair
made2POSTs/1browser cancel and exactly2 actual coding invocations. No uncertain result
was resent, no actual CLI rerun occurred. All failed attempts and native cancel receipts
remain preserved. Initial preflight review missed the202 assertion; this is explicit.

Preflight also corrected serialized-workspace observation, Codex redacted-request
parsing, active task list/stale response and atomic exclusive receipt publication.
Focused old-source regression fails0!=2; finalWeb20, Rust fmt/clippy/workspace tests/build
and project-success pass. Hosted live-source Fanz41300652087 and contracts41300652080
passed. Prior AP45+809 checks apply to unchanged AP sources; no fake tests substitute
for the actual pair. Two-writer receipt race checks pass without model/runtime calls.

Cleanup: AP reservations0, runtime claims0/VMM0/VM-cgroup directories0; both CLI process
groups stopped. Node/Connector restoredmax1 with all other configuration hashes
unchanged; AP restoredslots1/4CPU/4GiB/draining=true. Remote services/registry stopped,
local API/Rust/browser/PostgreSQL stopped at11:24:05Z; final tunnel absence was
recorded by11:24:23Z (retained receipt mtime), before original deadline. Host minimum available memory13,411,835,904bytes;
maximum observed load1=1.818359375. No threshold breach. DB volume retained.

Private evidence: `fanz-m2-20261101-t0442` backup and current handoff; pair receipts under
`prep/session/pair/attempt-3`, including summary/source-manifest, browser screenshot/diff,
actual-overlap, both boundaries/traversals, AP event chronology, fresh-base test log,
supervisor and runtime restoration. Provider requests/tokens/cost remain unknown/null.
No standing operator URL, public deployment/release, full platform acceptance or M3/AC05
claim. M3's next minimum remains durable submission intent/unique AP run-result refs,
restart readback and unknown zero resend; it was not started here.

Final fresh-context [independent acceptance](../../../../.team/fanz-m2-pair-t0442/review-report.md):
ACCEPT_M2_LIVE. Source/hash/streams, actual denials, overlap chronology and clean restoration
independently checked. Delivery still requires final-head CI, normal merge and remote readback.
