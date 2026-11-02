# Truthful WorkItem detail — implementation evidence

T-0339 / BOARD HDTL. [Normative contract](../sdd/work-item-detail.md); [proposal](../plans/work-item-detail-20261102.md);
[plan review](work-item-detail-plan-20261102.md). Base `4a8b9e55` (#963). Local runs use the pinned images in
[reproducibility](../reproducibility.md); logs are kept outside the repository with the session handoff.

## Acceptance

| AC | Oracle | Result |
| --- | --- | --- |
| DTL-AC-01 | `TestWorkItemDetailHTTP_ScopeAndPrecedence`: IDX-01 matrix (anonymous, denied, query, force-query, HEAD/POST 405 with `Allow: GET`, dot/dot-dot, escaped, double slash, invalid item, body) with zero source reads before authorization; 404/503/capacity mapping, open wire and wrong-item wire rejected | PASS |
| DTL-AC-02 | `TestWorkItemDetail_TruthfulShape` on real SQLite/Fake/HTTP: review verdicts and subjects equal stored rows, human-report links, consumed Approval joined to its CompletionRecord, completion joins equal stored join rows. Stored NULLs (evidence without report, unconsumed approval, resolved/unresolved blocker, audit without before digest) in the storage tests below. Schema check: 2 real responses and 11 variants against `WorkItemDetail`; command payload, `WorkItemSummary` and `WorkItemMaterialIndex` schemas equal `origin/main` | PASS |
| DTL-AC-03 | `TestWorkItemDetail_AttributionAcrossItemsAndRework`: rework A→B to Done with required Approval on one item; fixture-only Review, Evidence and Approval on a second item left in Review. Each item's lists equal an SQL oracle over the audit chain; 3 reviews / 4 evidence / 1 approval and both Candidates on the first item; fixture-only rows only on the second; initial acceptance group on both; `ClaimDispatch`/`PublishRunObservation` only under their Run's item | PASS |
| DTL-AC-04 | `TestWorkItemDetail_AttributionCorruption`: unattributed review, unattributed approval and a subject attributed to two items each fail both items' reads with `storage_corruption`; a conflicting subject no row uses is harmless | PASS |
| DTL-AC-05 | `TestWorkItemDetail_SnapshotCapacityCorruption`: pinned read unchanged while an independent connection commits title, review and blocker; fresh read sees them; repeated reads leave every durable table, allocator and ledger unchanged; 1024 reviews pass and 1025 return `ErrWorkItemDetailCapacity`; control character in a blocker is corruption; missing project is masked not-found | PASS |
| DTL-AC-06 | Gates, review and delivery below | See below |

Red (`e9abecad`): the three HTTP/service oracles failed with 404 and ServeMux redirects because no route existed; the
lawful fixture flow itself completed. Mutations (each reverted): treating an orphan or conflicting subject as "not mine"
fails DTL-AC-04; removing the acceptance-binding audit rule fails DTL-AC-03.

## Gates

PENDING

## Review

PENDING

## Notes

- The detail embeds the material index verbatim as `material`, so its validation, limits and cursor are reused.
- `DependencyRef`, `Approval`, `CompletionRecord` and `AuditEntry` were referenced only by the never-implemented shape
  and were removed (Redocly `no-unused-components`); command payload schemas are unchanged.
- SQLite does not import the command package: `ReadWorkItemDetail` receives `command.DecodeResultOwner` from the
  transport adapter, as `port.ResultOwnerDecoder`.
- Board and material-index behavior is unchanged: their row conversion and handler were extracted, not altered.
