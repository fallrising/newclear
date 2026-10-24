# Issue548 — lifecycle admission follow-up

Scope: first-party nested observer/reap race, synthetic causal proof and reviewed
bounded admission/completion design. Preserve existing ownership/identity/deadline
guards, original release/fixture, report shape and failed receipts.

AC-L1: deterministic short-lived nested command and double-fork counterexamples
with fixed-role numeric generation correlation. AC-L2: root technical review of
the proposed mechanism before production changes, then meaningful RED/GREEN with
cancellation/reuse/unknown-orphan/late-child/cleanup negatives. AC-L3: all existing
290 offline tests and exact-source bounded original-runtime verification after
coordination; never infer real runtime success from synthetic tests.

No ignore/retry/assume-leaf/death-only ownership proof; no staging, commits,
GitHub, live accounts, privileged containers, upstream changes or delegation.
Root handles publication and final acceptance. First checkpoint is causal/design
only, before any production protocol implementation.

T066 continuation: implement T065 Resolved contract after root technical ACCEPT.
Only trial.py/trial_integration.py/new trial_supervision.py and direct tests are
production scope. Preserve generic Process/Capture and public/manual behavior.
Parent-after-owner-exit clean commit is mandatory; real runtime remains forbidden
until independent review. First20-minute checkpoint records RED/GREEN and gaps.

Approved verification-only addition: the existing resource sampling test uses
four full intervals and asserts four scheduled slots after baseline/candidate
timing failures established its truncated final-slot budget. Production resource
timing and prior assertions remain unchanged. Root T069 owns the separately gated
actual M7 trial, sanitized report/source evidence, publication and final acceptance.
