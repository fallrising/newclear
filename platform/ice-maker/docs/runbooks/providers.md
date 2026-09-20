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
