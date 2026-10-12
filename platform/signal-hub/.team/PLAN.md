# Signal Hub M3 delivery

Objective: establish the merged M2 real-service baseline, then deliver M3 under docs/m3-design.md and the existing SDD/contracts. Scope: component plus dedicated CI and stale component root index entries. No production deployment or new runtime dependencies.

Source baseline: 614f9560d2c9bb1e06e20ccd099fdf517417e059. Orchestrator owns this plan, contracts, configuration/HTTP/CLI integration, documentation and final acceptance. Built-in workers only; no external CLI dispatch. All writers use isolated worktrees at the same source HEAD and disjoint paths. No recursive delegation or worker Git publication.

1. Baseline: unchanged binary HTTP/SQLite smoke and Chromium acceptance, synthetic inputs on loopback.
2. T-301 engine worker: internal/rules and internal/store, tests; interface below.
3. T-302 board worker: web source, tests and dist, browser metrics test only after integration.
4. Orchestrator: schemas/OpenAPI, config, HTTP/runtime/CLI, end-to-end harness, docs and root indexes.
5. Independent read-only reviewer after integration; rework findings before acceptance.
6. Evidence gate: exact native checks, inspect diff/screenshots and real-service artifacts; required CI and normal merge with remote readback.

## Shared Go interface

`rules.Parse(raw []json.RawMessage) ([]rules.Rule,error)` validates exact M0 rules and semantic constraints. `rules.Rule` uses exported ID, Version (int), Title, Filter, Aggregation, Bucket (string), GroupBy, Threshold fields with contract JSON tags.

Store methods: `ConfigureRuntime(ctx context.Context, sources []config.Source, definitions []rules.Rule, now time.Time, audit bool) error` atomically installs sources and rules, with audit/config.reloaded only if audit=true; `EvaluateRules(ctx,now) error` evaluates active rules independently; `BackfillRule(ctx,id,from,now) error`; `ListMetrics(ctx, id string, q MetricQuery) (MetricPage,error)` with From/To/Group/Cursor string and Limit int (Group empty means no filter). MetricPage follows existing OpenAPI exactly. `ActiveRules(ctx) ([]rules.Rule,error)` returns active definitions ordered by id. `RecordConfigRejected(ctx,now) error` emits sanitized rejection audit/event. Use existing ErrInvalidQuery/ErrNotFound/ErrUnavailable; add ErrInvalidConfig for version mismatch. ConfigureRuntime must NOT auto-evaluate (orchestrator evaluates at startup and after reload). Store owns all migrations and sources transaction refactor.

## Acceptance state

M2 baseline accepted: local real HTTP/SQLite smoke34 checks; unchanged main CI [38289184149](https://github.com/fallrising/newclear/actions/runs/38289184149) passed, including5 real Go/Chromium cases. Local browser diagnosis T-303 remains PARTIAL (sandbox launch failure); remote supported sandboxed Chrome supplies the product gate.

T-302 scoped frontend result accepted after independent root npm install/format/17 tests/types/build. T-301 engine integrated and accepted after root final race/vet/build and real HTTP gates. T-304 independently reproduced all four original findings and verified their green closure; final review report is the evidence record. M3 product accepted at `e44afd8e595af46a1867b48aaef89a9f3db5032e`: full remote native/HTTP gates and6 real-browser cases passed in run38293396899. Normal delivery follows PR349 checks; final metadata does not change executable source.

| Requirement | Evidence / final gate |
| --- | --- |
| AC-20/21, six aggregates, typed filters, partial/late/catch-up | internal/rules tests; store TestRuleAggregatesEmptyAndLate and TestEvaluationCatchesUpAfterRestart |
| AC-22/23, versions and atomic failed reload | store version/history/rollback tests; config tests; real e2e_rules.py version/reload/restart assertions |
| AC-24, durable transition identity/recovery | threshold restart/replay/null/missing/eviction tests, immutable-event assertions, real HTTP threshold checks |
| AC-25, reserved rule prefix | TestParseRejectsReservedRuleLoop |
| AC-26, cardinality | deterministic group-cap/conservation tests; disclosed union-cardinality semantics in m3-design |
| Metrics authorization and cursor contract | HTTP role tests, strict store cursor tests,39 real M3 HTTP responses validated by OpenAPI |
| AC-44, chart/version/partial |17 frontend tests, real browser/metrics.spec.mjs; final screenshots to inspect from CI |
| AC-45, failed config reload | real HTTP old credentials/config survive failed update; successful audit and rejected audit |
| 90K measurement | TestRuleBackfill90K:90,000 events/90 days,8,644 rollups,count90,000,about2.03s; heap snapshots3.43→1.33MB,not peak |
| Regression/contracts |34 M1/M2 HTTP checks;6 schemas,61 fixtures,15 webhook and5 canonical vectors |
| Quickstart | three literal Python blocks and stopped-service CLI executed successfully against a real Go service |
| Native/build | go test -race -count=1 ./...; go vet ./...; gofmt; go build; web npm ci/format:check/test/build; committed dist comparison |
| Independent review | T-304 final report and independently reproduced closure of all findings |
| Publication | normal PR, required CI/review, merge and remote readback; no deployment |

Root is applying codex-evidence-gate: worker assertions alone do not close gates. Final commands and report validation are required on the integrated source. Original failures remain visible in reports; an environment-diagnosis PARTIAL is not relabelled DONE.

## Review decisions

- Preserve bounded continuous series by retaining prior bucket keys alongside current-event keys. The deterministic200-row cap applies to that union. A new key may be overflow even when previous keys have zero values; contributions remain conserved.
- Evicted/missing complete buckets are false for threshold predicates regardless of aggregate/comparator. They differ from explicitly materialized empty count/sum rows carrying zero. Their gaps must not strand crossed state.
- Large group keys stay intact in rollups and stable IDs. Threshold event payloads always expose a SHA-256 selector, and raw keys only up to1024 bytes. Metric cursors use compact hashed selectors; HTTP request headers/target allow128KiB for escaped exact-group filters.
- Reload activation is one source/rule/audit DB transaction followed by credential publication under the server lock. Projection errors after successful activation are retried; they do not report that the accepted config was rejected.
- Root and workers use inherited built-in agents, not a verified multi-model run. Three worker launches and three follow-up assignments (independent review, engine rework, browser-gate review); provider request/token counts are unavailable and are not inferred from tool counts.

## Integrated local verification

Final integrated code passed `go test -race -count=1 ./...` (9 packages; store209.086s), `go vet ./...`, `test -z "$(gofmt -l .)"`, `go build -trimpath -o .local/run/signalhub-m3 ./cmd/signalhub`, contract checker (6 schemas/61 fixtures/15 webhook/5 canonical vectors), M1/M2 real HTTP smoke34 and M3 real HTTP39. Root independently ran `npm ci`, `npm run format:check`, `npm test` (17), `npm run build`, then verified rebuilt dist against the staged tree. Workflow actionlint1.7.7, task/report validators and `git diff --check` passed. Logs remain local evidence, with durable handoff pointers recorded separately.

Remote browser gate ran6 scenarios (5 existing plus M3) against the real Go binary with sandbox enabled. Root inspected its desktop/mobile metric screenshots; supported runner evidence does not change T-303's local diagnostic outcome.

## First remote candidate and bounded browser rework

PR [349](https://github.com/fallrising/newclear/pull/349), implementation `fb86fe832428ece16bed01e3f243dfce7e16a186`. First CI [38292215976](https://github.com/fallrising/newclear/actions/runs/38292215976) passed all native/contract/HTTP checks and5 existing browser cases; M3 functional/chart/mobile/logout assertions passed but its strict console gate reported a404. Browser acceptance is not accepted on that run.

The board declared no favicon. Add a bundled, hashed SVG using the existing signal mark, and a focused embed test that first failed for the missing declaration then passed for a served SVG. Keep strict console/pageerror checks and also capture failed response URLs. Screenshot review found missing CJK glyphs in the ephemeral CI runner; install its distro Noto CJK test fonts before browser execution. No application dependency or browser-sandbox policy changes. T-305 independently reviews this bounded follow-up; final CI and readable desktop/mobile screenshots are still required.

T-305 scoped review accepted: independently verified embedded SVG (race test1.045s), strict browser checks and CI-only font prerequisites. The ignored generated SVG was explicitly force-added and verified tracked. First404 resource identity was not captured; its closure still requires the next complete strictbrowser pass.

## Final product acceptance

AC-20–26 and44/45 accepted on product `e44afd8e595af46a1867b48aaef89a9f3db5032e`. [CI38293396899](https://github.com/fallrising/newclear/actions/runs/38293396899) passed all gates:9 Go packages with race, vet/build/format,17 frontend tests/types/format/reproducible assets, contracts6/61/15/5, real HTTP34+39, and6 real Go/Chromium scenarios (21.6s, Chrome154.0.8037.97, sandbox enabled). All PR checks for that candidate passed.

Root visually inspected `desktop-metrics.png` (1440×1000) and `mobile-metrics.png` (390×844): Chinese glyphs readable, group/time controls and metadata present, version/threshold/partial markers rendered, mobile layout within viewport. Exact values are available in the accessible table. The strict M3 browser scenario recorded zero console/page errors and zeroHTTP>=400 responses. This closes the first candidate's browser failure after the icon fix without suppressing errors; the original unidentified404 log remains preserved.

Evidence gate accepts T-301/T-302/T-304/T-305 within their scopes. T-303 remains a truthful PARTIAL diagnostic; a successful supported remote browser run satisfies the product gate. No outstanding implementation finding or unrun product check remains for M3. Public CI artifacts retain screenshots14days; private development evidence preserves logs, original failures, review manifests and screenshots for handoff.

This final record changes only acceptance metadata. [PR349](https://github.com/fallrising/newclear/pull/349) is the authoritative integration/merge result; final-head checks must pass before normal merge. Remote readback and task handoff are recorded in the owner ledger. M4–M6 remain follow-ups; no production deployment is claimed.
