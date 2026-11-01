ROLE: WORKER
AGENT: native fresh-context reviewer
ID: T-442
Goal: Independently review the fixed-candidate Fanzloud portion of FN05 and the bounded AP proposal; later accept actual evidence in one focused followup.
Why: Candidate/download must bind exact immutable AP bytes without stale-selection/auth escape; candidate-only work must not claim FN05 reviewer completion.
Inputs to read first: AGENTS.md; platform/fanzloud/AGENTS.md; platform/fanzloud/SDD.md; platform/fanzloud/docs/specs/SPEC-M3-fixed-candidate.md; platform/fanzloud/docs/specs/PROPOSAL-M3-readonly-review.md; git diff.
Scope (may touch): Write only the assigned private review report outside product tree; read product diff, relevant tests/contracts and named evidence. No production edits.
Out of scope (must not touch): AP/Workforce implementation; old workers; credentials; model/VM/browser launches; network/Git mutation; recursive delegation. Do not rerun already-green tests or inspect private config secrets.
Definition of done:
- [ ] Source-bound findings identify correctness/security/spec gaps or explicit acceptance.
- [ ] Actual evidence is labelled pending until received; proposal remains awaiting approval and full FN05 incomplete.
- [ ] Report uses STATUS plus Summary/Verification/Documentation/Risks and Follow-ups, each verification one line ending passed/failed/skipped.
Verify with: Inspect actual source diff, supplied native/Web logs and receipts; compare source hashes; later inspect bounded actual artifact/download evidence. Source reads/hashing only, no test rerun.
Budget: One reviewer, <=15 active minutes initial and one <=5minute focused correction/evidence followup; no delegation. Unknown provider requests/tokens/cost; no new CLI/provider calls.
