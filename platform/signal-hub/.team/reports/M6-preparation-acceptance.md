STATUS: DONE

## Summary

M6 preparation integrates three source contracts and offline checks, a non-root deployment intent/launcher, admission worksheet and recovery runbooks, with isolated service and browser coverage. Runtime/API schemas, identity rules and dependencies are unchanged. Design preceded implementation at f1889125f82a7689e166492fb1d2e44d20bef2c2. Product candidate b9bb8d35103522aeded29085ebc7cc28701ee9d7 closes independently found R1 and the first CI fixture media-type defect. Normal integration is tracked by [PR #357](https://github.com/fallrising/newclear/pull/357).

This report accepts only independently deliverable preparation; all required preparation gates below pass. It does not accept deployment, actual source enrollment, seven-day observation or full M6.

## Verification

Commands run from the component unless stated; exact argv, cwd, output, timing and exit status are retained in the private evidence bundle.

- `go test -race -count=1 ./...`:10 packages,375.820s elapsed (store368.739s); `go vet ./...`, `test -z "$(gofmt -l .)"`, `go build -trimpath -o .local/run/signalhub ./cmd/signalhub` — passed
- In web: `npm ci`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`, `git diff --exit-code -- dist`:28 tests/6 files and reproducible assets — passed
- `.local/run/contracts/bin/python contracts/check.py`:6 schemas,64 fixtures,15 webhook and5 canonical vectors, strict JSON/RFC4231/OpenAPI — passed
- Same Python with `scripts/e2e_smoke.py`, `scripts/e2e_rules.py`, `scripts/e2e_delivery.py`, `scripts/e2e_archive.py`, each `--binary .local/run/signalhub`:203 HTTP/OpenAPI responses (34+39+69+61),17 archive CLI outcomes; timing-dependent polling can add one response — passed
- Same Python `scripts/e2e_m6.py --binary .local/run/signalhub`:76 real loopback HTTP/OpenAPI responses and2 CLI outcomes,4.344s after integration — passed
- Same Python `scripts/test_check_sources.py` and `scripts/check_sources.py`:36 tests after R1, source examples valid; malformed whole-document Unicode and non-JCS numeric values rejected without remapping Alertmanager — passed
- `python3 scripts/test_check_deployment.py` and `python3 scripts/check_deployment.py`:20 tests, default eight gates pending; synthetic acceptance rejected. Clean-checkout directory regression reproduced then corrected — passed
- Existing `contracts/check.py` config schema/semantic admission for deployment/config.example.json; `sh -n deployment/launch.sh`; actual CLI help for archive verify/import, backup/restore and rules backfill inspected, including supported `--from` — passed
- At repo root: `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7 -shellcheck= -pyflakes= .github/workflows/signal-hub-ci.yml`; native task/report validators and `git diff --check` — passed
- Independent T-610 full candidate review, T-611 R1 correction and T-612 fixture correction: original invalid-byte matrix rerun unchanged, API/offline rejection aligned; Unicode/numeric positive controls preserve original seq; three actual fixture events/details and cleanup pass. Root inspected reports and verified evidence hashes — passed
- [CI38626701142](https://github.com/fallrising/newclear/actions/runs/38626701142), exact b9bb8d35103522aeded29085ebc7cc28701ee9d7: all native gates,36 source/20 deployment tests,204 original HTTP responses (one extra delivery poll)/17 CLI plus76 M6 HTTP/2 CLI,10 genuine Go/Chromium journeys in13.6s; Chrome154.0.8037.97, sandbox enabled — passed
- Actual M6 desktop1440px and mobile390px PNGs inspected: all three events/source cards readable, Chinese glyphs present, no observed clipping. Deterministic original-detail, no-overflow, token/logout and strict zero browser-health failures assertions pass — passed

## Documentation

Design, source integration, deployment acceptance, intent/worksheet/config examples, launcher, runtime/quickstart/SDD references and STATUS distinguish preparation from live authorization and actual evidence. OneFleet generic binary deployment lacks required non-root/config/env/secret/mount admission; a wrapper alone does not authorize or establish safe deployment. Restore instructions preserve subscription IDs and safe definitions while substituting isolated destinations/credentials before starting the restored service; original backup remains unchanged.

## Risks and Follow-ups

Historical failures are retained separately: local Chrome executable/library startup failures, initial directory-dependent deployment test, malformed capture admission R1, initial M6 CLI output-stream harness error, and CI38625218512's9/10 Chromium result caused by a415 seed response. None is relabeled a pass. Source/deployment corrections have regression coverage; T-611/T-612 close independent findings. Browser assertions, timeouts and sandbox remain unchanged. Corrected CI38626701142 and actual desktop/mobile inspection close the browser gate; the local environment failures remain failures.

The four real M6 requirements remain pending: three real sources continuously observed for seven days; authorized producer silence beyond twice its interval with phone receipt; independent notification within five minutes of actual hub outage; previous-day real snapshot restore in isolation. No real deployment, host/secret/producer/account change, outage or external notification write occurred. Offline worksheets and synthetic probes cannot substitute for these outcomes. Owner authorization and concrete private targets are required before dependent operations.

## Acceptance mapping

| Preparation requirement | Evidence |
| --- | --- |
| Immutable source retries and adapter behavior |36 offline tests,76 HTTP/2 CLI outcomes, original seq/content and per-member Alertmanager results; whole-document rejection probes |
| Reviewable deployment/operating commands |20 worksheet tests, config validation, shell syntax and CLI source/help inspection; non-root/admission/ingress/monitor gates stay pending |
| Recovery and existing invariants |Go race10 packages, existing203 HTTP/17 CLI, isolated M6 restart/backup/restore and preserved old browser flows |
| Complete browser journey |CI38626701142:10 sandboxed Chromium journeys; desktop/mobile artifact inspection, original detail, freshness, token/logout and strict browser health |
| Independent review and failure retention |T-610 original PARTIAL findings, T-611 and T-612 bounded DONE closures, root hash validation |
| Real M6 acceptance |Not delivered by this preparation report; all four gates and seven-day observation remain pending |

Execution accounting: prior session observed three native starts; resumed integration observed one independent Astra start and two bounded followups. Exact models gpt-6.1-sol/high and gpt-6-astra/high had actual bounded admission evidence. No external model dispatch or recursive delegation. Cross-compaction outer/nested tool totals, provider requests, backend snapshots, token/quota/cost and aggregate waiting time are unknown/null; local command durations are not provider time.
