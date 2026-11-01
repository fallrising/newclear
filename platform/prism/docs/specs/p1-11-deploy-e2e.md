# P1-11 — Deploy artifacts and Phase 1 end-to-end acceptance

## Goal and scope

Build a repeatable local Compose stack around the existing ClickHouse daemon. Verify actual ingestion, persistent storage, PromQL queries and Grafana Prometheus datasource queries. This milestone supplies deployment artifacts and minimal deployment lifecycle seams; it does not implement later-phase APIs or perform a production deployment.

The existing SPI, memory and ClickHouse semantics, Go1.27.1, clickhouse-go/v2 v2.48.0, module graph, supported PromQL corpus and all189native-histogram exclusions remain authoritative and unchanged. Preserve prior evidence; fresh root verification is required. Follow the complete SDD pack, especially12P1-11,10Phase1 E2E,11operations,21security,22deployment artifacts and23contracts.

## Allowed files and ownership

- Deployment worker: `deploy/**`, module `Makefile`. Includes Compose, Dockerfile, `.dockerignore` within deploy only if useful, ClickHouse XML, Grafana provisioning/five dashboards, systemd units, agent/alertmanager/rule reference artifacts and deploy README. No module-root `.dockerignore` without an explicit design revision; Dockerfile must avoid copying private/scratch files into build layers.
- Runtime/E2E worker: `cmd/prismd/**`, `internal/server/**`, `scripts/compose-e2e.py`, `scripts/test_compose_e2e.py`, `test/e2e/phase1_compose_test.go`, `test/e2e/README.md`. Preserve existing tests and assertions. No ingestion/query redesign or other script mutation.
- Query follow-up (runtime worker only): `internal/compat/promapi/query.go`, `query_ast.go`, `query_test.go`, `query_ast_test.go`, limited to D011. No other query files.
- Orchestrator: this spec, related SDD10/11/12/22/ADR020, module README, quickstart and inventory; private plan/tasks/integration/evidence. Shared files have one writer. Each implementation writer has its own isolated worktree. Audit production files are read-only.
- Excluded: dependencies, publicSPI, other drivers, root workflows, P2/P3/P4 APIs, agent runtime, alerting/controlplane, production deploy/release/imagepublish, host service installation and unrelated changes.

## Design decisions fixed before implementation

### D001 — Phase 1 executable deployment

SDD22 contains full-product examples that refer to unimplemented functions. The approved Phase1 contract takes precedence over blindly launching them. Default services are prismd, ClickHouse and Grafana. PostgreSQL may be an inactive `future` profile; later-phase agent/systemd/rules/alertmanager examples remain supplied but explicitly inactive. Provision all four named datasource definitions as specified, but only Prometheus health/query is required in this phase; unsupported Loki/Jaeger/Alertmanager status must be reported truthfully. Five dashboard files retain useful metrics panels; unavailable later-phase panels have an explicit description, not fabricated data or successful checks. SDD10/22 will be synchronized to final executable artifacts before acceptance.

### D002 — Images, Docker build and native commands

Keep official Go1.27.1 builder, existing official ClickHouse24.8.14.39 and GrafanaOSS12.0.0; resolve and record immutable platform digest evidence before final source freeze. No `latest` tags. Build a CGO-disabled nonroot daemon with version/revision link variables; copy an explicit allowlist of source directories, not `COPY . .`, to exclude `.team`, local secrets and fixture data from image layers. Preserve existing readonlymodule and architecture guards. `make deps-check` invokes existing guards/self-tests; default drivers are memory/clickhouse only. Add build/conformance/promql/e2e targets that invoke real existing supported checks. Do not introduce fake `-driver` flags, VMVL/differential success claims or weaken existing lint/test targets. One bounded runner owns local stack lifecycle; Makefile calls it rather than leaving resources on a failed test.

Managed builds retain proxy settings and verification. Optional BuildKit secret mounts provide the session/system CA during networked build steps; CA secrets are not copied into runtime layers. No host-network/proxy bypass, registry/globalconfig change, insecureTLS or module dependency changes. Docker/Compose missing tooling is a pinned temporary prerequisite, never global installation. External Grafana service is not a Go import.

### D003 — Runtime deployment seams

Current server has `/-/healthy` only and daemon does not accept `healthcheck`. Add bounded `prismd healthcheck --url <http(s) URL> [--timeout ...]` subcommand before configuration loading; malformed/credentials/unsupported schemes, non-2xx, network/deadline/oversized response fail without leaking URL credentials. Context cancellation is honored; body is bounded/closed, transport idle connections closed. This is the shell-free container healthcheck.

Add `GET /-/ready` to the server with no-store plaintext status and method contract consistent with health. Readiness becomes true only after backend migration/ping and all configured listeners are acquired; it becomes false before receiver shutdown/drain. Do not claim continuous backend/disk monitoring. Minimal internal lifecycle callbacks may connect bounded stdlib Unix-datagram `NOTIFY_SOCKET` READY=1/STOPPING=1 notifications. Support filesystem and abstract sockets, absent socket as no-op; failures retain a sanitized actionable error and cannot fabricate ready success. Test actual datagram delivery, no notification on failed startup, ordering, cancellation/shutdown and no goroutine leak. Systemd examples must truthfully match runtime; agent unit is explicitly reference-only.

Add a `version` subcommand for injected version/revision (defaultdev/unknown), no backend connection; do not change fixed Prometheus compatibility buildinfo2.53.0. `--config-check` is exercised with actual final Phase1 configuration before starting stack. No new configuration keys/dependencies.

### D004 — Configuration and secrets

Default Phase1 config selects clickhouse and existing DSN-file/auth-file paths, disables anonymous reads and preserves every existing mandatory JWT/rules/notify validation contract (clarified in D007). Supply valid inactive references without claiming later-phase runtime behavior. No parser rewrite. Compose mounts bounded regular secret files read-only; DSN is treated as a credential, never rendered into public environment/log evidence. Test-only generated credentials live under a private owned temporary root, contain no real account secrets and are removed after cleanup. Fixture file/container readability must be explicit; do not make production credentials world-readable. Grafana datasource forwards one secret bearer header to Prism; file/environment provisioning syntax is checked against official APIs and actual response data. Public service ports are loopback only, with adjustable/ephemeral test ports. Runtime nonroot/read-only, no-new-privileges and bounded memory/pids apply; no production safety/soak capacity claim.

### D005 — Worker interoperability and local ownership

Compose defaults `PRISM_HTTP_PORT=9090`, `PRISM_GRPC_PORT=4317`, `GRAFANA_HTTP_PORT=3000`; runner supplies0for ephemeral host binds. Secrets directory `PRISM_SECRETS_DIR` defaults `./secrets`, is absolute in fixture. Required secret filenames: clickhouse_password, clickhouse_dsn, ingest_api_key, grafana_password. Provisioning bearer substitution uses `PRISM_DATASOURCE_TOKEN` only in Grafana, never forwarded as an unknown PRISM config variable to daemon. Grafana has admin password file input. Root/worker must verify file-backed ClickHouse password support against actual entrypoint; no assumed future syntax.

Runner accepts `--compose-binary` or `PRISM_COMPOSE_BINARY` for official pinned standalone Compose, otherwise `docker compose`; explicit local socket is mandatory in managed tests, clear only endpoint/context/TLS selectors while preserving registry/proxy configuration. Commands use argument arrays, no shell interpolation of credentials. Unique Compose project names and a run ownership label guard every resource. Root fixture build image tag is unique; do not mutate shared tags or remove shared cache/image IDs. If an ownership check fails, preserve resource/diagnostics and stop cleanup of that resource. Always bounded timeouts; container/name/volume/network absence checked after teardown. No broad prune/down against unrelated projects.

Owned labels may be injected by generated fixture-only override to eachservice/volume/network; base artifacts need no per-run values. Project prefix `prism-e2e-` plus random suffix. Derive image `prism/prismd:<unique-run>` via PRISM_VERSION, builder VERSION/REVISION default values from Makefile/runner. Retained diagnostics are bounded and redact all generated secret values before persistence; no raw Compose config or environment dump. Health/persistence failures remain failures.

### D006 — Acceptance scenarios and reporting

E2E-01 Phase1: actual container daemon plus ClickHouse, official telemetrygen three signals (HTTP and gRPC as practical), real Prometheus remote_write and VectorLoki JSON push. Metrics are verified through PromQL instant/range/catalog; all three signal rows/values/trace IDs are checked in actual database with existingclient/controlled native fixture access. Loki query/Jaeger compatibility APIs are later phases and remain explicitly unavailable; raw storage checks cannot masquerade as those APIs. Unauthenticated ingest/query rejected; tenant labels cannot be injected via public input; existingsecurity suite remains required.

E2E-02 Phase1: all four datasource definitions provisioned; real Grafana `/api/datasources/uid/prism-metrics/health` and `/api/ds/query` return successful nonempty expected values, verify datasource proxy/auth so a simple `/api/health` is insufficient. No requirement for new browser/UI assets; SDD defines API-level evidence. Validate dashboards are provisioned and at least one metrics panel query returns known data. Inactive later-phase datasource health is reported, not skipped silently or claimed successful. Full E2E-03/04+ is out of scope.

Persist known sample across graceful prismd restart, and restart ClickHouse retaining only owned volume before query proof. Verify owned daemon shutdown and final container exit state/logs; do not hide first failure with retries. At most one unchanged-source diagnostic retry for a transient failure, record cause asunknown when evidence cannot establish it. Keep P1-10firstpromtool shutdown unknownrisk visible; new meaningful failures require root-cause analysis, no timer/assertion weakening.

Root final gates: `GOTOOLCHAIN=go1.27.1 GOFLAGS=-mod=readonly make lint test`, pinnedgolangci2.14.0 normal/integration, nativeguards/self-test/build/CGO0/modverify/security, fullmemory and realClickHouse conformance and579eval/6296queries/189exclusions/7seeds corpus; boundedlocalComposeE2E/build/actual datasource queries; runnercleanup regressions; module/license/source/doclink/scope checks. Freeze complete source+docs+protected inputs, then Astra independent review; root gates on frozen final source remain authoritative. Optional capability skips remain explicit; no mandatory skip or fabricated matrix success. Finish normalsourcePR/requiredCI/merge/exactmainCI/remotehashes/ledgerreview/handoff, then stop afterP1-11. No release/deploy.

## D007 — Preserve config validation and add mandatory JWT fixture

Executable config validation requires a readable JWT secret of at least32bytes, an existing rules directory and valid notify route/receiver references, even in Phase1. The initial D004 suggestion to omit these inputs was incorrect; do not change or weaken `internal/config`.

Add fifth secret filename `jwt_secret`, independent of the ingest API key. Phase1 config `auth.jwt_secret_file` is `/etc/prism/secrets/jwt_secret`; the fixture creates/mounts it read-only. Keep original four secret filenames unchanged. Compose also mounts `deploy/rules/` and new `deploy/phase1-notify.yaml`; this minimal inactive notify document has receivers default/watchdog/ops-fallback and valid route/default/watchdog references, no external webhook/SMTP credentials or calls. `notify.config_path` selects this document; full SDD22 alertmanager example remains a future-phase reference only. Existing parser/auth/file/receiver validation and negative tests remain authoritative. Validate actualfinalconfig before startup.

Runtime runner requires an accepted already-built unique local daemon image via `--no-build` (no shared tag mutation). The orchestrator builds it separately with official pinned standalone Buildx when plugins are absent; the runner does not install tooling or build a shared image. Temporary `BUILDX_CONFIG` may contain only owned builder metadata; keep Docker registry/proxy config inherited/unchanged. Compose itself may use default build on hosts with supported plugins; managed E2E uses pinned standalone tools without globalplugin installation.

## D008 — Reviewable execution and persistence evidence

`make e2e E2E_ARGS="..."` passes explicit runner arguments including a local Unix socket, accepted unique image, `--no-build` and optional pinned Compose binary. The documented command must be executable; missing required inputs fail with actionable usage. Startup collision checks cover containers, volumes and networks. Only an explicit Docker not-found response proves absence; daemon, permission and malformed inspection errors stop mutations. Successful and failed subprocess evidence is bounded and redacted before saving, including config-check, actual Go test output, restart/exit-state checks and teardown/absence proof. An actual provisioned metric dashboard panel is queried against a known metric; a UID list alone is insufficient.

Keep the existing ClickHouse async_insert=1/wait_for_async_insert=0 telemetry contract. Acknowledgement does not establish durable disk storage. This acceptance waits until known rows/values are query-visible and then proves their persistence across graceful daemon and ClickHouse restarts; it does not claim crash durability for acknowledged-but-unflushed data. Preserve the driver semantics and this operational limitation.

Docker build inputs include an immutable or engine-supplied frontend, with the engine/BuildKit version captured. The logical Buildx endpoint alias is resolved through its verified local default context and explicit per-command DOCKER_HOST; do not change global Docker context or registry/proxy/auth settings.

## D009 — ClickHouse 24.8 MergeTree pool validation

Root's exact-digest owned startup probe reproduced Code36/BAD_ARGUMENTS:
`number_of_free_entries_in_pool_to_execute_mutation=20` exceeds
`background_pool_size=4 * background_merges_mutations_concurrency_ratio=2`.
The original SDD22 pool value cannot start this server. Official fixed-tag
[MergeTree sanity checks](https://github.com/ClickHouse/ClickHouse/blob/v24.8.14.39-lts/src/Storages/MergeTree/MergeTreeSettings.cpp)
require mutation, lower-max-merge and optimize-entire-partition thresholds to fit
the pool capacity; [fixed-tag defaults](https://github.com/ClickHouse/ClickHouse/blob/v24.8.14.39-lts/src/Storages/MergeTree/MergeTreeSettings.h)
are20,8,25.

Change only `deploy/clickhouse/prism.xml` background_pool_size4→16, retaining
ratio2 and all memory/query/Compose resource caps. Capacity32 satisfies the three
existing defaults and matches the already exercised real-database fixture's pool.
No driver or timeout changes. Deployment README and SDD22 mirror explain the
constraint without a production capacity claim. Root repeats actual fixed-digest
startup and full Compose acceptance; source-level arithmetic alone is not green.
Retain original startup failure, probe/error/cleanup and all intermediate sources.

## D010 — Keep Grafana provisioning within the pinned image

Root attempt3 observed Grafana12.0.0 downloading four unversioned suggested app
plugins in the background. The fixed image alone therefore did not bound these
extra startup downloads. Official fixed-tag [plugin settings](https://github.com/grafana/grafana/blob/v12.0.0/pkg/setting/setting_plugins.go)
and [defaults](https://github.com/grafana/grafana/blob/v12.0.0/conf/defaults.ini)
provide `preinstall_disabled`; it disables the preinstall list, independently of
the `disable_plugins` setting. The four provisioned datasource types are built in.

Set only `deploy/docker-compose.yml` Grafana environment
`GF_PLUGINS_PREINSTALL_DISABLED: "true"`. Keep the pinned image, core datasource
definitions and all resource/auth bounds. Synchronize the deployment README and
SDD22 mirror. Root verifies absence of background app installation and successful
four-datasource provisioning in the next owned stack; this change cannot waive or
fix the separate failing Prometheus datasource health acceptance.


## D011 — Approved storage-free instant historical evaluation

The real pinned Grafana12 health probe sends `1+1` at Unix4. Root attempt3 and
authenticated isolated probe reproduce HTTP400 for this historical time and
HTTP200 scalar2 for current time. Do not waive datasource health or increase
MaxLookback. The owner explicitly approved this minimal exception on 2026-10-07 and
reconfirmed it on 2026-10-08. Canonical decision and task scope were updated
before implementation. Earlier failed health checks remain historical evidence.

Approved exact paths: `internal/compat/promapi/query.go`, `query_ast.go`,
`query_test.go`, `query_ast_test.go` only. Extend the existing bounded AST
validation with a conservative storage-selector fact, without an unbounded
preflight walk. Only instant expressions containing no vector/matrix selectors
may bypass the outer historical-time floor. Preserve future-time ceiling, all
range behavior, data queries including `up @ <now>` evaluated at Unix4,
@/offset/subquery bounds, complexity/regex/reserved-label controls,
authentication/tenant isolation, scan/result/timeout/cancellation limits.
Do not special-case `1+1`/Unix4 or call a native storage querier for any storage-free expression,
including current instant and range expressions. Existing weakest memory/fallback behavior remains
required; public SPI, drivers and dependencies stay unchanged.

Required red-green coverage: authenticated GET and POST form Unix4 constant
queries return scalar2 at requested timestamp, pure vector/time expressions if
supported; current constant still succeeds; historical selectors, selectors
with current @, historical range, future times, malformed parameters/AST,
reserved labels and oversized work remain rejected. Assert no storage Select
or native dispatch for accepted storage-free historical requests. Root actual
Grafana datasource health/query/panel and complete E2E after final rebuild,
plus final memory/realCH conformance/corpus/security and independent Astra,
remain mandatory. Root freezes only after approved implementation and all gates.

## D012 — Makefile conformance must execute the actual memory suite

Root reviewed `make conformance` and found it invokes only harness utilities
`./pkg/spi/conformance` before the real ClickHouse runner. Add `./drivers/memory`
to that existing Go test command, keeping the utility package and unchanged
ClickHouse runner/corpus. This is within original Makefile scope; no driver
semantics or modules change. T911 verifies target dry-run and actual focused
memory+utility race suite. Root final memory/realCH proofs remain required.


### D010 runtime proof refinement (within existing E2E scope)

Before datasource health, authenticate to Grafana `/api/admin/settings` and
assert only the parsed `plugins.preinstall_disabled` field is true. Never log or
persist the settings response body, which can contain sensitive configuration.
Check `/api/plugins` returns a valid list and none of the four fixed-tag
suggested app IDs (lokiexplore, pyroscope, exploretraces, metricsdrilldown under
their `grafana-...-app` names) is installed. Retain the four actual datasource
UID checks and all original health/data/panel/restart assertions. This proves
loaded configuration and runtime plugin inventory; datasource health failure
still fails the overall gate. No production query permission is implied.


## D013 — Root supplementary anonymous fixture-volume cleanup

The fixed ClickHouse image declares `/var/lib/clickhouse` as a Docker volume.
The preserved native integration runner removes its labelled container with
`docker rm -f`, leaving an anonymous data volume. Do not change that protected
existing driver runner in P1-11 or prune volumes by age/name/size. Root binds the
volume to its captured fixture ID through exact Docker mount/unmount events,
records metadata and verifies no container references it, then removes only
that exact disposable volume ID without force and proves absence. This
supplementary cleanup covers the fresh successful root fixture; older resources
without recoverable identity remain preserved and are not claimed removed.
Future final root real-database runs must retain their volume associations before
container teardown. Compose's separately owner-labelled named volumes remain
covered by the existing exact cleanup acceptance.


## D014 — Pinned Compose restart health and identity

The fresh complete stack passes ingestion, Grafana datasource health/query and
its provisioned metric panel, then the pinned Compose2.40.3 rejects
`start --wait` because `start` has no such flag. Preserve that failed run.
Restart the already stopped service with supported
`up --wait --no-recreate --no-deps --no-build --pull never <service>` within the
existing90second command budget. Before and after restart, require the exact
container ID and mounted named-volume identities to match the owned stopped
service. Missing/replaced/unowned resources fail; no recreate, new image, or
volume replacement can masquerade as persistence. Keep the graceful exit0 check,
both real post-restart data queries and full cleanup. Only the existing runner
and its regression tests change; add meaningful red-green coverage for supported
command routing and identity/volume mismatch refusal. Root reruns the whole
actual Compose gate; no timing or acceptance relaxation.


## D015 — Refresh ephemeral loopback endpoints after restart

The D014 actual run proves the same daemon container returns healthy, but the
post-restart data query uses its stale host port and fails. An isolated pinned
image probe confirms Docker29 assigns a different ephemeral host port when
restarting the exact same container. Preserve both failures and probe evidence.
After each verified same-container restart, re-read the four Compose published
ports through the existing strict loopback parser and rebuild the test endpoint
environment from those observed ports and the same disposable credentials.
Require the actual PromQL and native stored42.5 checks at these current endpoints.
Do not change Docker allocation policy, widen timeout/retry/data assertions,
relax identity/ownership checks, leak credentials or recreate resources. Only
the existing Python runner and its tests change. A regression must first expose
stale endpoint routing, then verify updated HTTP/gRPC/Grafana/ClickHouse endpoints
and invalid-port rejection. Root repeats the whole actual Compose acceptance.


## D016 — Preflight failure cleanup

Independent frozen-source review reproduced two main-entry failures: an invalid
Docker socket and a missing Docker executable raised before the runner cleanup
guard, retaining five generated fixture secrets. Validate prerequisites before
secret generation or include all fixture initialization in the guarded cleanup
region. Expected setup errors must return a nonzero, bounded diagnostic; any
partially generated secrets must be removed when no resources have started.
Do not invoke Docker cleanup before startup. Preserve ownership checks and the
existing diagnostic retention policy when live-resource cleanup cannot be
confirmed. Cover invalid socket, missing executable and partial setup failures
through main-level regressions, retaining every restart identity, refreshed port,
data and timeout assertion. Rerun Python contracts and full actual Compose E2E,
then freeze the corrected source/docs and obtain independent follow-up review.
This correction is limited to the Compose runner and its Python tests.
