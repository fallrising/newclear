# T-0389 — Buffered Responses completion

Demand: [desk T-0389](https://github.com/fallrising/desk/tree/main/tasks/T-0389-thinrouter-buffered-responses). FixedBR-1–BR-3: [SUCCESS](../../SUCCESS.md#t-0389--buffered-responses-completion).

Base `2d65b6528ef8425fe17bfb127f79c016dabe3380`; start approximately2026-10-24T11:08Z. Claim merged before productedits. Estimate25–35active minutes, checkpoint20active minutes; CI bounded10minutes; initialRED plus at most2reasoned corrections per issue. Hostedusage/costunknown; product realmodelcalls0 planned.

Status: local implementation, verification and independent review complete (2026-10-24T11:22Z). RemoteCI/merge/readback are publication gates tracked in desk/journal. Root owns specification/source/tests; bounded independentreview. Preserve original failures and scope limitations; fullproduct acceptance remains pending.


## Evidence (2026-10-24)

| AC | Evidence | Result |
| --- | --- | --- |
| BR-1 | `br1_collector_requires_a_consistent_terminal`, `br1_br2_buffered_failures_never_become_success` | PASS empty/partial/item-only/DONE/malformed object or conflicting status/error reject502 without exposing buffered output |
| BR-2 | `br2_first_terminal_controls_collection_and_errors_are_redacted`, same HTTPfailure matrix | PASS fixed errors; both recognized quota codes retain429; firstterminal cannot be changed by later events |
| BR-3 | `br3_buffered_completed_and_incomplete_preserve_output`, `br3_collector_preserves_terminal_output_and_incomplete_details`, `br3_terminal_output_is_authoritative_over_intermediate_items`, existing tool reconstruction | PASS terminal output/usage/incomplete details retained, full terminal output beats stale intermediate items, empty final output keeps reconstruction fallback |

The two new HTTP tests exercise45local gateway journeys:12failure/quota cases ×3APIs plus3completion/incomplete/finality cases ×3APIs. Each failure request observes exactly one fake-upstream request. Collector validation checks terminal type/object/status/error consistency; this is not full Responses-schema or general SSE-framing validation.

Commands from repository root (cargo test/clippy use the operator's shared `CARGO_TARGET_DIR`; exact local paths live in private evidence):

- Original RED: `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml --test responses_e2e br1_br2_buffered_failures_never_become_success` failed: partial transcript without terminal produced HTTP200, assistant text and stop. `red.log` retained.
- `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml --bin thinrouter br1_collector_requires_a_consistent_terminal`: added conflicting-success/quota case failed429vs502 (`conflict-red.log`); fixed successful-terminal/non-null-error inconsistency to502 while legitimatefailed/error quota stays429.
- Review R1: `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml --bin thinrouter br3_terminal_output_is_authoritative_over_intermediate_items` failed because one stale intermediate item replaced two final items (`output-red.log`). Terminal nonempty output now wins; fallback remains for empty/omitted output.
- `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml`: final113passed/0failed/0ignored. Earlier112-pass suites are retained separately; they preceded the newly exposed R1 regression and are not presented as final coverage.
- `cargo +1.99.0 fmt --manifest-path gateways/pokercase/Cargo.toml --check`:PASS.
- `cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings`:PASS on final source.
- `python3 scripts/check_project_success.py`:42contractsPASS; `python3 scripts/check_indexes.py`:PASS; `git diff --check`:PASS, staged whitespace required beforecommit.

Compact logs and independent reviews stay in private T-0389 evidence, referenced by desk/journal. Docker/CLI execution was unchanged; no redundant Docker canary or real provider smoke was run. Prior streaming/error/CLI/security regressions are included in the full suite. DirectJSON, native stream passthrough, transport failures, timeouts/retries/accounting and fullproduct acceptance remain outside this slice. Independent review R1 is resolved and final review passed. Required CI/normalmerge/readback remain publication gates.
