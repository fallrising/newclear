# Chromium terminal-cleanup regression patch — NOT_RUN

> 2026-10-28 owner決定：依已交付18項結案，Fanzloud暫緩且未完成（8/27、007FAIL/consumed、PR604Draft）。停止延伸Chromium調查；下方舊「下一步」僅為歷史提案，不是待執行工作。唯一恢復入口：[issue706](https://github.com/fallrising/newclear/issues/706)；[結案範圍](https://github.com/fallrising/newclear/blob/main/docs/fe-review/ROUND2-CLOSEOUT.md)。沒有新runtime/build/model授權。

> Latest checkpoint: [the bounded environment check](ENVIRONMENT-FEASIBILITY.md) is complete; no compatible existing Blink test route was identified in the inspected scope. Compilation/execution remain NOT_RUN. Its single next recommendation supersedes the earlier environment-check proposal below.

T-0380 / R2-AC-14 and R2-AC-E. This is the bounded test-patch artifact requested by the [completion plan](../FANZLOUD-COMPLETION-PLAN.md), following owner continuation on 2026-10-28. It is **not compiled or executed**. No Chromium checkout/build, source-slice model, browser attempt, application/engine fix or dependency change accompanies it.

The [patch](response-body-loader-terminal-cleanup.patch) changes only `third_party/blink/renderer/platform/loader/fetch/response_body_loader_test.cc` at Chromium commit `971a7443b0c9b0a9b2860529b33331b76077ec62`. It adds nine gtest cases, three terminal-callback counters to the existing `TestClient`, and a `TerminalCleanupClient` that checks public state before reading and cancels on closed/error notification. It invokes the real delegate; it does not reimplement its state machine or instantiate a real BodyStreamBuffer/V8 context.

## What was verified

Original source/test bytes match their prior Git blob and SHA256 receipts. `git apply --check`, actual apply to a disposable copy, reverse-check and reverse-apply passed; applied bytes match the saved candidate and reversing restores the original bytes. Only the test file is in the patch. This proves static applicability, not C++ compilation, engine behavior or an observed RED/GREEN result. [Provenance](provenance.json) fixes the original/patched/patch hashes and the exact source paths.

The test API spellings and usage patterns are visible in the saved upstream tests. Their full headers, BUILD target, complete include graph and actual test binary have not been validated in a Chromium build. A future approved executor must establish those before compilation. No local `clang-format` executable was available; formatting is manually matched to nearby test code, not formatter-verified. Repository documentation/CI checks do not compile this embedded patch.

## Behavioral oracles and limitations

For live, completely driven terminal cases, `ExpectTerminalCounts` checks exactly one expected finish/fail/cancel callback and zero alternatives. `ReplayingBytesConsumer::IsCancelled()` separately checks whether the underlying consumer was cancelled. This is a boolean observation, not an underlying Cancel invocation count. The cleanup client checks that the loader has not reported a terminal while its notification callback is still active; R1/R2 also check the data received by both clients and closed/error notification counts. Repeated draining of the task queue and explicit repeated-cancel controls check late/duplicate terminal behavior.

These assertions avoid reading the delegate's private state. The underlying `ReplayingBytesConsumer` and `FakeTaskRunner` are upstream test helpers. They exercise notification ordering under their own scripted semantics; they do not reproduce the Mojo completion signal, no-store fetch wiring, GC, real scheduler timing, ResourceLoader/inspector propagation or the actual007 binary. The R1/R2 client only represents BodyStreamBuffer's terminal-state-first cleanup rule, not the stream's JS behavior.

All results below are **predicted from source, NOT_RUN**. “Expected mismatch” means an assertion intended to fail on the original implementation; it is not recorded RED evidence. The original-source predictions and desired classification remain subject to real build execution and upstream contract review. No engine fix is selected.

| Plan row | Added test / coverage | Predicted original result and assertion | Status / gap |
| --- | --- | --- | --- |
| R1 | `ClosedNotificationCleanupPreservesFinish` | Wait → data `hello` → wait → done; terminal-state-first client cancels. Original is predicted to report cancel and set underlying cancelled. Assertions require finish=1/fail=0/cancel=0 and underlying not cancelled. | PATCHED / NOT_RUN; expected mismatch, not observed RED; real DataPipe/BodyStreamBuffer path remains untested |
| R2 | `ErrorNotificationCleanupPreservesFailure` | Same data/wait sequence ending in error. Original is predicted to report cancel. Assertions require finish=0/fail=1/cancel=0 and underlying not cancelled. | PATCHED / NOT_RUN; source error analog, not an observed007 error |
| R3 | `CleanupAfterBeginReadDoneDoesNotCancel` | Existing ReadingClient latches done via BeginRead; later cleanup Cancel must not add a callback or cancel underlying. | PATCHED / NOT_RUN; predicted finish once |
| R4 | `CleanupAfterDataAndDonePreservesDataAndFinish` | Existing ReadingClient consumes nonempty DataAndDone; no terminal before task driving; data remains `hello`, finish once after queue drain, later Cancel inert. R1 separately covers data followed by delayed terminal notification. | PATCHED / NOT_RUN for those two scripted orders only; not all real lookahead/timing permutations |
| R5 | `RepeatedReadableCancelNotifiesExactlyOnce` | Live readable/waiting consumer cancelled twice before queue drain, then again afterward; only one cancel callback, no finish/fail; underlying cancelled. | PATCHED / NOT_RUN; predicted unchanged control |
| R6 | `AbortSuppressesLateTerminalAfterCleanupCancel` | Queue wait/done, Abort loader twice; cleanup client sees error and cancels; late loader terminal callbacks remain zero, underlying cancelled and one client notification. | PATCHED / NOT_RUN; loader Abort with this client, not real JS AbortSignal/context destruction |
| R7 strict | `StrictSuspendThenProducerNotificationFinishesOnce` | Suspend while a notification is queued; no data-client/terminal progress and pending command remains. Resume, then explicitly call producer `TriggerOnStateChange`, drain queue: finish once. | PATCHED / NOT_RUN; explicitly **not** a Resume-alone liveness claim |
| R7 BFCache | `DrainedCompletionIsDeferredUntilResumeExactlyOnce` | Reuse existing BFCache feature fixture. DataAndDone is read while buffered; terminal delivery remains zero until Resume and task driving; then finish once. | PATCHED / NOT_RUN; BFCache behavior kept separate from strict suspension |
| R8 | `CompletionWithoutRegisteredConsumerClientFinishesOnce` | No delegate SetClient; loader remains live, not aborted/suspended. Drive wait/done, finish once; later Cancel inert. | PATCHED / NOT_RUN; not equivalent to context destruction |
| R9 | No new test; real context/AbortSignal fixture required | BodyStreamBuffer::ContextDestroyed explicitly CancelConsumer; must check actual context lifecycle without forcing a successful finish. | GAP / NOT_RUN; saved abort tests provide starting points, not coverage of this delegate combination |
| R10 | No new test; actual caught CloseStream exception fixture required | Caught exception exits Close before CancelConsumer; do not assume page-read success or a particular loader terminal. | GAP / NOT_RUN; no validated way to trigger this V8 branch in the available fixture |

R7's explicit producer notification is deliberate: the saved `ResponseBodyLoader::Resume` posts its own `OnStateChange` when no terminal is pending; that method returns when the loader has not been started. A drained consumer's strict-resume liveness is therefore not established by assuming Resume dispatches its delegate. The proposed control drives a new upstream consumer notification instead. This does not diagnose another runtime bug or change production behavior.

## Existing helper and source mapping

All line references below refer to the **original** pinned files, not patched line numbers. [Provenance](provenance.json) contains the full public URLs and hashes. No API was fetched or installed during this work unit.

| API / behavior | Evidence in saved source | Use / remaining uncertainty |
| --- | --- | --- |
| `TestClient`, `ReadingClient`, `MakeResponseBodyLoader` | `response_body_loader_test.cc:44–175` | Existing fixture types retained; callback counters are additive test instrumentation |
| Wait/Done and Wait/Error asynchronous notification | same file `1128–1206` | R1/R2 extend the upstream sequence with actual data and an additional wait; actual execution still needed |
| DataAndDone, EndRead, nonempty data | same file `1012–1062`, `1207–1246` | R4 and BFCache use the existing pattern rather than assigning private lookahead state |
| `Cancel`, asynchronous cancellation | same file `1099–1126` | R5 adds repeated-call and callback-count assertions |
| `Abort`, reader error, zero terminal callbacks | same file `851–910` | R6 preserves the aborted guard; cleanup-client behavior is explicit |
| `TriggerOnStateChange`, `IsCommandsEmpty`, strict suspension | same file `482–530` | R7 uses public producer drive; no Resume-alone claim |
| BFCache feature configuration and pending completion | same file `1248–1311` | Reuses fixture with both existing features and runtime flag; validates no new feature setup |
| `ReplayingBytesConsumer::IsCancelled` | `body_stream_buffer_test.cc:617–631` | Same pinned helper used in an existing test; observes boolean, not call count; header/build remains unverified |
| Terminal callback ordering, Cancel guard | `response_body_loader.cc:127–245,268–291` | Desired classification tested through callbacks rather than private enum inspection |
| Abort/suspension/resume | same file `445–490,518–588,589–591` | Distinct zero/deferred/terminal expectations, not a universal exactly-one oracle |
| Actual stream cleanup / context destruction / caught exception | `body_stream_buffer.cc:384–407,502–555` | R9/R10 gaps remain; the new client cannot certify V8/GC behavior |

## How the artifact can be used later

In a separately approved checkout of the exact Chromium commit, first verify the source hash and apply the patch with `git apply --check` before applying it. Determine the real BUILD target and required test initialization from that checkout; no unverified build command is prescribed here. Compile/run the nine named cases only after the required environment and cost scope are established. Record exact source, binary/build configuration, command, per-test outcome and original failure assertions. A test-only diff containing intended failing assertions is an investigation artifact, not a production patch to merge into Chromium unchanged.

Accept an original-engine RED only when the R1/R2 assertions actually fail for the predicted classification, with controls independently passing. Build errors, unknown target, unexpected scheduling, or failed control cases are different outcomes and must not be relabelled RED. If a trigger passes, first compare the actual build, helper semantics and preconditions; revise the hypothesis if evidence contradicts it. A handwritten model or optional source slice cannot replace this gate.

## Reassessment and unchanged product gates

Patch preparation is complete at the static artifact level. The unresolved issue is a genuine executable Blink test route, plus the R9/R10 integration fixtures and real DataPipe/BodyStreamBuffer reachability. **Next recommendation: a bounded read-only feasibility check for an existing compatible Blink test environment and its build/source correspondence.** Do not download/build Chromium or start a browser as an implicit continuation. If no compatible route is available within that check, report the exact environment/fixture gap and reassess one alternative from the parent plan; do not create another model of the engine to manufacture a pass.

Keep recovery007 FAIL/consumed, its unknown actual root cause, strict body/health/identity/cardinality/cleanup, canonical8/27,delivery18/19 and PR604Draft. This patch does not prove a fix, runtime acceptance, source/binary correspondence, or completion of the FE round. All older failures, dirty work and backups remain retained.
