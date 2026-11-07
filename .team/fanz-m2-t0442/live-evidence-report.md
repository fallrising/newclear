STATUS: PARTIAL

## Summary

**ACCEPT_SINGLE_LIVE** — evidence-only audit, 2026-11-01T05:17:14Z snapshot.
The actual Codex single-VM Web repair passes its bounded acceptance. Overall M2
remains **PARTIAL**: simultaneous Claude/Codex isolation, independent cancellation,
and current shared-route Claude live coverage remain pending. This finding does not
block delivery of the accepted implementation and single route; it does not authorize
more resources, another provider invocation, or M3.

Used the existing task-worker/evidence-gate contracts and this new evidence assignment.
No repeated code review, network request, test rerun, provider/VM/browser execution,
credential read, Git mutation or delegation. Only this report was written.

## Verification

- Source binding — passed
  HEAD, live/browser summary and source manifest all
  identify `a51a86634a27d84e52fe95e2d42d4ea7ac541ec0`. Read-only SHA256 comparisons
  confirm current Codex driver, backup and isolated Web bytes match the independently
  accepted code hashes; scoped driver/lifecycle/bridge/worker hashes also match the
  source manifest. Remote Connector/runtime remains explicitly pinned to M1
  `33e1eb70d66eb74644e8ad81e64e8bdc69c9fe07`, not misrepresented as current source.
- Single real submission and browser outcome — passed

  `browser-results/codex-live/receipt.json` identifies one POST and run
  `142e9aee-179a-426e-b0c6-330df9f4a677`, generation1, attempt1, backend
  `codex-subscription`, sandbox `e4ddc4ed-44c1-4a3f-8c4a-5ff4b7b4429b`.
  Chromium153 observed queued→provisioning→running→finalizing→succeeded, displayed
  passing checks and confirmed cleanup, and recorded no browser errors. Both vendor
  choices were visible; their presence alone is not two-vendor live acceptance.
- Official agent and tool binding — passed
  Driver receipt records official
  `codex-cli 0.166.0`, binary SHA256
  `b8a11fedf24b2dfb59a70c9e52b030f9a508dcd49cd2dd0d41956f4c785156b8`,
  model `gpt-6.1-sol`, ChatGPT auth, verified configuration and empty environments.
  Raw protocol confirms thread `01a19582-e670-7153-8503-e7f15a0ee0ef`, turn
  `01a19582-e6c5-7d33-b8c2-d7887ea81bcc`, provider `openai`, no attached environments,
  empty MCP status, and one completed turn in9621ms. Four successful dynamicToolCall
  completions exactly match the receipt's call IDs: two reads, one write of only
  `totals.py`, and `python3 -m unittest -v`. A read-only Python consistency assertion
  checked these identities/statuses and passed. No provider/API fallback is indicated.
- Fixed-base patch and verification — passed
  Base is
  `55bd36a47d3ca619b0a10bcad427b9fb9b8c99c5`. The downloaded285 bytes equal AP's diff
  bytes exactly; independently recomputed SHA256 is
  `c5134c8015bad2104fceb70e5c4c79086d6ec9bd85a0b4fa0f833b4ed3ef6fdb`.
  Inspection shows only `range(start, end)`→`range(start, end + 1)` in totals.py.
  Agent tool output, final profile verification and `codex-patch-proof.log` show all3
  tests passing. The retained fresh-base patch proof files have the expected source
  and unchanged tests. Profile check output SHA256 matches the proof-log SHA256
  `1e49a46a805cc274ff699398036a0518abf26d92ff5dba2a50970f7caa5df42c`.
- Single-run boundary and cleanup — passed
  within scope. Live summary's bound
  guest probe reports UID2000, NoNewPrivs, host/control denial and direct/proxy egress
  denial. AP records `runtime.cleaned` and cleanup confirmed; driver receipt confirms
  the owned CLI process group stopped. `single-cleanup-runtime.json` independently
  records claims0, VMM0, VM cgroup directories0. The first retained cleanup diagnostic
  reported22 because it counted kernel control files as cgroups; claims/VMM were0
  there too. Parent identified the counting error, and the inspected corrected
  `audit-single-cleanup.py` counts only `p.is_dir()` under the same configured parent.
  The first diagnostic remains retained, not silently treated as a passing count.
- Synthetic versus live evidence — passed
  Config probe has zero turns; isolated
  Responses fixture explicitly has zero live provider requests and two local fixture
  requests. They remain qualification evidence, separate from this actual repair.
  One actual run receipt exists under the scoped Codex runs directory. Browser mount
  failure occurred before the container process started; catalog preparation log says
  no tasks submitted; worker log confirms one claimed run and no second claim. These
  bootstrap failures are not counted as coding retries. Other bootstrap details in
  the acceptance record are parent operational history, not independently re-executed.
- Partial-delivery wording — passed
  Documentation housekeeping noted below.
  M2 acceptance record explicitly says actual Codex single repair PASS / M2 PARTIAL;
  prior Claude M1 remains preserved and simultaneous/cancellation acceptance is still
  required. No CloudAC04, M3, usable MVP or concurrent FN03 pass is implied.
- Hosted CI — skipped
  as an independent network check. Assignment supplies green
  runs on a51a8663: AP41275675180, Fanz41275675220, contracts41275675179,
  workflow41275675200. Network is out of scope for this reviewer; parent owns remote
  check reconciliation and final Git delivery. This is not an invented independent CI
  verification and does not weaken required CI.
- Concurrent FN03 / new shared-route Claude live — skipped
  Not executed; separate
  bounded resource approval was pending during this audit. Required for full M2.

## Documentation

This report supplements the earlier ACCEPT_CODE review with new single-live evidence.
The acceptance record still had one stale “Hosted CI pending” sentence at inspection;
parent was notified and will reconcile it to the supplied green run IDs. It does not
alter the single-live result or justify marking M2 complete.

Evidence root: `.local/fanz-m2-20261101/` in the shared workspace. Private raw evidence
must remain in the private handoff/backup; only sanitized summaries belong publicly.
Audit-computed receipt SHA256 values:

- `codex-live-summary.json`: `f219dc694923f64461fba02c8142dbcaaf3d14781b846ffca989f1172b4e2d17`
- `browser-results/codex-live/receipt.json`: `b506cdad3942a68b46b9c062b30f837167c539cfa61280b6c9999a1f6a3e42de`
- `single-cleanup-runtime.json`: `7b2e0eeb458f0d436e158baa6841ed9a71636a12db7f9303cc191c290d622efe`
- Actual driver `events.jsonl`: `d6a81b757e3f236fbc6e42e62cf647be63c9e36366cdec3a88f3c8de49c450d2`

## Risks and Follow-ups

Nonblocking trace limitation: the RPC logger's configuration response ID2 also redacts
the server's fanz_write callback request ID2. Thus the log has3 visible item/tool/call
requests, but all4 dynamicToolCall started/completed notifications, successful results
and receipt call IDs remain intact. The write is independently evidenced; do not report
four visible callback-request records or rerun a provider merely to improve the trace.

One coding CLI invocation is observed. Provider request count, aggregate model tokens
and billed cost remain unknown/null; neither four tools nor one turn supplies those
metrics. Full M2 still requires the explicitly bounded concurrent experiment and its
own evidence audit. Preserve this accepted single-run evidence and all earlier failures.

Audit accounting through report write:8 outer functions.exec calls,8 nested
exec_command calls and1 apply_patch; agent starts0, network/provider/VM/browser
execution0. Read-only evidence assertions are not application test reruns. Underlying
model-provider requests/tokens/cost and aggregate execution/wait timing unknown/null.
