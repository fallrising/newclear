# Expired export availability in the workbench

Issue #379, bounded UI correction after PR655. Baseline0b4e42d9cd27e4d4ede935f0a09c992c42fa58a7.
Actual prior BGC integration observed an expired approval leaving stale archive and
approval controls until a separate failed download. Preview has the same missing
refresh path. This slice fixes that observable state, not backend GC or authority.

## EUX-01

When export preview or explicit approval receives exact ApiError410 artifact_expired,
the selected immutable artifact is immediately known unavailable. Remove its download
and new-export controls, discard its stale preview, show expiry while retaining
summary/diff/archive identity/hash/size. Revalidate only the originating run's artifact
query prefix, including state-version variants. Preserve known expiry if refresh fails;
do not invent server pruned_at/timestamps or remove metadata. A late response from
run A must not expire run B. Backend idempotency/authorization/export contracts unchanged.

## EUX-02

401 keeps existing session refresh behavior; preview401 should refresh consistently.
Other410/error codes,409,network loss and transient failures do not mark expiry, hide
valid actions or reset the approval's PendingCommand. Same payload retry after lost
ACK keeps its key. Reconciliation remains independent and read-only; no implicit
approval or export dispatch. No backend/schema/dependency/workflow change.

## Verification

Tests first: actual App/ResultArchive/ExportPanel render with controlled API errors;
root preserves genuine failing behavioral assertions on unchanged product before
implementation. Cover preview and approval expiry, failed/stale refetch, correct
run isolation and non-expiry/auth/retry boundaries without testing implementation
callbacks alone. Then root runs focused new/affected web tests, typecheck/format/build,
and the updated one BGC Playwright scenario against real PostgreSQL/API/GC/fakeHTTP.
B stale approval now updates without a second failed download; direct artifact410
and no-file/no-export/result-preservation checks remain. Prior independent download
expiry evidence is retained, not deleted or replayed merely for counts.

New changed-source web assets must be rebuilt and bound to tested source. No old
Python700/756/OC/native or unrelated browser suites rerun locally. Independent review,
project contracts/index/diff, required hosted CI and normal merge gate delivery.
Full fake fault matrix/liveAT09/12/13/VMrecovery/deployment/M4 remain open.
