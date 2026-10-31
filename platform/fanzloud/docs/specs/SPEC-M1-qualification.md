# T-0442 M1 qualification — bounded executable investigation

Status: Q1 PASS_CAPABILITY_ONLY; Q2 PREREQUISITE_FAILED; Q3 NOT_RUN. Await bounded neighboring dependency and authorized KVM target before production integration.
Authority: owner approved [SDD](../../SDD.md) / ADR-0008. M1 is not complete.

## Goal and first probe

Establish whether pinned official Claude Code can use the operator's existing subscription while exposing only an administrator-supplied MCP capability. The first probe is deliberately inert: one fixed `probe` tool returns a per-run public nonce; it accepts an empty argument object and cannot read/write files, start commands, contact services, or create tasks. Actual stream initialization must expose only that MCP capability and optional EndConversation; no agent self-report substitutes for the tool event.

Use CLI2.1.312, claude-opus-5-5/low, one fresh invocation,120-second outer deadline, strict MCP, no built-in tools, dontAsk, restricted settings, explicit hooks-off and claude.ai-connectors-off settings, no slash commands, no session persistence. No `--safe-mode`: official documentation says it disables MCP. No `--bare`: it changes the authentication route. Existing login must be claude.ai/firstParty; API key/helper/third-party route is not admitted. No fallback model or retry of an unknown invocation. Host timeout terminates the owned process group.

The orchestrator creates the private artifact/working directory, pins both CLI and probe source hashes, and reads only filtered auth status. No repository is checked out into the credential runner. The trusted stdio process is this fixed script, not repository-provided code. Startup, args, tool listing, call/result, exit and absence of permission denials are checked from actual JSONL. Raw output stays private; public receipt includes only booleans/counts/hashes/version. Neither this trusted script nor CLI permission flags are an OS sandbox proof.

## Necessary follow-on, not yet runnable

The next qualification must replace the inert MCP tool with a reviewed run-scoped interface to an existing isolated executor: read/write bounded workspace files, execute bounded argv, collect a fixed-base diff, verify and stop/clean up. The current Agent Platform `/tool` is a guest-to-host fixture mailbox, not that host-to-guest interface (`connector_tool.ToolExchange` accepts bind/poll/deliver/ack/close). `Connector.prepare` starts pinned OpenHands; changing goal text or toggling tool_transport does not select Claude Code. Do not call private `sb.exec` to bypass run ownership, lease or isolation.

A current authorized KVM endpoint is also required: this development machine has no `/dev/kvm` or Cocoon/sandboxd. The historical KVM node is now reserved for another project's runtime; do not start a second daemon or copy login credentials there. No remote mutation is authorized by discovering its SSH alias.

## Acceptance and stops

- Q1 actual CLI tool-surface probe: version/auth pinned, one nonce response through the MCP tool, no built-in file/shell/network/delegation tools, expected init model, with assistant/result model names audited offline, no permission denials, clean exit and owned-process cleanup.
- Q2 executor compatibility: an actual approved run-scoped host-to-guest interface exists and keeps one lifecycle authority. Current source inspection fails this prerequisite; no live coding run is attempted until resolved.
- Q3 live coding/isolation: one fixed-base small repair, actual test and diff plus canary/cross-workspace/egress/stop evidence within10min. NOT_RUN until Q2 and authorized runtime are ready.
- Q1 alone cannot pass any FN acceptance, claim Web integration, or justify production adapter implementation. One probe and at most one evidence-based correction; no extra models to fill metrics.

## Official references (checked 2026-10-31)

[CLI flags](https://code.claude.com/docs/en/cli-reference), [MCP](https://code.claude.com/docs/en/mcp), [authentication](https://code.claude.com/docs/en/authentication). These document supported CLI capabilities, not qualification of this custom runtime or a general service-license assertion.
