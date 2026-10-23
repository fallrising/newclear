---
document_type: evidence
node_id: N00
task_id: T10
recorded_at: 2026-10-23
result: partial
---

# T10 — Foundation resumption evidence

## Candidate and authority

Owner activated START_DEVELOPMENT_PROMPT.md. Base commit: `b7f2a4311d1135977ba273efba8e77702b908036`, existing branch `docs/retire-goku-development-prompts-20261023`, plus the scoped uncommitted repair. Other components were concurrently edited and preserved. No commit, push, PR, merge, release or deployment was authorized or performed. App remains the foundation build-info shell.

Rust 1.97.1 (8bab26f4f), Node 24.18.0, npm 11.16.0, Tauri CLI 2.11.4. Linux x86_64 isolated test snapshot preserved the monorepo layout. All new build/test jobs used the common workspace launcher; source remained separate from build/cache/temp. Logs and artifacts are retained in the protected Flowshot workspace evidence directories, outside this public repository. Source/dependency lockfiles were not regenerated.

## Repairs

- Release probe uses `CARGO_TARGET_DIR` and `CARGO_BUILD_TARGET`; Tauri wrapper normalizes relative Cargo paths before the CLI changes cwd.
- TypeScript build info, Vite bundle, Tauri frontendDist and launch-entry inspection agree on `AGENT_BUILD_DIR`; default checkout paths remain available. The ignored node_modules symlink refers to isolated dependencies.
- Window probing is asynchronous, bounded by the observation deadline and output size; hung probes are killed. Swift reports the requested PID, checked alongside the window ID. Spawn failure produces a diagnostic. Cleanup waits for exit and escalates TERM to KILL. Observation timestamps retain their precision and invalid values cannot pass.
- The acceptance budget remains strictly `<1500 ms`; the 15-second observation clock remains diagnostic. Shared-workspace launch evidence defaults to `AGENT_EVIDENCE_DIR/macos-launch`.
- Frozen-lock verification checks schema/node/spec identity, SPEC digest, source list/order/hash algorithm, command descriptors, frozen marker and generator version. Actual drift checker is exercised by the changed-output negative test. Existing lock bytes and generated DTO/wrapper bytes are unchanged.
- SDD verifier accepts positive node revisions, rather than only revision 1. N00 revision 2 records scripts/root-workflow ownership and the already-frozen contract. All N00 derived source hashes and documentation manifests were regenerated; historical evidence remains intact.
- Root `.github/workflows/flowshot-ci.yml` routes Flowshot changes to the existing Linux and two-architecture Mac gates. Nested standalone workflow is identified as historical. Hosted Mac timing remains nonblocking diagnostic only; native compile/test failures remain blocking.

## Red, corrections and green

| Check | Observed failure | Correction/result |
| --- | --- | --- |
| Local baseline `make ci` through launcher | could not start: Make absent; Cargo also absent | used isolated Linux test host with Make/compiler and pinned Rust/Node |
| `python3 scripts/sdd.py verify` | stale MANIFEST | regenerated after reviewing intended documentation changes |
| `node scripts/launch-regressions.node.mjs` | missing testable probe exports; independent repro accepted undefined/NaN/negative timestamps | path, timing, spawn, cleanup and async regression tests pass |
| Child cleanup fixture | local readiness using console output stalled; bounded rerun exited 124 | fixture uses explicit stdout write and finally cleanup; corrected test passes; original stalled session interrupted |
| `cargo test --locked -p flowshot-xtask frozen_lock_rejects_metadata_tampering` | `tampered schema_version must be rejected` | validator checks declared metadata; negative cases pass |
| First Rust implementation compile | sha2 0.11 digest array lacks LowerHex | used explicit byte-to-hex encoding, consistent with existing source digest; full Rust gate passes |
| `python3 -m unittest discover -s scripts -p 'test_*.py' -v` | revision 2 rejected as missing | positive integer revision check passes valid revisions and rejects zero/negative/fractional/missing/text |
| Final project-success validation | AC table used unsupported partial/blocked status labels | changed labels to pending, retaining partial verification and blocker details; validator rerun |
| First Linux snapshot `make ci` | component-only snapshot lacked linked monorepo workflow | reproduced actual `repo/apps/flowshot` plus root CI layout; SDD passes |
| Cargo metadata from src-tauri with relative target | target resolved beneath src-tauri rather than project root | wrapper normalizes before invoking Tauri; red missing-helper regression then green |

The Linux download step emitted transient TLS retry warnings before successful dependency fetching. These were not product test failures. No acceptance threshold was relaxed.

## Executed verification

Commands below ran from the component directory under the shared workspace launcher, unless noted. Linux full gate is real execution, not a mock desktop run.

| Command | Result |
| --- | --- |
| `make ci` on isolated Linux | passed available gates; explicitly skipped native-ci because WebKit/pkg-config prerequisites were absent |
| `cargo run --locked -p flowshot-xtask -- contracts --check-determinism --check` | passed, zero frozen/generated drift |
| `cargo run --locked -p flowshot-xtask -- check-boundaries` | passed |
| `cargo fmt --all --check` | passed |
| `cargo test --workspace --exclude flowshot-tauri` | passed: core 5, xtask 7; DB is still a zero-test marker |
| `cargo clippy --workspace --all-targets --exclude flowshot-tauri -- -D warnings` | passed |
| `npm run lint`, `npm run test`, `npm run build` | passed; 6 frontend tests in 3 files |
| `node scripts/check-launch-entry.mjs` | passed; 2359-byte entry (<20000) contains get_build_info; React stays split |
| `node --test scripts/*.node.mjs` | final full-ci3: 14 passed, including IPC during a stalled window probe and normalized relative Cargo paths |
| `python3 -m unittest discover -s scripts -p 'test_*.py' -v` | passed: SDD valid/invalid revision matrix |
| `python3 scripts/sdd.py generate`, `python3 scripts/sdd.py verify` | passed after hash/manifest refresh |
| `npm run tauri -- --version` | passed: tauri-cli 2.11.4; proves wrapper invocation only |
| `python3 scripts/check_project_success.py` from monorepo root | passed: 41 project contracts and navigation/index |
| Python/PyYAML root-workflow inspection | passed syntax, component paths, two-Mac matrix and diagnostic-only continue-on-error placement |
| Scoped `git diff --check` | passed |

## Independent review and acceptance limits

[Initial audit](../../../../.team/reports/T-001.md) and [independent review](../../../../.team/reports/T-002.md) record findings, actual checks and scoped ACCEPT. Reports live under the component after detecting a collision with another component's shared-root task number; unrelated Fleet records were left intact. Reviewer independently ran the then-current 12 Node tests and SDD regression. Orchestrator owns final acceptance and inspected the actual diff and full Linux output.

A preexisting nonblocking diagnostic limitation remains: app stdout emitted after command completion is not retained while waiting for the window. Stderr remains observed. This is documented rather than represented as fixed.

- Native Rust/Tauri tests, mock IPC and native build: **not executed this run**; Linux prerequisites absent.
- Swift compilation, controlled macOS 13+ release launch, hardware/timing/screenshot evidence: **not executed**, target access unavailable. Historical hosted failures remain preserved in T08.
- New root GitHub workflow: statically checked, **not remotely executed**; no push/publication authority.
- N00/T08/T09 remain blocked; no G2 done outcome appended, no downstream gate unlocked, no usable tag.
- N01–N10/A01–A07 product implementation and real dogfood remain pending. Minimum next action: run required native gates and unchanged Mac launch oracle on the controlled target, then follow the existing N01 tasks and graph.

## Test resource handoff

Candidate selection inspected OS/resources, processes, services and listeners; container enumeration was unavailable to the test account, so no container/service was changed or stopped. The selected host had ample resources and no observed active build job; the existing registry/service state was preserved. All test commands ran in bounded task directories; source snapshots, logs and installed isolated toolchains remain for reproducibility. No cleanup/prune or data migration occurred.

## Final candidate confirmation

The final isolated `make ci` rerun (full-ci3) exited 0 with the same explicit native prerequisite skip. It ran 12 Rust tests, 6 frontend tests, 14 Node tests, the SDD revision regression, format/lint, deterministic contracts, boundaries and production build. The final reviewer follow-up retained ACCEPT and independently passed 9 focused tests.

All 61 code/config/lock files in the protected source fingerprint were compared byte-for-byte with the tested remote snapshot by SHA-256: zero mismatches. Fingerprint manifest digest: `417ae0d8687b8ee8832ca58dd4131c5f4b3c101f5e00702be365c56b15352a1f`. Preserved evidence: `linux-ci-final.log` and `candidate-source-sha256.json` in the final Flowshot workspace task. Documentation-only handoff updates followed, with SDD/integrity rechecked.

Post-test inspection observed no Flowshot task processes, and the existing Docker/containerd services and registry listener remained active. Nothing required service restoration. Test snapshots, toolchains and protected logs were preserved; no automatic cleanup was performed.

Evidence-gate decision: ACCEPT the reviewed portable N00 repair; overall requested product delivery remains PARTIAL/BLOCKED on native/Mac acceptance and the unchanged downstream gates.
