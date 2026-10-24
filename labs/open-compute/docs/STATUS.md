# Status and evidence

## M4 kernel closure qualification — 2026-10-24

The contract baseline was committed before implementation. A new M4-only same-PID
exec runner now uses a checked subreaper, bounded launch/wait/reader registry,
closed epochs and actual ECHILD before cold snapshots; deletion requires a
distinct fresh single-use terminal seal. Generic Process/command, storage.py,
M5/M7 and all other production inputs remain unchanged. Ambiguous sampled edges
are reported separately from kernel closure; no historical vanished role is inferred.

Worker focused51 tests pass in5.881s on Python3.11.17 with source stable.40 actual
owned-process case receipts include coordinator ECHILD, three real generations,
generic refusal versus kernel closure, live orphan, foreign/stolen wait, launch/
thread policy, root status/identity, bounded output, timeout and receipt failures.
An earlier source893611 had331 root offline passes in35.773s, unchanged source,
actual ECHILD and no unexpected children. Review then reproduced two expired
capability authorization defects; their RED evidence remains retained. Current
receipts/seals retain immutable original absolute deadlines and reject late
consumption; deletion also enforces the remaining original bound. Large CLI
output uses the existing bounded tail ring and can complete normally.
Current frozen source digest:
`57be515883f0933712f89517a2ac7526d1b82eff79544c48d839e9603247a566`.
See [implementation report](../tasks/548-m4-kernel-closure/report.md).
Root reports332 full offline passes on the corrected source and T078 independent
ACCEPT, including expiry/overrun/tail-ring probes. The separately authorized original M4 run passed in61.007s in a fresh non-root,
network-disabled container, with unchanged16 runtime/workload inputs and the
original pinned artifact. All five M4 and eight functional checks passed;
three epochs waited for5/13/13 registered launches, closed with actual ECHILD,
completed all cold snapshots and released locks. Final fresh kernel proof
authorized owned scope removal; the container is absent. The first sample
contained one stable child and zero ambiguous edges; synthetic tests separately
exercise transient ambiguity and live-orphan refusal.

[Actual sanitized report](evidence/2026-10-24-m4-kernel-closure.json) and
[exact source/artifact binding](evidence/2026-10-24-m4-kernel-closure-source.json)
retain the working-tree/base distinction. Necessary hosted CI and normal merge
remain delivery gates. Historical failures and unknown exact attribution remain;
whole-mainline acceptance and usable_tag remain incomplete/none.

## Issue548 diagnostic continuation — 2026-10-24

Repeated reads of a latched process-edge refusal could erase its specific reason
before M4 recorded the failure. The five rethrows now preserve the existing
allowlisted reason. Regression42 failing subcases before correction becomes
25 focused passes;319 full offline tests pass on Python3.11.17 with source hashes
stable and verified child collection. See [scope and evidence](../tasks/548-observation-reason/report.md).
Independent review accepts the repair after25 focused tests and a real-process
GREEN: child_missing survives stop/projection while cleanup still refuses success.
Exact-head CI/publication remain required. No new local original-runtime result is claimed; historical M4/AC-05 and whole-mainline acceptance remain open.

## CI fixture portability follow-up: T071 (2026-10-24)

The first PR585 hosted offline check failed7 assertions/14errors because generated
temporary scripts relied on caller PYTHONPATH. The fixture scripts/coordinators
now explicitly load the trusted checkout; both new test classes remove ambient
PYTHONPATH. Full318 tests then passed in39.238s under Python3.11.17 with no
PYTHONPATH, stable hashes, final ECHILD and no unexpected descendants. Final freeze:
`aa7c3c86935ee78ce04ed1542aa68469760cc30a400a43f59733c3ba47944fe2`.
Only test_lab.py/test_trial_supervision.py changed after the runtime freeze below;
the [source binding](evidence/2026-10-24-m7-supervision-source.json) records both
identities. Product/runtime bytes and assertions remain unchanged. The first CI's
M7/crash/retry/storage jobs passed; its offline failure remains failed. Fresh
exact-head CI is required for publication acceptance.

## Reviewed M7 runtime repair: T069 (2026-10-24)

T067 independently accepted the frozen implementation; root independently reran
318tests/39.283s with matching hashes and final ECHILD/no unexpected children.
One fresh original v0.2.4 M7 trial then passed in80.892s: M7-01–05 all passed,
20 expected command results, three daemon generations and three nonforced
SIGTERM/exit0 cleanup receipts. Retained data, explicit scope removal and evidence
publication passed. Actual environment was UID1001/Linux x86_64/Python3.12.3 in
the pinned network-disabled container; no timeout, source drift or remaining
owned container occurred. [Report](evidence/2026-10-24-m7-supervision.json) and
[exact source/environment binding](evidence/2026-10-24-m7-supervision-source.json)
are sanitized public evidence. Their harness commit records the working-tree base;
the reviewed30-file hashes identify the tested repair. Exact publication/CI is
separate. The old trial FAIL remains historical; M4/AC-05 remains unresolved.

## Current lifecycle implementation: T066 (2026-10-24)

The M7-only same-PID delegated owner is implemented. The final frozen offline
gate passes318tests in39.636s on Python3.11.17; all30 code/workload/build hashes
match before/after. Final ECHILD follows collection of only the exact known M5
SIGKILL fixture orphan; no unexpected child remains. Source digest:
`71a4040e996cc06f6c8b6390d95d7e437b488f98b54fa3436ba95ac8d8c07b55`.
The [current SDD](SDD.md) defines READY/ADMIT/CLOSED/ACK with closure nonce,
absolute cleanup bounds, typed clean_pending and parent-after-exit clean commit.

Earlier317/oneERROR and failed baseline/candidate resource timing pairs remain
retained. The reviewed fixture correction gives all four scheduled resource
samples a full interval; production timing/guards and prior assertions remain.
This local result supersedes T063's production-unchanged checkpoint below.
Final independent review, original-runtime verification, CI and publication remain
separate. T066 ran no actual upstream runtime. The previous retained trial FAIL
and historical M4 uncertainty are not erased; AC-05/mainline/tag status is unchanged.

## Historical lifecycle causal/design checkpoint (T063)

On base `27a5dde13be6c7fcc057d3777558f61b1d06fa1f`, two bounded synthetic
process probes pass: controlled inner `lab.command` reap deterministically
causes an outer `child_missing` refusal, and an intermediate's exit can leave a
different-process-group descendant alive outside the observed owner. A separate
fixture-only subreaper collected that descendant. Private numeric correlation
receipts are preserved by the shared launcher; no production module or original
runtime was changed/run. This establishes a possible mechanism, not the exact
historical vanished role or a repaired trial. The [proposed acceptance contract](SDD.md)
requires kernel descendant-completion proof, stable owner identity and fail-closed
cancellation/unknown handling before implementation review. Mainline and AC-05
remain incomplete/failed. See [checkpoint report](../tasks/548-lifecycle-admission/report.md).

## Issue548 historical failure reconciliation (2026-10-23)

The five reported Actions job logs were retrieved, rather than expired: an initial
CLI terminal-escape refusal was resolved by explicitly saving the response privately.
Only fixed report facts were extracted; raw logs remain private and are not artifacts.
Seven-day artifact expiry and Actions log access are distinct. The new diagnostic
artifact/30-day retention maintenance does not by itself repair runtime behavior.

| Historical run / job | Recorded checkout and symptom | Existing subsequent source change |
| --- | --- | --- |
|39048597519 /117442274247 |35d899827f2c12a67eb3a03ee2329b32f7045d20: cold_after_writes ownership, cleanup schema; final shutdown reports parent-edge observation change | M4 remains unresolved; keep the current ownership refusal and original AC-05 failed until new causal evidence. |
|39027518316 /117381325258 |bf0187bd20a526380ad5badf3956d5179eeda900: first_owner/bootstrap | c4ddd3852865a2241ff47a50b30161c88627523a waits for the retained instance before connecting, with three regression cases. This chain does not prove every bootstrap failure is the same race. |
|38687989780 /116267162297 |f6b09f0141bd28e10f79f9b31508b947e1ae85d3: checkpoint_crash identity, cleanup schema | cff9b8cce948fdaa001e8080cf1a40e3a5b897f0 waits within the existing deadline for direct-child reaping after /proc becomes nonlive; preserves required SIGKILL/-9 with three regressions. |
|37726578369 /113146007761 and37725768008 /113143448784 |9bb0f5534fb9ea7e2000e3ac6f68cfeb35838dca and2ee27650d672efac686a46c4d6c1070984e21539: cold_locked hard-link refusal, after M1 passed | e8c60d71154e99ce766d6a1ffe81cc0dbf311700 excludes only the reproducible binary-derived OCR subtree, preserving persistent hard-link refusal and adding real roundtrip/negative regressions. The old reports do not identify the actual hard-linked path; attribution remains source-derived. |

Run head_sha is not necessarily the PR merge checkout recorded by the harness.
Current offline290-test pass covers the existing regressions and new projection/
ownership-refusal tests; it does not replace the required real profiles or explain
M4. Current one-shot fresh-container outcomes: restore9/9 PASS, checkpoint-crash5/5 PASS,
retained-manual FAIL at first_owner (original bootstrap/child_missing, later cleanup
shutdown), storage5/5 PASS. No profile repeated, all owned containers stopped; exact
source manifests and private/public evidence boundaries are in
[tasks/548-failure-diagnostics/report.md](../tasks/548-failure-diagnostics/report.md).
The current trial failure and historical M4 cause remain unresolved; diagnostic
improvement and a single M4 pass do not mark548 or mainline complete.


Updated: 2026-10-17 (operator date; CI timestamps below use UTC).

## M7 result

**Passed on the original open-compute v0.2.4 release.** A fresh non-root Linux
runner exercised the retained manual path using separate owner/client processes.
Initialization deployed the original Worker/D1/Workflow and stopped with its data
retained. Repeated initialization refused without changing the manifest.

Three subsequent foreground owners served finite commands. Duplicate submissions
returned the same single D1 row; conflicting payload input was rejected unchanged.
The first owner created the original waiting Workflow and stopped. The second
verified the original deployment, row, Workflow and nonce before approval; the
third read back completed state after another stop/start. All three stops recorded
SIGTERM, exit 0, no force and all observed owned generations exited. State existed
after each stop. Only explicit cold destroy removed the exact owned runtime scope;
the private state directory remained. M7-01 through M7-05 passed, with the fixed
20 command responses (including the two expected refusals), three distinct daemon
generations and three clean stop receipts.

The [M7 contract](SDD-M7.md), [operator steps](quickstart.md#9-operate-a-retained-manual-trial-m7)
and original [sanitized report](evidence/2026-10-17-m7-ci.json) describe this result.
Report SHA256: `e2f06e69e16efcccb324603944eb18263dcea22bb9e8629c9d84f0dceb7ba847`.
Historical M1–M6 implementations, contracts, fixtures, release pin and reports
remain unchanged.

### M7 design and execution provenance

| Item | Exact reference |
| --- | --- |
| Independently reviewed SDD before code | [`8e81d9ae`](https://github.com/fallrising/newclear/commit/8e81d9ae), path/UTF-16 clarification [`4bc1ce11`](https://github.com/fallrising/newclear/commit/4bc1ce11) |
| Reviewed implementation and readiness correction | [`9c25b62f`](https://github.com/fallrising/newclear/commit/9c25b62f), [`c4ddd385`](https://github.com/fallrising/newclear/commit/c4ddd385) |
| Candidate including current main | `4e2d74bf299f72eb55930f2dcb1f7e597d80f43b` |
| Actual CI checkout | [`edd46382`](https://github.com/fallrising/newclear/commit/edd463825d37b95b6980b5ae56b2d34892073471) |
| Tested complete Git tree | `bcfa98bda4ca998b83bd4f8309f1ad5ad14b6e96` |
| Original successful runtime CI | [Run 39030725849](https://github.com/fallrising/newclear/actions/runs/39030725849), [M7 job 117390467939](https://github.com/fallrising/newclear/actions/runs/39030725849/job/117390467939) |
| M7 runtime step window | 2026-10-17T11:58:53Z through 2026-10-17T12:00:13Z |
| Environment | Linux x86_64, EUID 1001, Python 3.11.17; Ubuntu 24.04 runner |
| Original fixture SHA256 | `4618b185c706f1895856a881cd5b7426229931328f7725db7adbbda5fe7c0a37` |
| Upstream identity | Original v0.2.4/source `73efa56a1b1ad51a4519b2253ffaa499cb29fb2d`; unchanged artifact/SHA256 in [the lock](../upstream.lock.json) |

The actual checkout is GitHub's synthetic merge of main `ffe09f07` and the
candidate. Its full tree equals the candidate; emitted JSON and all seven report
artifacts match byte for byte. This checked-in report keeps its original checkout
attribution. Later documentation commits and validation reports do not become the
source of this observation.

### M7 verification and limits

Root's full suite and Python 3.11 CI each passed **276 tests, no skips**. All five
CI jobs and their steps passed, covering original-runtime M1/M2/M3, cold storage
M4, checkpoint SIGKILL M5, controlled retries M6 and retained manual operation M7.
Independent reviews covered manifest/protocol, owner/client, integration oracle
and original evidence. Meaningful regressions cover ownership and path replacement,
UTF-16 payload bounds, uncertain Workflow mutations, clean-shutdown authority,
full deployment identity, D1 detail identity, protocol framing, cleanup deadlines
and retained-instance readiness. Local tests used Python 3.13.5; original-runtime
and Python 3.11 evidence came from fresh CI, not the authoring account.

The [initial candidate run](https://github.com/fallrising/newclear/actions/runs/39027518316)
passed M1–M6 but failed before the first retained owner was ready. Its failure
report remains preserved. Review then found a missing wait for retained-instance
startup after shared daemon health; a bounded exact-identity readiness gate and
sanitized failed-owner diagnostics were added and reviewed. The initial generic
bootstrap error does not identify its exact underlying cause.

A later [integrated-main validation](https://github.com/fallrising/newclear/actions/runs/39048597519)
failed M4 at `cold_after_writes`: its unchanged process observer reported a
parent-edge change during shutdown. Exit 0 and no forced kill did not prove all
owned generations exited, so that cold observation and cleanup were refused.
The failed report is preserved. The generic observation error does not establish
its underlying cause or imply data loss. Historical guards remain unchanged;
this uncertainty is a limitation to investigate before sustained host use.

This is a finite CI rehearsal of the same foreground commands available to a
human operator. It does not install a machine, account, system service, resource
quota or detached daemon. The lease bound (default one hour, maximum 24 hours)
is not soak evidence. Use a fresh approved account with its real passwd home;
changing HOME cannot relocate the runtime. Stop retains data; dirty/unknown state
refuses resume or destruction and has no automatic orphan recovery.

The one Workflow per trial retains the original five-minute wait: resume/approve
must satisfy the same-boot clock checks within 270 seconds of creation. This does
not establish overnight waits or machine-reboot recovery. Host installation still
needs a concrete target, account/path, network exposure, data, resource and rollback
scope. Network loss, disk-full, concurrent submissions and long-running behavior
remain future tests. No production adoption, hostile-code isolation, power-loss,
capacity or external exactly-once claim follows; M4 cold endpoint differences
still cannot establish per-row costs.

## M6 result

**Passed on the original open-compute v0.2.4 release.** A fresh non-root Linux
runner executed three controlled callback-failure cases with one additional
attempt. Independent entries recorded attempts 1/2 and the explicit policy,
with a successful post-effect acknowledgement on each entry.

| Case | Callback entries | D1 effect rows | completed | Workflow terminal |
| --- | --- | ---: | ---: | --- |
| Unguarded transient failure | 1,2; throw,return | 2 | 1 | complete |
| Stable-key transient failure | 1,2; throw,return | 1 | 1 | complete |
| Exhausted retries | 1,2; throw,throw | 2 | 0 | errored |

Both successful outputs retained the original job/case and attempt 2. Exhaustion
returned success=false, output=null and the exact generic public Workflow error.
The sole step was `controlled-effect`, type `step`. Initial rows were empty of
effects/entries and incomplete; repeated terminal and D1 readbacks matched.
The cases charged 21 GET attempts against the shared 256 ceiling. This count
excludes setup/deployment probes and is not a timing or throughput measure.
The running daemon received SIGTERM and exited 0 without force; observed owned
generations exited, observers drained and verified scope removal/exclusive
sanitized report writing succeeded.

The [M6 contract](SDD-M6.md) and original
[sanitized report](evidence/2026-10-17-m6-ci.json) preserve this experiment.
Report SHA256: `85cf9c2712afb2318a973bce30ac333c4db9440f21fb3e28cc489d7540a29440`.
Historical M1–M5 contracts, fixture, release pin and reports remain unchanged.

### M6 design and execution provenance

| Item | Exact reference |
| --- | --- |
| Reviewed SDD committed before code | [`79180699`](https://github.com/fallrising/newclear/commit/791806999e6b218ebc3ab099bc323f36f4a3970a) |
| Independently reviewed implementation | [`2301ae06`](https://github.com/fallrising/newclear/commit/2301ae066302a18860b9c77bad9d9abb928f41a4) |
| Actual CI checkout | [`838203e5`](https://github.com/fallrising/newclear/commit/838203e59d6e044ca1a1a8172a464f181f27c45c) |
| Tested complete Git tree | `e777995d08ece82a8de1f0bd579d8574fd59490e` |
| Original runtime CI | [Run 38935855144](https://github.com/fallrising/newclear/actions/runs/38935855144), [M6 job 117091041565](https://github.com/fallrising/newclear/actions/runs/38935855144/job/117091041565) |
| Harness run ID | `20261016T165647Z-146e5138` |
| M6 runtime step window | 2026-10-16T16:56:46Z through 2026-10-16T16:57:11Z |
| Environment | Linux x86_64, EUID 1001, Python 3.11.17; Ubuntu 24.04 runner |
| New fixture SHA256 | `6802f38703ff91d28138b0eae2f80b31abe446dbbfb1fbe490a9043a40d8f1b9` |
| Upstream identity | Original v0.2.4/source `73efa56a1b1ad51a4519b2253ffaa499cb29fb2d`; unchanged artifact/SHA256 in [the lock](../upstream.lock.json) |

The checkout is GitHub's synthetic merge of main `6492e4f9` and candidate
`2301ae06`. Its parents and complete tree were read back; the tree is identical
to the candidate. Original emitted JSON and artifact contents match. Later
documentation/final validation commits and reports do not become the original
source of this observation. The report filename uses the operator date; actual
UTC run timestamps are retained above and inside the report.

### M6 verification and authoring limits

Root's integrated suite and Python 3.11 CI each passed **213 tests, no skips**.
All four CI jobs and steps passed, including original-runtime M1/M2/M3,
cold-storage M4, checkpoint-crash M5 and controlled-retries M6. M6-01 through
M6-05 passed. Contract/fixture/runner and CI/operator wiring received independent
review. Actual original logs, six reports and tested-tree provenance were
retained for independent evidence review.

Red-Green regressions covered the post-effect premise, strict counts/types,
readbacks, budgets, cleanup, write failures, an outer deadline expiring after
case completion, signal interruption during process ownership transfer, an
arbitrary failed-shutdown signal string and unsupported environment fallback.
The latter two were reproduced independently before correction and re-review.
Original failed test/review receipts remain retained. Local tests used Python 3.13.5;
original-runtime/Python 3.11 evidence comes from fresh CI, not the persistent
authoring home. Local `make` was unavailable, so its optional dry-run did not
execute; CI actually executed both `make check` and `make integration-retry`.
No provider/tool installation was needed.

Follow the [quickstart](quickstart.md) and run
`make -C labs/open-compute integration-retry` in a fresh disposable non-root
account. The keyed effect is one synthetic local D1 insert. Entry logging, effect
insertion, outcome acknowledgement and result settlement are separate operations.
Markers show the reached post-effect checkpoint/intended outcome, not an
independent exception trace or exclusion of acknowledgement-loss windows. Public
attempt/config history is a placeholder and was not used as proof. Generic
errors alone do not uniquely identify internal exhaustion. Finite stable reads
do not exclude future execution. No external exactly-once, in-flight crash,
power-loss, concurrency, soak, capacity, upgrade, isolation or production
adoption conclusion follows. M4 endpoint changes still cannot yield per-D1 costs.

## M5 result

**Passed on the original open-compute v0.2.4 release.** At the original
Workflow's publicly committed waiting checkpoint, a fresh non-root Linux runner
sent generation-checked SIGKILL to the daemon first and its frozen live child.
Both selected generations received their required signal and were observed
nonlive. The daemon was actually reaped with return code -9, retained observed
history was nonlive and both observer threads closed before a new daemon started.

GET-only comparisons retained the original scope/config/data/control/scheduler
identities, instance/account/D1 binding, deployment/version/runtime, D1 row and
waiting Workflow. Only then was approval sent to the original Workflow. It
completed with counter 1 and unchanged nonce/output. The restarted daemon exited
normally on SIGTERM; all observed owned generations exited, owned scope removal
and exclusive sanitized evidence writing succeeded.

The [M5 contract](SDD-M5.md) and original
[sanitized report](evidence/2026-10-16-m5-ci.json) preserve this exact experiment.
Report SHA256: `d73fe0d8aae3832cfc58fd167191c7ceba16cb6b0b1a2cb65d3dd5c0d3c0eb5a`.
Historical M1–M4 reports and the results below remain unchanged.

### M5 design and execution provenance

| Item | Exact reference |
| --- | --- |
| Reviewed SDD committed before code | [`3a6f08ed`](https://github.com/fallrising/newclear/commit/3a6f08ed9f7404e928004aebf202fc225fbc27dc) |
| Reviewed implementation | [`4bcfec49`](https://github.com/fallrising/newclear/commit/4bcfec49) |
| Independently reviewed direct-child reap correction | [`cff9b8cc`](https://github.com/fallrising/newclear/commit/cff9b8cc) |
| Integrated candidate | [`7658237f`](https://github.com/fallrising/newclear/commit/7658237fa23ce78bc1b15ae4ab702176fb621108) |
| Actual CI checkout | [`33cb32a9`](https://github.com/fallrising/newclear/commit/33cb32a90224d751197836082f5c51a3fa8a92a9) |
| Tested complete Git tree | `523e7c65280ce6fe5a43a1ddd2b55e20ef1b3bdf` |
| Actual runtime CI | [Run 38816939298](https://github.com/fallrising/newclear/actions/runs/38816939298), [M5 job 116703883935](https://github.com/fallrising/newclear/actions/runs/38816939298/job/116703883935) |
| Harness run ID | `20261015T222504Z-92a457c6` |
| M5 job window | 2026-10-15T22:24:59Z through 22:25:34Z |
| Environment | Linux x86_64, EUID 1001, Python 3.11.17; Ubuntu 24.04 runner |
| Upstream identity | Original v0.2.4/source `73efa56a1b1ad51a4519b2253ffaa499cb29fb2d`; unchanged 195537392-byte artifact/SHA256 in [the lock](../upstream.lock.json) |

The checkout is GitHub's synthetic merge of main `f87a823d` and candidate
`7658237f`. Its parents and complete tree were read back; that tree is identical
to the candidate. Later documentation commits and validation reports do not
become the original source of this observation.

### M5 verification ledger

| Gate | Observed result |
| --- | --- |
| Offline and independent review | Root and Python 3.11 CI each passed **189 tests, no skips**; actual separate-group SIGKILL, nested alarm, strict projection, GET-only, cleanup and reap-race failures covered; final source and raw evidence independently reviewed |
| Existing regressions | All M1 AC-01–08, M2-01–09, M3-01–05 and M4-01–05 passed in the same workflow |
| M5-01: original committed wait | Exact original pin/fresh non-root scope, trusted deployment, two submissions/one row and original publicly committed waiting Workflow |
| M5-02: abrupt stimulus | Two attempted and two completed SIGKILL signals; daemon generation `2200/12230`, child `2233/12748`; both exited, actual root return -9, retained history nonlive and observers closed |
| M5-03: original recovery | New daemon `2266/12832`; original authority/identity/deployment/D1 row/nonce and original waiting Workflow retained; six successful GET-only comparison requests before approval |
| M5-04: completion and containment | Same original Workflow complete, counter remains 1, nonce digest/output unchanged; restarted daemon was running, SIGTERM exit0/no force/no observation error, all owned exits and scope removal verified |
| M5-05: original sanitized evidence | Strict bounded crash/readback projection, exact artifact/source/environment, original report bytes/hash, cleanup and exclusive report write succeeded |

Process pairs above are PID/start ticks, not reusable PID-only authority.
The two observed targets had separate process groups; no PGID alone authorized a
signal. The abrupt lifecycle operation reported 0.014293728 seconds within its
ten-second bound. This excludes restart/recovery and is not an RTO or performance
claim. The six GETs count only successfully completed comparison requests;
startup/readiness probes and read-only CLI enumeration are outside that counter.
M5 does not mark historical graceful-restart AC-06 passed for the crash stimulus.

### Failures retained and authoring limits

The [first real run 38687989780](https://github.com/fallrising/newclear/actions/runs/38687989780)
failed M5 after both selected signals and observed exits: its earlier
`Popen.poll()` was still None, but the helper checked -9 before another reap.
No restart/readback/approval occurred and cleanup withheld scope removal. It
remains a failed result. A deterministic pending-poll/nonlive regression and
bounded reap correction were independently reviewed before this successful run.

Independent source review also reproduced fresh identity I/O after an already
fired watchdog; the corrected failure handler preserves only cached facts.
Actual nested-alarm regressions verify the fix. Earlier sandbox socket denials
remain recorded; root's full socket-enabled 189-test run passed on Python3.13.5.
Original-runtime evidence and Python3.11 execution come from the fresh CI runner;
no runtime was started in the persistent authoring home or patched to pass.

Follow the [quickstart](quickstart.md) and run
`make -C labs/open-compute integration-crash` on a fresh disposable non-root
account. M5 keeps the same runner/path/UID, kernel and filesystem alive and tests
one publicly committed wait with sequential observed-generation signals.
Unobserved/escaped descendants, atomic whole-tree crash, power-loss/fsync
ordering, arbitrary in-flight effects, external exactly-once behavior,
portability, upgrades, hostile isolation and production adoption remain unknown.
Application alarms cannot guarantee interruption of uninterruptible kernel I/O.

## M4 result

**Passed on the original open-compute v0.2.4 release.** A fresh non-root Linux
runner took three complete cold scope metadata snapshots under the existing
runtime locks. Between snapshots it restarted with the same authority,
confirmed sixteen fixed job IDs absent, submitted each twice with an identical
128-byte ASCII payload, read all sixteen original rows after the second restart,
and completed the original Workflow. Counter stayed 1 and nonce/Workflow ID
were unchanged. All three daemon sessions exited normally with SIGTERM;
observed owned generations exited and final owned scope removal succeeded.

The [M4 contract](SDD-M4.md) defines this fixed experiment. Its original
[sanitized report](evidence/2026-10-13-m4-ci.json) is preserved byte-for-byte;
SHA256 `b0e68342bf8b0ed17103c26dbef8be85a594aabeb1b240a243cfe80b35b13966`.
Historical M1/M2/M3 reports below remain unchanged. All three previous real
scenarios passed in the same workflow, alongside 153 offline tests with no skips.

### M4 design and execution provenance

| Item | Exact reference |
| --- | --- |
| Reviewed SDD committed before implementation | [`525d053`](https://github.com/fallrising/newclear/commit/525d05301befcb87510ba71c91ff124379fe042d) |
| Independently reviewed implementation | [`c76a422`](https://github.com/fallrising/newclear/commit/c76a422902a40a1bfd324daa5d4c4e713a980a25) |
| Actual CI checkout | [`58ed591`](https://github.com/fallrising/newclear/commit/58ed5911b8a24ef57ccaceb44e9d0dec90f4307f) |
| Tested Git tree | `be603af09a7c3810e0f758ef274dc7a8fcd6a51d` |
| Real-runtime CI | [Run 38397480850](https://github.com/fallrising/newclear/actions/runs/38397480850), [M4 job 115296297028](https://github.com/fallrising/newclear/actions/runs/38397480850/job/115296297028) |
| Harness run ID | `20261013T122806Z-3eb90b73` |
| Runner | Ubuntu 24.04, Linux x86_64, EUID 1001, Python 3.11.17 |
| Upstream identity | Original v0.2.4 / source `73efa56a1b1ad51a4519b2253ffaa499cb29fb2d`; unchanged 195537392-byte asset and SHA256 in [the lock](../upstream.lock.json) |

The checkout is GitHub's synthetic merge of main `7e854f26` and the reviewed
implementation `c76a4229`. Its parents and complete tree were read back and
fetched; the tested tree is identical to the reviewed head. Later documentation
commits do not become the original source of these measurements.

### M4 verification ledger

| Gate | Observed result |
| --- | --- |
| Independent review | Revised SDD accepted before code; scanner interruption findings reproduced/fixed/re-reviewed; fresh integrated source/CI/operator review accepted exact final hashes |
| Offline contracts | **153 tests passed, no skips** locally and on the Python 3.11 CI runner; real alarm/threaded signal, FD/lock, metadata/limit, sparse/hardlink and strict evidence failures covered |
| Existing real-runtime gates | M1 AC-01 through AC-08, M2-01 throughM2-09 and M3-01 throughM3-05 all passed in the same workflow |
| M4-01: original runtime and trusted controls | Exact original artifact, fresh non-root scope, actual Worker/D1 deployment, original duplicate row and committed waiting Workflow established |
| M4-02: complete bounded cold snapshots | Three complete locked snapshots, numeric units/groups/inode accounting and owned metadata checks passed; no partial scan became zero-valued success |
| M4-03: fixed batch and retained state | 16 absence checks,32 completed submissions,16 original retained reads after the second same-data restart; all exact counts and signed deltas validated |
| M4-04: completion and cleanup | Original Workflow completed with counter 1 and unchanged nonce; three distinct daemon generations, all SIGTERM exit 0 without force or observation error; owned scope removed |
| M4-05: sanitized evidence | Strict full extension/group sums/deltas and bounded whole report passed; original artifact bytes/hash, source/tree/workload/environment and measurement limits retained |

### Observed cold regular-file footprint

| Cold checkpoint | Logical bytes | Reported allocated bytes | Regular paths / unique inodes | Observed hardlink aliases |
| --- | ---: | ---: | ---: | ---: |
| Original Workflow waiting | 227765344 | 228343808 | 245 /243 | 2 |
| Fixed writes after first restart | 229213018 | 229797888 | 247 /245 | 2 |
| Original completion after second restart | 230447700 | 231038976 | 249 /247 | 2 |

The batch-stage endpoint difference was +1447674 logical bytes and+1454080
reported allocated bytes. The restart/read/completion endpoint difference
was +1234682 logical bytes and+1241088 reported allocated bytes. These differences
include platform/background/restart effects; **they are not exclusively D1
payload costs, a per-job ratio, a growth rate or capacity evidence**. The
synthetic unique payload total was 2048 bytes; no scaling threshold was imposed.

Each snapshot reported two hardlink aliases in the derived OCR group. In this
run, that group's reported allocation stayed 8953856 bytes and scope-transient
allocation stayed 204910592 bytes across all checkpoints. Those fixed group
enums are path partitions, not inferred internal products. The observer did
not inspect payloads or attribute transient files to a particular component.
The three snapshots took about 0.0111–0.0115 seconds, each under its ten-second
application budget; 552/563/574 entries were observed, including 307/316/325
directories and zero sockets. Directory/socket blocks are excluded from byte
figures. The 512-byte allocation unit means st_blocks, not a filesystem page size.

Unlike M2 backup payload counts, M4 includes OCR and transient regular files;
only the harness marker is excluded. It deduplicates observed `(device, inode)`
aliases. Scans are sequential and require cooperating cold runtime locks;
physical extents, reflinks/compression, same-device bind mounts, between-checkpoint
peaks, free capacity, whole-host storage, retention/reclamation and long-term
growth remain unknown. No host adapter or production adoption follows.

### Reproduce M4 and authoring limitations

Follow the [quickstart](quickstart.md) on a fresh disposable non-root Linux x64
account, then run:

```sh
make -C labs/open-compute check
make -C labs/open-compute preflight
make -C labs/open-compute integration-storage
```

The authoring account used Python 3.13.5 and the shared disk-backed launcher.
Root's final actual socket-enabled rerun passed 153 tests/no skips. Earlier
sandbox socket denials and a test socket's inherited unsafe mode were retained;
its fixture alone received explicit 0600 mode, without relaxing the scanner.
Descriptor leaks under actual alarms/threaded signals were reproduced and fixed
before acceptance. No runtime was started in the persistent authoring home;
original runtime and Python 3.11 evidence come from the fresh CI runner.
Application deadlines/narrow signal deferral do not promise interruption of
uninterruptible kernel filesystem I/O.

## M3 result

**Passed on the original open-compute v0.2.4 release.** A fresh non-root
Linux runner observed the lifecycle-authorized runtime process generations in
four fixed windows around a normal daemon restart. Both four-second read
windows completed exactly eight validated GET requests. The original D1 row,
waiting Workflow and persistent state survived; the same Workflow completed
with callback counter 1 and an unchanged nonce. Both daemon shutdowns exited
normally without forced termination, and the owned scope was removed.

The [M3 contract](SDD-M3.md) defines these bounded observations. The original
[sanitized report](evidence/2026-10-13-m3-ci.json) is preserved byte-for-byte;
its SHA256 is
`4dce0d7b24b31f99d6f1038dbed719393ef3b9fa745d14342a6dc62aff3eb3e0`.
Historical M1/M2 evidence below remains unchanged. All three real experiments
passed again in the same job, using Python 3.11 and the unchanged upstream pin.

### M3 design and execution provenance

| Item | Exact reference |
| --- | --- |
| Reviewed SDD committed before implementation | [`0cea629`](https://github.com/fallrising/newclear/commit/0cea629aaebd36f6ec3dfda75fc3b3f6fee57e4e) |
| Lifecycle generation fix and nested deadline clarification | [`fb80148`](https://github.com/fallrising/newclear/commit/fb8014855f61c2cd7740b3df057dce3f98f0aeb5) |
| Sampler dependency baseline | [`cd52145`](https://github.com/fallrising/newclear/commit/cd521452749638702d298eee69bcf650cba0a40a) |
| Independently reviewed implementation including sampler rework | [`dc9e5ec`](https://github.com/fallrising/newclear/commit/dc9e5ecdabb690a2c1f9b9922d189cad7c0a61ce) |
| CI checkout recorded by the harness | [`0855e2b`](https://github.com/fallrising/newclear/commit/0855e2b63329f0a78911e0f5bf2d3e9f03d956f8) |
| Tested Git tree | `ac10829a1dc54d7e91c4b2397334847704dcd00e` |
| Real-runtime CI | [Run 38377772191](https://github.com/fallrising/newclear/actions/runs/38377772191), [job 115230354252](https://github.com/fallrising/newclear/actions/runs/38377772191/job/115230354252) |
| Harness run ID | `20261013T094036Z-e5d357ea` |
| Runner | Ubuntu 24.04, Linux x86_64, EUID 1001, Python 3.11.17 |
| Upstream identity | `v0.2.4` / source `73efa56a1b1ad51a4519b2253ffaa499cb29fb2d`; unchanged 195537392-byte asset and SHA256 in [the lock](../upstream.lock.json) |

The recorded checkout is GitHub's synthetic merge of main `c0e2bf9` and the
reviewed revision `dc9e5ec`. Its parents and complete tree were read back from
GitHub and fetched locally; the tree is identical to `dc9e5ec`. Later evidence
and documentation commits do not rewrite the report's tested source identity.

### M3 verification ledger

| Gate | Observed result |
| --- | --- |
| Independent review | Reviewed SDD, fresh lifecycle and sampler reviews, then a fresh final integration/CI review; all concrete blockers resolved before acceptance |
| Offline contracts | **115 tests passed, no skips** in the root rerun and on the Python 3.11 CI runner |
| Existing real-runtime gates | M1 AC-01 through AC-08 and M2-01 through M2-09 all passed in the same CI job |
| M3-01: original runtime and trusted application | Exact original artifact verified on the fresh non-root runner; real Worker deployment, D1/Workflow and two submissions yielding one persisted row passed |
| M3-02: owned identities, units and bounded acquisition | Lifecycle retains PID/start-time generations and revalidates parent edges; recorded page/tick units and bounded helper protocol passed, with meaningful negative tests in the 115-test suite |
| M3-03: all four observation windows | Both idle windows had twelve valid scans; both read windows had sixteen valid scans and eight validated serial GETs; all attempted acquisitions succeeded |
| M3-04: normal restart, completion and cleanup | Daemon identities changed from `3138/30276` to `3271/33157`; state and Workflow ID survived, counter remained 1 and nonce unchanged; both shutdowns exited gracefully with all observed owned processes gone and scope removed |
| M3-05: bounded sanitized evidence and provenance | Strictly projected separate report written with exact source/artifact identity, workload, units, metrics, coverage and fixed limits; original report hash and historical evidence preserved |

### Observed resources for this run

| Window | Valid scans | Validated GETs | Peak sampled aggregate RSS (bytes) | Paired own CPU (seconds) |
| --- | ---: | ---: | ---: | ---: |
| Source idle, 3 seconds | 12 | 0 | 278769664 | 0.04 |
| Source read probe, 4 seconds | 16 | 8 | 281382912 | 0.12 |
| Restarted idle, 3 seconds | 12 | 0 | 145620992 | 0.05 |
| Restarted read probe, 4 seconds | 16 | 8 | 149368832 | 0.15 |

The runner reported 4096-byte pages and 100 clock ticks per second. All 56
attempted scans were valid, with zero skipped scheduling slots. The largest
observed acquisition gap was about 0.25005 seconds and the longest scan about
0.03938 seconds. Each phase observed at most two live authorized processes.
The report also records 12 or 16 missing observations per phase: lifecycle
history retains an already-exited process generation, whose absence does not
become an invented zero CPU contribution. CPU unpaired observations remain
explicit (14 in each idle window and 18 in each read window).

RSS can count shared pages repeatedly. Scans are sequential and can miss peaks
or short-lived descendants; CPU includes only paired observations of the same
generation within a phase and excludes unobserved intervals. Full-tree and
between-sample coverage remain unknown. The harness and observer helpers,
startup, shutdown, resume and cold backup are excluded. These single-run
observations do not establish capacity, memory savings after restart, latency,
saturation, full-lifetime CPU or tenant isolation.

### Reproduce M3 and authoring limitations

Follow the [quickstart](quickstart.md) on a fresh disposable non-root Linux x64
account, then run:

```sh
make -C labs/open-compute check
make -C labs/open-compute preflight
make -C labs/open-compute integration-resources
```

The M3 authoring account was non-root Linux x64 with Python 3.13.5. Its runtime
preflight passed without starting a daemon, but its persistent home was not used
for the experiment. Local `make` was unavailable, so the exact Python unittest
equivalent ran through the shared task launcher. Initial socket tests were
denied by the authoring sandbox; the authorized loopback rerun passed all 115
tests with no skips. Actual Python 3.11 execution and original-runtime results
come from the fresh CI runner. No upstream guard was bypassed.

## M2 result

**Passed on the original open-compute v0.2.4 release.** The real non-root CI
runner stopped the source daemon, verified a complete persistent-state backup,
actually removed the original scope, restored into a fresh directory tree, and
started a new daemon using only that backup. The original deployment/version,
bindings, D1 row and R2 object identity survived. The same waiting Workflow then
completed with callback counter 1 and an unchanged nonce.

The [M2 contract](SDD-M2.md) and [sanitized report](evidence/2026-10-08-m2-ci.json)
define and preserve this result. The report SHA256 is
`2783d20c636ebfbcae39dcd08fbf4771230bf4e52a446c2e55bff9e62fd12722`.
Backup payloads, inventories, configuration and keys were private temporary
data, removed during verified cleanup, and were not uploaded.

### M2 design and execution provenance

| Item | Exact reference |
| --- | --- |
| SDD committed before implementation | [`7cfa106`](https://github.com/fallrising/newclear/commit/7cfa106d89f59333f18d0fbda9876af3001360d6) |
| Source-preservation clarification | [`d2a1209`](https://github.com/fallrising/newclear/commit/d2a12099f70a2733db5ad2110ddd5434531bc947) |
| Initial implementation | [`bc61141`](https://github.com/fallrising/newclear/commit/bc6114140de7d76abe55654f7e679621f7ae6090) |
| OCR exclusion contract, committed before its code change | [`eb43f08`](https://github.com/fallrising/newclear/commit/eb43f0894173df0515c0a85a6fd832de451d69b7) |
| Reviewed implementation including the focused fix | [`e8c60d7`](https://github.com/fallrising/newclear/commit/e8c60d71154e99ce766d6a1ffe81cc0dbf311700) |
| CI checkout recorded by the harness | [`cee5753`](https://github.com/fallrising/newclear/commit/cee57533b12d7c63491f548d0ad0049b851af004) |
| Tested Git tree | `ef1e34f91654d027fe431698613f66f069889719` |
| Real-runtime CI | [Run 37727686546](https://github.com/fallrising/newclear/actions/runs/37727686546), [job 113149484970](https://github.com/fallrising/newclear/actions/runs/37727686546/job/113149484970) |
| Harness run ID | `20261008T042948Z-19a4afd7` |
| Runner | Ubuntu 24.04, Linux x86_64, EUID 1001, Python 3.12.3 |
| Upstream identity | `v0.2.4` / source `73efa56a1b1ad51a4519b2253ffaa499cb29fb2d`; unchanged exact artifact pin in [the lock](../upstream.lock.json) |

The CI checkout is GitHub's synthetic merge of main `216643e` and the reviewed
PR revision `e8c60d7`. Its two parent SHAs and complete tree were read back from
GitHub; the tree is identical to `e8c60d7`. The checked-in report preserves this
tested revision. Later documentation/evidence commits do not rewrite that
provenance or become the original source of the observations.

### M2 verification ledger

| Gate | Observed result |
| --- | --- |
| Independent review | Recovery/lifecycle and fixture/API/evidence reviews passed after resolving concrete findings; the precise OCR exclusion and two regression tests also received a focused independent review |
| Offline contracts on the real CI runner | **59 tests passed, no skips**; the existing M1 integration also passed AC-01 through AC-08 in the same job |
| M2-01: original artifact and environment | Exact 195537392-byte asset and pinned SHA256 verified; runtime reported `ocd 0.2.4`; real EUID 1001 and fresh owned source |
| M2-02: source application | Real Worker deployment, D1 write/read, duplicate submissions yielding one row, committed waiting Workflow, 64-byte binary R2 sentinel and immutable deployment/binding observations |
| M2-03: cold source | SIGTERM exit 0, no force or observation error, all observed owned children exited, all three exclusive source locks acquired |
| M2-04: complete backup | Source and saved package independently verified; **410 inventory entries, 134 regular files, 13,215,704 payload bytes**, including persistent configuration, keys, DB state and Local object authority |
| M2-05: actual source removal | Both original scope and data paths observed absent; source root `66305/2431129` replaced by pre-created staging root `66305/2431288` (device/inode) |
| M2-06: restore before spawn | Complete restored inventory verified against backup before starting the runtime; staging identity became restored scope identity; fresh regular files, modes and current UID checked |
| M2-07: original application recovered | Six GET-only readbacks confirmed original identities, deployment/version/runtime/bindings, D1 row and original waiting Workflow; R2 bytes, metadata, etag, version and uploaded timestamp unchanged |
| M2-08: original execution completes | Workflow `flow-20261008t042948z-19a4afd7` reached `complete`; same ID, callback counter 1, unchanged nonce and matching output |
| M2-09: final containment | Restored daemon SIGTERM exit 0, no force or observation error, all observed owned children exited; restored scope, staging and private backup removed; sanitized report written |

Daemon identities changed from PID/start-ticks `2453/6665` to `2528/8700`.
The recovered instance/account remained `01a119c655477605b3335c3697625f4b`.
Recovery did not run setup, redeploy, recreate resources or reseed data. The
original Workflow's persisted deadline continued to apply throughout recovery.

### Failure that refined the contract

The [first implementation run](https://github.com/fallrising/newclear/actions/runs/37725768008)
passed its 57 offline tests and M1, but M2 stopped at `cold_locked` with
`hard-linked file is refused`. It had not verified a backup or deleted the
source; the sanitized report recorded `source_preserved: true`. This was a
failed M2 run, and its result is not substituted for the successful run above.

Inspection of the fixed upstream source showed that every startup materializes
embedded OCR models with hard-linked language aliases under the exact
`instances/lab/data/tessdata` subtree. Those bytes can be regenerated by the
same binary. The [revised SDD](SDD-M2.md#5-quiescence-and-complete-backup) records
the source chain and narrowly excludes this binary-derived subtree. The failed
CI did not publish individual paths, so the attribution is source-derived.
Persistent hard links remain refused. Two new regressions exercise an actual
source-removal round trip and confirm that same-named business paths elsewhere
remain persistent, including refusal when those paths contain hard links.

### Reproduce M2 and interpret its limits

Follow the [quickstart](quickstart.md) on a fresh disposable non-root Linux x64
account with no existing runtime scope:

```sh
make -C labs/open-compute check
make -C labs/open-compute preflight
make -C labs/open-compute integration-restore
```

The experiment uses the **same runner, absolute scope path and UID**, with a
new directory tree and daemon. It establishes the recovery unit for this pinned
synthetic fixture after graceful shutdown and actual source removal. A different
physical host, OS/UID/path relocation, power loss, encrypted offsite retention,
version migration, HA, capacity, general API parity and a host adapter remain
unverified. The small backup size and successful Workflow completion are not
performance measurements or exactly-once guarantees for external effects.

The historical M2 authoring environment was UID 0 with a mismatched readable PID
namespace. It ran helper/contract tests only; it did not run the upstream daemon
or bypass its non-root guard. The runtime result above comes from the real CI
runner. The original M1 evidence below remains unchanged.

## M1 result

**Passed on the original open-compute v0.2.4 release.** A fresh non-root Linux
runner deployed the trusted Worker, wrote and read D1, reached a durable
Workflow event wait, stopped the actual daemon with SIGTERM, and completed the
same Workflow after restarting with the same data. The committed callback
counter stayed at 1 and its nonce did not change.

This is evidence for the bounded M1 contract in [SDD.md](SDD.md). The
[checked-in sanitized report](evidence/2026-10-07-m1-ci.json) preserves the
result independently of the CI artifact's seven-day retention.

## Design and execution provenance

| Item | Exact reference |
| --- | --- |
| SDD committed before implementation | [`474b7b1`](https://github.com/fallrising/newclear/commit/474b7b1db50cb9b1c9da155453566c15e84f41cc) |
| Reviewed implementation revision | [`bfaf410`](https://github.com/fallrising/newclear/commit/bfaf410ed1741bb763a42b2cd1106578b7deda0f) |
| CI checkout recorded by the harness | [`92816c4`](https://github.com/fallrising/newclear/commit/92816c4457e0691cdc29434b0c1716865f2af279) |
| Tested Git tree | `48fb4131787a9015cf3d6873a91692884f4bf9b4` |
| Real-runtime CI | [Run 37649927495](https://github.com/fallrising/newclear/actions/runs/37649927495), [job 112890282037](https://github.com/fallrising/newclear/actions/runs/37649927495/job/112890282037) |
| Harness run ID | `20261007T161024Z-b71e0e43` |
| Runner | Ubuntu 24.04, Linux x86_64, EUID 1001, Python 3.12.3 |
| Upstream identity | `v0.2.4` / source `73efa56a1b1ad51a4519b2253ffaa499cb29fb2d`; exact size and SHA256 in [the lock](../upstream.lock.json) and report |

Pull-request CI checks out a GitHub-generated merge commit. The recorded
`92816c4` has parents `92cc9a8` (main at execution) and `bfaf410` (the PR
revision). Its tree was checked against `bfaf410` and is identical. Later
evidence-only commits do not retroactively change the report's tested identity.

## Verification ledger

| Gate | Observed result |
| --- | --- |
| Independent review | SDD, fixture/API semantics, CI scope and lifecycle reviewed; all blocking findings resolved before this run |
| Offline contracts on the real CI runner | `make -C labs/open-compute check`: **29 tests passed, no skips** |
| AC-01: original artifact | 195537392 bytes; pinned SHA256 verified before execution; runtime reported `ocd 0.2.4` |
| AC-02: owned environment | Fresh scope, EUID 1001, loopback listener; refusal/no-clobber cases covered by contract tests |
| AC-03: real deployment | Worker deployed through v4, actual Worker response and D1 binding write/read succeeded |
| AC-04: duplicate submission | Two requests for the same synthetic ID yielded one persisted row |
| AC-05: durable wait | Original Workflow reached `waiting`; callback counter was 1 and nonce was captured |
| AC-06: actual daemon restart | Daemon PID/start-ticks changed from `2500/10715` to `2567/12774`; scope, instance, config and data identities stayed consistent |
| AC-07: resume | Workflow `flow-20261007t161024z-b71e0e43` reached `complete`; same ID, counter 1, unchanged nonce and matching completion output |
| AC-08: bounded cleanup and evidence | Both daemon shutdowns used SIGTERM, exited 0 without forced termination or observation error, and all observed owned children exited; scope removed and sanitized report written |

The first implementation also passed a real run with its original 17 tests:
[run 37647386810](https://github.com/fallrising/newclear/actions/runs/37647386810).
Independent review then found concrete failure-path gaps. The final revision
adds regression coverage for existing partial-file preservation, unknown
process/reader observations, total HTTP/download deadlines, and artifact/output
paths that overlap the runtime scope. The 29-test run above validates those
fixes together with the original runtime path.

## Reproduction and authoring environment

Follow [the quickstart](quickstart.md). From the repository root:

```sh
make -C labs/open-compute check
make -C labs/open-compute preflight
make -C labs/open-compute integration
```

Integration requires a real non-root Linux x64 account with a fresh disposable
passwd home and no existing `.open-compute` scope. The download requires access
to GitHub release assets. All workload inputs are synthetic.

The historical M1 authoring container was UID 0 and exposed a different PID namespace through
`/proc`. Its offline result was 29 tests: 27 passed and 2 native process tests
explicitly skipped. The original runtime correctly refuses that environment;
no upstream guard was changed. Both native tests executed and passed on the
real CI runner. The reported runtime success is from that runner, not a local
mock or a deployment on an operator's physical server.

## What M1 did not establish

No hosted Cloudflare comparison, general API parity, arbitrary-code isolation,
resource-limit stress, performance claim, multi-node/HA behavior, unclean crash,
full cold backup/restore, upgrade/rollback, production deployment, or host adapter
is established by this milestone. A committed Workflow step surviving normal
restart does not imply exactly-once external side effects.

M2 takes up the complete cold-backup question through its separately committed
SDD and evidence gate above. It does not retroactively change the scope of this
completed M1 run or establish a host adapter.
