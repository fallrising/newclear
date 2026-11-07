# M3 / FN05 fixed candidate — T-0442

Owner continuation2026-11-01; SDD §§3,5,6 / FN05 remains the full acceptance target.
This necessary Fanzloud portion uses AP's existing immutable result archive. It does
not implement or claim the missing read-only reviewer backend. AP changes need the
separate bounded dependency approval required by SDD§3; no AP/Workforce code changes here.

## Contract units

- CU-M3-C01: isolated gateway admits GET only for canonical `/api/v1/runs/{uuid}/artifacts`
  and `/api/v1/runs/{uuid}/artifacts/{uuid}`. Existing authenticated AP endpoints are the
  authority. No wildcard, query, redirect, POST, delete or expiry bypass. Preserve body
  bytes and existing bounded framing/security; archive routes never enter run-observation
  persistence. Browser receives no provider or connector credentials.
- CU-M3-C02: operator explicitly chooses a succeeded task with a diff and clicks
  “取得審查候選”. GET metadata selects exactly one unpruned result archive for that run.
  Canonical artifact/run UUIDs, JSON MIME, integer size1..1MiB and lowercase SHA256 are
  mandatory. Fetch that exact artifact once; no fallback to mutable run JSON or local
  fabricated artifact. Verify UTF-8 byte length and WebCrypto SHA256 before JSON parse.
  Validate result-archive-v1, artifact/run/task/base/profile/attempt/goal identities against
  the captured selected run, diff bytes/hash/base and verification against that run.
  Unknown/empty/pruned/malformed/mismatched evidence fails closed with no downloadable candidate.
- CU-M3-C03: show candidate SHA256, base, writer profile and fixed diff/checks in text-only
  content; download precisely the verified original JSON bytes. Candidate hash is AP
  archive SHA256 (not diff SHA256); metadata distinguishes both. This result archive is
  the immutable review input and includes the original goal, diff and verification; it is
  not a repository tree or proof of an actual reviewer. No review-start button is exposed
  before the read-only backend exists; page states review has not started.
- CU-M3-C04: selection/reload/logout invalidates candidate and outstanding reads using a
  generation token. Late A replies cannot attach to B or a new login; load failure clears
  prior download. Download requires authenticated current run and current verified bytes.
  Browser reload reacquires the same immutable archive through explicit GET; no task or
  review POST, automatic dispatch, retry or new lifecycle authority.

## Acceptance / test skeletons (before code)

| ID | Given / When / Then | Layer |
| --- | --- | --- |
| C01 | canonical artifact URL / GET versus mutation or malformed URL / only exact GET forwarded with AP auth | Rust route and real TCP contract |
| C02 | fixed metadata+archive / read / digest, size and identity agree; original bytes downloadable | JS unit, actual AP+Rust+Chromium |
| C03 | tamper/prune/mismatch/nonterminal / request / no candidate/download/dispatch | JS negative contracts, AP status passthrough |
| C04 | pending A load / select B or logout/login / stale completion cannot restore candidate | JS asynchronous browser controller |
| C05 | accepted real M2 result / actual Web load, download, fresh browser reload / same archive and diff hashes, zero task POST/CLI/VM | actual retained AP database, no worker |

Security: existing AP session/CSRF and exact bounded gateway; candidate text remains
untrusted data, never executed/rendered as HTML. Atomicity: AP already persists immutable
archive in its result transaction; Fanzloud only reads and verifies, no new database schema.
Retry/recovery: explicit bounded GET only; old unknown submission locks remain unchanged.
Concurrency: captured run plus request generation; no stale post-logout result. Errors:
redacted generic candidate failure, do not echo untrusted upstream bodies. Compatibility:
P0 unchanged, existing task/diff flow remains; old missing/pruned archive is unavailable.
Dependencies: browser WebCrypto/TextEncoder and existing Rust crates only.

Start2026-11-01T15:14Z; estimate60–90 active minutes plusCI; every20min checkpoint.
One fresh-context reviewer, <=15min code/evidence plus one <=5min correction review;
no nested workers. Meaningful RED then focused/full native/Web gates, real GET-only
browser proof and independent acceptance. Build25min, CI observation30min; same failure
at most two evidence-based corrections. No green replay, coding/VM/new task, paid API,
host resources, release or deployment. Missing AP backend remains explicit; prepare
one concrete proposal and stop its implementation pending scoped approval. Unknown
provider requests/tokens/cost and complete tool totals remain null.
