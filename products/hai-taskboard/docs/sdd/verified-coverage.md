# Authenticated verified coverage

Status: **Owner accepted on2026-11-01**, following Claude plan REWORK→ACCEPT and explicit D1–D3 approval.
Task T-0339 / HM2C; baseline98b95de288d42aa72bd074a6c3f593dd98144e29.

## Normative contract

The [reviewed and now approved contract](../plans/m2-verified-coverage-20261101.md) sections
COV-01, COV-02, COV-03, COV-04 and “Follow-up precision conditions” R1–R7 are normative by reference.
Their exact route, closed response, phase/subject mapping, all-matches evidence predicate, bounded
artifact verification, shared eligibility, two-stage/two-snapshot reads, cursor, error precedence,
no-allocation/no-write rule and deterministic bounds apply without reinterpretation.
The proposal's “Decision and review boundary” records the decision input; the owner has approved it.

D1 adopts the dated V1 Accepted/Fresh mapping in [domain gates](domain-and-gates.md).
D2 supports Review prospective coverage and QA current eligibility, without simulating a transition.
D3 distinguishes unknown I/O503 from definite unavailable material in this GET, preserving command errors.
No UI, runtime dependency, migration, real executor, activation, backup/restore, release or deployment.

## Fixed acceptance and named tests

COV-AC-01..06 are fixed as in the approved contract. Before production implementation, add compiling
named skeletons and retain meaningful Red. New interfaces may need compile stubs; name that exception.
HTTP: TestVerifiedCoverageHTTP_AuthScopeAndWireContract.
Core/integration: TestVerifiedCoverage_ExactSubjectAndProjectPolicy,
TestCoverageProjection_MatchesCurrentDonePredicate, TestVerifiedCoverage_NoWritesOrAllocatedIDs,
TestVerifiedCoverage_RevalidatesAfterExternalIO.
Every row starts NotRun and advances only with visible source-bound test evidence. Required gates:
focused tests, native backend format/vet/full/race/build, web regression, pinned OpenAPI lint,
project/index/document validation, Claude code review, exact-head CI/merge/readback.

## Implementation boundaries

Service exposes DescribeVerifiedCoverage(context, actor, project, item, candidate) ([]byte,error),
with no caller subject/policy input. HTTP adds a narrow optional VerifiedCoverageService interface.
Cursor wire keys are stream_epoch/event_sequence. Stage-2 material and cursor share each transaction.
Root owns HTTP/OpenAPI/spec/integration acceptance; one isolated native worker owns application/domain/
SQLite/local artifact core and its tests. Both use this contract; worker cannot change acceptance or Git
authority. Old preparation and commands preserve their existing API/error/replay contracts.


## Observation and command headroom

Version headroom is not a domain eligibility predicate. QA may observe MaxInt64 with satisfied=true;
command ingress still rejects that exhausted version. Review permits actual MaxInt64-1 with prospective
MaxInt64; a larger prospective value is invalid. This follows the SQL-safe observation contract and
never grants command acceptance. The command/preparation schemas and validation retain their existing
headroom bounds; VerifiedCoverageSubject is the separate observation schema.
