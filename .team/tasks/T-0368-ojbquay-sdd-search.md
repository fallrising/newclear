ROLE: WORKER
AGENT: native independent search worker
ID: T-451
Goal: Read-only GitHub provenance search for Ojbquay/ddmq SDD in unindexed active repositories fallrising/Zircon-Godot and fallrising/magpie.
Why: Complete owner-requested active-repository coverage without treating empty index results as evidence.
Inputs to read first: workspace AGENTS.md; latest desk origin/main docs/operating-method.md; existing backup owner-retained T-0368 provenance backup README. Existing repair tree must remain untouched.
Scope (may touch): Only docs/project-success/evidence/ojbquay-sdd-20261022/unindexed-search/ for exact nonsecret tree metadata, relevant document excerpts and report. Product repos remote are read-only. Use gh api GET if connector lacks tree capability.
Out of scope (must not touch): All code, tests, other evidence, .team/PLAN.md, Git mutations, external mutations, credentials, runtime services. Do not clone or download entire huge repositories. No recursive delegation, model CLI or paid model calls.
Definition of done:
- [ ] Resolve default-branch complete SHA, complete recursive tree (explicit truncated false or expand subtrees), count entries and candidate documents.
- [ ] Search path names and read project README plus relevant first-party docs/specs for ojbquay, ddmq, SDD, ProduceDelay, retryIntervals, __ojbk.delay.inbox. Separate unrelated acronym hits.
- [ ] Report exact examined paths, queries, failures, limitations and whether normative Ojbquay SDD found. Avoid claiming exhaustive historical search.
Verify with: Saved API metadata/tree and document digests; read-only report with STATUS, Summary, Verification (passed/failed/skipped), Documentation, Risks and Follow-ups. Return exact source refs and evidence paths.
Budget: 25 minutes, one full inspection and at most one evidence-driven retry per failed API request; no recursive agents.
