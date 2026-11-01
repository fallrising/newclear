# M3 integrated mock security and budget acceptance

Status: design recorded before implementation; final acceptance results below.

## Scope and truth boundary

This slice connects the existing AT-07/AT-11 contracts at one recorded source
revision. Models and GitHub remain deterministic loopback mocks. Synthetic
credentials are task-owned; real provider billing, a hard money cap and live
GitHub remain outside this gate. The existing deferred billing decision does
not turn fixture credits into money. This document does not change the SDD's
milestone status or implement M4 storage/export/backup.

A broker has its own quota. Model **durable cutoff** must deny new broker
admission and withhold a late completion. Raw model request exhaustion is not
silently redefined as the same policy: terminal admission already uses the
model tool gate, while broker admission documents cutoff plus broker quota.
The integration regression must call the real ModelProxy.cutoff transaction,
not insert cutoff_reason in SQL and then claim the cross-component wiring.

## Acceptance matrix

| Boundary | Current-run check | Required evidence |
| --- | --- | --- |
| Durable cutoff with an in-flight broker hop | PostgreSQL barrier test using real model pin/token/cutoff and broker admission | cutoff returns without waiting for hop; model token revoked; one cutoff event; new and repeated broker requests denied; late completion withheld, no receipt/ACK/replay; capacity remains reserved |
| Normal SDK and broker lifecycle | Existing worker-tools KVM five-case matrix | normal/disabled/partial-proof consume actual SDK polling to finished/caught_up, matching results/verification; cancel and uncertain outcome follow their conservative states; no false finished requirement after destroyed VM |
| Combined normal Worker model + broker | New integrated KVM normal, request-cutoff and invalid-usage cases | Explicit model and tool policies; unchanged guest model mailbox; normal public approval, one real broker operation, SDK finished/caught_up and verified result; actual cap/invalid usage errors drive native cutoff with zero tool dispatch in fault cases |
| Model limits and unknown usage | Native parallel/reservation/restart tests plus guest-model KVM mock-complete, mock-cutoff, mock-unknown, fixture-credits, fixture-budget-cutoff, fixture-budget-unknown, rotate | dispatch counts and unknown/credit reservations match case contract, no automatic replay/refund or rotation reset |
| TLS and cross-run audience | guest-model KVM mock-https-complete and cross-run | loopback test CA with normal TLS checks; no cross-run token authority; no paid endpoint |
| Guest and network isolation | guest-model KVM isolation; egress KVM --deny-all | exact terminal attack checks, control credentials/workspace unreadable, no direct metadata/private/public route; deny-all proxy rejects old grants |
| Result rendering | Existing native result-download tests and Chromium injection case | persisted diff exact bytes/hash, safe download headers, no injected DOM/dialog/payload execution |
| Final resource ownership | Each case and final teardown | owned VM/claim/reservation/CPU scope/process/listener/test DB absent; complete stop proof before reservation release; journals and failed reports retained |

Historical isolation/allowlist/DNS/redirect and OS process crash reports remain
separate evidence. A fresh deny-all run does not revalidate allowlist redirects.
The historical normal broker run uses a guest fixed fixture. The new combined
case instead configures the host mock provider through the unchanged guest model
mailbox and performs one bounded tool action in the same normal Worker. It does
not establish an unrestricted coding model. SQL tests exercise the held-hop
cutoff race; zero-dispatch real-KVM faults exercise native automatic cutoff. Full arbitrary agent workflows and arbitrary encoded secret DLP
are not established by this bounded suite.

## Acceptance harness correction

Inspection found that the guest-model KVM driver sets passed before its finally
block and only records zero_vms/zero_claims afterward. Resource residue can
therefore coexist with passed=true. Correct the actual finalization path so
original case acceptance and successful cleanup are both required; missing or
failed cleanup observations fail closed. Resource/server/database cleanup must
still run if an earlier cleanup step raises, and the failed report must survive.
This is an acceptance-driver defect; it is not a newly proved runtime leak.

Also record the model driver's observed SDK polling completion/cursors, rather
than inferring SDK finished only from a platform succeeded result. Successful
cases must observe finished/caught_up; cancelled/budget fault cases have their
own terminal oracles. Observation must not replace polling, suppress 409, mutate
lifecycle state, or drive progress. Existing explicitly scoped fault injection
in legacy model cases is labeled; it cannot stand in for unmodified Worker
lifecycle evidence from worker-tools.

A real mock-unknown rerun additionally exposed an old accounting assertion:
it required a successful measurement-source reason even for an unknown request.
The corrected oracle requires exactly one unknown slot with
`model_response_invalid`; successful mock and HTTPS rows require their exact
final measurement reason and zero unknown slots. The retained failure and its
zero-resource cleanup are separate from the corrected rerun. This changes
acceptance assertions, not runtime accounting or the provider error contract.

The deny-all rerun exposed a second stale fixture adapter: egress and standalone
isolation scripts prepend an obsolete `COMMAND` global, while the current guest
fixture builds terminal commands with `edit_command`. This raises `NameError`
before the fixture can listen, producing `model_not_ready`; it is not evidence
of a network isolation failure. Preserve the failed report, reproduce fixture
startup without a VM, and wrap the current command builder so the probe executes
before the original deterministic command. Cover both affected adapters, then
rerun the selected real-KVM deny-all case with unchanged security assertions.

## Verification and provenance

Use behavioral Red/Green regressions for the broken acceptance oracles. The three
model/broker cutoff tests add missing coverage of existing correct behavior;
their initial setup failures are not a product Red result.
Run focused tests then make platform-check, make web-check and make browser-test.
Run only the named KVM matrix on a fresh owned node/configuration/state with
unchanged resource/attestation gates. Each driver output is private; publish an
allowlist of case names/counts, states, hashes and cleanup booleans only.

Record source commit and per-file runtime/driver/test hashes, commands and exit
status. Keep failed attempts distinct. Root and an independent reviewer inspect
actual observations; a hand-authored aggregate passed field is not proof.
Final PR and main CI must pass after review. New defects require a minimal
reproducer and scope/lock check before any runtime edit.

## Reproducing the bounded matrix

From the component directory, use the locked development environment and a
fresh dedicated sealed deny-all node. Supply private configuration/output paths
through local variables; never add those files to the repository. The legacy
model driver needs a separately owned connector HTTP process. The combined and
worker-tools drivers create and stop their own connector, so run them serially
after stopping that process. Each output directory must be new.

```sh
make platform-check
make web-check
make browser-test
# Repeat for each named model case in the matrix, with a fresh output:
python scripts/test-postgres.py python scripts/m3-guest-model-kvm.py \
  --config "$fixture_config" --origin "$connector_origin" \
  --output "$case_output" --case "$model_case"
python scripts/test-postgres.py python scripts/m3-integrated-acceptance.py \
  --config "$fixture_config" --origin "$connector_origin" --output "$combined_output"
python scripts/test-postgres.py python scripts/worker-tools-kvm.py \
  --config "$fixture_config" --origin "$connector_origin" --output "$worker_output"
python scripts/m3-egress-kvm.py --config "$fixture_config" \
  --output "$egress_output" --deny-all
```

The new driver only installs a credential-free bounded terminal program. The
ordinary Worker still owns model requests, public approval, tool admission,
delivery/ACK, SDK polling, result verification and stop proof. The controller
reads observations and posts the public approval decision. It does not write
leases, grants, ACKs, cutoffs or lifecycle state. Request-limit and malformed
usage fixtures cause native model cutoff. The normal case denies subsequent
model use through terminal run state; its model token row need not have an
explicit revocation timestamp. Fault cases require explicit token revocation.

Review also reproduced four new-driver error-path gaps before final acceptance:
an unstarted fixture thread could hang shutdown; a failed shutdown skipped later
close/join actions; boolean counters could pass integer assertions; corrupt
reports could mask the original failure. The corrected path attempts independent
cleanup actions, guards unstarted threads, rejects non-integer evidence, and
preserves corrupt report bytes and the primary failure. Report storage failure
still fails the command; a stale report alone is never acceptance evidence.

## Current execution record

On 2026-10-04, the final named matrix passed: 10 guest-model cases, three combined
Worker cases, five worker-tools cases, deny-all egress (nine checks), and the
repaired standalone isolation adapter (23 checks). The model isolation case
additionally passed its 29 checks. Normal flows consumed actual SDK events to
finished/caught_up; cancelled and failed flows retained their own explicit
terminal/cleanup oracles. The combined normal case applied one public approval,
made two model requests and one authenticated broker hop, durably ACKed its
result and verified the saved diff. Both combined fault cases made one model
request and zero broker hops; invalid usage retained one unknown request.

The final native gate has 45 unit tests and 460 platform tests, including three
actual-cutoff SQL tests, 20 model/legacy-fixture oracle tests and 21 combined
oracle tests. Web validation passed 68 tests and build; Chromium passed seven
tests. The first Chromium attempt could not launch because its existing shared
library search path was absent; supplying that path fixed the rerun without a
dependency change. Initial SQL setup mistakes, both failed KVM attempts and the
pre-review combined run remain distinct from final successful runs.

The final host inspection observed zero VMs, claims, reservations, CPU VM scopes,
Worker/connector processes and listeners. All 16 owned PostgreSQL wrappers
recorded removal, including initial attempts. The owned node was stopped and
its PID/cgroup disappeared. A literal scan of 47 observable report/trace/log
files found none of 103 known synthetic credential values; this is a bounded
canary check, not an arbitrary-secret disclosure guarantee. Journals and failure
artifacts remain private and retained.

The [public evidence allowlist](evidence/m3-integrated-acceptance.json) links case
observations to private report hashes and the final 156-file source manifest.
Model, combined and repaired legacy adapters ran in successive recorded
snapshots. Runtime bytes stayed unchanged; the final legacy adapter delta only
changed standalone fixture construction and its tests. The model isolation
driver uses the unchanged `GUEST`/`BAIT` constants from that file. Independent
review verifies this dependency boundary rather than claiming every run used
an identical whole-tree archive. PR and main CI results are recorded with the
delivery; these results do not promote the overall SDD milestone to Passed.
