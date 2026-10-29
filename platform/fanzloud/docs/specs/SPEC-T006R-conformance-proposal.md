# Finite HTTP/WSS conformance and remaining T006R oracles — scope proposal

Status: **C1 confirmed by the owner on 2026-10-29** (「確認範圍：實作 C1；C2 執行前再問我。」). C2 needs a separate approval before it runs. Desk T-0433 (issue 706), R2-AC-14 and R2-AC-E.

Basis:
- [ROUND2-SDD](../../../../docs/fe-review/ROUND2-SDD.md) R2-AC-14: "M1–M3 finite HTTPS/WSS synthetic harness … mock is not real backend/Cloud acceptance; real integration needs its own explicit scope."
- [DESIGN](../fe-review/DESIGN.md) M1 and M3.
- [SPEC-T006R](SPEC-T006R-fe-review.md) R01–R12 and its 12 named machine oracles.

## Current state (main `0ff9bab0`)

Done: the dark canonical capture is 27/27 on the M2-repaired source (v7, independently reviewed), and the R07 M2 gates pass or pass on bounded evidence.

Named oracles:

| Clause | Oracle | State | Gap |
|---|---|---|---|
| R01 | `review_exact_assets_and_unknown_routes_fail_closed` | exists | — |
| R02 | `review_fresh_state_origin_and_environment_are_contained` | exists | — |
| R02 | `review_tls_https_wss_trust_and_negative_names` | **missing** | needs a real browser over the private TLS: positive, wrong-name, untrusted-CA and plain-HTTP refusal |
| R03 | `review_http_fixtures_match_actual_controller_contract` | exists, fixture-level | not exercised over the real loopback HTTPS transport |
| R04 | `review_replay_live_bounds_and_invalid_frames_fail_closed` | exists, fixture-level only (`fixture.subscribe`) | no real WSS socket. Missing: upgrade cookie/Origin/path refusal, close codes 1008/1013/1012, 64 KiB frame bound, binary/repeated/unknown frames, exact T005C error optional fields (`history_gap` oldest/latest, `future_cursor` latest, `unsupported_version` supported_version, both `subscriber_lagged` shapes), logout/expiry invalidation within the inherited window, and "no WS input causes a mutation" |
| R05 | `review_explicit_actions_are_the_only_mutations` | exists | — |
| R06 | `review_gap_restart_timeout_and_refresh_preserve_no_resend` | **missing** | pure partitions plus a focused real browser |
| R07 | `review_measured_presentation_is_accessible_at_three_sizes` | **missing as an oracle** | the 27-cell evidence exists. Not exercised: keyboard traversal landing on the event/diff regions, keyboard local scroll, measured accessible name |
| R08 | `review_secrets_clear_and_diff_is_inert` | **missing as an oracle** | the per-cell DOM flags exist; no oracle over them plus a canary scan |
| R09 | `review_late_acquisition_and_stalled_cleanup_fail_honestly` | exists | — |
| R10 | `review_canonical_capture_keys_are_complete_and_immutable` | **missing** | no oracle over the exact 27-key set, hashes, source and chain |
| R11/R12 | `review_evidence_keeps_native_and_mock_boundaries` | **missing** | no oracle over scope, mock-boundary and native-gate statements |

## Proposed scope

### Phase C1 — offline, no browser (implementation only; no runtime approval needed)

C1-a, R04 over the real loopback WSS transport. Start the existing review transport on `127.0.0.1` with a per-test private CA and loopback certificate, then drive it with Node's built-in WebSocket client and HTTPS requests. Cover every R04 item in the table:
- upgrade refusals (no cookie, wrong Origin, wrong path, over the limit);
- the subscribe timeout;
- replay→snapshot→replay_end→live order;
- each close code and error shape;
- the frame bound;
- binary, repeated and unknown frames;
- invalidation after logout and expiry within the inherited window;
- subscriber release on every exit;
- mutation counters unchanged by any WebSocket input.

No browser, no external network, no new dependency.

C1-b, R03 over the real loopback HTTPS transport. Send every T006 operation's success and fixed-error case through the real transport. Validate each response with the actual `createP0Controller` validators and the exact headers: no-store, nosniff, JSON or text type and exact `Content-Length`.

C1-c, offline evidence oracles over the accepted v7 results. These skip in CI and run when `FE_REVIEW_RUNS` points at the private run directory, like M2-03.
- R10: exact 27 keys, hashes, source commit and desktop→tablet→mobile chain.
- R08: bearer and prompt empty, inert diff, no secret patterns.
- R07: no overflow, axe has no critical or serious violations, region attributes, and a pointer to the contrast evidence.
- R11/R12: scope and mock-boundary statements, `m2Accepted` false in the runner, native gates named.

C1-d, R06 pure partitions. Gap, restart (identity change), timeout and refresh schedules against the actual controller with fake primitives. Assert that no mutation is resent and that refresh only issues GETs plus a subscribe. This extends the existing T006 test-12 style model without changing T006 tests.

### Phase C2 — one focused browser run (needs separate owner approval at run time)

One attempt, `conformance-001`: desktop plus mobile, at most 300 seconds including cleanup, same pinned image and `--network none`. It uses a new focused driver: a separately named file, with no change to the canonical runners.
- R02 TLS: positive load over private-TLS HTTPS/WSS, refusal for a wrong name, refusal for an untrusted CA, and plain HTTP not served.
- R06 focused browser: forced gap or restart, then refresh; record that no mutation is resent.
- R07 items not yet exercised:
  - Tab traversal lands on `#event-list` and `#diff-output` with a visible focus ring.
  - Arrow and Page keys scroll the overflowing mobile diff.
  - The measured accessible names equal the heading text (`getByRole('region', {name})`).

This run produces conformance evidence, not new canonical cells. If C2 finds a product defect, it stops with the finding; it does not change gates.

### Out of scope

- Real backend or Cloud integration, production authentication conformance and provider calls (the SDD reserves these for a separately scoped unit). [SPEC-T007](SPEC-T007-p0-subscription-e2e.md) remains the existing product-side loopback HTTP/WebSocket evidence and is not counted as R2 harness evidence.
- Light theme and Round 3.
- Any change to the product controller, its security, retry or recovery behaviour.

## Acceptance and delivery

- Every new oracle first fails meaningfully, or is shown to fail by mutation where the target already behaves correctly, then passes. All existing suites stay green.
- Independent review and required CI before each merge.
- C1 is one PR and one merge.
- C2 needs the runtime approval; its result and review go into its own PR.
- After C1 and C2, the final integration step records R2-AC-E: source commits, commands, tool versions, results, mock and real boundaries, cleanup, and PR/CI readback. Only then can delivery be stated as 19/19.

## Estimates and stop conditions

Estimates are not hard limits:
- C1: about 2–3 hours of active work.
- C2: about 1 hour of driver work plus one run of at most 300 seconds.

Stop and report if:
- a gap needs a product controller or security change;
- the WSS client cannot trust the private CA without weakening TLS;
- C2 fails, in which case the evidence is preserved and nothing is retried.

## C1 implementation notes

Files:
- `fe-review/conformance-transport.node.mjs`: C1-a and C1-b over a real `createTransport` HTTPS/WSS listener on an ephemeral `127.0.0.1` port.
  - A per-test private CA, a loopback leaf, a wrong-name leaf and an unrelated CA come from `openssl` (EC P-256, the same CA/leaf pattern as `trust.mjs`) in a private temporary directory that is removed afterwards.
  - Node's `https` client and the bundled `ws` client both trust only that CA.
  - The bundled `ws` comes from the existing Playwright 1.63.0 tools, located through `REVIEW_MODULES` (the directory that contains `playwright/package.json`). The test skips with a stated reason when that variable is unset. No new dependency is added and no machine path is committed.
- `fe-review/conformance-evidence.node.mjs`: the C1-c evidence oracles over the accepted v7 results, enabled by `FE_REVIEW_RUNS`.
- `fe-review/conformance-partitions.node.mjs`: the C1-d R06 pure partitions against the actual controller.

Deviation handling: where the review harness does not follow the T005C contract, the C1 oracle states the contract and records the measured harness behavior as a finding. The pinned `transport.mjs` and `fixture.mjs` are not changed in C1. Changing them would move the v7 source pins that the canonical 27/27 evidence relies on, so a harness repair is an owner decision.

## C1 results (2026-10-29)

Oracles added (35 fe-review node suites in total):

| File | Oracles | Result |
|---|---|---|
| `conformance-transport.node.mjs` | `review_tls_node_client_trusts_only_private_ca_and_loopback_name`, `review_wss_upgrade_requires_cookie_origin_and_fixed_path`, `review_wss_replay_live_order_and_exact_envelopes`, `review_wss_errors_have_exact_fields_and_policy_close`, `review_wss_invalid_frames_close_without_effects`, `review_wss_logout_expiry_and_shutdown_close_promptly`, `review_wss_subscribe_timeout_closes_after_five_seconds`, `review_http_over_https_matches_actual_controller_contract`, `finding_subscriber_cap_is_http_403_not_subscriber_limit_1013` | 9/9 over the real loopback HTTPS/WSS transport (about 6 s) |
| `conformance-partitions.node.mjs` | `review_gap_restart_timeout_and_refresh_preserve_no_resend` | 1/1 |
| `conformance-evidence.node.mjs` | `review_canonical_capture_keys_are_complete_and_immutable`, `review_measured_presentation_is_accessible_at_three_sizes`, `review_secrets_clear_and_diff_is_inert`, `review_evidence_keeps_native_and_mock_boundaries` | 4/4 against the accepted v7 results |

The meaningful-failure checks were mutations, restored byte-exactly afterwards:
- A transport auth-check interval of 2000 ms makes the logout oracle fail (the close took 1990 ms).
- A fixture that ignores Origin makes the upgrade oracle fail.
- Disabling the client gap check makes the R06 oracle fail.
- An altered desktop result breaks the R10 chain.
- One mobile cell set to `overflow=true` fails R07.

Without `REVIEW_MODULES` or `FE_REVIEW_RUNS`, the environment-dependent oracles skip with a stated reason. With both set, all fe-review suites pass 262/262; without them, 250 pass and 13 skip. The T006 suite passes 10/10.

Findings against T005C (the harness is unchanged; repair is an owner decision because it moves the v7 source pins):

- F1 — subscriber cap. T005C requires a `subscriber_limit` error and close 1013. The review transport refuses the ninth upgrade with HTTP 403. This is measured and pinned by `finding_subscriber_cap_is_http_403_not_subscriber_limit_1013`.
- F2 — back-pressure. From source inspection: an outbound frame over 64 KiB, or `bufferedAmount` over 64 KiB, triggers a `protocol_error` close 1008 instead of `subscriber_lagged` (1013) or `stream_unavailable` (1013). The frames are small, so this is not reachable in a test.
- F3 — `history_gap`, `subscriber_lagged` and `stream_unavailable` cannot be produced through the review transport. History holds 256 events, and no scenario exceeds that. The client's handling of `history_gap` is covered in the R06 partitions.

R02's browser half (TLS trust in a real browser), R06 in a real browser, and the R07 items not yet exercised remain C2.
