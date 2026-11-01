# T-0411 Retained converter state

Demand: [desk T-0411](https://github.com/fallrising/desk/tree/main/tasks/T-0411-thinrouter-state-bound). Contract: [RS-1–RS-3](../../SUCCESS.md#t-0411--retained-converter-state).

Bound actual growable retained payload/collections, preserving streaming-only traffic. Fixed metadata/line/transport/output/RSS and collector policy stay separate. Chain final-stage failure must close even if its first stage has not completed.

## Verification — 2026-10-25

RED: `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml rs3_retained_text_limit -- --nocapture` failed:17individually valid1MiB text records accumulated without a state-limit diagnostic while source remained open, exceeding the5s focused deadline (idle60s). Focused GREEN passed after per-converter budgets and final-stage chain termination. Original RED retained; one product correction, no failed full-suite rerun.

Shared RetainedBudget performs subtraction-based checks before growing logical retained payload/collections. JSON metadata is counted with a capped writer without allocating a second serialized copy. ChatToResponses charges decoded text/arguments, serialized call_id/name and output/tool-map entries. ResponsesToChat charges new item-id/output-index mappings and argument-dedup ids, including unknown item-id aliases resolved through output_index. AnthropicToChat charges new tool indexes. Existing keys do not charge again; moving text/arguments into final output does not double-charge. Budget is per converter, not shared across chain stages.

On violation the failing converter clears its variable-size collections/payload, emits `upstream converter state limit exceeded` and becomes done. It does not forward the violating delta, close a tool successfully or replay retained payload in the error. A prior finish_reason cannot rescue it. Chain completion now follows its final stage, so internal downstream failure does not wait for first-stage terminal; existing normal-chain terminal behavior remains green. Other bounded stage state may remain until the response object is dropped; this does not claim immediate clearing of every converter in a chain.

Added43scenario iterations across11tests:2default text-budget direct/chain failures;5default entry-limit routes;4nonretaining text routes forwarding more than16MiB;6shared text/argument failure cases;12exact-payload completions (text/arguments/mixed ×stop/length ×DONE/EOF);2output/tool-slot transitions including empty tools;3serialized metadata cases;2argument-alias budget cases;2new map registration limits;1Anthropic duplicate-index/streaming compatibility case;4realHTTP failures (Chat→Responses text/arguments and Responses→Chat/Messages entry limits). Reduced-budget unit tests establish precise boundaries; adapter/HTTP tests exercise production defaults. These are matrix iterations, not43test-runner entries.

Adapter sources remain pending and assert drop at final failure receipt before another consumer poll. HTTP sources remain open after data:4responses finish within15s (idle60s), all4source-drop notifications required, observed1.67s. HTTP stream failures remain protocol errors, not broken bodies. HTTP sources are Chat/Responses; Anthropic-source chain behavior is adapter-covered. Existing154tests remain green,including11Claude fakeCLI session/reuse/disconnect cases, native/opaque/EOF/stall/read-error/input-line/terminal regressions.

```sh
cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml
cargo +1.99.0 fmt --manifest-path gateways/pokercase/Cargo.toml --check
cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings
python3 scripts/check_project_success.py
python3 scripts/check_indexes.py
git diff --check
```

Observed165tests/16groups,0failed/ignored;fmt/clippy warnings-as-errors,43contracts/6llms/0errors,diff PASS. Independent source/final-document review PASS with no blocking rework. Required CI/merge/readback remain publication gates.

Limits: logical retained payload and collection entries are not allocator capacities, whole-process RSS, decoder/output allocations, total wire traffic or transport buffers. Fixed-count response/model/finish metadata remains separately constrained by bounded input records; generated framing and JSON structure overhead can exceed payload counters. Streaming-only text routes remain unbounded in total traffic. Native Responses and opaque passthrough are unchanged. No collector/generalSSE/deadline/session/retry/accounting/dependency/permission/provider/Docker/login/release change or whole-product acceptance. Consumer polling remains required.

Next separately scoped step: assess non-stream response collector bounds; not started.
