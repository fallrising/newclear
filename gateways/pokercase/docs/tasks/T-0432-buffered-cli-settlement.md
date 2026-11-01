# T-0432 — Existing buffered CLI settlement

Demand: desk T-0432 / #698. Claim PR318 merged f1060394633fc96962936fd92d02f1579e88df76 before product work. Existing T-1102 §4.1–4.3/§5.1/UC-R01–05 and original17AC remain unchanged. Owner accepted this bounded continuation after buffered HTTP delivery and personal isolated rerun.

## Goal and boundary

Connect the existing original-event Claude Code/Cursor observers to existing non-stream Chat/Messages/Responses requests. Preserve all client wire/conversion, retry/cooldown, Claude tools/live user/tool/session reuse and Cursor text-only policies. Original token buckets and actual CLI-ready/first-output/terminal observations must survive collection/conversion and failures without post-conversion legacy duplication. This is not a new observer/provider/schema or client capability.

Current source gates both RequestContexts on stream and writes buffered usage only after synthetic Messages/Chat conversion. Three outer CLI failure branches also legacy-log nonstream failures. Source findings are not runtime RED until an isolated real gateway/fakeCLI run proves them.

Exclude new first-output/startup/stall timeouts, complete OS crash/SIGKILL matrix, real client/version/provider/credentials/privateDB/login, Docker, new dependencies/permissions, price/decimal/currency/grouping reform, new usage mapping, Cursor tools/images, Antigravity native stream/capabilities, release/deploy. All previous streams/HTTP/rawusage/costcoverage/T0435 coverage/guarded entries are regression dependencies. Mainline incomplete, usable_tag none, desk in_progress, issues698–702open; AC04/17 unresolved.

## Fixed acceptance

| ID | Given / When / Then | Required evidence |
| --- | --- | --- |
| CB-1 | Existing supported buffered CLI request selects a fresh run, reused user/tool phase or saved-session resume/retry: reserve before existing dispatch side effects, preserve separate attempt IDs under the parent, settle once, never add a legacy duplicate. Reservation failure does not dispatch or consume reusable session/tool state. | Actual controlled fakeCLI+gateway HTTP missing-reservation/identity RED→GREEN, selected-phase trace vs pending row; fallback/resume retries and preflight refusal |
| CB-2 | Complete/partial/missing/zero/invalid raw events and successful/incomplete/failed/unknown terminal observations: preserve source-specific fields independently of outcome, no fabricated measured zero or converted usage, no subscription estimate. CLI ready/first accepted text or supported tool output/total have existing separate definitions; HTTP status/headers stay null. | Original raw fixture events vs final SQLite/eventsJSON/CSV/Web; native observer regressions; three protocol wire checks |
| CB-3 | Collection failure, client cancellation/drop, storage refusal/finalization failure or pending restart: retain bounded fixed classification and appropriate raw observations, no extra model dispatch or silent reattempt; pending history recovers once without rewriting old finalized rows. | Actual fakeCLI/gateway failure, cancellation before/after output, collection cap, trigger-injected store failures, actual owned gateway restart and independent fixture counters; no full SIGKILL claim |
| CB-4 | Existing wire response/Claude tools+user+saved session reuse/first terminal/Cursor text-only admission: behavior remains compatible while accounting changes. All conversion paths finish under one consumer lease. Existing fallback boundaries and immutable history remain. | Byte/structure assertions, tool result/session continuation phase traces, Cursor tools/images/disabled refusal; relevant existing native and four journey regressions |
| CB-5 | Headless reproducible artifact: prove every fixture/runtime/helper/HTTP destination before any request, use only controlled synthetic temp state, preserve exact source/Cargo/artifact/binary/helper attribution and clean only owned resources. | New pinned terminal command/report, parser/SQL versus actual HTTP/fakeCLI evidence clearly separated; full native/Python/repo/fmt/Clippy/locked build, four prior journeys plus coverage/Antigravity/bufferedHTTP, independent source/runtime and ledger review, normal PR/CI/readback/journal/desk/full per-file backup/owned-worktree cleanup |

## Design and accounting boundaries

- Always provide existing source-specific RequestContext for supported CLI paths. Remove the buffered legacy success write and all three outer legacy CLI failure writes, retaining cooldown/retry behavior. Non-CLI paths stay unchanged.
- Hold the existing BodyAccounting consumer owner through collect and every final protocol conversion. On accepted collection/conversion explicitly settle from observed source terminal; on collection/conversion error use existing fixed classifications without replay. Drop/cancellation remains idempotent and never follows the reusable process into another reply.
- Collection bound failure is classified inside ClaudeRun.collect before dropping its receiver; otherwise the producer may win the once-only finalizer with cancellation. The outer consumer remains responsible for final conversion and drop. A deterministic producer-close barrier regression proves this ordering.
- Reuse raw observers unchanged where possible: Claude prompt requires all three explicit input/cache buckets; absent buckets do not become0. Cursor cache/input overlap is unverified, so normalized prompt remains null; preserve independently known completion and four raw result buckets with current partial/missing/invalid semantics. Both CLI costs stay null; client wire usage remains the existing synthetic protocol representation, separate from ledger evidence.
- Retain `claude_code_stream_event_v1`/`cursor_cli_result_v1` source meaning: these identify original CLI event formats, not the client's stream flag. No adapter-version or live-CLI-version claim is added.
- Existing CLI `headers_ms`/status remain null; `cli_ready_ms`, accepted-output timing and terminal/local-stop total come from original monotonic observers. Do not substitute legacy latency or parse completion time. Timing asserts ordering/applicability, not arbitrary sleeps as exact measurements.
- Buffered collect currently has no standalone stall timeout. Do not add one or copy streaming stall policy into buffered requests. Validate explicit caller cancellation and existing producer errors; timeout behavior of existing streaming regressions remains separate. Silent before-first-output waiting still needs caller cancellation.
- Preserve existing early Claude reservation before capacity/session/tool mutations. It identifies a selected attempted dispatch; preparation/spawn failure or cancellation after reservation can leave a failed/cancelled attempt with no successful CLI inference. Count selected reservations, actual spawn/input/tool dispatches, preflight refusals and admin requests separately. Do not claim all attempts imply provider execution. Pre-cancel/preflight refusal before reservation creates no inference row. Moving reservation later would risk consuming reusable state before storage acceptance and is outside the minimal integration.
- Existing raw incomplete terminal may coexist with a legacy collector's synthetic successful wire response; retain raw failed/unknown accounting without redesigning collector/response semantics. Actual conversion failure must not be recorded as source success merely because a terminal was already observed.
- SQLite trigger faults use isolated synthetic databases only. No real credential or private database, no history backfill or inference to fill gaps. Current exact filters/limits and coverage semantics remain unchanged.

## Evidence and delivery plan

First retain a real fakeCLI/gateway RED against the attributable prior compatible normal binary; helper scripts/hash/source match the new source baseline. Then apply the minimum integration, focused unit/HTTP cases and complete appropriate regressions. Fake CLI/runtime files use absolute owned paths, synthetic HOME/profile/state and fixed nonforwarding proxy; helper callbacks confined to controlled loopback. Before runtime prove no inference/refresh/discovery escapes, no redirects/CONNECT forwarding, and configured providers/endpoints are allowlisted fixtures. Tests that cannot prove confinement stop.

Keep all RED/failure/correction evidence. Green reruns are not #701 root-cause proof. Preserve prior synthetic official-endpoint401 as a historical outbound call; no retry to official services. Whole-round tools/agents/model/provider/retry/token/cost/execution-active-wait remain unknown/null. Estimate3–5activehours, checkpoint20min, per-issue at most2reasoned corrections after initialfailure; stop affected work on isolation/material-product/scope/effort nonconvergence.

Independent source/runtime and ledger evidence gates precede final acceptance. Fail-stop commit/push, required CI, normal merge, source/merge/origin contents/ancestry/Desk-Task trailers, journal/desk, complete verified backups and only owned-worktree cleanup are required. Complete this slice then stop.

## Observed validation — 2026-10-30

The unchanged actual baseline assertion failed with pending0/no attempt identity/raw buckets, then passed with pending1 and exactly one finalized row. Client wire remained identical. Independent source review identified a separate producer-close race; a deterministic native test observed cancelled instead of failed, then passed unchanged after collection failure was classified before receiver closure. This native channel/SQLite proof is separate from HTTP coverage.

The pinned normal executable completed45cases/9stages through real gateway HTTP and absolute fake Claude/Cursor/runtime/MCP helper: three protocols, complete/partial/missing/zero/invalid raw usage, source failed/incomplete/unknown/EOF, before/after-output cancellation, collection limits, fallback, three-protocol two-turn tools, live/saved session reuse and retry, reservation refusals, finalization fault with two real process restarts/no replay, Cursor admission and cross-surface reconciliation. It observed50selected attempt rows,57client requests,119admin requests,44fake runtime/CLI spawns,30Claude user inputs,4tool dispatches and5preflight refusals. These denominators are distinct. Twelve helper stdio RPC requests were observed; helper callback HTTP count is unknown, not folded into model/admin totals. HTTP provider inference/refresh/discovery/unexpected destinations were0 in this controlled run. All owned child/listener counts ended0, listeners rebound and temporary state was removed.

SQLite original columns, events JSON, CSV missing cells, Web events and seven measurement summaries agree for the same selected rows with existing surface limits preserved. The independent checker recomputes sums/means/counts/coverage/status/basis; Cursor prompt and both CLI costs remain unknown. Real process restart is exercised here, unlike the prior buffered-HTTP matrix's in-process Store/router reopen. This is not a complete OS crash/SIGKILL matrix or installed/live CLI verification.

Executed commands: `cargo +1.99.0 test --locked` (396tests/22groups), `python3 -m unittest discover -s scripts/tests -v` in the component (129tests, including18new pure checker tests), repository validator tests (20), `cargo +1.99.0 fmt --check`, `cargo +1.99.0 clippy --locked --all-targets -- -D warnings`, locked normal/native builds. Generic/Claude/Cursor/namedHTTP nine-stage journeys, measurement coverage seven scenarios, Antigravity isolation/settlement and prior53-case bufferedHTTP acceptance all passed against newly retained attributable binaries. Repository contracts passed47contracts and navigation/index; independent source/runtime and prepublication ledger reviews also passed; publication/required CI/remote readback remain delivery gates; do not infer them from these runtime results.

Normal binary SHA256: `8e3d776171009e0ec35aa0fb70ef8f2fcbf496da45864b9a1057cdda9d186259`; native test binary: `72736175e3d5733541e4478949a5cbce8b41ef107d950c3166420bb1e0b4d01f` (294inventory tests). Both retain53exact source/template/Cargo input hashes and actual Cargo source/artifact identity; the mutable shared target is not the delivery artifact. New matrix report SHA256: `4488e79aca0f1d50367d67f8760eccd258d691bc967fc516909b832856ab52ac`.

## Headless replay and evidence boundaries

The delivered private handoff provides `local-demo.py`, default check. It first verifies a fixed manifest/contract/checker, all seven executable helper sources, the retained normal binary, Python runtime and generated fixture digests, then runs the journey and the independent report gate. A changed pin stops before launch. Preserve that entry and its artifact set together; earlier guarded entries remain unchanged.

For an independently prepared source checkout, retain an attributable normal executable from `cargo +1.99.0 build --locked --message-format=json`. Independently pin the manifest and `scripts/buffered_cli_contract.json`, and call `buffered_cli_check.verify_artifacts(manifest)` before any journey startup. The lower-level runner is:

```sh
python3 scripts/buffered_cli_walkthrough.py --check --binary /path/to/preserved-thinrouter --expected-binary-sha256 <verified-sha256> --contract scripts/buffered_cli_contract.json --output-dir /path/to/evidence
```

Validate saved evidence without executing HTTP or CLI:

```sh
python3 scripts/buffered_cli_check.py --check --report /path/to/report.json --contract scripts/buffered_cli_contract.json --expected-contract-sha256 <fixed-contract-sha256> --manifest /path/to/pinned-manifest.json --expected-manifest-sha256 <fixed-manifest-sha256> --output-dir /path/to/validation
```

Pure checker tests and SQL/source inspection are not actual HTTP coverage. Actual HTTP uses controlled fake CLI/runtime/provider fixtures, not installed clients, real provider versions or billing. No owner personal run of the new entry is claimed. Mainline incomplete, usable_tag none, desk in_progress; #698–702 remain open and AC04/17 unresolved. No automatic next milestone.
