---
id: SPEC-T049
status: verified
contract_units: [CU-WEB-OBS-01, M1-WEB-04, M1-WEB-06]
---

# Current run observation

Keep existing endpoints, explicit refresh and500ms polling. Each started run GET gets a
monotonic browser-local request generation. Selecting a run and becoming unauthenticated
invalidate outstanding observations. Re-selecting the same ID or logging back in does not
restore an earlier request. Only the latest started request in the authenticated selected
view can publish status/reason/history/result, change current-run-derived controls,
clear a confirmed pending marker, follow a404 fallback, or schedule/execute its poll timer.
This generation is UI eligibility, not AP state_version or a durable execution identity.

Ignore obsolete success and failure. Current run-read failures remain visible with the
existing bounded messages. Preserve legitimate current404 recovery to the confirmed
fallback and current polling without writes. A delayed callback whose timer was already
queued must check eligibility before another GET. Handle refresh-owned errors within
its captured generation so generic callers cannot publish an old failure. A terminal
refresh may call the existing recent-list read; fence its rejected completion here,
without redesigning that list's independent request contract.

Security: AP auth remains authoritative; shared API401 handling still logs out even
for a stale request, and all other page request lifecycles remain outside this repair.
Atomicity: eligibility is checked after await and before synchronous projection effects.
Retry/recovery: no new automatic retry on error, no create/cancel/reconcile/submit effect;
existing successful poll behavior remains. Errors are existing generic bounded messages,
never raw result bodies. Compatibility: no route/schema/storage/Rust/rustdoc changes.
No global request framework, session overhaul, abort controller or backend change needed.

# Pre-implementation acceptance skeletons

| AC | Scenario | Expected |
| --- | --- | --- |
| O01 | Two same-run reads, newer success then older running result | New state/diff/checks/controls unchanged after old response |
| O01 | Held A read, A→B→A or logout/login, then release old A | Current observation preserved |
| O02 | Old network error or404 after a newer read/selection | No error overwrite or fallback GET |
| O02 | Already-queued old poll callback after selection or logout | No run GET; current callback still polls |
| O02 | Current error and current404 fallback | Error visible / confirmed fallback observed, zero execution writes |
| O03 | Actual-controller RED→GREEN and Chromium held responses | Observable state/results and request log, exact-source evidence |
| O04 | Optional Claude attempt, required fresh acceptance, root gates/CI/delivery | Review source and actual evidence; final BOARD closure |

Full FN07/owner operation and runtime backend acceptance are not implied by fixtures.
