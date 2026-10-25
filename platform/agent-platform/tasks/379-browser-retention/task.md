# Browser retention/export composition

Issue #379, test-only acceptance on PR653 merge ada118988b909c6aa826a76da8939e1ec7451432.
No product defect or artificial RED claimed. Existing independent coverage remains valid.

## BGC-01

One owned PostgreSQL/API/fake GitHub cohort, two authenticated browser pages. First
INSERT explicitly synthetic historical terminal never-allocated runs A/B, canonical
archives aged31days and A event identities/prefix aged31days plus recent suffix.
Use unknown verification, coherent result/hash/base, generation0 and no jobs, bindings
or adapter operations. No immutable trigger bypass, timestamp UPDATE or fixture reset.

Browser A freshly approves its export before actual event/archive preview/apply.
Ownership manifest binds DB identity, cohort, labels and hashes; reject unexpected
candidates before destructive apply. Event GC prunes only A prefix; archive GC
prunes only unreferenced B while A export reference protects its payload. Release
A real paused events request to receive410, snapshot and suffix; preserve result,
archive hash and queued export. Replayed approval remains one operation. Actual
ExportWorker over synthetic HTTP creates exactly one branch/Draft PR; idle redispatch
has no effects. Reload preserves final state. No synthetic HTTP responses replace API.

## BGC-02

B holds stale preview/approval/download controls before GC. After GC stale approval
and download return410 artifact_expired, create no export or remote mutation, and
download-error refetch hides archive/export controls while preserving result/diff/hash/size.
Do not assert automatic control removal from approval failure alone: current UI only
refreshes auth errors there. Reload confirms expiry. Assert receipts and authority/result
facts throughout; parameterized owned identifiers, fail closed on cohort mismatch.

## Verification and boundaries

One new Playwright file, exact-source fixture with verified unchanged web assets and
cached tooling; root-owned PostgreSQL runner and finally cleanup. Scoped Python/TS
static checks, project contracts/indexes/diff, independent source/evidence review,
required changed-source CI and normal merge. Preserve all genuine failures.
Real UI/auth/TCP API/SQL/GC/export HTTP, synthetic imported history/VM/model/GitHub.
No real31day worker lifecycle, liveVM/provider acceptance, complete fake E2E/AT09/12/13
or fullM4. No audit/native/lostACK or unchanged long-suite replay, deployment/release/tag.
