# Phark R2 M1–M3 implementation evidence

Status: **Candidate verified for original R2 M1–M3; parent independent review, current-head CI and publication pending**. This is the approved dormant-component FE review exception, not restored product investment, usable qualification, production durability or completion of product AC04. Native/backend/security/API/dependency behavior is unchanged.

## Implemented scope

- Review-only fresh-state/API fixture retains real Spring sessions, CSRF rotation and default quotas. Two random synthetic accounts, four posts, one generated PNG, cross-account reply/like/repost, actual notification/cursor/profile/search/report IDs. Existing nine anonymous bootstrap posts remain intact. Credentials/cookies/HMAC/raw service logs/SQLite/media are private; no DB writes or backend seed endpoint.
- Browser-only loading/empty/401/403/429/500 states, separate from actual API integration. The keyboard runner covers pending/error/real mutations and explicit mock paging; completed evidence and retained health limits are below.
- Measured product changes: App loading/error roles and bounded grid row; Column min-height; PostCard/ReplyThread wrapping and minimum width; PostCard containing block for Radix's hidden native Select; Composer named region and error/description association. A later notification-only wrapping rule in existing `index.css` uses App's `data-view` attribute. No auth, pagination, optimistic mutation or API logic changed.

## Preserved attempts and root causes

| Attempt | Observed result |
| --- | --- |
| [baseline-001](../../runs/baseline-001/result.json) | FAIL before mocks: Vite runner cannot evaluate original config `__dirname`; all recorded cleanup true. Review launcher now exactly mirrors and pins original plugins/alias/proxy. |
| [baseline-002](../../runs/baseline-002/result.json) | FAIL after loading/empty/401: harness incorrectly expected fallback text for a valid 403 problem response. Exact detail/request ID and disabled-security/Retry assertions corrected. |
| [baseline-003](../../runs/baseline-003/result.json) | Six mock cases and true API seed PASS; real baseline stopped at a strict locator collision. The actual timeline contains original plus repost Tech entries; later runner requires exactly two. |
| [baseline-004-real-only](../../runs/baseline-004-real-only/result.json) | Measurements collected at all three sizes, health zero. Mobile page 642/390; desktop/tablet columns grew beyond the intended deck height; long post/reply strings overflowed. Axe region moderate 5 each; contrast incomplete 95/16/12. |
| [baseline-005](../../runs/baseline-005/result.json) | After narrow CSS/ARIA fixes: six mock cases PASS, text overflow zero and column height fixed. Mobile page still 642/390. Axe violations zero; contrast incomplete 95 at each size. |
| [mobile-001](../../runs/mobile-001/result.json) | First targeted diagnostic was capped by normal clipped deck descendants; it did not identify the cause. No product fix inferred from that incomplete diagnostic. |
| [mobile-002](../../runs/mobile-002/result.json) | Full positioned/root diagnostic identified Ops hidden Select elements at x641–642 with BODY as containing block, matching document width 642 while body/root remained 390. |
| [mobile-003](../../runs/mobile-003/result.json) | PostCard `relative` fixes the containing block: page 390/390; deck retains deliberate horizontal 872/358; text overflow zero. Axe explicitly skipped for focused geometry. |
| [final-001](../../runs/final-001/result.json) | Actual unchanged shared capture tool ran all 12 route/viewport keys: all 200, loaded selectors and health clean. Nine keys pass; notifications overflow at all three sizes. Search mobile records one moderate landmark-unique finding. Final keyboard/route supplemental phases had not run because shared overflow gate stopped the attempt. |
| [final-002](../../runs/final-002/result.json) | Repaired only notifications3 through the shared tool; strict immutable9+3 selection passes12unique. All9 supplemental route identities/geometry/health pass. Real keyboard login and controlled composer pending500/no-resend/input recovery pass; actual POST201/id/author/content pass, then harness CSS selector escaping stops before the card assertion. Replaced with exact `[class~="bg-card/95"]`, retaining content identity/count. Product source unchanged by this harness correction. |
| [final003](../../runs/final003/result.json) | PASS12 keyboard steps and3 mock paging channels, cleanup true; its one count-only request failure remains historically unclassified. |
| [final004](../../runs/final004/result.json) | All12 steps complete; strict health FAIL on exact POST logout ERR_ABORTED, while two controlled500 consoles are precisely classified. No matrix rerun. |
| [final005](../../runs/final005/result.json) | Logout-only PASS: same actual Request204, sessionGET200/account null, signed-out UI; only that event is classified completed-logout-204-browser-abort. Cleanup true. Original failures retained. |

Each attempt preserves its own source hashes and failure state. All above receipts record successful owned cleanup; parent owns separate outer-container receipts. No failed attempt is rewritten into a success.

## Focused checks

- Four new harness guard tests PASS: invalid loopback, fresh/repeat/symlink state, actual CSRF/ID correlation, independent cleanup and safe categories.
- Four assertions against actual initial geometry/state receipts RED, then [explicit source-linked corrected measurements](layout-verification.json) GREEN (4/4, 56.278323 ms). This is measured evidence, not a claim that screenshots were rerun.
- Notification overflow assertions RED at all three sizes, then actual final-002 measurements GREEN 3/3.
- Capture selection guards PASS 3/3 (52.915729 ms): exactly nine original green keys plus three failed-notification replacements, rejecting duplicates/missing/unexpected keys and inappropriate replacements.
- [Backend native](evidence/backend-native.json): actual610 tests,0 failures/errors/skips,37.289s; [unchanged jar packaging](evidence/backend-package.json) passed without duplicating tests. [Final frontend native](evidence/frontend-native.json): lint0.214s and tsc-b/Vite build2.633s,34source hashes verified against current files. CI remains separate. No frontend test script is invented.
- Independent review found a late-browser-acquisition cleanup gap. Explicit30s launch, ownership-before-cancel-check, bounded5s close and210s main deadline resolved it; two meaningful async late-acquire/stalled-close tests plus original4guards passed6/6 (94.58318ms). The service entry point was not unit-importable before extraction; no invented RED claim for this extracted helper.
- Health classifier final4tests passed108.810401ms, rejecting wrong Request/absent204/missing readback/wrong method/path and unobserved navigation. Final005 exercised the exact runtime proof.
- Author viewed all initial and repaired mobile notification screenshots plus final mobile Home; all49 PNG hashes/dimensions are verified, but manual review is not claimed for all49 images.

## Final bounded evidence and limits

Final evidence is indexed in [result.json](result.json):13 immutable run receipts,49 raw PNG hashes/dimensions,12 selected shared keys,23 current runtime-source hashes and6 focused-test source hashes. final003 completes12 keyboard steps and3 controlled paging channels (Tab scrollLeft0→294→514, stable-ID duplicate merged, one continuation each). final004 repeats the necessary journey only to instrument health, classifies the two controlled500 console events, and retains its strict logout-abort FAIL. final005 runs only fresh login/logout, preserving the matrix/workflow dependencies rather than rerunning them. All required local M1–M3 gates have bounded evidence; independent acceptance/current-head CI/publication remain parent-owned.

Contrast incomplete findings are not a contrast pass. Shared capture evaluates axe only at its first viewport. The actual nine supplemental scans record notification22/search23/profile28 color-contrast incomplete nodes at each size; Search retains one moderate landmark-unique violation at each size. No critical/serious violation was reported. Home's earlier source-specific95 incomplete findings remain preserved. No full R3, dark-mode support, production data, deploy or owner completion is claimed. Source-backed diagnostic limits and parent-controlled runtime remain in force.

Publication note: staged whitespace gate found trailing blanks in two reviewed RED log copies. [Normalization record](evidence/publication-log-normalization.json) pins before/after hashes; only trailing whitespace was removed. Raw originals and failure assertions remain preserved.
