> 2026-10-31 後續：owner 已批准 T-0447；隔離 executor／KVM／真實 Web coding 已實測，見 [M1-isolated](M1-isolated.md)。以下保留原 qualification 的版本與前置差距，不改寫舊結果。

# T-0442 M1 qualification checkpoint

Status: PARTIAL. No real coding task, Web integration or FN acceptance passed in this checkpoint.

## Actual evidence

- Approved source baseline: `72c3e9b779a827206b6bfb9ce4d7d8f8651ee986`; qualification script was uncommitted at execution, exact SHA-256 `09e75f200aed483eeb6db16b755a9baf210259fff16f7464652b98feecf86316`.
- Official CLI2.1.312, CLI SHA-256 `4f4178ce41d83e23341ebfbaecdbcf8ea6bf7baea0690025abe49eeec3a5d01d`; exact model claude-opus-5-5, effort low, existing first-party subscription. No authentication files read/copied, no API route enabled.
- Command: `python3 tools/m1_claude_mcp_probe.py --claude <installed-cli> --output <new-private-evidence-directory>` from the Fanzloud directory. One model-capable CLI invocation; exit0, 3.376 seconds. Actual JSONL init lists only the supplied MCP tool (optional EndConversation permitted), one matching call/result with a fresh nonce, correct model, no permission denials. All9 capability assertions passed.
- Post-run exact-argv process observation found zero owned CLI/MCP processes. This is probe process cleanup, not VM cleanup.
- Q1 **PASS_CAPABILITY_ONLY**: supported native tool restriction plus a trusted inert MCP tool works with the existing login. It does not prove repository tools cannot read secrets in a real executor, license arbitrary services, or provide a coding diff.
- Q2 **PREREQUISITE_FAILED**: reviewed Agent Platform connector supports prepare/prompt/result/release and a fixture-only bind/poll/deliver/ack/close mailbox. It does not expose the host-to-guest native-agent workspace tool route this proposal needs. Relevant sources: [allocation/preparation](../../../agent-platform/src/agent_platform/connector.py), [tool mailbox](../../../agent-platform/src/agent_platform/connector_tool.py), [runtime client](../../../agent-platform/src/agent_platform/runtime_client.py). No private driver call or host-shell fallback used.
- Q3 and FN-01–07 **NOT_RUN**. Zero coding submissions, VM allocations, remote mutations or Cloud retries. No API-billing route was enabled. The inert CLI call is a real model invocation; internal provider request count, token usage and actual billing remain unknown.

## Environment prerequisite

The development host has no `/dev/kvm`, Cocoon or sandboxd; no connector origin/token reference is configured. The historically used KVM node is now assigned exclusively to another project by the host inventory (kernel source `f36635671c65fc63ba6db5a4741a2c3ff102821f`, `infra/hosts/de-4/README.md`). It cannot be reused implicitly.

A read-only check of an existing alternate CI host confirms KVM device present, current login lacks device access, Cocoon/sandboxd absent,193.5GiB root disk free. This identifies a possible preparation target, not permission to install runtimes, change group/device rights or interfere with CI. No remote state changed.

## Concrete next step within M1

A single bounded dependency is required in Agent Platform, not its entire roadmap:

1. Add an explicit external-tool run mode that prepares the existing isolated workspace without starting OpenHands. Preserve current mode and its tests.
2. Expose a run/generation-scoped authenticated interface for workspace file access and bounded guest command execution, using existing UID/launcher, deny-all egress, lease, operation receipt and cleanup boundaries. Do not expose host paths or raw node credentials. Reuse current run/result/release authority; no second scheduler or VM manager.
3. Connect the trusted Claude MCP adapter to this interface; the official CLI and credentials remain outside repository execution. Validate one fixed-base small repair and canary/egress/cleanup in a real VM, then connect the Fanzloud Web flow.

This needs the approved SDD §3 neighboring-project gate: an owner-approved bounded dependency card and one authorized KVM test target. Suggested operational bound: existing alternate host, one zero-warm VM, maximum4vCPU/4GiB and10min per coding run, private loopback/SSH only, no published service, no changes to existing CI/other services, no new purchase. Host preparation (pinned existing Cocoon/sandboxd dependency and limited KVM access) needs explicit permission; it has not been performed. If the owner chooses an already prepared endpoint instead, no host installation is necessary.

No fourth product milestone is introduced. This dependency unblocks the original M1; no repeated Cloud setup or CLI upgrade is requested.

## Verification and review

The temporary Q1 probe had no pre-existing wire fixture, so test-first integration was impractical: first inspect official flags and implement the inert probe, then retain actual native evidence and regression-test false acceptance (assistant assertion, unexpected host tool, changed init model, denial, mismatched result, duplicate call and partial trace). These parser tests are offline and cannot replace Q3.

Independent Claude Code review (claude-opus-5-5/high, tools disabled) returned REWORK with three publication conditions: source-hash binding, current status/check receipts and observed-model scope. These are resolved by the offline audit below; no second live probe was run. The additional duplicate-with-invalid-arguments parser gap was repaired and regression-tested. Final bounded confirmation: ACCEPT for this PARTIAL checkpoint, exit 0,36.74 seconds, exact claude-opus-5-5/high, no additional live probe. Required record corrections are incorporated; committed source hash is verified below. Raw CLI stream/receipt and private host observation remain in the approved evidence store; public summaries exclude account IDs, credentials and host addresses.


## Source binding and offline verification

Executed script is preserved privately as `executed-probe.py`, SHA-256 `09e75f200aed483eeb6db16b755a9baf210259fff16f7464652b98feecf86316`. Final script SHA-256 is `c1694c1fa03eb94152651d15a152ed679f1417d367349e48b204cc8a94abe077` (`sha256sum tools/m1_claude_mcp_probe.py`); the sole behavioral change counts every probe call, including an extra call with invalid arguments. Live evidence belongs to the executed version. No live success is attributed to the changed parser; it is verified by offline replay of the original stream and regressions.

Offline audit observed exactly one probe call across all argument shapes; every assistant model and result modelUsage key was `claude-opus-5-5`. No fallback is visible in this stream; internal provider requests remain unknown. Strict `assess(original_events, original_nonce, 0)` on the final parser returns PASS_CAPABILITY_ONLY. Source bytes must still match this hash when committed; otherwise update this binding instead of reusing the claim.

Commands/results:

- `python3 -m unittest discover -s tools -p 'test_m1*.py' -v`: PASS,3 tests including invalid-argument duplicate rejection.
- `python3 scripts/check_project_success.py --projects platform/fanzloud` from repo root: PASS, contract/navigation/index.
- `python3 scripts/check_indexes.py` from repo root: PASS,50 project contracts,8 navigation files,zero errors.
- Changed Markdown local-target audit and `git diff --check`: PASS.

Missing: Q2 interface/host prerequisites; Q3/live coding/VM isolation/Web FN gates. Runtime tests were not locally repeated because production Rust/Web was unchanged; required hosted CI still applies. The temporary missing probe-directory preparation error caused no invocation; the file was subsequently created at `tools/` and checked before the sole live run.

Final publication audit: Codex/root accepts only the Q1 capability evidence and this bounded checkpoint. Claude first review took94.76s and requested source/status/model clarifications; final review took36.74s and accepted with three mechanical pre-merge conditions (record this result, verify committed hash, rename changed-init-model regression). No production Rust/Web change, no adjacent runtime change and no host preparation. Required hosted CI and remote merge results are recorded in the PR.
