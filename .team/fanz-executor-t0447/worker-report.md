STATUS: DONE

## Summary

Implemented the bounded T-0447 connector substrate in the assigned isolated worktree.
No commits, provider calls, host changes, nested workers, dependencies or parent-owned
coordinator/profile/API files were changed. This is an implementation-worker result,
not EX-02/EX-03, VM, subscription coding or browser acceptance.

- Explicit `Allocate.external_workspace=true`, opt-in connector configuration and
  non-fixture verification. Legacy false-field serialization/fingerprints are preserved.
- `POST /v1/runs/{uuid}/workspace`: generation, operation UUID, read/write/exec;
  preserves exact content/argv whitespace. Each operation uses the existing fence,
  run lock and fsync journal. Completed replay observes; mismatches and unknowns refuse.
- Root-owned guest helper drops groups, GID/UID and privileges before workspace access.
  File components use descriptor-relative no-follow opens; hardlinks/nonregular files
  refuse. Commands have fixed cwd/environment, bounded output and process-group stop.
  Root attestation before/after tools requires no remaining UID2000 process.
- External prepare never starts OpenHands. Result finalization closes tool admission,
  runs fixed-profile verification and uses existing diff integrity checks. Cancellation
  skips the absent OpenHands interrupt, retaining exact ownership/removal verification.
  Inspection reads the same journal; unsupported OpenHands prompt/events/control/approval
  paths refuse explicitly. Catalog/admission honor narrowed `max_claims` (default4).
- Tool receipts cap at4MiB plus final-result headroom so existing8MiB stale-cleanup
  serialization remains usable; max128operations. External deadline at most600seconds.

## Verification

Commands below ran from `platform/agent-platform` with `PYTHONPATH=src:tests_platform`.
`PYTHON` denotes the root-prepared native system Python3.12 venv; `RUFF` its pinned Ruff.
In-process HTTP tests require the approved unsandboxed local execution route because
restricted sandbox TestClient stalls during event-loop startup.

- Final `timeout 30 $PYTHON -m unittest test_external_workspace -v`:17 tests,1.419s — passed
- Affected earlier frozen source: `timeout 45 $PYTHON_MANAGED -m unittest test_external_workspace test_connector_tool.ConnectorToolTests test_guest_isolation test_runtime.ConnectorTests test_output_security.OutputPolicyTests test_m3_recovery_oracles -v`:47 cases passed; see preserved environment error below. Subsequent source edits only bounded workspace receipts and result remaining-time admission, covered by final focused group; legacy groups unchanged — passed
- Native supplement `timeout 30 $PYTHON -m unittest test_m3_recovery_oracles.RecoveryOracles test_recovery.FenceTests -v`:20 tests,0.107s — passed
- Scoped `$RUFF check` and `$RUFF format --check` across nine changed source files and new test module:10 files accepted — passed
- `git diff --check` — passed

Preserved failures and corrections:
1. Initial intended RED: missing `agent_platform.connector_workspace` import.
2. One test command used repository root instead of component cwd; no tests ran. Corrected cwd.
3. Initial TestClient sandbox startup stalled; faulthandler identified waiting portal
   in `TestClient.__enter__`. Same test passed outside restricted sandbox; the exact
   owned stalled process was terminated using argv+cwd identity, not broad process kill.
4. Legacy allocation fingerprint test initially exposed the new false field in model
   serialization. Fixed absence of default field, then exact failing case passed.
5. Managed CPython3.12 lacks `fcntl.F_SEAL_WRITE`; extra RecoveryOracles setup errored
   before its tests. Native system CPython exposes seals; all19 previously blocked
   oracle tests plus one fence regression passed. No seal check was weakened.
6. First Ruff pass reported formatting/line-length issues; final scoped lint/format passed.

## Documentation

Root owns the preceding `EXTERNAL-WORKSPACE.md`, SUCCESS, BOARD and PLAN updates.
The coordinator must forward only committed AP job leases; this worker added no lease
minting or second owner. Root should document the public workspace schema and explicit
unsupported OpenHands endpoints. A result reports `execution_mode=cocoon-external`,
not `cocoon-fixture` or a fabricated provider completion.

Frozen source SHA256:

- connector.py:981bad7cc9f433fd5ec4404063dd9f8428c9831e19a1e0943025bc6a3dc9d5ad
- connector_workspace.py:ae5811020611ecd87adc59ec39c597048cb3fb879de5d02fb99ba6474813810a
- connector_cancel.py:209c40d4132c560eb270e671e403278a77611e231fe59c9ed99600d045b90102
- connector_recovery.py:37a5d1578a47fa6e6694fda522779a6f3c34aa89f84905e0a9844c6f239f721e
- connector_control.py:3ce03c2e73f0fe4d2b0e91d7c231c70615c9a57c5621e10d1771e26109230e49
- connector_approval.py:c9ed79b914448a0fa8e8b78f98851ba1a21b65ad44c83bdbcc9eb10662e7ffca
- connector_output.py:ad587d5a44f85d1a7f493264a886c9f4830aace8482d8c699b0ec769f39bac15
- guest_control.py:219f4fd948a18d2a5e7f7e6e77f312dbfbdfcd4338a257d5719f5c7a17db326f
- guest_external.py:a36fd2b5c0019fd4f1ab318c0ea93f06af63e86c938effc7f57ee637a3b71a00
- test_external_workspace.py:7738dedf3e3f6caa8caaedefd7bf32cc1f80bb3d34b666de679f3c266f1aa817

## Risks and Follow-ups

Root still owns actual KVM boot/canary/cross-workspace/egress/cleanup evidence, actual
subscription CLI coding, parent browser journey, integrated PostgreSQL regressions,
independent review and normal delivery. No EX-02/03 or FN acceptance is inferred here.

The arbitrary argv capability runs only inside the guest; this is not a host-shell
endpoint. SDK command timeouts alone never prove termination; an escaped/background
UID2000 process makes post-tool attestation fail and keeps the operation uncertain.
Result checks require enough remaining deadline budget; caller must finalize before
its ten-minute deadline, then observe actual VM removal. Unknown runs cannot resume
an external agent session merely because a prepared workspace exists.

The native test environment differs from managed CPython only where noted; raw provider
requests, hosted tokens and costs are unknown. This worker launched zero providers.
