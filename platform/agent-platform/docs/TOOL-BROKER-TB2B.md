# TB-2b — real KVM tool transport acceptance

This slice exercises [TB-2a](TOOL-BROKER-TB2A.md) on a dedicated, deny-all
Cocoon KVM node using the pinned SDK terminal tool and a local mock GitHub
upstream. The normal Worker remains unchanged and the transport remains
fixture-only and disabled by default. Live GitHub and production activation
are separate gates.

## Preconditions

Use an explicitly authorized, dedicated empty node with the pinned sandboxd,
Cocoon runtime, guest image and terminal launcher from the existing
[KVM](KVM-VALIDATION.md), [isolation](M3-GUEST-ISOLATION.md) and
[sealed egress](M3-EGRESS.md) procedures. The node must have no claims or VMs,
zero warm targets and the explicit `node-egress-v1` deny-all policy. Wait for
initial golden snapshot creation to finish before running acceptance.

Create fresh private connector state and test credentials. Preserve other
connector journals and fences. For a delegated systemd user service, both
`Delegate=yes` and `DelegateSubgroup=supervisor` are required; the Cocoon VM
cgroup belongs under that service's `vms` subgroup. Starting a service without
the supervisor subgroup can leave the VM cgroup in an invalid domain state.
Never relax a shared host controller or delete an uncertain allocation journal
to make a test pass. Reconcile only through the existing explicit empty-host
ownership procedure.

The private connector config must set `tool_transport_fixture: true` and use
loopback control listeners. Only the test driver explicitly requests
`tool_transport: true`. Use the repository's locked dependencies and a fresh,
task-owned `agent_platform_test` PostgreSQL database. No external service
credential or paid model is needed.

Start the connector separately using the same private config and service
identity as sandboxd. Run from the component directory on the KVM host:

```sh
PYTHONPATH=src python -m agent_platform.cli connector \
  --config <private-state>/connector.json --port 17888
```

In a separate terminal, use the existing disposable PostgreSQL wrapper. It
creates a database for the run and removes only its own container afterward:

```sh
PYTHONPATH=src python scripts/test-postgres.py python scripts/tool-broker-kvm.py \
  --config <private-state>/connector.json \
  --origin http://127.0.0.1:17888 --output <new-private-output>
```

`--case` selects one case; omitting it runs the full matrix. Each invocation
requires a fresh database and output directory. Keep raw logs and connector
journals private. A failure preserves its report and attempts cancellation;
nonzero cleanup counters prevent success. An uncertain allocation or incomplete
stop proof requires ownership reconciliation before any subsequent acceptance.

## Evidence boundaries

The guest probe runs through the actual SDK terminal as UID 2000. It emits only
boolean observations and checks the exact expected schema. Protected-file
probes never truncate or write the target. The signal permission probe uses
`kill(pid, 0)` and the socket metadata probe attempts the existing mode.

A failed connection to a documentation address alone is not evidence of a
network policy. Pair the bounded direct-connect observations with actual sealed
node attestation and guest interface isolation. The probe cannot obtain the SDK
or tool relay key; credential-audience substitution must be tested separately by
the trusted host.

The Unix client's ACK means that adapter process received the result. It does
not prove durable LLM consumption. Helper/session restart deliberately closes
authority and never retries the original operation. An already dispatched
upstream request cannot be recalled; lifecycle changes must prevent later hops
and delivery while cancellation retains the normal full-stop proof requirement.

| Case | Required observation |
| --- | --- |
| `complete` | Approved SDK terminal reads repository, issue and pinned file; three exact results, three SQL ACKs, seven authenticated mock HTTP hops and all 25 guest isolation checks |
| `cross-run` | Two live guests; wrong binding/generation/run capability rejected; other guest's tool key, Agent Server key and actual model-local key rejected by the tool relay; zero dispatch |
| `helper-restart` | Kill the owned guest helper after dispatch while upstream is held; restart fails closed with its existing socket/marker; original terminal fails, no ACK or replay |
| `session-rebind` | A new host ToolSession cannot bind an existing channel or restore the original authority |
| `worker-takeover` | Inject SQL lease expiry, run production reconciliation and claim with a new owner/generation, retain the original binding/reservation and reject old tool authority |
| `revoke`, `pause`, `cancel`, `cutoff` | Control returns while the mock request is still blocked; no later result ACK; pause/resume does not replay; capacity remains reserved until confirmed stop |
| `stop-proof` | After actual VM stop, an injected incomplete proof cannot release the SQL reservation; the complete proof then releases it |

The takeover case uses real SQL ownership and generation transitions in one
test process. It does not kill a host worker or restart the connector process.
The incomplete-proof case does not leave a real cgroup behind. The model helper
is enabled only on the unprompted sibling VM to test its actual credential
audience; simultaneous model/tool orchestration is not established.

Tool result assertions use the fixed SDK terminal artifact plus the durable
Broker delivery ledger. They do not require the subsequent SDK finish event.
During harness development, post-approval event polling returned a generic
connector refusal in both normal and helper-fault runs. Its exact cause remains
unresolved; it is not evidence of a secret leak or a verified helper-attestation
failure. Raw failure logs remain private. Full SDK workflow completion and
connector process crash recovery are outside this acceptance claim.

## Acceptance record

On 2026-10-03, all ten cases above passed on actual KVM. The
[sanitized record](evidence/tool-broker-kvm-2026-10-03.json) contains source and
runtime hashes, the command, all 25 isolation observations, dispatch/ACK counts,
fault outcomes and cleanup. Final claims, VMs, VM CPU scopes, SQL reservations
and test PostgreSQL containers were zero; the test connector and node services
were stopped and their private journals retained.

`PATH=<locked-venv>/bin:$PATH PYTHONPATH=src make platform-check` passed 45 unit
and 318 platform tests, with Ruff checks covering 120 files. The final focused
probe/denial regression run passed six tests. KVM used Python 3.13.5; local native
checks used Python 3.12.3. Existing runtime dependencies matched the lockfile in
the isolated test environment.

This is scoped TB-AT-10/TB-AT-11 evidence subject to the boundaries above. It
does not establish full platform workflow health or production activation.
TB-AT-12 live GitHub access remains **not run**.
