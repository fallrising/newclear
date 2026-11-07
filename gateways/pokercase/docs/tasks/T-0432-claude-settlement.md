# T-0432 Claude Code stream settlement

Owner approved this bounded continuation on 2026-10-28; desk PR276 claim merged c33fb64dc06385ae95db40a2f9943801369af6b8. Existing forwarding is retained. Generic HTTP three-client settlement is already delivered. Original17AC, T1102, mainline incomplete/usable_tag none, full#698 and#699–702 remain unchanged.

## Fixed acceptance

- CS-1: Claude provider streaming through Chat/Messages/Responses reserves a unique attempt before each actual spawn, live-user input or tool-result dispatch. Internal saved-session retry and external fallback share request_id but have distinct attempts. Reservation failure dispatches nothing and cannot trigger inference retry.
- CS-2: Observe untouched raw stream_event after EventFilter selects ready records but before delivery/client conversion; retain only fixed numeric input/output/cache counters, never content, diagnostics or whole-session result totals. Cumulative counters replace, not add; absent/malformed/overflow never imply zero. Cache-inclusive prompt total requires all disjoint buckets explicitly known. CLI cost stays null. Source is claude_code_stream_event_v1, actual CLI version remains unverified.
- CS-3: Once-only durable outcome and timing: raw message_stop + known stop_reason (end_turn/tool_use/stop_sequence success; max_tokens incomplete; unsupported unknown), source error/EOF, cancel, stall. CLI-ready is separate from HTTP status/headers (null). First output requires accepted caller-visible text/tool records and excludes thinking, unregistered tools and unmapped deltas. Recognized raw source errors settle immediately even without another event or consumer poll; successful consumer terminal settles before final yield; raw observation is bound to the original reply channel even after reusable process publishes the next turn. Conversion rejection is failed; body drop preserves already observed raw terminal and never damages the next turn.
- CS-4: Finalization failure never replays inference. Restart recovers remaining pending attempts once as interrupted without invented tokens/time; admin JSON/HTML/CSV agree, including raw reported counters and CLI-ready semantics. Existing legacy rows and generic HTTP accounting remain compatible.
- CS-5: Headless isolated fake-CLI journey covers setup/auth, all3client streams/tools, fallback/failure/cancel/stall, usage, restart/reuse; owned processes cleaned. Source/binary digests checked. Full native checks and independent review, required CI/normal merges/readbacks, ledger/journal, verified backup and own merged-worktree cleanup complete before delivery claim.

## Design and boundaries

A request context creates per-dispatch shared observations. Reply identity owns observation; the producer reads raw events and the response consumer owns finalization/drop. No lookup of a new sink to finish an old turn. Raw terminal is retained before finish_turn publishes reuse; successful result usage/totals after this boundary cannot be attributed to a later request. Existing failed-result behavior still aborts the process and fails its currently outstanding request; no result counters are imported and any detached earlier attempt remains unchanged. Persist fixed raw numeric fields alongside normalized aggregate counts. No change to CLI wire conversion, tool/session protocol, runtime dependencies, real credentials or provider calls. All new evidence is synthetic; raw Claude cache/result schema and real client/version behavior remain unverified until separately authorized.

Plan: document first → real persistence RED → bounded disjoint implementation + focused regressions → full locked Rust1.99.0/fmt/Clippy/native validators + prior generic HTTP journey and new CLI journey → independent source/ledger reviews → normal delivery. Estimate2–3activehours, checkpoint every20minutes, command/CI limit600s; each issue initial reproduction plus at most2 justified correction cycles; preserve all failures. Whole-round tools/providers/tokens/cost/active/wait unknown/null.

Status: product source/runtime delivery merged via PR729; requiredCI and remote readback passed. Administrative closure follows finalhandoff; mainline remains incomplete.

Raw `stream_event` error accounting is durable immediately. Existing EventFilter wire behavior remains: a standalone raw error before the first accepted output may wait for a later CLI result/EOF or caller cancellation; this slice does not claim that pre-output wire wait is bounded. Real CLI/version behavior remains unverified.

## Local verification and evidence (2026-10-28)

- `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml`:313 tests/22 groups passed on final source; fmt --check, Clippy --all-targets -- -D warnings and locked build passed.
- `python3 -m unittest discover -s gateways/pokercase/scripts/tests -v`:35 passed. Native `scripts/tests`20 passed; `scripts/check_indexes.py`:45contracts/7indexes passed.
- Actual nine-stage Claude fakeCLI journey and prior genericHTTP journey passed. Claude journey17 durableattempts: all17costs unknown/null; raw phase counts retained, cachemissing aggregate unknown. Generic journey retains its synthetic$28partial estimate; neither figure is real provider spending.
- Focused actual REDs: baseline no durableattempt; filtered events incorrectly claimed first visibleoutput; raw error remained pending without another event. Corrected tests preserve request/session ownership, store-fault no replay, savedresume separateattempts and restart recovery. Worker source reports are not substitutes for root integration evidence.
- Preserved compatibility failures: initialtest admin envelope, coalesced-record harness, newjourney OAuth-import envelope, HTML3timings expectation and legacyfixederror expectation; strict zero/null/privacy checks retained. Sandbox socket denial was rerun through approved platform execution with no permission change. Clippy enum-size warning fixed byboxingHTTPobserver; final fullsuite and journeys repinned.
- Local evidence directory: `/home/ckc/test/codex/.local/t0432-claude-settlement`; exact commands/results in `validation.txt`, original logs/reports, acceptance map, independent `review.md` and final `handoff.json`. Original17AC/T1102/Cargo/priorSS+PCtaskdocs/unrelatedtrackedplans unchanged.

Final remote source/merge/CI/readback, ledger review, complete backup and cleanup are written after execution; no real provider/login/version/cache-schema validation, release or deploy claimed. Earlier fixture startup/auth intermittency remains unexplained (#701). No new milestone starts at closure.

## Product delivery readback

產品 [PR729](https://github.com/fallrising/newclear/pull/729) source `d7e91159caf3699f17c8cfdc6e5e03f3d57c58d8`、merge `cef2b3f0f0f408171429fe4abb95f1a8b2799168` at 2026-10-28T18:01:57Z；最終313Rusttests/22groups、fmt/Clippy/lockedbuild、35Python、20validator tests、45contracts/7indexes、Claude及genericHTTP各九階段旅程、獨立來源/執行審查通過；必要check/validate CI、正常合併與遠端內容/祖先/Desk-Task trailer回讀通過。

管理帳本發布、完整備份`/home/ckc/test/backup/t0432-claude-settlement-20261028`與本輪工作樹清理由最終`.local/t0432-claude-settlement/handoff.json`核實；這份產品merge時點快照不預先宣稱其後步驟完成。新`local-demo.py`預設check並驗source/binarydigest，先前入口及舊digest保留。此輪完成即停止，不開新里程碑。
