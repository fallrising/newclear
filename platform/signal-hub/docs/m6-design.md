# M6 source and deployment acceptance preparation

This contract is written before M6 implementation. It prepares a reviewable integration and operations package without deploying it. SDD M6 live acceptance is unchanged; synthetic tests, accelerated clocks, a merged PR and this document cannot satisfy it.

## Scope and ownership

Three inputs only: release pipelines, inspection jobs and Alertmanager webhook v4. Keep the existing CloudEvents/auth/API/SQLite schemas and M1–M5 runtime semantics. Add synthetic examples, offline validation, deployment launch/acceptance templates, recovery instructions and isolated service checks. No new runtime dependency, host/controller changes, public ingress, automatic deployment, secret provisioning, live notification sends, offsite integration or release. Root owns shared contracts/PLAN/STATUS/CI; bounded workers own source and deployment preparation in disjoint worktrees; an independent exact-model reviewer examines the integrated candidate.

## Source integration contract

| Input | Configured name | Scope | Delivery contract |
| --- | --- | --- | --- |
| Release | release | `urn:example:release:` / `release.deploy.*` | Persist one immutable envelope per pipeline run/attempt/outcome before send; retry identical bytes/id/time; a new outcome gets a new id. |
| Inspection | inspection | `urn:example:inspection:` / `inspection.check.*` | One immutable envelope per completed scheduled run; include observed result without raw secrets/logs. Never regenerate time or id for a retry. |
| Alertmanager | alertmanager | `urn:signalhub:alertmanager:example:` / `alertmanager.alert.*` | Receiver `example:primary`; existing mapping and identity remain unchanged. Inspect every batch member, including in HTTP200 responses. |

Examples live in `examples/sources/`: `config.json`, `release.json`, `inspection.json`, `alertmanager-firing.json`, `alertmanager-resolved.json`. Credentials are distinct runtime file references, never values. Production substitutions require a private reviewed config; the examples are not production enrollment. `scripts/check_sources.py` validates examples and optional supplied captures offline using existing contract-check dependencies. It does not read token_ref files, send requests, rewrite payloads or hide conflicts. Tests cover cross-source scope, reserved types, mutable duplicate content and invalid batch members. Exact ingest mapping remains the Go runtime authority.

On202 persist receipt and original seq; on200 verify duplicate result or per-member statuses. A timeout after commit is ambiguous: retry the saved envelope. Retry transient429/503/transport failures with bounded backoff and retained payload; stop and investigate401/403/400/413/409. Do not mint replacement IDs to suppress409. Repeated same Alertmanager fingerprint/startsAt/status with changed annotations, labels, groupKey, generatorURL or mapped timestamp/content conflicts by design. Freeze relevant alert content for an episode, capture/replay realistic repeats before enrollment, and block source acceptance if it cannot meet the mapping. No identity-version migration is authorized by this preparation.

Freshness is authenticated configured-name receipt time, not event time. An identical duplicate refreshes freshness but adds no timeline row and proves neither a new release nor a newly completed inspection. Missing expected_interval disables silence checks; never-seen remains never. Silent means strictly greater than twice the interval, evaluated every second/on read. Irregular release/Alertmanager activity needs an explicitly reviewed heartbeat/watchdog policy; do not fabricate ordinary events or count empty webhook batches as liveness. Seven-day evidence must distinguish actual new events, duplicates, source observations and gaps.

## Deployment and external monitoring contract

OneFleet remains the workload lifecycle authority; OneVPS owns privileged host capabilities. The package under `deployment/` is a preparation template, not a second controller or an executed deployment. A private deployment worksheet must pin hub binary/config digests, workload/node identity, service user, approved tailnet ingress, data/archive/backup locations and separate credential references. Do not include private values in this repository.

The inspected existing generic OneFleet binary path starts an `app` with PORT and a data working directory; it does not supply Signal Hub's required CLI flags, and its generated remote systemd unit does not declare a non-root user. Therefore direct deployment of the raw hub binary is not ready. A bounded launch template translates that known contract to explicit hub flags, rejects root/missing inputs, and is tested only with synthetic files. Actual non-root host admission/secret mounts and ingress remain approval gates; do not modify OneFleet or add privileged service installation here. Catalog `register` is an external write, not permission to deploy; visibility=internal alone is not a firewall. No Cloudflare public ingress commands are part of this package.

External monitor must execute outside the hub process and its host failure domain, reach only approved tailnet health/ready endpoints, and notify independently of the hub's subscription queue. Proposed fixed cadence60s, request deadline10s, failure threshold2, bounded independent send/retry budget60s: worst nominal detection-to-send <=190s, leaving margin within300s. Record actual end-to-end phone arrival; scheduling, connectivity and provider delay can invalidate the budget. Missing monitor observations are failures, not success. Its credentials, schedule and account require separate authorization. Only a design and local simulation are included; no monitor is installed or enabled.

## Authorization matrix

| Action | Current authorization | Gate / evidence |
| --- | --- | --- |
| Code/docs/examples/offline tools and synthetic isolated services | Granted | Task claim, disjoint worktrees, native verification and independent review |
| Commit/push/PR/CI/normal merge/readback | Granted after gates | Recheck current task before each commit; normal branch protection |
| Provision/change host/service user, OneFleet catalog/deploy/start/stop | Not granted | Concrete private node/workload, changes, impact, rollback and acceptance steps |
| Configure production secrets, real producers/notification accounts | Not granted | Least-privilege scope, exact targets, storage/channel and revocation plan |
| Stop real producer/hub for outage drills | Not granted | Agreed bounded outage window, operator, restart/abort procedure |
| Seven-day observation and previous-day real snapshot restore | Pending environment authorization/evidence | Real timestamps/receipts and isolated restore proof; no synthetic substitution |

## Failure and recovery matrix

| Failure | Recovery and invariants |
| --- | --- |
| Ingest ambiguity/busy | Replay saved original bytes; permanent source+id identity returns original seq; changed content stays409. |
| Bad config/token/source scope | Keep rejected config and prior active version; fix through review. Changing source token_ref/scope resets attribution; preserve history. |
| Hub outage | Independent monitor sends through its own account/path; restore process once authorized, inspect queue age/health before re-enabling producers. |
| Delivery backlog/restart | Stable subscription IDs/cursors, pending jobs and inflight lease remain; wait lease expiration, tolerate at-least-once duplicates, receiver deduplicates durable IDs. DLQ replay requires owner and reason. |
| Archive or import error | Keep immutable parts/orphans and manifest; verify hash/count/membership before deletion/import; do not overwrite or blanket-clean. Missing archived inputs can prevent rule backfill. |
| Backup/restore failure | Require complete snapshot+manifest pair; verify hash/schema; fresh destination only. Keep original/partial artifacts and choose a new name. |
| Isolated restore startup | Snapshot preserves materialized bodies/headers/IDs and queue state, but persisted safe subscription definitions exclude URL and credential refs. Before startup replace URLs/credential refs with isolated ones while preserving subscription ID and safe definition; current config controls dispatch targets. Missing subscriptions pause queues and cannot prove resumed delivery. Defense-in-depth egress isolation is still required before starting a copy of real data. |
| Rollback | Stop only the authorized workload, preserve failed-state DB/sidecars/logs, select prior tested binary/config plus compatible snapshot into a new path. Never copy old DB over a live database or assume older binaries accept newer schemas. Reconcile post-snapshot lost events using saved immutable producer payloads and receiver dedup. |

## Acceptance matrix

| Gate | Preparation evidence | Live acceptance still required |
| --- | --- | --- |
| Source contracts and auth | Offline positive/negative examples; real isolated202/200/409/403; batch-member handling; original seq survives restart | All three actual sources continuously observed7 days, no unexpected409, actual timeline/freshness/gap records |
| Producer silence | Synthetic service waits real elapsed seconds (>2x short interval), observes silent/recovered events | Authorized real producer stop, interval/receipt/phone evidence |
| Hub liveness | Local process health failure and explicit external-monitor timing design | Authorized real hub stop; independent notification within300s |
| Restore | Snapshot made by this run, immutable pair, fresh isolated restore/start and seq/query evidence; existing M5 queue/archive tests retained | Previous-day real snapshot, approved isolated environment, integrity/queue/data checks |
| Regression | Go race/vet/format/build; frontend format/types/unit/build; contracts; all HTTP and sandboxed Chromium | Does not establish host ACL, non-root deployment or production capacity |
| Delivery | Independent review + evidence gate + required CI + normal merge/readback | Owner acceptance separate; full M6 review only after all live DoD |

## Planned exact commands

From component root: `go test -race -count=1 ./...`; `go vet ./...`; `test -z "$(gofmt -l .)"`; `go build -trimpath -o .local/run/signalhub ./cmd/signalhub`; `git diff --check`. Web: `npm ci`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`, reproducible dist check. Existing contract venv: `python contracts/check.py`; all four `python scripts/e2e_{smoke,rules,delivery,archive}.py --binary .local/run/signalhub`; new `python scripts/check_sources.py`, source tool unit tests and `python scripts/e2e_m6.py --binary .local/run/signalhub`. Deployment checker/tests commands will be frozen in its README before implementation. Browser: `SIGNALHUB_BINARY=<absolute-built-binary> SIGNALHUB_CHROMIUM=/opt/google/chrome/chrome npm test` with sandbox unchanged; unsupported local libraries must remain failed/skipped until supported CI supplies genuine evidence. Native task/report validators and scope review are mandatory.

Original failures and correction evidence stay retained. Preparation may merge independently; STATUS must leave deployment, ongoing operation and all four real M6 requirements explicitly pending.
