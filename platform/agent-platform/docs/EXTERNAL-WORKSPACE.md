# T-0447: run-scoped external workspace

Owner approved this bounded dependency on 2026-10-31; desk claim PR343 merged.
This implements Fanzloud M1 Q2/Q3 under its approved SDD, not full Agent Platform M4.

## Contract before implementation

The existing Connector remains the sole VM, journal, admission/fence and cleanup authority.
Add an explicit opt-in external-workspace execution mode; default OpenHands and fixture
mailbox behavior remain compatible. No external agent or repository sees connector,
node, provider or guest-control credentials. A trusted adapter holds these capabilities
and exposes only run-bound workspace tools to the pinned subscription CLI.

An external run uses the existing fixed catalog repository/base, immutable guest,
network attestation, deadline and generation fence. Preparation installs trusted helpers
and checks out the workspace as UID2000 without starting OpenHands. All repository
commands run unprivileged with no-new-privileges, fixed cwd/environment, bounded
argv/input/output and deadline. File tools reject traversal, symlinks and non-regular
files; no host paths or caller-selected mounts. Arbitrary shell capability, if expressed
as argv, remains wholly inside the owned guest and its deny-all egress boundary.

Every tool operation has a caller operation UUID and durable fingerprint. Same request
replay returns the recorded result; mismatch refuses; interrupted/unknown operations
are never re-executed. Current generation, lease, deadline, cancellation, release and
confirmed preparation gate every admission. Result finalization closes tool admission,
checks actual quiescence and uses the existing fixed-base diff/verification contract.
Release requires existing ownership and observed VM/claim removal evidence.

M1 admits one VM at most, 4vCPU/4GiB, one coding invocation at most10min.
A trusted execution coordinator must use the backend's lease ownership contract;
Fanzloud projections cannot independently retry or grant a second execution owner.
No API billing, new dependencies, public endpoints, automatic push/apply or new milestone.

## Acceptance

- EX-01: real HTTP contract tests prove mode gating, run/generation/lease/deadline,
  duplicate/replay/unknown and input bounds; existing OpenHands regressions pass.
- EX-02: real owned guest tools read/write/execute and return fixed-base diff with
  configured check outcome; canary, cross-workspace, egress denials and cleanup proven.
- EX-03: pinned actual subscription CLI uses only trusted MCP tools to complete one
  small repair on that guest; source-bound stream, diff/check and removal evidence.

EX-01/02/03 NOT_RUN at contract creation. Mock tests cannot pass EX-02/03.
After the real VM/tool boundary passes, parent T-0442 connects real browser/Rust
to the same route. One coding submission jointly proves EX-03 and M1 submit/progress/diff
without a duplicated provider invocation (SPEC-M1-isolated-web). No FN acceptance or AC-04 Cloud completion follows from this alone.

## Coordinator binding (implementation detail)

The explicit `claude-subscription` profile/backend uses AP's existing PostgreSQL
jobs, Worker.claim/owned and committed-lease heartbeat. A trusted pinned local CLI
adapter is injected into that worker; workers without it cannot claim new subscription
runs. Recovery can observe/save a completed result or cancel an owned VM, but cannot
restart an uncertain CLI. Fanzloud submits to AP and observes its run ID. The connector
configuration can narrow the existing4 slots to1; sealed sandboxd max_claims and
registered AP capacity must match that narrower ceiling. No additional lease authority.


## M2 second vendor (T-0442)

`codex-subscription:gpt-6.1-sol` uses the same external-workspace contract and
existing worker/lease/connector authority. Inject `CodexSubscription` through
`CODEX_SUBSCRIPTION_CONFIG`; `SUBSCRIPTION_CONFIG` continues to select Claude only.
No configured driver means no new claim for that route. Both routes refuse uncertain
CLI recovery; cancellation and result collection remain AP operations.

Codex0.166.0 uses official app-server dynamic tools with explicit empty execution
environments on fresh thread and turn. Trusted temporary HOME/CODEX_HOME references
existing personal ChatGPT authentication; no user config/plugins/MCP or repository
execution is inherited. Fixed binary/catalog, startup settings, effective config,
thread/model/tool binding and deadline are checked before accepting completion.
[Normative M2 scope and limits](../../fanzloud/docs/specs/SPEC-M2-two-vendors.md).
Single-VM host authorization remains unchanged; M2 live and parallel acceptance must
be recorded separately from protocol fixtures and native database tests.
