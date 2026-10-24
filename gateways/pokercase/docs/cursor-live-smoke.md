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

## Authorized follow-up2026-10-24

Owner asked to retry, authorizing one additional brief real request using the existing dedicated profile. Original failed attempt and marker remain immutable. This round starts05:13:48Z, ends05:33:48Z with final3minutes closeout. First diagnose container startup offline; capture only bounded redacted diagnostics. No host auth copy, privilege widening, deployment or automatic repeated inference.

### Follow-up outcome and fixed diagnostic

The authorized retry sent exactly one further gateway request and launched one container. It again returned502 after1.938seconds; no expected reply, no automatic retry, and automatic cleanup succeeded with0remaining containers. Provider-internal requests/tokens/cost remainunknown. The checkout SHA changed from `ac220e06` to `db3da9a2`; runtime source/dependencies were unchanged and the binary hash matched the first attempt; the old request marker was preserved and a new independent marker recorded this authorization.

The new diagnostic helper persisted **only fixed categories/codes and byte counts**, not arbitrary stderr, account identities or tokens. It recorded259stderr bytes with `sandbox` and `not available`; no RPC/HTTP code was detected. Inspection of the installed official bundle located the startup rejection for “Sandbox mode is enabled but not available on this system.” This identifies the rejected CLI prerequisite, not the exact kernel/feature-gate reason behind it. It does not establish that the earlier UID observation caused the failure.

No-network startup returned `unavailable`/`EAI_AGAIN` as expected with networking disabled; a separate bridge DNS-only check resolved the official API host. Neither probe proves inference works. Direct helper preflight attempts lacked required command/policy inputs and are inconclusive; they are not a successful kernel compatibility test. No privileges or flags were relaxed to obtain a pass.

A narrow gateway correction now maps the two known sandbox-unavailable startup sentences to503 and a fixed operator message. The log carries static `reason=sandbox_unavailable`; the API retains its existing error schema and does not expose arbitrary stderr. `--mode ask`, `--sandbox enabled` and every Docker restriction remain unchanged. Other failures retain existing status handling and no new retry is introduced.

Validation: the new focused E2E first failed with actual502/expected503; after the correction, `cargo +1.99.0 test --locked` passed99tests, `clippy --locked --all-targets -- -D warnings` and `fmt --check` passed. Independent source review passed. Diagnostic-helper fixtures verified identity/short-token exclusion and fake-Docker exec/cleanup behavior. These checks validate error handling, **not a successful live reply after the correction**; no further live call was made.

Next: determine a sandbox-compatible runtime configuration. Any choice to disable the CLI sandbox or loosen Docker permissions requires a separately reviewed safety decision; this change does neither. The dedicated authenticated profile is retained, and both authorized one-request attempts are consumed. Do not request the completed login authorization again or silently send more inference.

## Compatibility decision2026-10-24 (current next step)

The owner supplied a direct-CLI comparison using the same image/profile: normal Docker flags reject `unshare -Ur`; relaxing seccomp allows that probe; keeping Docker restrictions and using `--sandbox disabled` returns OK. These are owner-reported observations, not tests rerun by this gateway work. They support a local seccomp conflict; the additional AppArmor/UID-map observations do not prove a second blocker.

The [reviewable decision](cursor-isolation.md#2026-10-24-container-compatibility-decision) changes only the fixed CLI preference inside mandatory Docker to `--sandbox disabled`. Default Docker seccomp and every outer restriction stay intact. No silent fallback or automatic retry is added; fixed503 redaction remains for a CLI that still reports the known error. Earlier failed gateway attempts remain failed.

Current next step: obtain fresh owner authorization for one gateway text acceptance using the corrected runner and retained profile; both previous one-request allowances are consumed. The owner-reported direct-CLI OK does not verify thinrouter end to end. No new live request was made by this compatibility implementation.
