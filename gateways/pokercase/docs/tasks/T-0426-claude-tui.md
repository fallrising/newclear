# T-0426 — Approved interactive Claude transport

Owner2026-11-01 explicitly selected option A: genuine Claude TUI with magpie-style preload response tap and incremental output. This supersedes the prior pendingCT3; claim351 merged before implementation. Existing core17AC text remains historical, with this approved transport extension superseding AC10's print-only transport selection. No credential/protocol spoofing, permission bypass, new dependencies or live quota experiment.

## Scope/design

Server defaults to `--claude-mode tui` on supported Unix; `--claude-mode print` explicitly selects the existing adapter. Unsupported platforms or unavailable/incompatible TUI/tap return clear errors, never silently switch mode. `--claude-bin` still selects the official executable. Internal `claude-tui-helper` owns PTY, exact session correlation and private response-tap files. Existing gateway tools/MCP, output conversion, attempt accounting, cancellation, live runs and shelf remain the shared lifecycle. Never infer cache savings/native live acceptance from transport selection.

The preload observes selected original main-response events through Bun.FetchSession and forwards them as existing stream-json; it does not change request bodies, headers, TLS, auth, entrypoint identity or model. Strip inherited loader/session markers, install only the owned tap; preserve official system prompt and strictMCP/defaultpermissions. No transcript-only fallback posing as incremental streaming. Read only the exact selected session transcript, no unrelatedprofile enumeration. Refuse login/onboarding/untrusted-directory prompts instead of answering for the user. Base64 images use bounded privateowned files; never add unapproved remote imagefetch. Signals/EOF/cancel must stop and reap the owned PTY group and clean onlyowned files.

## Fixed acceptance

| ID | Given / When / Then |
| --- | --- |
| TA-1 | Server default and explicit print selection select distinct transports; original print behavior remains independently tested; selected TUI cannot fall back to print. |
| TA-2 | Actual synthetic PTY child receives interactive args and safe input, exact model/tools/settings/session; no print flag, bypass, inherited injection or secret-bearing diagnostics. |
| TA-3 | Partitioned main-response events reach the client before completed transcript output, preserve raw usage/toolIDs/results and do not duplicate; missing/cut/incompatible tap cannot become successful complete output. |
| TA-4 | Multi-turn/MCP/native-resume interfaces and three client protocols remain wired; owned child/descendant cleanup, cancellation/error settlement and private files remain bounded and isolated. |
| TA-5 | Focused RED/green, native regression suites, independent review, requiredCI/normalmerge/readback, ledgers, completebackup and ownedcleanup have visible evidence; prior live gap and unknown subscription savings remain explicit. |

## Verification plan

Old source must fail a focused new transport admission/helper test for the intendedmissing capability; then run synthetic PTY/tap and actualgateway cases. No realCLI/provider/profile/privateDB, Docker or new dependency. Existing print tests explicitly selectprint rather than accidentally exercising TUI. Full locked Rust1.99tests,fmt,Clippy,build; relevant existing Python/journeys; repo contracts/indexes/tests. Keep failed/skipped evidence and use synthetic protocol rather than fabricated productcacheRED. Previous sixadmissions remain exhausted. Live TUI/version/account behavior and actual quota savings are unverified. Mainlineincomplete,usable_tagnone.

## Implementation and local verification

Implemented default interactive mode plus explicit print compatibility, response-only Bun tap, single active observed message stream, raw usage forwarding, fixed401/429 and transport failures, bounded private files and PTY/watchdog cleanup. The official child retains5s polite termination grace; TUI helper wait6s and gateway shutdown7s allow cleanup to complete. A native completed turn with no observed response fails after a1s observation-convergence allowance; this does not impose an active generation timeout. No transcript-generated success or print fallback.

Focused old-selector RED was followed by final432Rusttests/25groups (including10gatewayTUI and12transport tests),199Python tests, fmt and Clippy with warnings denied. The TUI tests cover all three client protocols, incremental output before completed transcript, actual MCP callback and same-child continuation, synthetic saved-session restart, raw usage, missing/cut/unobserved response, delayed observation, normal grace, hard helper death, descendant/private-file cleanup and unrelated-file preservation. Node tests verify original request/response/rejection identity, split UTF8/CRLF, bounded fatal signaling and redacted knownHTTPstatuses. Independent code review accepted the final helper/tap hashes.

Retained failures: sccache environment denial; one stale shared-target executable rejected and rebuilt; missingtap test deadline initially shorter than productionreadiness; an existing fixture-startup listener-rebind assertion failed in the first full suite, exactretry and finalfullsuite passed with the test unchanged, cause unknown. Failed runs are retained separately. New tap/lifecycle issues found in review were corrected before acceptance. Offline journeys, repository contracts, remoteCI/normalmerge/readback and finalledger/backup/cleanup are recorded separately as completed, never inferred from this local result.

This implements the approved core transport. Real official-CLI compatibility, session reuse and subscription savings remain unverified; six prior admissions remain exhausted. Original17AC history and mainline incomplete/usable_tagnone are retained.


Local delivery gate: locked build; retained generic HTTP, named HTTP, Claude print, buffered CLI and process-recovery walkthroughs all passed with the preserved current binary. Repository success contracts, indexes,20validator tests and diff check passed. Buffered-CLI first invocation omitted its required existing contract argument; that harness error and clean teardown are retained, corrected invocation passed. The original17AC rows were compared byte-for-byte with the source baseline and remain identical. RemoteCI/normalmerge/readback and finalledger/backup/cleanup are still pending at this product-commit checkpoint.
