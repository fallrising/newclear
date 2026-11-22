---
id: SPEC-T048
status: specified
contract_units: [CU-WEB-DIFF-01, M1-WEB-04, M1-WEB-05]
---

# Authenticated current-view diff download

This clarifies the existing M1-WEB-04 exact authenticated download and FN06 boundary.
An explicit download click requires authenticated state, a selected run, an available
string diff and enabled download control. Capture the run, expected diff and existing
view invalidation generation before issuing the same authenticated GET result.diff.
The existing candidate generation already changes on selection and unauthenticated
showLogin, including logout and observed401; reuse it conservatively. Candidate reload
also invalidates an outstanding diff read: the user can explicitly download again.
Do not introduce another executor, API, persistence identity or session mechanism.

After await, ignore completion if authentication, selected run or generation changed.
Only the still-current action may compare response bytes against the captured expected
diff and current displayed diff, create a Blob URL, click the download link and schedule
its existing revocation. An obsolete failure is ignored by this handler; current
mismatch/network failure remains an error and does not download. Existing shared API401
handling still shows login and invalidates reads; this task does not change transport or
promise to fence all other page requests. No automatic retry, alternate source or cached
fallback. No new status writes, POST, mutation intent, provider or cross-product lookup.

Security: AP authentication remains authoritative; frontend checks suppress stale local
download side effects, not replace authorization. No secret is put in URL/storage/logs.
Atomicity: post-await eligibility/byte validation occurs before synchronous Blob creation.
Recovery: user explicitly reselects/logs in/retries a GET; existing unknown submission
locks remain. Errors: use existing redacted API errors / bounded diff mismatch message,
never include returned bytes. Compatibility: same route, filename, MIME and exact bytes;
no Rust signature/error/rustdoc changes and no alteration of candidate/review contracts.

# Pre-implementation test skeletons

| Clause | Named acceptance before code | Expected |
| --- | --- | --- |
| D01 | D01: late diff after logout or logout/login never downloads | Hold GET, change login state, release identical bytes; zero clicked download anchors |
| D01 | D01: A-B-A selection invalidates pending diff even with identical bytes | Hold A GET, select B then A; zero download |
| D01 | D01: observed401 invalidates pending diff and unauthenticated clicks do not read | Hold GET, another read401, release; no download/new diff GET |
| D02 | D02: stale diff failures preserve the new view error | Hold then reject after logout/selection; sentinel error unchanged |
| D02 | D02: current exact diff downloads once while mismatch/error does not | UTF8 exact Blob contents/name, onlyGET; mismatch/error visible, zero download |
| D03 | Real Chromium held response/logout/relogin plus current download | Actual shipped JS, synthetic server, native browser download events and bytes |
| D04 | Fresh review, local checks, CI/merge/readback | Actual receipts; final BOARD closure |

Runtime/owner FN07 acceptance is not supplied by synthetic browser/session fixtures.
