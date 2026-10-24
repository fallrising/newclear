# Provider routing and review runbook

## Local pipeline operation

Phase 3 is synthetic and offline. A publishable local result requires, in this
order: successful bounded builder evidence, a successful local deterministic
gate boundary, and an accepted JSON-only reviewer finding from a different
provider. The pipeline accepts only the configured Codex/DeepSeek builder,
local gate, and Claude/Grok reviewer aliases. The reviewer identity must be
read-only and receives only immutable builder and gate evidence, never a
workspace, command argv, or publication capability.

Every reached stage appends an immutable usage entry. Stop immediately if the
task budget or attempt ceiling is exhausted, a failure signature repeats, any
stage reports timeout/truncation/non-zero status, or review findings reject the
work. Do not retry by changing providers or aliases outside approved routing.

## Provider failure recovery

Do not publish when a boundary returns non-zero, timed-out, truncated, empty,
redacted, malformed, or rejected evidence, or when doctor, authentication,
health, rate-limit, model-alias, gate-adapter, or cost evidence is missing.
Record the bounded failure signature in the request-owned usage ledger,
preserve local deterministic evidence, and have the operator resolve the
provider condition. A new run requires a healthy, policy-approved alias and
available task budget; it does not reuse a rejected result.

## External gates

Real provider authentication, model configuration, rate-limit headers,
invoice-backed usage reconciliation, and production enforcement of read-only
review access remain operator-owned external gates. This repository performs no
provider mutation, merge, deployment, or `main` update.

## Grok review input and execution boundary

The current [Grok review adapter](../../src/ice_maker/adapters.py) sends one
bounded artifact with `--single`, explicit `--model`, `--output-format json`,
`--disable-web-search`, `--no-subagents`, `--permission-mode plan` and `--tools=`.
It does not select `--sandbox` or `--cwd`; the
[executor](../../src/ice_maker/execution.py) inherits the caller's working
directory. Artifact-only describes what the adapter supplies as review input.
It does not make that artifact the only file the CLI process can access.

Plan mode and an empty tool selection are CLI policy settings, not proof of an
OS filesystem or network boundary. Grok's
[sandbox profiles](https://docs.x.ai/build/features/sandbox) are separate from
[permissions](https://docs.x.ai/build/features/permissions). This adapter does
not itself establish the production read-only isolation gate above. Before
live use with untrusted input, the operator must qualify an approved execution
profile and actual access-denial behavior in the selected parent environment.
Do not automatically weaken a failed sandbox or copy Cursor's container-specific
`--sandbox disabled` setting to Grok.

The official executable is `grok` (Grok Build), not an assumed `grok-agent`
alias. Grok's native streaming format is `streaming-json`; this adapter chooses
single-result `json`. For maintained worker invocation and Linux prerequisite
checks, follow the [canonical Grok worker card](https://github.com/fallrising/kernel/blob/main/agents/cli-workers/providers/grok.md)
and the [official CLI reference](https://docs.x.ai/build/cli/reference). No Grok
model, authentication, or sandbox qualification was performed by this documentation update.
