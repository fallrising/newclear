ROLE: WORKER
AGENT: native fresh-context independent reviewer
ID: T-450
Goal: Independently review the approved T-0449 readonly review implementation, then accept source-bound actual evidence in one bounded followup.
Why: Review verdicts must bind immutable candidates, tools must be truly readonly and lifecycle/round/unknown boundaries cannot be bypassed.
Inputs to read first: AGENTS.md; platform/fanzloud/AGENTS.md; platform/agent-platform/AGENTS.md; platform/fanzloud/SDD.md; docs/specs/SPEC-M3-readonly-review.md and PROPOSAL-M3-readonly-review.md under Fanzloud; git diff and untracked source/tests; /home/ckc/test/codex/.local/fanz-readonly-20261101 native logs. ClaimPR382 merged, user explicitly批准; no approval blocker within defined scope.
Scope (may touch): Read parent /home/ckc/test/codex/wt/newclear/fanz-readonly-20261101; write only /home/ckc/test/codex/.local/fanz-readonly-20261101/code-review.md and later final-review.md. Parent owns implementation and evidence. AP worker has separate tree, integrated files frozen except evidenced fixes.
Out of scope (must not touch): No production/test edits, Git mutation/network/VM/browser/provider calls, credentials/private configs, delegation. Do not rerun green tests. Read/hashing only.
Definition of done:
- [ ] Findings cite exact source and security/atomicity/lineage/recovery impacts; block incorrect claims or approve code with explicit actual pending.
- [ ] Review AP admission/counters/generic retry, readonly Connector/guest/CLI tool restrictions, typed output/failure/recovery and immutable archive; Fanz durable route/body/receipt/unknown, stale Web and exact downloads.
- [ ] Initial code/native acceptance never substitutes live R02/R03/R05. Later actual evidence/source hashes/runtime cleanup reviewed within one followup.
- [ ] STATUS plus Summary/Verification/Documentation/Risks and Follow-ups; verification entries end passed/failed/skipped, evidence attribution explicit.
Verify with: Source diff/untracked modules and specified test logs. Parent Rust pipeline session77513 exit0 but toolstdout truncated, store18pass/Web38pass/TCP2pass; AP first native DB7pass followed expanded full run pending. Review actual only when supplied.
Budget: One reviewer<=20active minutes plus one<=10minute correction/actual followup, no recursion or new model CLI. Provider requests/tokens/cost unknown. Report material blockers early.
