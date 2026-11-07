# T-0426 Inline instruction roles

Demand: desk T-0426, existing core AC10/13/14; owner requested continued development after approved A. Claim [PR358](https://github.com/fallrising/desk/pull/358) merged before implementation. This is a representation-preservation correction, not a new reuse policy.

## Diagnosis and scope

Retained isolated official-client capture from CLI2.1.312 contains inline `system` messages: a text-block array on first emission becomes a string on later requests. Current Anthropic-to-chat conversion sends every non-assistant array through the user-block path, changing instruction role to `user`; the string path preserves `system`. Thus identical instruction text changes both conversation prefix and signature merely due to representation. Reproduce using synthetic text only; do not publish captured prompts.

The wrapper uses exec and does not itself close stdin. The capture also appends new system messages across turns. Correct role preservation does not make those changed instruction sets eligible for reuse. Trailing instruction messages can also prevent exact tool-result matching under the existing rule. The live attempt retained no matching request-shape diagnostic proving these conditions for each dispatch: six distinct processes/no resume remain factual, their complete cause unknown. Do not strip instructions or weaken signature/history/tool-result checks to manufacture reuse.

## Fixed acceptance and design

- NR-1: Inline system/developer text-block arrays retain their roles and text, in the same order as equivalent strings. Top-level system, ordinary user images/tool results and assistant tool calls retain existing behavior.
- NR-2: Equivalent array/string instruction representations produce identical normalized conversation and native reuse signature. A changed instruction or appended instruction changes the signature; no reuse-policy modification.
- NR-3: Preserve RED/green and diagnosis limits, independent review, applicable tests/CI, normal merge/readback, ledger and separate complete backup/owned cleanup. Original17AC and prior pilot facts unchanged; mainline incomplete, usable_tag none.

Minimal conversion branch before user-block conversion handles the already accepted system/developer roles with the existing text-block helper. Inline instruction arrays use the same text-only projection as top-level system arrays: non-text blocks are ignored, not converted into user images or tool results. Tools/images are supported in their existing user/assistant roles; this correction adds no instruction-block tool/image semantics. No actual official CLI/provider/profile/private DB reads, Docker, dependencies or permissions. Estimate30–45active minutes with20minute checkpoints; each failure at most two justified corrections. Complete this slice then stop.

## Verification plan

RED/green focused conversion and native signature/prefix regressions; existing user-image/tool conversion tests. Full locked Rust suite, formatter, Clippy; repository success/index checks and tests. No need to rerun unchanged standalone Python fixtures or live walkthroughs. Independent source and ledger reviews, required CI, normal delivery. Outcomes appended after actual execution.

## Observed verification

Two new regressions failed on the original converter: system blocks became user messages and equivalent instruction representations produced unequal signatures. After the five-line conversion branch, the focused selection passed15tests (including2new regressions). Full locked Rust suite passed434tests in25groups; formatter and Clippy passed. Existing Claude print/TUI same-process, MCP, saved-session and protocol tests are included. Independent T001 code review accepted the final runtime; nontext instruction-array projection is explicitly documented above. Original17AC text is byte-identical.

Local repository checks passed51contracts,9navigation indexes and20repository tests. Initial `--lib` selection failed because the package has only a binary target; corrected `--bin thinrouter` produced the genuine RED. First full-suite sandbox execution had278passed/22failed on denied local bind/preflight; the same source passed under platform-approved execution. All failed logs are retained. These invocation/environment failures are distinct from the two product regressions.

The unchanged standalone Python walkthrough suite and actual live pilot were not rerun locally for this conversion change; required CI runs its own prescribed suite. Product CI/publication, ledger, complete backup and cleanup are subsequent delivery gates, not preclaimed here. Whole-session tools/model requests/tokens/cost/active-wait are unknown; scoped new product-provider calls0. No live native reuse, fixed cache multiplier or account guarantee is established.
