# T-0351 PP1c root review — PARTIAL

Reviewed T1101 actual two-document diff and report against the approved parent e3d0c3f and original14findings. Root independently checked six full approved media/session paragraphs byte-for-byte. New logical LeaseV2/journal/proof/handshake/CLI/typed inventory changes are explicitly DRAFT proposals;39-card ownership splits do not constitute measured implementation size. No product changes or runtime tests belong to this docs branch.

Accepted as a reviewable correction checkpoint, not as DOC_READY: the prior media/session policy and v1 compatibility omissions are corrected, error authority is centralized, exact card paths and ownership/dependencies are made reviewable. T1101 remains PARTIAL, including its failed full-implementability condition and skipped product execution. Report schema passes; no worker assertion substitutes for runtime/CI.

Remaining blockers D01 physical helper/image/UID/mount/argv vectors, D02 complete raw comparison receipt, D03 browser/socket/receipt/named mutation deltas are real design gaps. Logical schemas cannot prove that the source adapter runs. D01 also depends on the separately pending owner PP1a tooling exception. Until these are specified and independently reviewed, do not approve the full protocol or authorize product cards. D03 must explicitly reconcile browser-created sessions/audit/content with the zero startup-delta rule, without ignoring entire tables.

Root review checked the new revoker handshake retains one PID while rolling back its read-only preflight before starting the write transaction, distinguishes pre-commit rollback from unknown commit, and uses the unchanged parent receipt. Proof self-hash excludes its own property; canonical byte policy does not migrate v1. These checks find no additional blocker beyond the explicit unresolved contract inputs in this bounded checkpoint; they are not a full implementability approval.

Next: owner tooling decision, PP1b runtime qualification, then bind D01 to observed approved tools and make D02/D03 concrete for final design review. Preserve PR333 Draft; no SDD merge without necessary owner approval. No PP1c build or restore was run.
