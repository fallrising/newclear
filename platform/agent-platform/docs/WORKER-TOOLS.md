# Normal Worker mock tool integration

This slice connects the existing SQL-backed read-only mock tool broker and guest relay to the normal Worker lifecycle. It is disabled by default and uses only the existing loopback mock GitHub adapter. Billing, live credentials, deployment, process recovery changes and KVM acceptance are outside this slice.

## Explicit enablement

Create a new immutable OpenHands profile revision with `mock_tools: true`. Existing revisions, profiles that omit the flag, and their runs stay disabled even when the host has a mock tool configuration. A fake backend cannot enable mock tools. The flag is persisted in the profile's existing `tool_policy` JSON; no schema migration is needed.

The trusted Worker reads `TOOL_BROKER_MOCK_CONFIG` from a private file. Configuration pins the existing `Policy` fields, including mock service/credential revision UUIDs, loopback origins, a private secret file, repository numeric ID and canonical owner/name, full commit SHA, allowed paths/issues/operations and bounded limits. No task or guest can supply the config or credential. Reject unknown/invalid fields with a fixed error, without logging their values. The run repository and base SHA must match this host policy before provisioning. Missing configuration fails closed for an enabled run. Before allocation, this uses the existing quarantine path: the pending reservation remains held until operator cancellation confirms no allocation intent. It does not silently disable tools or report success. No automatic policy refresh, grant expansion or live URL fallback. The existing ToolSession capability has a maximum two-minute lifetime; this slice does not add renewal. Expiry stops the channel conservatively and may end a longer run before its overall deadline.

## Lifecycle

Read the opt-in flag from the claimed run's immutable profile. Set allocation `tool_transport` per run, never on a shared client. The connector still independently requires its fixture-only transport opt-in and attests the helper. Existing ToolSession binding supplies its own transport confirmation without changing connector contracts.

After prepare and transition to running, provision one grant bounded by the run deadline and start a ToolSession with the current SQL owner, generation and binding. Bind before prompt. Pump the session on normal running ticks alongside model/events processing; upstream work stays in ToolSession's bounded executor outside SQL transactions. Approval, cancellation, pause and lease checks remain authoritative. Do not issue tools while awaiting approval. Completion must drain a pending acknowledgment before saving a successful result; no result or capacity release may bypass existing proof checks.

On tool uncertainty, close/revoke the channel, request the existing cancellation stop proof, and mark the run failed only with confirmed cleanup; otherwise quarantine and retain capacity. Tool failure cannot become a successful run merely because the SDK finishes. Every exit closes the session, including lease loss and exceptions. Existing SQL/control gates reject late dispatch/delivery. A recovery claim must not automatically provision a replacement grant, rebind, reset operation counters, or replay an operation. Preserve the original reservation until existing complete stop proof permits release. Completed/stopped recovery still reconciles persisted results and cleanup normally.

## Verification boundary

Meaningful red/green regressions use real PostgreSQL plus local HTTP mock connector/upstream boundaries and normal `Worker.run_once`/`execute_real`. Cover default-disabled and immutable opt-in, config and repository/commit rejection, successful tool delivery/ACK and lifecycle completion, uncertain delivery, cancellation/ownership loss and incomplete stop proof. Reuse existing lifecycle and broker regression suites.

The fixture models SDK/VM behavior deterministically. These tests do not prove real KVM isolation, actual SDK tool requests, process restart or production/live GitHub readiness. Those need a separately scheduled real-runtime acceptance run. No test may report mocked behavior as KVM evidence.

## Review checklist

- A configured Worker must not enable transport for an old/default profile, including when two differently configured runs share one client.
- SDK `finished` is insufficient while an admitted operation or guest acknowledgment is pending. Tests must exercise this interleaving. The controller currently needs a narrowly contained read of the existing session pending state; no concurrent relay API refactor is part of this change.
- Stale workers cannot change the successor's state or release capacity. Cancellation, pause, approval and model cutoff still gate dispatch and delivery through SQL.
- Recovery never resets a grant or operation counter. An existing saved result requires proven acknowledged tool operations; missing or unknown evidence must not become success.
- Error paths and public evidence contain only fixed codes, synthetic identifiers and counts. Secrets/configuration paths and raw external payloads are excluded.

## Operator setup for local mocks

1. Keep the connector's existing `tool_transport_fixture: true` switch restricted to a disposable mock test configuration. Its sealed deny-all guest policy and transport attestation remain mandatory.
2. On the trusted Worker host, create a mode-0600 secret file and mode-0600 JSON configuration for the loopback mock service. Set `TOOL_BROKER_MOCK_CONFIG` to that configuration path when starting the normal Worker. The API and guest do not need this secret.
3. Through the authenticated profile API, create a new revision with `backend: "openhands"` and `mock_tools: true`; use that revision for a new run whose repository and base commit match the configured policy. Existing profile revisions remain unchanged.
4. Inspect the run's terminal state and cleanup state independently. A tool failure is not a successful result. An interrupted run with unknown cleanup continues to occupy capacity; request cancellation so the existing reconciler can verify release.

This setup describes a local mock integration. The new tests do not run the actual SDK/guest tool program, and there is no claim of end-to-end KVM acceptance for this slice.

The private JSON configuration requires every field below and rejects extras. Replace the synthetic IDs, local port, secret path and repository grant with values for your controlled mock fixture. `secret_file` points to the private credential; its contents are never sent to the connector or guest.

```json
{
  "service_id": "7a49c632-f54b-4226-bdf5-2f801e278a9f",
  "credential_revision": "396347db-6c4e-45ee-8288-73f37d19476e",
  "origin": "http://127.0.0.1:18090",
  "credential_origin": "http://127.0.0.1:18090",
  "credential_path_prefix": "/repos/example/project",
  "secret_file": "/run/agent-platform/mock-tool-secret",
  "repository_id": 123,
  "owner": "example",
  "repository": "project",
  "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "paths": ["README.md"],
  "issues": [1],
  "operations": ["github.repository.get", "github.issue.get", "github.file.get"],
  "request_limit": 10,
  "in_flight_limit": 1,
  "total_timeout": 2,
  "idle_timeout": 1
}
```

## Recovery evidence

A normal successful run records a durable `tool.session_drained` event only after all admitted operations are acknowledged and the relay is closed. A successor may reconcile a previously saved result only with that event and settled operation records. An active recovery claim does not create a new tool grant or session, even if the prior process disappeared before its first tool call; it follows the conservative failure/stop-proof path. This deliberately trades automatic continuation for no replay.
