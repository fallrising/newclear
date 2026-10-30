# T-0442 P0 browser-to-Cloud mainline

Intake start was not timestamped; first recorded plan checkpoint 2026-10-30T03:16:44Z. Claimed via desk PR314 at03:16:17Z. Estimate 90–120 minutes active work plus bounded build/CI/provider waits; checkpoint each 20 minutes. Provider/token/cost counts unknown, native agent starts recorded in handoff. No hard tool-call cap.

Outcome: one real Chromium operator journey through the actual Rust binary, first with T007 fake executable (AC-01), then same source with pinned official CLI/live Cloud (AC-04). AC-05 remains outside this milestone; identify its next smallest slice only.

Order: document scope → bounded harness worker → build/run real Rust/Chromium fake gate → same-source live preflight/execution if ready → independent acceptance → CI/PR/merge/readback → ledger/journal. Root owns integration, mainline docs and all external actions. Worker owns only new acceptance harness files in separate worktree; no recursive delegation. No frontend redesign, Node API fixture, provider version relaxation, release/public deployment or extra paid service.

First executable acceptance: authenticate via rendered page over private trusted HTTPS, confirm logged_in, submit once, observe WebSocket lifecycle and Ready, click Show diff, verify exact synthetic diff, refresh/reconnect without resubmit, logout. Concrete Rust production composition and strict T007 shell fake only; no intercepted API or patched browser transport. Capture sanitized boolean/count evidence and source identity.

Live: exact codex-cli 0.145.0, validated private scope, administrator-selected environment/branch, existing authenticated home and private HTTPS. One attempts=1 submit, bounded 10-minute observation, one final diff read, no apply/push/retry of unknown submission. Missing prerequisites remain not-run; no substitute evidence. Only nonsecret gate/status metadata persisted.

Checks: focused harness assertions, actual browser run, required component native CI and project indexes on final source; fresh independent document-driven acceptance. Same-source green checks not repeated without relevant change. At most two reasoned repairs per reproduced failure. Build/CI wait <=10 minutes each before recording exact status. Review required before acceptance.

## 2026-10-30T03:30Z checkpoint

AC-01 real-browser/Rust/fake gate passed: one submit/status/diff, accepted→pending→ready, exact displayed diff, explicit Refresh/reconnect, logout invalidation, zero browser/request/unexpected HTTP errors. fake-001 failed precondition before any product action because Cargo artifact mode was0775; same bytes copied mode0500 and fake-002 passed in4.745s. All owned resources removed. No production code/UI/dependency changed. Root reviewed worker diff and accepted harness implementation; worker PARTIAL report retained (runtime was root-owned). Native 307Rust/10controller/fmt/clippy/build passed, no repeat needed on unchanged production source.

Official pinned CLI acquired from official release and verified by digest/version/help; default CLI not substituted. Live missing valid private home/config/target. One concrete setup/target/prompt question is pending after independent fake work completed. No Cloud task submitted, no extra paid service. AC-04 and overall T-0442 remain in_progress. Independent review/CI/delivery still pending.

## Acceptance decision

Fresh-context native reviewer ACCEPTED the bounded implementation and AC-01 evidence with no blocker; verified88 hashes/binary/embedded assets/WS/diff/cleanup/native logs and independently ran2 harness tests. Root evidence-gate accepts AC-01 only. AC-04 skipped for missing private operator input, so T008/T-0442 remain in_progress. Required hosted CI remains a merge gate. Additional report-format/index-enum diagnostics were repaired without runtime changes; historical failures retained.
