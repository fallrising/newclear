# M6 personal-use integration and deployment design

The current acceptance contract is [SDD06 personal use](sdd/06-security-operations-acceptance.md), reduced on2026-10-17: start with one useful actual source, one non-root instance, persistent data and usable backup/restore. Existing functional evidence is reused. Three-source seven-day observation, phone receipt, independent-host outage notification and previous-day snapshots are optional expanded-operation criteria, not first-use gates. Their historical unmet results stay unmet; a merged PR or synthetic data does not prove deployment or real-source compatibility.

## Scope and ownership

The existing preparation examples cover release pipelines, inspection jobs and Alertmanager webhook v4; first use needs only one useful source, not all three. Keep the existing CloudEvents/auth/API/SQLite schemas and M1–M5 runtime semantics. Add synthetic examples, offline validation, deployment launch/acceptance templates, recovery instructions and isolated service checks. No new runtime dependency, host/controller changes, public ingress, automatic deployment, secret provisioning, live notification sends, offsite integration or release. Root owns shared contracts/PLAN/STATUS/CI; bounded workers own source and deployment preparation in disjoint worktrees; an independent exact-model reviewer examines the integrated candidate.

## Source integration contract

| Input | Configured name | Scope | Delivery contract |
| --- | --- | --- | --- |
| Release | release | `urn:example:release:` / `release.deploy.*` | Persist one immutable envelope per pipeline run/attempt/outcome before send; retry identical bytes/id/time; a new outcome gets a new id. |
| Inspection | inspection | `urn:example:inspection:` / `inspection.check.*` | One immutable envelope per completed scheduled run; include observed result without raw secrets/logs. Never regenerate time or id for a retry. |
| Alertmanager | alertmanager | `urn:signalhub:alertmanager:example:` / `alertmanager.alert.*` | Receiver `example:primary`; existing mapping and identity remain unchanged. Inspect every batch member, including in HTTP200 responses. |

Examples live in `examples/sources/`: `config.json`, `release.json`, `inspection.json`, `alertmanager-firing.json`, `alertmanager-resolved.json`. Credentials are distinct runtime file references, never values. Production substitutions require a private reviewed config; the examples are not production enrollment. `scripts/check_sources.py` validates examples and optional supplied captures offline using existing contract-check dependencies. It does not read token_ref files, send requests, rewrite payloads or hide conflicts. Tests cover cross-source scope, reserved types, mutable duplicate content and invalid batch members. Exact ingest mapping remains the Go runtime authority.

On202 persist receipt and original seq; on200 verify duplicate result or per-member statuses. A timeout after commit is ambiguous: retry the saved envelope. Retry transient429/503/transport failures with bounded backoff and retained payload; stop and investigate401/403/400/413/409. Do not mint replacement IDs to suppress409. Repeated same Alertmanager fingerprint/startsAt/status with changed annotations, labels, groupKey, generatorURL or mapped timestamp/content conflicts by design. Freeze relevant alert content for an episode, capture/replay realistic repeats before enrollment, and block source acceptance if it cannot meet the mapping. No identity-version migration is authorized by this preparation.

Freshness is authenticated configured-name receipt time, not event time. An identical duplicate refreshes freshness but adds no timeline row and proves neither a new release nor a newly completed inspection. Missing expected_interval disables silence checks; never-seen remains never. Silent means strictly greater than twice the interval, evaluated every second/on read. Do not assign a silence expectation to irregular release/Alertmanager activity without a meaningful cadence; no heartbeat/watchdog is required just to pass personal-use acceptance. Do not fabricate ordinary events or count empty webhook batches as liveness. If expanded seven-day observation is chosen, distinguish actual new events, duplicates, source observations and gaps.

## Deployment and external monitoring contract

Personal use may run one non-root Docker instance, or use OneFleet after that route meets its admission requirements. Do not add a controller or change other components. The package under `deployment/` preserves the original OneFleet/expanded-operation templates; its worksheet is optional for personal use. Keep a concise private record of the selected binary/config, service user, private ingress, persistent data/backup locations and credential references. Docker test fixtures are not a ready-made persistent deployment recipe; actual mounts, access and backup must be checked for the selected instance. Do not include private values in this repository.

The inspected existing generic OneFleet binary path starts an `app` with PORT and a data working directory; it does not supply Signal Hub's required CLI flags, and its generated remote systemd unit does not declare a non-root user. Therefore direct deployment of the raw hub binary is not ready. A bounded launch template translates that known contract to explicit hub flags, rejects root/missing inputs, and is tested only with synthetic files. Actual non-root host admission/secret mounts and ingress remain approval gates; do not modify OneFleet or add privileged service installation here. Catalog `register` is an external write, not permission to deploy; visibility=internal alone is not a firewall. No Cloudflare public ingress commands are part of this package.

Phone and host-outage notification are deferred for personal first use. If the expanded outage guarantee is selected, the external monitor must execute outside the hub process and its host failure domain, reach only approved tailnet health/ready endpoints, and notify independently of the hub's subscription queue. Proposed fixed cadence60s, request deadline10s, failure threshold2, bounded independent send/retry budget60s: worst nominal detection-to-send <=190s, leaving margin within300s. Record actual end-to-end phone arrival; scheduling, connectivity and provider delay can invalidate the budget. Missing monitor observations are failures, not success. Its credentials, schedule and account require separate authorization. Only a design and local simulation are included; no monitor is installed or enabled.

## Authorization matrix

| Action | Current authorization | Gate / evidence |
| --- | --- | --- |
| Code/docs/examples/offline tools and synthetic isolated services | Granted | Task claim, disjoint worktrees, native verification and independent review |
| Commit/push/PR/CI/normal merge/readback | Granted after gates | Recheck current task before each commit; normal branch protection |
| Provision/change host/service user, OneFleet catalog/deploy/start/stop | Not granted | Concrete private node/workload, changes, impact, rollback and acceptance steps |
| Configure production secrets, real producers/notification accounts | Not granted | Least-privilege scope, exact targets, storage/channel and revocation plan |
| Stop real producer/hub for outage drills | Not granted | Agreed bounded outage window, operator, restart/abort procedure |
| Optional expanded seven-day/outage/previous-day drills | Deferred; require selected environment and authorization | Real timestamps/receipts and isolated restore proof if claimed; no synthetic substitution |

## Failure and recovery matrix

| Failure | Recovery and invariants |
| --- | --- |
| Ingest ambiguity/busy | Replay saved original bytes; permanent source+id identity returns original seq; changed content stays409. |
| Bad config/token/source scope | Keep rejected config and prior active version; fix through review. Changing source token_ref/scope resets attribution; preserve history. |
| Hub outage | Without the deferred external monitor there is no automatic outage-notification promise. Restore the process once authorized and inspect queue age/health before re-enabling producers; if external monitoring is selected, it sends independently. |
| Delivery backlog/restart | Stable subscription IDs/cursors, pending jobs and inflight lease remain; wait lease expiration, tolerate at-least-once duplicates, receiver deduplicates durable IDs. DLQ replay requires owner and reason. |
| Archive or import error | Keep immutable parts/orphans and manifest; verify hash/count/membership before deletion/import; do not overwrite or blanket-clean. Missing archived inputs can prevent rule backfill. |
| Backup/restore failure | Require complete snapshot+manifest pair; verify hash/schema; fresh destination only. Keep original/partial artifacts and choose a new name. |
| Isolated restore startup | Snapshot preserves materialized bodies/headers/IDs and queue state, but persisted safe subscription definitions exclude URL and credential refs. Before startup replace URLs/credential refs with isolated ones while preserving subscription ID and safe definition; current config controls dispatch targets. Missing subscriptions pause queues and cannot prove resumed delivery. Defense-in-depth egress isolation is still required before starting a copy of real data. |
| Rollback | Stop only the authorized workload, preserve failed-state DB/sidecars/logs, select prior tested binary/config plus compatible snapshot into a new path. Never copy old DB over a live database or assume older binaries accept newer schemas. Reconcile post-snapshot lost events using saved immutable producer payloads and receiver dedup. |

## Acceptance and evidence reuse

Use the five personal-use conditions in [SDD06](sdd/06-security-operations-acceptance.md). Existing native, HTTP, Chromium and Docker evidence covers unchanged runtime behavior; do not repeat the remote Docker campaign for a documentation change. CI remains required for repository changes.

| Area | Reusable functional evidence | Check when actually enrolling/deploying |
| --- | --- | --- |
| Source/auth |202/200/409/403, immutable seq, member results | One selected real source's payloads and retry/errors; others only when added |
| Freshness | Real elapsed synthetic silent/recovered | Meaningful interval for a periodic source; no phone requirement |
| Persistence | Restart and safe snapshot/restore tests | Selected instance's data mount and usable real backup; no previous-day restriction |
| Delivery | HTTPS/HMAC, retry, durable dedup and isolated queue recovery | Only channels actually enabled; phone and host-outage guarantees deferred |
| Publication | Independent review, relevant checks, required CI and normal merge/readback | Record source enrollment, deployment and ongoing operation separately |

The original [expanded-operation worksheet](deployment-acceptance.md) and checker remain strict and optional. Do not submit synthetic passed evidence, fill a three-source worksheet just to start with one source, or infer a successful deployment from a document merge.

## Planned exact commands

From component root: `go test -race -count=1 ./...`; `go vet ./...`; `test -z "$(gofmt -l .)"`; `go build -trimpath -o .local/run/signalhub ./cmd/signalhub`; `git diff --check`. Web: `npm ci`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`, reproducible dist check. Existing contract venv: `python contracts/check.py`; all four `python scripts/e2e_{smoke,rules,delivery,archive}.py --binary .local/run/signalhub`; new `python scripts/check_sources.py`, source tool unit tests and `python scripts/e2e_m6.py --binary .local/run/signalhub`. Deployment checker/tests commands will be frozen in its README before implementation. Browser: `SIGNALHUB_BINARY=<absolute-built-binary> SIGNALHUB_CHROMIUM=/opt/google/chrome/chrome npm test` with sandbox unchanged; unsupported local libraries must remain failed/skipped until supported CI supplies genuine evidence. Native task/report validators and scope review are mandatory.

Original failures and correction evidence stay retained. These are the existing preparation/runtime verification commands, not a new first-use checklist. STATUS records actual deployment and operation separately, with the original four real gates explicitly deferred/unverified under the reduced scope.
