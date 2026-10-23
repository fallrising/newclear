# Fleet Access web scope — 2026-10-23

Owner explicitly removed the third exposure mode and selected Access web for current use; public remains supported but unused. This record supersedes the old AC-03 product scope without changing historical source manifests or test results.

## Verification

RED observed: unsupported mode accepted; Access pending ingress published before policy; policy failure still published; empty allowlist accepted; obsolete DB route column retained; unsupported stored modes upgraded; API enqueue erased freshly reconciled CF IDs. Logs are retained in the shared workspace evidence. Implementation removes the retired behavior and adds Access gating and database migration coverage. The first full native run found a now-unused test import; it was removed before the passing run. A task validator initially rejected a four-digit worker ID; the bounded task is now T-101 and validation passes (product board T-1001 is unchanged).

Cloudflare policy API reference: [application policies](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/subresources/policies/). Real browser email-OTP acceptance has not run. No production deployment or external route cleanup was performed.

## Executed results

- Full native runner through the shared workspace: `go test -count=1 ./...`, example tests, `go vet ./...`, schema/compiler tests and three binary builds **PASS** with Go 1.27.1. [Normalized output](2026-10-23-access-web-native.txt).
- Source fingerprint **479bf27d84ea726b99534bf3919bea741401c0c142c31615caad9acf4760e9b3**, based on 887c5574b6b4b93ca0dde7a6c58f1aeb17de517a. [Manifest](2026-10-23-access-web-source.json) was compared against every runtime/build/test file before acceptance; exact binary hashes match the real Docker artifacts.
- Isolated VPS `scripts/acceptance.py`, current Access-mode synthetic workload: **ten checks plus cleanup PASS**. [Docker result](2026-10-23-access-web-docker.json). This uses a local origin and noop CF integration; `ac03: not_run` remains explicit. Tested registration/heartbeat, literal env/argv, no repeated recreation, secret merge, stop/start/redeploy, agent and control-plane restarts/outages, and uninstall after generated-file/cache loss.
- Migration tests exercise an actual legacy SQLite schema with services, releases and instances. The two-mode upgrade preserves data/foreign keys and is repeatable; unsupported legacy rows fail before mutation and roll back. Historical migration001 stays immutable; migration002 removes the retired route-ID column and adds write guards.
- API regression confirms the asynchronous status update preserves new CF object IDs. Fake-CF tests verify policy before ingress/DNS, no publishing after policy failure, no empty/everyone fallback, managed policy allowlist updates and refusal of unmanaged policies. These tests do not demonstrate real edge login.
- All **41 project success contracts**, current local documentation links, task contract, scoped whitespace check and source/binary identity **PASS**.
- Independent CLI read-only review (gpt-6.1-sol/high, 300s timeout) found only the SDD embedded Example A still saying public. Root changed it to access; the bounded 120s follow-up returned **ACCEPT**, verified identical embedded/shipped YAML, all114 source hashes and the published Docker result. No runtime/migration regression was identified by the initial review. Historical deleted-resource error handling is a preexisting issue outside this removal slice.

Preflight reconfirmed available test resources, services/containers, listening ports and absence of another active Fleet test. No existing service needed stopping. Test-owned processes/containers were removed and original container inventory restored; state, logs and artifacts remain preserved outside the public repo. No production service, Cloudflare account or live route was modified.

## Delivery and remaining acceptance

Current progress and PR/CI/merge readback are recorded on [BOARD](../tasks/BOARD.md#t-1001--access-web-scope-owner-instruction-2026-10-23). Owner authorizes milestone Git delivery; remote CI must pass before merge. AC-01/02/04 are supported by this candidate's checks. AC-03 remains pending real Access browser denial and allowed-email OTP success; public is retained but unused. No usable tag, release or deployment.
