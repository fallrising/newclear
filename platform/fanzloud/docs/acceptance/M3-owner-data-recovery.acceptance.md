---
id: ACCEPT-M3-OWNER-DATA-RECOVERY
decision: accepted
---

# Original-data candidate and offline verifier

[Scope/DATA01–03](M3-owner-data-recovery.md), [verifier contract](../specs/SPEC-M3-data-probe.md).
Owner continued after PR1077/1078. Base `b9109be632046d1da7c98db12c77214a11bdbc4e`.
This adds only an offline diagnostic verifier, tests, one existing-CI step and records;
no product routes, Rust/AP code, schema, store, credentials or live operation changes.

[Sanitized receipt](evidence/M3-owner-data-recovery/probe.json) preserves current results.
All112 Docker volumes still exist; no original containers/images existed at initial
inventory. Host reads were denied and sudo required an unavailable password. A locally
packaged installed static BusyBox helper used verified network-none/read-only/cap-drop-ALL/
no-new-privileges/resource-bounded profiles. UID999 found28 inaccessible roots; metadata
measured UID70 ownership before the selected-owner scan. No UID guessing, root capability,
permission mutation, external image download, PostgreSQL/AP/worker/provider/VM start.

Thirty PG directories:2major18,28major16. Only the two compatible major18 candidates were
scanned. One contains both known U07 run UUID texts, the other neither. Published artifact
hash text absent in this bounded physical scan is inconclusive. No raw rows/paths/credentials
are exported. A private snapshot of the matching candidate was captured twice through
read-only mounts; all69,191,168bytes have the same SHA256. This is two physical reads,
not a logical database integrity or restore test. Original volume not mounted writable.

The shipped Python verifier independently processes the retained tar without extraction
or SQL. Expected SHA, header/type/path/duplicate/count/size limits and major18 pass;
1488members,1074numeric relation files/28,696,576bytes, both markers present. It deliberately
returns **candidate_only**, with logical_restore_verified=false and runtime not_ready.
Source/archive private paths stay in the protected handoff; only counts/hash appear here.

## Tests and failures retained

```sh
python3 -m unittest discover -s platform/fanzloud/acceptance/owner-data-recovery -v
python3 platform/fanzloud/acceptance/owner-data-recovery/verify_snapshot.py ARCHIVE --sha256 DIGEST
python3 scripts/check_indexes.py
git diff --cached --check
git diff --exit-code
```

Initial skeleton import failed because implementation did not yet exist; not a behavioral
RED. First special-member fixtures mistakenly represented tar type bytes as ordinary file
contents: four subcases failed. Corrected tuple fixtures retain the same refusal assertions.
Then a real extended-metadata test failed: stdlib consumed a hidden PAX header before the
member loop. [RED15/1](evidence/M3-owner-data-recovery/red.txt) → early header/type/size
rejection → [GREEN16/0](evidence/M3-owner-data-recovery/green.txt). No assertion weakened.
Tests also cover hash/version/identity, outside-relation markers, split chunks, archive/
member/count/relation limits, traversal, duplicates, links/specials, malformed/truncated
archives, symlink input, no extraction and fixed CLI errors without private values.
The one CI addition runs these tests; all original workflow checks/permissions remain.

## Acceptance status

| AC | Outcome | Limit |
| --- | --- | --- |
| DATA01 | Located compatible physical candidates with bounded read-only observations | Host observations require lead evidence; no original-volume deletion conclusion |
| DATA02 | Matching private snapshot retained;17tests and actual archive verifier passed; concrete isolated-copy proposal documented | No logical recovery/SQL/server test; dead tuples/compression remain possible |
| DATA03 | Local checks and independent review accepted; CI/merge/readback pending | Original M3-U/FN07 remains open; only this bounded investigation may close |

No browser/Rust/AP live suite rerun locally for this standalone offline tool. Hosted
existing checks remain gates. Native backup verification and private capture are not
whole-product or owner acceptance. No private archive or dump is committed.

All six owned diagnostic containers exited0 and were removed by exact ID without -v;
the single generated BusyBox image was removed. The112 original volume names still
match the initial inventory exactly. Private snapshot remains retained; no prune or
original-volume deletion. Diagnostic process launches are not PostgreSQL/AP starts.

## Independent review correction

Initial independent review REQUEST_CHANGES: P1, the stdlib reader stopped at the first
zero header and the final1024-byte check failed to reject trailing junk/appended members.
All16 earlier tests passed, so new regressions were required. The reviewer reproduced
an unsafe appended member, nonzero junk, and a single-zero terminator followed by a member.
[Behavioral RED](evidence/M3-owner-data-recovery/trailer-red.txt):17tests,3failing subcases.
The verifier now records the final validated padded member end, requires at least1024
remaining bytes, and checks the entire remainder is zero. [Final GREEN17/0](evidence/M3-owner-data-recovery/final-green.txt);
actual private snapshot still gives the same candidate_only counts/hash. No assertions
were weakened. Focused independent re-review remains pending at this checkpoint.

Raw test logs are retained privately; public logs normalize only the workspace prefix
and trailing whitespace. The first staged-whitespace check found one unittest subcase
line trailing space; normalized before final checks, without changing result content.

## Final independent decision

Focused re-review **ACCEPT**, no remaining blocking findings. Independently ran17tests,
all3trailer regressions and the actual private snapshot through only the reviewed verifier:
matching SHA/counts/bothmarkers, candidate_only and logical_restore_verified=false.
No raw archive inspection/extraction.55project/9llms indexes,14staged paths,165relative
links, source/test SHA256, staged whitespace/alignment and private-path inspection pass.
Reviewed verifier SHA256 `6c42888f67000d431af0fb351e8cdb9b7655825e0ce63c2320db4e2fedf20b0e`;
tests SHA256 `61cf22fb733750f6ef43d60fe477c030286745a906a7c302f427da821a083345`.
Lead accepts the bounded tool/document set after inspecting the actual report/results.
Host/Docker inventory, captures and cleanup remain lead evidence; reviewer performed
no Docker/service/provider operation or logical recovery. Required hosted CI/normal
merge/readback and board-only closure remain delivery gates at this source checkpoint.
Original M3-U/FN07 remains open; acceptance of this diagnostic is not restore acceptance.
