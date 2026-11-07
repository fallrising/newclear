# T-0435 / #699 existing token and time coverage

Source e558d5f7a353a924e8c1bb311e7caf94b26779c4. Claim PR292 merged817015d47fff85b04ff795e02039d3c046dd6901 with required CI and content/ancestry/trailer readback. Implements unchanged T1102 §4.2/4.3/5.3, UC-R04; original17AC and prior deliveries remain. Core measurement criteria below are fixed before implementation. Owner approved the additive `?schema=2` API choice before dependent implementation; default v1 numeric scalars remain compatible.

## Fixed MT-1–MT-5

- MT-1: Given synthetic empty/all-null/partial/explicit-zero/complete saved token/time observations, each canonical metric independently exposes known_sum (null with no known observations), known_count, unknown_count, total_count, coverage, status and basis. Empty means no_data/null coverage, nonempty0known means unknown/0coverage; partial sum is a known subtotal, complete only means all selected field values present. Explicit0 counts as known. Whole-row usage_status is never inferred from one field or changed. Establish actual failing assertions before the minimum correction; source findings alone are not RED.
- MT-2: Given modern and legacy rows with distinct recorded headers_ms/cli_ready_ms/first_output_ms/total_observed_ms/latency_ms, summarize each independently. Counts include every selected stored event/attempt row regardless of outcome/source/usage_status. This measures saved-field availability, not support among eligible adapters. Known-only mean divides by that metric's known_count and is null with none, never divides by all rows or succeeded rows. Legacy latency remains explicitly mixed historical/compatibility basis, never first-output/total or combined with the other clocks. No fallback/backfill or history rewrite.
- MT-3: Given matching selected row/day sets, canonical daily JSON and Web summaries reconcile with SQLite and raw event JSON/CSV. Daily scope is latest30(API)/14(Web) populated RFC3339 date-prefix buckets, with an explicit aggregate summary over the selected buckets so emptyDB has no_data metrics without invented day rows. Event scopes remain100(JSON)/50(Web)/30(TUI)/1000(CSV); reconcile only matching subsets and disclose limits. No new business filters, grouping or raw CLI bucket aggregation. TUI's current event latency must distinguish null and0 and label legacy basis. Doctor/dashboard/TUI cost footer remain cost-only and regress unchanged. CSV missing values stay empty with existing row status/source, zero remains0; no aggregate CSV is invented.
- MT-4: Given failed/interrupted/pending attempts, fallback/retry attempts sharing a parent, mixed legacy/current rows and sparse dates, every row stays in its metric denominator exactly once. Do not deduplicate by request_id or add upstream and converted usage. Reopen preserves recorded values; read-only aggregation never dispatches inference or repairs historical values. Preserve existing raw CLI fields and T0428/T0429 semantics. Token summaries describe saved counters, not subscription use, billing or aligned provider units.
- MT-5: Given the final bounded implementation, required focused RED→GREEN, full locked Rust1.99.0/fmt/Clippy/build, Python and repository validators, headless reproducible report, four prior generic/Claude/Cursor/namedHTTP journeys and Antigravity proof-before-HTTP isolation/settlement regression pass. Preserve old entries/digest guards and failures, pin separately retained current-source binaries with Cargo artifact/inventory/source hashes. Independent source/runtime and ledger review, fail-stop Git/requiredCI/normalmerge/content+ancestor+trailer readback, journal/desk, complete verified backup and own-worktree cleanup are required. Overall incomplete/no usabletag/desk in_progress; no next milestone.

## Canonical metric contract

Only existing aggregated normalized prompt_tokens/completion_tokens and five separate saved timing columns gain summaries. Raw reported input/output/cache buckets remain per-event only; no mapping changes. Each metric basis names its saved column; token basis explicitly describes stored counters only, and latency basis explicitly describes legacy/compatibility mixed events. `known_mean` is for timing only, with explicit known-observation denominator. Sums must not fabricate0 when absent or silently overflow; unavailable arithmetic must retain counts and be distinguishable. No price precision reform.

The same endpoint selects canonical output with `?schema=2`. Its `schema_revision` is2; `data` contains the latest30 populated date-prefix buckets, and `measurement_summary` covers their combined rows (including no_data summaries when empty). Each day retains outcome/cost counts, nullable complete token totals and a nullable known-only legacy mean. Default/schema1 preserves numeric token/latency scalars, adds `schema_revision:1` and a compatibility notice pointing to schema2. Those legacy scalars alone remain ambiguous; owned Web consumers use the canonical report. Unknown schema selectors return400; existing authentication remains required.

The scope metadata is `day_bucket_limit:30`, `selection:latest_populated_date_prefix_buckets`, `denominator:stored_event_attempt_rows`. A basis object warns that stored token counters are not subscription consumption, timing means use known saved observations, and legacy latency mixes historical values with headers/CLI-ready mirrors. Every field summary names its stored column. `unavailable` means the exact sum cannot be represented as i64; counts remain intact and a known-only timing mean can still be available. No schema migration or raw-value rewrite is required.

## Bounds and evidence

3–4 active-hour estimate;20minute checkpoints;600second command/CI limits; initial issue plus at most2 reasoned corrections. Scope/authority/isolation conflicts, stalled progress or major overrun stop affected work. Whole-round counts/tokens/cost/timing unknown/null. No real credentials/privateDB/providers/login/Docker/dependencies/permissions/release/deploy, pricing reform, new observers/mapping, full#698/#701, client/version acceptance or Cursor/Antigravity capabilities.

Source-map T001 accepted by root against current store/admin/web/TUI code and spec. Actual native and admin-HTTP RED are recorded; complete delivery gates remain pending. Later owner T0432 report independently validated without HTTP rerun and separately backed up; original274file snapshot and false-at-the-time personal-run flag remain untouched.


## Core checkpoint; not product completion

Claim292 merged and readback verified. Actual native baseline five tests failed:28field/cohort summary mismatches, independent clocks/attempt denominators/sparse-reopen checks and TUI unknown=0ms. Minimum core correction now passes eight newtests,25Store/eightTUI focused regressions and fmt. Root source review corrected a provisional legacyAVGoverflow regression; a timing mean remains independently available from exacti128 accumulation then binary-float division even if its i64sum is unavailable. OriginalREDtests unchanged. No historical values, raw mappings, schema, CSV or costs changed. Rootbasec23a0fa47d236313e6b0e50343f7ca32b096dbf4 has byte-identical pokercase to initiale558d5f7. This was the core checkpoint before owner selected schema2. Final HTTP reconciliation, full gates and publication are recorded separately below. Native SQLite/TestBackend is not HTTP/live-terminal/provider acceptance.


## Approved API choice — 2026-10-29

Owner replied「按你建議，繼續開發。」to the two explicit API choices. Adopt option1: GET /admin/api/usage/daily?schema=2 returns schema_revision2, nullable complete token scalars, nullable known-only legacy mean, seven per-field summaries perday and selectedscope, and explicit scope metadata. Default /daily (and schema=1) keeps numeric v1 scalars, marks schema_revision1/legacy compatibility and directs readers to schema2. Unknown schema values fail400; no database or eventCSV schema migration. Web directly consumes canonical Store report. Existing v1 scalar-only clients retain historical ambiguity until opting into v2; do not claim they gained missing-value distinctions.


## Source-to-consumer matrix

| Saved fields | Query/scope and denominator | Consumers and change |
| --- | --- | --- |
| prompt_tokens, completion_tokens | Canonical sum/count per populated date bucket and selected set; all stored attempt rows exactly once | Daily JSON schema2 and Web use known subtotal/coverage. v1 numeric scalars retain compatibility. |
| headers_ms, cli_ready_ms, first_output_ms, total_observed_ms | Separate sums/counts/known-only means over the same rows; no substituted clocks | Schema2 and Web expose each field independently. Unsupported/unmeasured/history gaps remain unknown. |
| latency_ms | Separate legacy/compatibility summary with known-only mean | Schema2/Web label its mixed basis; TUI event display distinguishes unknown from0ms. |
| Raw reported input/output/cache counters and usage_status/source | Existing per-event values; no new aggregate/mapping | Event JSON100/Web50/TUI30/CSV1000 remain distinct scopes. CSV already preserves blank null and explicit0. |
| Existing cost fields | Existing all-time/day cost coverage | Doctor/dashboard/TUI footer remain cost-only; original cost regression retained. |

Daily selection is a populated-date limit, not a calendar window. There are no new business filters. Cross-surface checks compare identical selected rows rather than treating API30, Web14 and event limits as interchangeable. Whole-row usage quality remains separate from field coverage.

## Reproduction and verification

Run from the component directory after a locked build, using a separately retained binary and its inspected SHA256:

```bash
cargo +1.99.0 build --locked
python3 scripts/measurement_coverage_check.py --check \
  --binary /absolute/path/to/preserved-thinrouter \
  --expected-binary-sha256 <verified-sha256> \
  --output-dir /absolute/path/to/owned-results
```

This command needs no desktop. It checks the executable before launching any process/listener, uses a fresh temporary SQLite database and guarded non-forwarding loopback fixture, creates no provider connections/routes, and writes a JSON report before cleaning up. It never replays inference to fill gaps. The report separates admin requests from inference/refresh/discovery, compares exact matching subsets, and records helper/binary fingerprints; source checkout metadata alone is not build attestation. Existing four walkthroughs and Antigravity entries remain available.

Observed local validation: eight new native cases passed after actual five-test baseline RED; baseline admin HTTP also exposed ignored schema2 and missing empty-scope/Web summaries before the API correction. Full378Rust tests/22groups,96Python tests,20repository-validator tests,47contracts/8indexes,fmt/Clippy/lockedbuild passed. The final real-adminHTTP matrix passed all seven synthetic scenarios and reopening: empty, all-null failed/interrupted, partial retry, explicit zero, complete fields with partial whole usage, mixed legacy/pending, and1,032rows across35sparse date buckets. API30 selects882rows; Web14 selects406; eventJSON100/Web50/CSV1000 are checked against their own exact subsets.64adminrequest attempts produced62responses (startup polling is included); inference/refresh/discovery/unknown destinations were0. Eight actual doctor invocations retained cost semantics; raw rows stayed unchanged and cleanup passed. Pending recovery is not claimed by this reopen scenario.

All four existing nine-stage generic/Claude/Cursor/namedHTTP journeys passed on the separately preserved ordinary binary. Antigravity's six isolation proofs then seven real-router HTTP stages passed on the separately preserved native executable:45inference/2discovery/4refresh/0unexpected,45durable attempts and released stream ownership. Ordinary-build and Cargo test-context executables have separate recorded digests, source manifests and inventories. This is isolated regression evidence, not a #701 root-cause diagnosis or real-provider bill check.

Independent source review, required CI, normal merge/readback and ledger/backup/cleanup remain explicit delivery gates; their eventual outcome is recorded in the board/ledger. SQL/native fixtures and headless terminal rendering are distinct from HTTP/CLI journeys; no real client/version/provider verification is claimed. Product remains incomplete, with no usable tag; this slice does not close #699 or #698–702.
