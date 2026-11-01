# M2: two actual vendors and isolated tasks (T-0442)

Owner instruction 2026-11-01 implements approved SDD M2 / ADR-0008, without changing
FN acceptance. M1 evidence stays pinned; old CloudAC04 and M3/AC05 remain pending.

## Contract units and machine acceptance

- M2-01 (FN02): same isolated Web catalog selects registered Claude or Codex subscription
  profiles. Trusted pinned official CLI only, official personal login, no API fallback.
  Route receipt binds binary/version/model/source/auth kind/tools/AP run/generation/base.
  Gate Codex before coding: prove supported tool/credential separation. No prompt-only
  restriction, no fake adapter or second model of same vendor as acceptance.
- M2-02 (FN01/02): each vendor executes a bounded repair through existing AP authority,
  produces actual statuses, fixed-base diff and required passing checks; downloaded bytes
  and SHA256 equal AP result. Existing Claude M1 receipt remains valid for unchanged code;
  any changed shared path needs proportionate regression. Mock/CLI capability/live distinct.
- M2-03 (FN03): two simultaneously present VM/workspace IDs have independent state,
  markers and results. Actual traversal/cross-workspace/secret canary/network denials,
  no credentials in workspace; cancel A leaves B usable, both finally removed with claims
  and owned processes checked. Sequential M1 is insufficient. No extra VM authority.
- M2-04: confirmed accepted submission unlocks the form for a separate explicit task.
  Each action/result stays bound to its run; selecting another run cannot show stale data.
  Unknown submission locks submission across reload; zero auto-resend. No M3 intent store.
- M2-05: default fail closed for missing/unqualified route, wrong version/binary/auth,
  unavailable required tools or unconfirmed CLI outcome. AP leases/deadlines/cancellation
  remain sole authority. Never restart uncertain CLI. Unknown usage stays unknown.

## Archetype answers

Security: CLI auth stays trusted; only run/generation-bound MCP reaches guest. No host
shell/file/image/browser/delegation/secret tools; qualification must prove their absence
or an equally enforced existing remote execution boundary before admission. No new runtime
dependency without explicit approval. Atomicity: existing AP job/lease owns execution,
no Fanzloud scheduler. Retry: no automated CLI retry/resume or uncertain tool resubmission.
Recovery: existing AP observation/cancel only; durable Fanzloud intent/run/result is M3.
Failure: typed reason, result and cleanup independent; failed/unconfirmed never success.
Cancellation: existing AP action/version fence, process stop, run-bound connector release.

## Limits and verification order

Estimate120–180min active plus CI;20min progress checkpoints; same defect initial+max2
justified diagnostic/fix attempts, Codex qualification once+max1 justified correction.
Single coding invocation<=600s. Host remains max1 VM4CPU/4GiB, zero warm; do code and
single route first. TwoVM experiment must receive separate explicit bounded resource
approval before allocation. Preserve all failed evidence; same green source not rerun.
Stop affected route for unsupported separation, missing login, secret exposure, new cost,
unknown launch, exhausted retries or unsafe host capacity. Do not substitute fake success.

Focused tests precede production changes: catalog/admission/route dispatch, CLI outcome
and forbidden tools, concurrent selection/stale-response/unknown refusal; existing AP
lifecycle tests and required Rust/AP checks. Live harness uses actual Chromium HTTPS Rust
AP Connector VM; mock projection tests separately named. Independent fresh-context review,
required CI and evidence audit precede acceptance. Retain source/run/tool/diff/check/cleanup
receipts; no private host/account/secrets in public artifacts. M2 NOT_RUN at creation.

## Qualified mechanism selected after source/fixture audit

Candidate uses official Codex0.166.0 app-server (binary SHA256
b8a11fedf24b2dfb59a70c9e52b030f9a508dcd49cd2dd0d41956f4c785156b8),
model gpt-6.1-sol with byte-pinned unmodified official model metadata. Official
`thread/start` and every `turn/start` carry `environments: []`; no resume/fork.
Three official dynamic tools dispatch to existing `Bridge.call`, preserving its UUID,
fingerprint, generation, closed-on-unknown and VM-only contract. App-server retains
its agent loop and official personal ChatGPT auth on the trusted host.

Enforced absent environment, not name suppression alone, blocks built-in apply_patch.
Code Mode is the pinned model's normal V8 execution surface: no Node/fs/network; only
registered callbacks. Disable shell/view_image/browser/computer/image-generation,
apps/plugins/hooks/remote plugins, implicit skills, and native delegation including
`features.multi_agent_v2={enabled=false,disable_native_tools=true}` (model metadata
can override the plain feature boolean). Disable all inherited MCP servers and verify
MCP status empty before the turn. Unexpected effective config/model/catalog/tools fail
closed. Pin catalog bytes; metadata cannot silently change the accepted tool surface.
Control prompts/config are trusted and separate from repository inputs.

One local synthetic Responses fixture observed actual binary denial of direct shell,
patch/image and nested patch/Node/file import/media path calls, empty MCP resources,
no host marker and successful inert dynamic tool. This is NOT a live provider receipt.
Initial fallback-model fixture was insufficient; exact model metadata required Code Mode
and exposed native delegation until the documented disable_native_tools correction.
Those earlier receipts remain preserved. Live coding is gated on this contract and
native adapter tests; no claim that version/help or this mock proves FN02/FN03.

AP admits backend `codex-subscription`, model_ref `codex-subscription:gpt-6.1-sol`,
same command-verification/deadline<=600 constraints as Claude. Workers select only the
matching injected driver; a Claude-only worker cannot claim Codex, and vice versa.
No recovery may relaunch either subscription driver. Exact schema migration/backup
constraints update with this additive backend; no scheduler or lease semantics change.


Review corrections before live execution: create a private ephemeral Codex HOME and
CODEX_HOME outside repository ancestors, with only a symlink to the existing official
ChatGPT auth file (no secret copying or API exchange). Launch with an allowlisted
environment and explicit official endpoint/no notification/no implicit skills or
plugin prefetch. Refuse system/project startup configuration. Audit merged config
before thread creation, without logging its contents. Delete ephemeral CLI state on
exit, retain redacted protocol receipts. This prevents ambient extensions from starting
before the RPC audit; absent execution environments remain the tool boundary.

Native backup admission also preserves exact completed queued-cancel proof and the
same confirmed real binding/released-reservation proof for both subscription backends.
No unresolved cleanup, generation mismatch, or unknown operation is admitted.
