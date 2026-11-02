# Truthful WorkItem detail — implementation evidence

T-0339 / BOARD HDTL. [Normative contract](../sdd/work-item-detail.md); [proposal](../plans/work-item-detail-20261102.md);
[plan review](work-item-detail-plan-20261102.md). Base `4a8b9e55` (#963). Local runs use the pinned images in
[reproducibility](../reproducibility.md); logs are kept outside the repository with the session handoff.

## Acceptance

| AC | Oracle | Result |
| --- | --- | --- |
| DTL-AC-01 | `TestWorkItemDetailHTTP_ScopeAndPrecedence`: IDX-01 matrix (anonymous, denied, query, force-query, HEAD/POST 405 with `Allow: GET`, dot/dot-dot, escaped, double slash, invalid item, body) with zero source reads before authorization; 404/503/capacity mapping, open wire and wrong-item wire rejected | PASS |
| DTL-AC-02 | `TestWorkItemDetail_TruthfulShape` on real SQLite/Fake/HTTP: review verdict/subject, the evidence fields above and every audit field equal their stored rows, human-report links, consumed Approval joined to its CompletionRecord, completion joins equal stored join rows. Stored NULLs (evidence without report, unconsumed approval, resolved and unresolved blocker, audit without before digest) in the storage tests below. Schema check (`python3 check-schema.py detail-*.json` from the worktree root, jsonschema Draft 2020-12 with format checking; script and the two captured responses kept with the session handoff): `PASS 13 WorkItemDetail schema fixtures (2 real responses)` — 2 real responses from the AC-03 flow plus 11 positive/negative variants; `PASS command payload and reused schemas unchanged vs origin/main` | PASS |
| DTL-AC-03 | `TestWorkItemDetail_AttributionAcrossItemsAndRework`: rework A→B to Done with required Approval on one item; fixture-only Review, Evidence and Approval on a second item left in Review. Each item's lists equal an SQL oracle over the audit chain; 3 reviews / 4 evidence / 1 approval and both Candidates on the first item; fixture-only rows only on the second; initial acceptance group on both; `ClaimDispatch`/`PublishRunObservation` only under their Run's item | PASS |
| DTL-AC-04 | `TestWorkItemDetail_AttributionCorruption`: unattributed review, unattributed approval and a subject attributed to two items each fail both items' reads with `storage_corruption`; a conflicting subject no row uses is harmless | PASS |
| DTL-AC-05 | `TestWorkItemDetail_SnapshotCapacityCorruption`: pinned read unchanged while an independent connection commits title, review and blocker; fresh read sees them; repeated reads leave every durable table, allocator and ledger unchanged; 1024 reviews pass and 1025 return `ErrWorkItemDetailCapacity`; control character in a blocker is corruption; missing project is masked not-found | PASS |
| DTL-AC-06 | Gates, review and delivery below | See below |

Red (`e9abecad`): the three HTTP/service oracles failed with 404 and ServeMux redirects because no route existed; the
lawful fixture flow itself completed. Mutations (each reverted): treating an orphan or conflicting subject as "not mine"
fails DTL-AC-04; removing the acceptance-binding audit rule fails DTL-AC-03.

## Gates

Source-bound on `82aa3b78` (pinned images):
- Backend `scripts/check-backend.sh` (mod verify, gofmt, vet, full tests, race, build): exit 0 in 725 s.
  `internal/application/service` race took 675.8 s locally while a review ran concurrently (rework round: 462.7 s),
  inside the 15-minute package limit; slower CI runners remain the main delivery risk.
- Web `scripts/check-web.sh` (format, lint, 30 tests, type-check/build): exit 0; web is unchanged.
- Redocly 2.51.2 lint: valid, 0 warnings. Docs: 163 local links/anchors, 53 success contracts, index preflight pass.

## Review

Claude plan review: [plan evidence](work-item-detail-plan-20261102.md). Independent Claude Code (claude-opus-5-5, read-only)
code review of `4d4301fb`: **ACCEPT**, 210.6 s, USD 2.061 list price (not billing). It traced every Review/Evidence/Approval
write path, runtime and acceptance audit groups, the refactors' preserved behavior, interceptor isolation, wire/schema
consistency and layering; no blocker or major. Five minors, all adopted:

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | No oracle for an unresolved (`NULL`) blocker | Snapshot subtest adds one and asserts `resolved_at` nil and ordering |
| 2 | AC-02 compared few fields; schema check not referenced | `TruthfulShape` compares evidence subject, AC revision, recipe, environment, verifier class/actor, report and human-report link, and every audit field, with SQL; schema command and output named above |
| 3 | Wire validator did not check completion-record order | Added `completed_at` then ID ordering check |
| 4 | Map iteration filled three digests | Three sequential parses |
| 5 | Gates/Review pending; BOARD `last_activity` stale | Filled here; BOARD refreshed |

## Notes

- The detail embeds the material index verbatim as `material`, so its validation, limits and cursor are reused.
- `DependencyRef`, `Approval`, `CompletionRecord` and `AuditEntry` were referenced only by the never-implemented shape
  and were removed (Redocly `no-unused-components`); command payload schemas are unchanged.
- SQLite does not import the command package: `ReadWorkItemDetail` receives `command.DecodeResultOwner` from the
  transport adapter, as `port.ResultOwnerDecoder`.
- Board and material-index behavior is unchanged: their row conversion and handler were extracted, not altered.
