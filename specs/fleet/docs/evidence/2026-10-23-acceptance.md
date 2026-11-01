# Fleet candidate acceptance — 2026-10-23

## Candidate and decision (pre-delivery snapshot)

Owner invoked [START_DEVELOPMENT_PROMPT](../../START_DEVELOPMENT_PROMPT.md), restoring mainline work. Base and freshly fetched main both resolve to `b7f2a4311d1135977ba273efba8e77702b908036`; the working branch is `docs/retire-goku-development-prompts-20261023`. Unrelated existing/concurrent changes were preserved.

This is an **uncommitted candidate**, identified by content manifest `7416734bd434f50d901d6c421782aae6bae5728ac8d4c4037019ecd67af60245`. [Source manifest](2026-10-23-source.json) includes Go/SQL, module files, UI, schema, deploy configuration, testdata, acceptance scripts and build files. [Docker evidence](2026-10-23-docker.json) records the corresponding binary SHA-256 values. Documentation and root CI wiring are reviewed separately from this component content fingerprint.

Evidence gate: **AC-01/02/04 candidate checks PASS; full mainline PARTIAL**. AC-03, remote CI, merge and usable-tag gates remain open. No commit, push, PR, merge, release or production deployment was performed.

| AC | Actual result | Evidence and boundary |
| --- | --- | --- |
| AC-01 | PASS for this candidate | Raw schema types/presence, Unicode limits, protected-hostname normalization; safe YAML/Compose and literal dotenv regressions; existing examples/goldens. Actual container argv/env preserve quotes, newlines, dollars and trailing backslash. |
| AC-02 | PASS for isolated node lifecycle | Real fleetd/SQLite and fleet-agent, real Docker/Compose and a dedicated local registry; one workload deploy → healthy → stop → start → same-image redeploy. Stable generation does not repeatedly recreate. Catalog generations/state and actual container identity checked. |
| AC-03 | PENDING | No Cloudflare calls, tunnel/access policy creation, public DNS, OTP login or WARP reachability test. Origin loopback success is not ingress acceptance. |
| AC-04 | PASS for tested process/outage recovery | Agent restart preserves instance identity and applied generation; fresh actual report required. Control-plane restart preserves node/image/release/generation/port/git SHA. Running and stopped assignments reconcile during outage and after agent restart. Uninstall succeeds with Compose/env/cache absent. |

## Changes and RED → GREEN

- The compiler previously emitted unquoted user strings. Tests reproduced YAML privileged/host-network injection, argv scalar coercion and dotenv variable injection. Compiler strings now use safe YAML quoting plus Compose dollar escaping; volume targets use long syntax; output safety is checked semantically.
- Raw nulls and YAML scalar coercions previously disappeared into Go zero values. Parsing now checks field presence/types before defaults. Deploy overlays its image before this validation. Hostnames normalize before protected-name checks; string limits count characters.
- Same-generation `force_recreate` previously pulled/recreated every tick. Applied metadata now gates recreation by generation/hash and survives process restart.
- The agent previously returned immediately on fetch failure. It now reconciles the same-node cache on each failed fetch; missing generated files are restored, including before tombstone Down. Heartbeat starts before potentially blocking cached recovery.
- Secret merging previously split/reordered dotenv lines, corrupting multiline quoted values. It now preserves encoded dotenv syntax and appends node secrets with override order intact.

RED logs are retained in protected workspace evidence: `recovery-red-executed.log`, `integration-red.log`, `secret-merge-red.log`, and worker `contract-red.log`. Expected behavioral failures were observed before fixes. Worker `contract-green-attempt.log` preserves the intermediate golden mismatch. These historical failures are not rewritten as passing runs.

## Executed verification

[Native output](2026-10-23-native.txt) comes from `scripts/verify.py`, run through the shared workspace launcher with the installed Go executable. Public output normalizes private executable/artifact paths. Executed native subcommands:

- `go test -count=1 ./...` — PASS.
- `go -C examples/hello-healthz test -count=1 ./...` — PASS.
- `go vet ./...` — PASS.
- `go test -count=1 ./internal/fleetfile ./internal/compose` — PASS.
- `go build -trimpath` with explicit ldflags/output paths for fleetd/fleet-agent, plus the hello-healthz build — PASS; exact normalized argv is in native output.
- `scripts/acceptance.py` executed through the shared launcher on the selected isolated VPS, with exact built binaries and source ID — final round03 PASS, ten checks plus cleanup.
- `git diff --check` — PASS after final scoped changes and documentation.
- `python3 scripts/check_project_success.py --projects specs/fleet` and `python3 scripts/check_project_success.py`, through the launcher — PASS (Fleet and all 41 project contracts/navigation/index). Earlier repo-wide checks observed concurrent codex-usage documents in progress; no unrelated files were changed to make this pass.
- Native task/report validator on T993/T994/T995, document-link checks, recomputed source fingerprints and final-build binary hashes against round03 — PASS. Initial documentation status wording and worker report suffix did not conform to validator syntax; formatting was corrected without changing acceptance evidence.

Toolchain: go version go1.27.1 linux/amd64. Real runtime: Docker 29.8.1, Compose 5.5.1. Only process restarts/outages were injected: no host or Docker-daemon reboot, no separate-host network topology, no production-control takeover.

An initial `make` launch failed because make is absent locally; no Makefile target is claimed as executed locally. Native equivalent commands then ran via the installed toolchain. Initial sandbox Go tests failed on DNS and loopback socket permissions; the authorized rerun outside the sandbox passed. Initial recovery-test invocation from the repo root failed because it was outside the Go module; the corrected module invocation produced the retained behavioral RED results.

Round01 established lifecycle/recovery and literal values. Round02 added actual secret merging and fresh-report checks; independent review found its missing-file uninstall oracle could be masked by cached stopped recovery. Round03 preserves/removes that cache before restart and proves the intended absent-file path. Earlier round evidence remains protected and is not substituted for round03.

## Isolation, cleanup and review

Preflight inspected connection, CPU/memory/disk, processes, active services, containers/images and listening ports. The host had sufficient capacity and no Fleet stack; its existing test registry remained untouched. A distinct loopback registry, state directory, node ID, workload/project and generated credentials were used. No existing test or production service needed stopping. Exact host/account/IP and private raw logs remain outside the repository.

Every test process and created container was stopped/removed; final container inventory equals the original inventory and cleanup status is `passed`. No global prune, data deletion, service migration or host reset occurred. State databases, logs, generated config snapshots and test image artifacts were preserved for handoff.

T993 read-only audit → T994 isolated scoped implementation → root diff inspection/integration/full verification → T995 independent read-only review. Reviewer ACCEPTs the Go fixes and final corrected round03 oracle; root accepts the supported candidate evidence. This is independent native-agent review, not a claim of cross-model-family review.

## Remaining minimum steps

1. Provide dedicated Cloudflare test configuration (`CF_API_TOKEN`, account/zone IDs, allowed/base domain, protected bootstrap tunnel/hostnames and Access allowlist) through a secret location, plus an enrolled WARP device. These required variables were absent from this session; no setup location/client was supplied.
2. Execute the real public/access/private boundary checks from [bootstrap](../bootstrap.md#isolated-lifecycle-and-recovery-acceptance), preserving unauthenticated denial and authenticated/WARP success evidence. Keep private services off public DNS.
3. With explicit Git delivery authorization, publish the candidate and run [root Fleet CI](../../../../.github/workflows/fleet-ci.yml). The previous nested workflow is not a monorepo CI entrypoint. Minimum declared Go 1.23 remains for CI verification; this local run used Go 1.27.1.
4. This candidate milestone may merge after its required review/CI pass under the subsequent owner authorization. Full-mainline usable-tag qualification still requires all original AC. Current `mainline: incomplete`, `usable_tag: none` remain accurate.

Record updated 2026-10-22T18:24:27Z. Product progress authority remains [BOARD](../tasks/BOARD.md); this file is evidence, not a second task board.

## Subsequent delivery authorization

Owner explicitly requested milestone commits and PR merges. The original candidate results above remain historical evidence. Delivery uses a clean branch based on `f64c7ef01532f717e963e7c1adec4cbae87f16e7`, retaining the exact component fingerprint and separating unrelated work. Current PR, native/CI verification and actual merge status are recorded in [BOARD](../tasks/BOARD.md#milestone-delivery). AC-03 and usable qualification remain pending.

Delivery revalidation (2026-10-23T01:41:40Z): the isolated tree passed the full native test/example/vet/schema/three-build runner with Go 1.27.1, all 41 project contracts, documentation link targets and scoped diff/public-path checks. A sandbox-only attempt failed because loopback sockets are forbidden; the authorized outside-sandbox run passed. Runtime manifest equality was checked against the reviewed/live-tested candidate. Rebuilt binary hashes differ: `go version -m` shows only the changed Git revision/time in build metadata; the published Docker hashes remain the exact binaries actually tested, not these new rebuilds. No new live-Docker run is claimed for the delivery rebuild. Remote CI results are recorded on the board when available.
