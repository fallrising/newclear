# T-0377 dedicated Cursor live smoke

Owner explicitly authorized dedicated-profile login and one brief text request on2026-10-23 (conversation instruction: 授權). This continues the real-account portion of SUCCESS AC-17; offline CI-1–CI-5 and image startup already passed.

Scope: fresh named profile volume and pinned local Cursor image; do not copy/read host login files. Authenticate through the official CLI browser flow. Send one short text request through thinrouter, request no tool/plugin use, and verify response plus request-container removal. No automatic model retries, deployment or usable tag. This is one text journey, not every protocol/tool/image or token-refresh acceptance.

Start18:13:50Z; cutoff18:33:50Z, final3minutes closeout. Login waiting is bounded; no reply/expiry implies no completed login. Profile credentials stay in the volume, never in logs or Git. Stop test gateway/login containers after verification; retain the profile for explicit later use.

## Observed result: FAILED

Official CLI login was confirmed successful with exit0 at2026-10-23T18:24:40Z; no account identity or credential is recorded here. One non-streaming `/v1/chat/completions` request with requested model `auto` was sent through one direct Cursor connection. Expected reply was `CURSOR_OK`; the gateway instead returned HTTP502 after2.016seconds. The launcher recorded exactly one Docker run. No retry was made. Actual provider-internal model requests, billed tokens and cost remain unknown.

The request container disappeared without operator removal (`remaining_containers_before_operator_cleanup=0`); the dedicated credential profile is retained. This is a successful login and cleanup observation, **not a successful inference journey**. Offline isolation and startup evidence remains separately scoped.

Source: `ac220e06a2c452e8be8f40e2f43ffb5ee4813a71`; built binary SHA256 `b7862c838b8cab1d97c778e3fe24b66c95a8351c9ff082cb15eece782440b4c2`; image `sha256:3751cae4e8a7ec05b2728ff991fbd56370da79035ad7cd6da39dd849840bfaaf`, official CLI2026.10.22-27dcf5f. Source/runtime dependencies are unchanged from the previously accepted isolation implementation. `cargo +1.99.0 build --locked` passed for this checkout. The private operational script persists an exclusive request marker before POST and records only generated container names, numeric usage/status and match/cleanup booleans; no raw model response, login URL or auth data is saved.

## Diagnosis and next step

No-network Node diagnostic inside the same image returned `ERR_SYSTEM_ERROR` for `os.userInfo()`, because UID1000 lacks a passwd entry. Inspection of a matching CLI software path found it catches that failure; this is a compatibility observation, **not an established cause of HTTP502**. The production gateway intentionally exposes a fixed error, and this run did not retain raw upstream stderr. No second inference was used to chase a hypothesis.

Next: add bounded, redacted operator diagnostics for the container startup/error path and reproduce local preconditions without provider calls. Establish a concrete correction before requesting an additional live request; the originally authorized one-request allowance is consumed. Existing login authorization/profile can be reused and should not be requested again. Live text remains pending/failed; other protocols, client tools/images and token lifecycle remain unverified.

Preflight independent review found and corrected an operator-script cleanup ownership bug: refusing an occupied profile must not remove an existing login container. The fixed script records and cleans only its generated request name; a fake-docker test and focused independent review passed. The script is operational evidence, not a product implementation change.
