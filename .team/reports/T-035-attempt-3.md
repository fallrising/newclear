STATUS: PARTIAL

## Summary

DG-W2-20260923-01; T035 revision3/attempt3. Uninvolved T036 F01–F03 require object-specific maintenance eligibility/impact, approved work discovery and canonical kind/risk/unit delta triage. Lead corrects in newclear-dim-gate-w2-closeout / agent/dim-gate/task/t035-w2-closeout baseda05491c. Full contractrevision3 is fixed before implementation; no AC reduction or new persisted schema. All earlier attempts remain.

## Verification

- Fixeda05491c native314/29files, lint/typecheck/docs/contracts/CI/architecture/build/actionlint/diff — passed
- Reviewer F01 sufficient object scope blocked by unrelated hidden allocation; canonical command succeeds201 — failed
- Corrected working diff: frozen offline install, typecheck/lint,321unit/29files,docs171/404,contracts91/210,CI/architecture and demo build — passed
- Corrected fixed browser/performance/full regression/follow-up review/latestheadCI — skipped

## Documentation

PLAN DG-D067 records REWORK and sole shared-file owner; W2contract revision3 specifies per-object DTO and current policy behavior. Current SDD/README status headers are synchronized without removing historical reports.

## Risks and Follow-ups

Source now includes shared policy object eligibility, filtered object-only consumers, overlapping phase membership and typed triage summary. Domain/HTTP tests prove sufficient scope, hidden affected consumers/no pool denial, stale proposal revocation, approved Request/Change phase inclusion, +2048MiB resize, signed shrink, zero-demand bind, Kafka multiunit demand and unknown historical baseline. New browser assertions exercise these on visible UI; execution pending. The initial new HTTP test used the wrong client helper name and typecheck rejected it; corrected to the existing revokeAssignment before the passing gate. Preserve capacity and hidden consumer redaction. Freeze correction, complete fixed gates and uninvolved review; latest-headCI, authorized merge and actual closeout precede W3.
