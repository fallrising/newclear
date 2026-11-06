STATUS: DONE

## Summary

Implemented T146 in the four authorized isolated-worktree product paths only: `scripts/local/prepare.mjs`, `prepare.test.mjs`, `restore-target.mjs`, and `maintenance-workflow.test.mjs`. Root approved the exact export, result shape, producer-captured readRoutes test seam and A/B/C split before edits. No actual Docker/network/Git actions, dependency changes, Compose edits, public CLI flags, public receipt fields, lease/helper/schema edits, old-resource reuse or cleanup occurred.

Private export `createPreparedNetworks(receipt,deps={})` accepts only the actual object returned by prepare/prepareRestore and returns frozen `{web:{id,name,subnet,gateway},data:{id,name,subnet,gateway}}`. The producer's WeakMap captures root/cwd/project/runner, receipt bytes/snapshot and filesystem identities, fixed default route reader and target workflow capability. Clones, mutated/stale/replaced receipts, cross-cwd/runner substitutions and repeat/concurrent use fail ADAPTER_UNSEALED. Capability consumption precedes any awaits/mutations. Normal prepare still creates no networks and retains its exact public return shape and CLI behavior.

Allocation examines all current Docker network IDs/IPAM plus the fixed `/proc/net/route` main-table projection. It only selects the first two available /24 slots in192.168.240.0/20, handles ordinary default0/0 explicitly, validates canonical IPv4/masks/gateways/IP ranges/auxiliary addresses and rejects unknown IPAM drivers or malformed/unsupported observations. The global inventory and namespace are checked again before each create. The two fixed internal bridge creations use project/network/version labels, fixed subnet/gateway, and no config-hash spoofing. Each returned full ID is immediately preserved in an exclusive private fsynced creation record before strict inspect; both networks are inspected again before the final complete-pair record. Failed/ambiguous or partially successful attempts retain resources/evidence and cannot retry with the same receipt.

The target factory retains the original prepareRestore-returned capability, runs its existing empty-project guards, allocates the two networks, then follows unchanged fixed-Compose PG-first/blank-query/API-and-ingress-created-stopped flow. Both network IDs, names, private IPAM and security properties must survive every Compose create, and the final inspected Target network IDs must exactly equal the allocated pair. No unknown existing resource is adopted by the allocator.

## Verification

- Checkpoint A: missing private export/capability named Red (`T146/A/red.log`) followed by22/22 prepare tests in `A/green-final.log`;172 added+removed lines (116 source+56 tests). Covers original object versus clone, receipt shape, no normal-prepare network creation, mutation/cwd/file/runner refusal, one-shot, capacity and partial retention — passed
- Checkpoint B: real-registry factory named Red observed0 private creates instead of2 (`B/red.log`), followed by143/143 prepare/workflow tests, zero skipped,49417.93405ms (`B/green.log`).62 changed lines (19 factory+43 workflow fixture/tests). Factory retains PG-first ordering and rejects either ID or subnet changing during Compose before PG start — passed
- Checkpoint C: unknown global IPAM driver named Red observed missing rejection (`C/unknown-ipam-red.log`); fixed supported-default-driver gate and auxiliary-address bounds.73 changed lines (4 prepare+68 prepare tests+1 workflow fixture). Final prepare tests29/29, zero skipped,7045.659125ms (`C/final-prepare-green.log`) — passed
- Required final command `/home/ckc/.local/bin/node --test scripts/local/prepare.test.mjs scripts/local/maintenance-workflow.test.mjs scripts/local/maintenance-helper.test.mjs scripts/local/maintenance-helper-session.test.mjs scripts/local/maintenance-target.test.mjs` passed296/296, zero failed/cancelled/skipped,50143.439861ms. Exact log `T146/C/final-combined-green.log`. Prior294/294 pre-IPAM-hardening pass remains in `C/combined-green.log`, not confused with final source — passed
- Final fault coverage includes default plus enclosing/nested host-route overlap, malformed masks/flags/columns, exhausted/single-slot pools, unknown/IPv6/noncanonical/out-of-subnet IPAM, preexisting name/label namespace, parallel capability calls, races before first/second creation, partial second-create failure, wrong IDs/names/labels/security/IPAM and final first-network drift. Tests assert no replacement attempts, no completion receipt after failure and retained created resources — passed
- Task validator `python3 /home/ckc/test/codex/agents/codex-team-superpowers/scripts/teamctl.py validate-task .team/tasks/T-146.md` passed. Python trailing-whitespace check passed on all four owned product files; snapshots/diffs/counts/SHA256 manifest preserved under `T146/{A,B,C}` and `T146/final-source-hashes.json` — passed
- Report validator `python3 /home/ckc/test/codex/agents/codex-team-superpowers/scripts/teamctl.py validate-report .team/reports/T-146.md` passed — passed

## Documentation

All evidence paths above are relative to `.team/pp1c-c-20261102/`. Checkpoints172/62/73 lines each remain below400; total307 changed lines across checkpoints. Root owns PLAN/task/publication documentation and actual-runtime acceptance.

Frozen final source hashes:

| File | SHA256 |
|---|---|
| prepare.mjs | `29cc7dbf1bc0bbd326dd2b7dcb448fbae7c598eaa5cd4a4f0e9949eaa392cbb8` |
| prepare.test.mjs | `4a2b94b1253678916f7746726786c78e13c8d3e7b6cd6d495154e23c57d74ef7` |
| restore-target.mjs | `d3afe4d7bab1a6c1a9936cbc7b2c87a5f90379ee73fbb5baeb9ab2e91733e79b` |
| maintenance-workflow.test.mjs | `5a89d3e54b974b91359d090d42c0e38000ec0b897cfba4be1de33513e24d784c` |

Root source fixture can call `const receipt=await prepare(options,deps); const networks=await createPreparedNetworks(receipt,deps);` in the same module instance/process. The cwd must remain the producer's component, and an explicitly supplied command runner must be the original producer runner. The test-only readRoutes function is captured at prepare time; the default always reads `/proc/net/route`, never a caller path. Source CLI and ordinary prepare do not implicitly call this API.

Private durable records are `network-attempt.json`, `created-network-web.json`, `created-network-data.json`, and `prepared-networks.json` under the owned root. Per-created records deliberately say CREATED_UNVERIFIED and retain the returned full ID before inspect; only the final record proves both completed checks. These are private evidence, not new public receipt/Target/Lease schemas.

## Risks and Follow-ups

Root must perform actual controlled source/target creation and prove pinned Compose adopts both newly created network IDs through every service create with the unchanged Compose file/SHA. Native fixtures establish rejection when IDs/IPAM drift, not actual Compose adoption. Labels are exactly project/network/version; no fabricated config-hash is used to bypass adoption behavior. If Compose rejects or recreates the networks, preserve that failure and resources for root review; no automatic cleanup/retry/unknown adoption is implemented.

The main-table runtime parser does not establish arbitrary host policy-routing coverage. Root supplied `network-route-check.json` separately records tables52/local/main,115 routes and no overlap for this controlled host. That evidence is not repackaged as a capability valid for arbitrary production hosts. Live capacity may change after read-only checks: a Docker race/conflict still fails closed, consumes the capability and retains any partial creation. No fixed pool expansion/fallback exists.

Root still owns full C gates, independent review, actual fixture/lifecycle evidence, CI and publication. This DONE status is the bounded implementation/native-test deliverable, not C/D completion or actual-runtime success. Prior runtime failures/resources remain untouched.

Estimated T146 active effort approximately20minutes of the new45minute assignment, including report, with remaining budget reserved for bounded follow-up. Exact provider/request and aggregate tool counts are unknown; command durations cited above are observed test summaries. Prior T14123/T1457/T13223/T13612/T1398 and historical B usage remain separate and were not reset.
