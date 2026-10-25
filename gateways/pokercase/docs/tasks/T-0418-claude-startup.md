# T-0418 Claude startup directory cleanup

Contract: [SUCCESS SC-1–SC-3](../../SUCCESS.md#t-0418--claude-startup-directory-cleanup).

Started 2026-10-25T16:30:59Z; claim PR219 merged before product edits. Early returns and startup future drop precede the old reader-only run_dir cleanup. Scope is ownership of newly created MCP directories; no historical sweep, session changes or stdin timeout/cancellation protocol change. AC fixed before RED.

Estimate30–45active minutes including delivery;20minute checkpoints;initial reproduction plus at most2reasoned fixes per issue;each CI/build/test≤600seconds;source review8+2minutes,ledger4+1minute. Complete tool/provider/token/cost/active-wait metrics unknown/null.

Validation: focused RED/GREEN, filesystem boundary and fakeCLI lifecycle tests, full locked Rust/fmt/clippy/contracts/index, independent source and ledger reviews, CI/normal merge/remote readback.

Test-method correction before rerun (SC-2 unchanged): aborting reqwest's HTTP client task did not demonstrate that the server startup future was dropped; the process witness timed out. Preserve this failure; do not claim blocked-stdin HTTP disconnect is fixed. Verify the promised startup-future drop directly by aborting and joining its owned Tokio task after a fake Python child signals it is not reading a 1MiB stdin input. HTTP input-error and healthy continuation remain integration coverage. The healthy fake emits another tool call on the next user turn, so assert that existing behavior instead of expecting a text-only reply. Initial failed log retained. Each issue uses its first reasoned test-method correction.

Full-suite failure retained (full-first-failed.log): healthy sequence timed out waiting for directory expiry. Inspection found the final turn still awaited a tool result, so MCP callback timeout could emit another completion and reset waiting_since concurrently with expiry. The intended SC-3 idle-expiry witness must finish the final tool call first. Correct the fixture sequence by returning its result and observing a healthy completed reply before the unchanged3second expiry check (configured idle2seconds). This changes the setup, not the timeout or product contract; no MCP timeout/session behavior fix in this slice. This is the second reasoned correction to the healthy-sequence test; no further attempts without new decision if it remains unresolved.

## Observed evidence

| AC | Result | Evidence |
| --- | --- | --- |
| SC-1 | PASS | `sc1_spawn_failure_removes_only_its_tool_directory`:2tool failures and1no-tools failure preserve503/retryable, sibling and slot; original RED retained. `sc1_partial_setup_and_existing_paths_keep_ownership_separate`:existing path rejected,3partial private-file setup failures remove only owned path. `sc1_initial_input_failure_removes_tool_files`:HTTP502 input failure, directory absent before return, PIDreaped, sibling intact andone-slot healthy replacement. |
| SC-2 | PASS | `sc2_dropped_startup_future_cleans_directory_child_and_slot`:1MiB input with fake Python child not reading; alive=0 proves reader not installed, permit held and directory present. Direct abort/join removes directory, child PIDdisappears andslot reacquires. This tests startup-future drop directly, not HTTP disconnect propagation or explicit token cancellation. |
| SC-3 | PASS | `sc3_tool_files_survive_continuation_then_expire`:3private0600files survive tool return and next user turn inoneprocess, then idleexpiry removes directory. Existing session/reuse/cleanup regressions remain green. |

208tests/18groups, zero failed/ignored.10newscenario iterations across5tests (3spawn+1collision+3partialsetup+1drop+1inputerror+1healthy sequence); event/file loops and request counts are not separately inflated. Partial setup is a deterministic guard/write_private unit failure, not injected through the production setup closure. Production ownership transfer is inspected. Filesystem removal remains best effort; no cleanup guarantee against OS errors or process crash. No historical sweep/session changes, runtime dependency/permission or liveprovider/login/Docker calls.

Commands (each build/test bounded to600seconds; shared CARGO_TARGET_DIR):
- From workspace: `cargo +1.99.0 test --locked --manifest-path wt/newclear/claude-startup/gateways/pokercase/Cargo.toml --bin thinrouter sc1_spawn_failure -- --nocapture` -> RED exit101:2directories instead of1preserved sibling.
- From workspace: `cargo +1.99.0 test --locked --manifest-path wt/newclear/claude-startup/gateways/pokercase/Cargo.toml sc -- --nocapture` -> first exit101 (HTTP abort witness/healthy fixture expectation), corrected exit0 including all5new tests. The broad substring also selects existing regressions.
- Final corrected suite from workspace: `cargo +1.99.0 test --locked --manifest-path wt/newclear/claude-startup/gateways/pokercase/Cargo.toml` -> exit0, full suite below. The first full run used the relative component manifest from product root and failed the final tool/idle setup, preserved separately.
- From product worktree root: `cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings` -> exit0; `cargo +1.99.0 fmt --manifest-path gateways/pokercase/Cargo.toml --check` -> exit0.
- From product worktree root: `python3 scripts/check_project_success.py` -> exit0,43contracts; `python3 scripts/check_indexes.py` -> exit0,43contracts/6navigation indexes; `git diff --cached --check` -> exit0 including added task document.

Source review, requiredCI, normal merge/readback and board/journal/desk closure are publication gates. Complete tool/provider/token/cost/active-wait totals unknown/null.

## Renewed bounded diagnosis

Owner approved at recorded snapshot 2026-10-25T16:59:52.346365+00:00, after boardPR651 requiredCI failed SC-3 HTTP Request TimedOut at shared Env::chat line291 (20second timeout). Earlier local208/18 and productPR650CI remain historicalPASS. This diagnostic labels four HTTP request phases and fakeCLI MCP milestones, then runs one instrumented reproduction. Keep idle2s/cleanup3s/client20s and original acceptance unchanged;no realprovider/login/Docker calls. Estimate10–15active minutes,each command≤600s. Prior failures remain retained. No diagnosis result asserted yet.

Instrumented local reproduction:23/23claude_live_e2e tests passed;allfour SC-3 phases andboth MCP tool callbacks completed. This did not reproduce the failed CI and does not establish a fix. Restrict fixture tracing to the SC-3 marker;other tests retain prior fixture I/O. Publish diagnostic-only stage labels through native gates and one changed-source CI run to capture any recurrence on CI;no unchanged rerun or product behavior change. Prior PR651 failure remains unresolved even if this diagnostic run passes.

Full native validation reproduced the same22pass/1fail HTTP timeout at SC-3 final-result. The next-user snapshot already contains the second MCP reply andmsg_b2 end_turn before final-result begins. This identifies the stalled fourth request and a prematurely completed tool phase,not yet its cause. Add only a fixed-category MCP outcome marker(success/not-registered/tool-timeout/other-error),never raw response bodies;one hypothesis-driven diagnostic run distinguishes early callback registration from expiry. Original failed full log remains intact.

Classified integration run23/23passed, both tool outcomes success;the early-reply error classification remains unobserved. Second and final hypothesis-driven instrumentation refinement:add request durations and fixture timestamps,then validate once under the full-suite conditions that reproduced the failure,so a recurrence can distinguish a2second tool timeout from an immediate not-registered response. No timeout/concurrency change or unchangedCI rerun. After this capture,report confirmed facts versus hypotheses without further blind retries.

Diagnostic outcome: full-suite instrumentation reproduced the same22/23 HTTP timeout specifically at `final-result`, the fourth request. Before that request began, the fixture had already received the second MCP reply and emitted its second end_turn. This confirms phase/order, not the early reply's error category. The later fixed-category integration run passed23/23 withsuccess outcomes;final timed-marker full validation passed208/18. Intermittent failures remain unresolved,not fixed by tracing. No product runtime source changed.

Next minimum diagnostic/fix direction: inspect early callback rejection versus tool-timeout and ensure an already completed tool phase cannot accept a late result into a sink that will receive no further events. Source inspection shows `mcp_call` may reply immediately on no matching announcement or after idle timeout;the reader end_turn branch registers idle state but does not remove prior waiting entries,while continue_run can attach a new sink via those entries. This is a supported hypothesis,not a proven causal attribution for the originalCI. Do not loosen timing or mark PR651 complete from passing diagnostic runs.

Commands from workspace (shared CARGO_TARGET_DIR,600s bounds): `cargo +1.99.0 test --locked --manifest-path wt/newclear/claude-startup-diagnostic/gateways/pokercase/Cargo.toml --test claude_live_e2e -- --nocapture` -> initial23/23PASS; same component full `cargo +1.99.0 test --locked --manifest-path ...` -> reproducedFAIL22/23inClaude target; classified targeted run23/23PASS; finaltimedmarker full208/18PASS. `cargo +1.99.0 clippy --locked --manifest-path wt/newclear/claude-startup-diagnostic/gateways/pokercase/Cargo.toml --all-targets -- -D warnings` andfmt `--check` PASS. Product scripts/check_project_success.py/check_indexes.py andstaged whitespace gates apply. Independent review/onechanged-sourceCI remain publication gates.

## Gateway trace and continuation repair

Owner requested deeper logging andresolution at 2026-10-25T17:23:15.578450+00:00. Earlierdiagnosis locatedfourthHTTPrequest but didnottrace gatewaystate. Thisround captures nonsecret run-correlated callback/result/sink/completion transitions, establishesdeterministicRED,andfixestheoriginalSC-3 blocker withoutrelaxingtiming. Estimate30–45active minutes;20minutecheckpoints;perissueinitialreproduction+2reasonedfixes;eachcommand/CI≤600s;source review8+2min,ledger4+1min. Allpriorfailedattemptsremainhistorical;usageunknown/null.

Deterministic causal test: callback HTTP andstdout are independent delivery paths. The newtc1 fixture starts itssecond MCP callback beforepublishingthecorrespondingstdout tool event,usesgatewaydebug admissionstageasabarrier,thenpublishes it. ExistinghealthySC-3 sequence/deadlines/assertionsremainunchanged. Expectedpre-fixfailure:immediate not-registered callbackreply,unsolicitedend_turn withoutsink,thenlate tool-result requestattaches tostalewaitingstateandtimesout. This is an explicit I/O ordering test,not an unchangedretry.

Confirmed deterministicRED:gateway mcp_not_registered at17:26:23.868541,stdout reader_tool_waiting at.869651,unsolicited reader_end_turn+reader_no_sink(done=true) at.869810/.869820,thencontinue_tool_sink(idle=true)+tool_result_buffer at.871705/.871799 andHTTP20s timeout. This reproduces the observedphase4 failurecausally;the originalCI lacks internaltrace,soits exactschedule remainsunobserved.

Minimumrepair:wait forstdoutannouncement underoneexistingidle deadline sharedwithresultwait;serialize buffered-resultcheck/waiterregistration usingcalls→results lockorder;detach completed-message sender atomicallywithreuse publication underlive lock;onend_turn retirestalewaiting/pending/announcement/resultstate;alwaysreset/expire completedmessages evenwithnosink. Newresult/user sinks installunderthe same live lock,preventingoldcompletionfromclearinganewreceiver. No HTTP/idledeadlineextensionornewdependency.

## Continuation repair evidence

| Contract | Result | Evidence |
| --- | --- | --- |
| SC-3 early callback | PASS | `tc1_callback_before_stdout_registration_keeps_tool_continuation`:gateway admission barrier puts callback before matchingstdout;RED logs immediate not-registered thenend_turn/no-sink andstaleidleattach,HTTP20s timeout. Sameorder nowwaitsforannouncement,completesallfourrequests inoneprocess andremoves0600MCPfiles atsameidle2s/observation3s. |
| SC-3 callback coordination | PASS | `tc2_early_callback_and_both_result_delivery_orders`:2cases forbuffered-beforecallback andwaiter-before-result,includingannouncementwake;`tc2_missing_announcement_is_bounded_or_cancelled`:2cases formissingannouncement timeout/stop. Calls→results lockorder closes thecheck/registergap. |
| SC-3 turn ownership | PASS | `tc3_completion_does_not_retire_the_next_requests_sink`:oldterminal reachesoldreceiver whilethenewturnreceiver remainslive;`tc3_unsolicited_completion_retires_all_waiting_tool_state`:2cases with/withoutactive sink,staleindexes/buffers/waitersremoved andlatecontinuationrejected. |
| SC-3 late-result fallback | PASS | `tc4_late_tool_result_uses_replacement_after_completed_phase`:forceunsolicitedcompletion,thenlateclienttoolresult;HTTPcompleteswithin3s through existingfull-conversationfallback,starts2 withmaxruns1,oldrundirremoved,gracefulshutdownremovesreplacementdirectory. |
| SC-1/SC-2 compatibility | PASS | Originalstartupfailure/futuredrop/owned-directorycases andfull214tests/18groups;no status/fallback/permission/dependencychange outside the repairedtoolphase. |

Six new tests,9scenario sequences:7unit (2+2+1+2),2HTTP lifecycle. Full214/18,fmt,Clippy,43contracts/6indexesPASS. No failedimplementation attempt after deterministicRED;earlierhistoricalfailures remainvisible. Productioncode now waitsforstdoutannouncement andtoolresult withoneshared existingidledeadline;unknownannouncement still returnsfixederror atdeadline,invalidtoken/stopbehavior remainsbounded. Completion takesoldsender beforepublishingreuseunderlive mutex;newrequestinstallation shares thatmutex. Even withoutsink,completionresetsfilter/retireswaitingstate/schedulesexpiry. Healthyresponses/toolnames/ids/contentunchanged.

Opt-in troubleshooting: `RUST_LOG=thinrouter::claude_lifecycle=debug` emits numeric process-local run_id andfixedstage/booleanmetadata only. No callbacktoken,sessionid,requestbody,toolname/arguments/resulttext is logged. The fakegateway captures this target toper-testtemporarygateway.log andattachesit tofailedstage diagnostics. The controlledordering fixture usesfixeddebugadmission stages tocoordinate the twoI/Opaths; it is not a realprovider test. Productiondefaultloglevel is unchanged.

OriginalCI had nointernalgatewaytrace;the controlledRED establishesa reproduciblecause ofthe sameobservedsymptom,not certaintyabout that historicalrun's exactschedule. No realprovider/login/Docker orwholeproductacceptance. Review/necessaryCI/normalmerge/readback andcompletionoforiginalboardPR651 remainpublicationgates.

Commands from workspace, shared CARGO_TARGET_DIR and600second bound:
- `cargo +1.99.0 test --locked --manifest-path wt/newclear/claude-continuation-fix/gateways/pokercase/Cargo.toml --test claude_live_e2e -- --nocapture`: initial gateway-trace capture23/23PASS;no falsefixclaim.
- Same manifest/target with `tc1_ -- --nocapture`: deterministic RED exit101,20.10s;afterfix sameeventorder GREEN exit0,2.11s includingidlecleanup. Logs retained.
- Same manifest with filter `tc -- --nocapture`: sixnewtestsPASS,includingcontrolledearlycallback andlate-resultfallback plusunitorder/cancel/cleanup cases.
- `cargo +1.99.0 test --locked --manifest-path wt/newclear/claude-continuation-fix/gateways/pokercase/Cargo.toml`: final214tests/18groupsPASS,zerofailed/ignored.
- From productroot: `cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings`: PASS6.38s;fmt `--check`: PASS.
- From productroot: `python3 scripts/check_project_success.py`, `python3 scripts/check_indexes.py`, `git diff --cached --check`: PASS43contracts/6indexes andstagedwhitespace.
