# TB-2a — mock guest tool transport

Status: implementation and mock verification slice; **disabled by default**.
This extends [TB-1](TOOL-BROKER-TB1.md) and the [Tool Broker design](TOOL-BROKER.md).
It does not complete TB-2, establish a KVM security boundary, or enable live GitHub.

## Execution path

```text
Pinned SDK terminal tool (UID 2000 in the proposed guest layout)
  → python3 -I /opt/agent-platform/guest_tool_client.py '<operation JSON>'
  → fixed Unix socket /var/lib/agent-platform/tools/request.sock
  → private guest_tool mailbox (UID 2001)
  ← authenticated connector HTTP relay on guest loopback port 18081
  ← explicit host ToolSession harness
  → existing TB-1 Broker → fixed mock GitHub adapter
```

The SDK adapter is a stdlib client invoked through the existing terminal tool.
There is no new native SDK tool registration, dynamic plugin, shell-command
approval expansion or runtime dependency. The client has no URL, socket-path or
credential CLI option and does not retry. Repository text and returned issue/file
contents remain untrusted data.

The normal Worker, public run/profile API and RuntimeClient allocation path do
not turn this transport on. A trusted fixture harness must explicitly allocate
`tool_transport: true` against a connector configured with
`tool_transport_fixture: true`, provision the existing immutable broker grant,
and drive `ToolSession.step()`. The host must already hold the run generation,
lease owner and sandbox binding. No grant issuer or secret is exposed to guest
requests. The fixture switch does not authorize KVM execution or live access.

## Identities and helper contract

The terminal can submit only the three fixed read-only operation shapes from
TB-1. The helper allocates the operation UUID; reserved identity/URL/header fields
are rejected. The Unix socket uses Linux `SO_PEERCRED` and accepts UID 2000 only
in its production entry point. Tests explicitly select their current local UID;
that is parser/peer-credential evidence, not proof of UID isolation in a VM.

Root setup creates a UID 2001-owned `0755` socket directory; the socket is `0666`
so UID 2000 can connect, while peer credentials enforce admission. Terminal UID
2000 cannot replace the socket or write its parent. The private mailbox stores only operation IDs/status, never request payloads,
results or receipts. Its state remains in the existing UID 2001 `0700` control directory, with `0600` files.
Conditional admission attestation checks helper SHA-256/owner/mode, the directory,
socket and state file, plus the helper process identity. It does not repair a
running guest. The actual KVM attestation contract remains to be exercised.

The relay key is fresh and separate from model and Agent Server keys. It is kept
in the private connector journal/helper environment and included in existing
connector output filtering. TB-1 bearer capabilities remain in the host session;
neither that token nor the external service credential is sent to the guest.
General model/session credentials cannot authorize the tool control route.

`POST /v1/runs/{run_id}/tool` requires the connector's host credential and an exact
`ToolExchange` schema with `generation`, `binding_id`, and an action:

| Action | Additional fields | Effect |
| --- | --- | --- |
| `bind` | none | Discover a fresh helper instance and pin run/binding/generation once |
| `poll` | none | Return one pending operation or one guest consumption receipt |
| `deliver` | `operation_id`, `result`, `receipt` | Deliver a verified result once |
| `ack` | `operation_id` | Clear the consumed operation after broker ACK |
| `close` | none | Close the channel and discard volatile completion |

The connector supplies the pinned identity to guest control calls. Both connector
and host session compare every reply's instance/run/binding/generation. A process
epoch prevents a restarted connector from resuming its persisted channel; a
fsynced startup marker prevents helper restart, including idle restart, from
creating fresh authority. Binding is immutable and cannot silently migrate across
generations. A fresh host session cannot rebind an existing channel.

## Delivery and failure semantics

1. The helper persists operation metadata before host polling. Only one request
   can be outstanding. A repeated payload is not automatically admitted with a
   new UUID; the helper bounds its history to 100 requests.
2. The host session normalizes against the immutable grant, uses the existing
   broker admission ledger, and executes upstream work on a separate global
   four-slot executor with no waiting queue. `step()` does not wait for upstream
   completion. Connector control RPCs and DB gates remain synchronous and bounded
   by their existing transports; this is not a separate process guarantee.
3. Before exposing a completed result, the session polls the same helper and
   rechecks `Broker.authorize`. Pause, cancellation, lease loss or revocation
   prevents later delivery. Requests already dispatched are not rolled back.
4. The helper returns the result once on the originating Unix socket. The client
   validates the response and ACKs its operation ID on that same connection. The
   broker receipt is never part of the terminal response.
5. Only then does the host receive the receipt and acknowledge the durable broker
   operation. A final helper ACK unlocks the next request. No result or raw receipt
   is saved in the connector journal; only identity, status and hashes are stored.

Timeout, malformed response, lost ACK, changed instance, unexpected pending
operation or uncertain effect closes the channel. There is no result replay,
automatic retry, operation refund, helper restart recovery or generation rebind
in this slice. `close()` revokes the grant before attempting guest close and never
joins an upstream execution thread. Eventual completions are discarded. If revoke
or close cannot be confirmed, the host session exposes a fixed error; callers
must retain the normal run cancellation/recovery controls.

The capability expires according to TB-1's two-minute limit; this fixture session
does not rotate it. Renewal, operator activation and recovery UX are later work.
The client's ACK confirms receipt by the adapter process, not durable consumption
by the LLM or visibility in an SDK event stream. Failure after receipt is not a
reason to replay the operation.

## Verification boundary

Repository tests exercise real Unix socket framing, guest loopback HTTP,
connector ASGI routing, real PostgreSQL authority/ledger, and the fixed mock
GitHub HTTP adapter. The VM port-forward, guest attestation and SDK terminal
execution are mocked. Focused tests cover cross-identity rejection, framing,
restart, once-only delivery, lost ACK, revocation, bounded execution and
credential filtering. Native checks and exact-head CI are reported with the PR.

TB-2b still requires an explicitly authorized deny-all KVM host: run the actual
pinned SDK terminal command, prove UID 2000 cannot inspect mailbox/relay secrets
or replace helpers/socket, verify cross-run/generation rejection and helper
restart, and exercise pause/cancel/stop with in-flight requests. Until that proof,
TB-AT-10..12 and full TB-2 remain incomplete. TB-3 separately requires approved
live repository/credential permissions and production transport readiness.
