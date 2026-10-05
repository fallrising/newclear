STATUS: PARTIAL

## Summary

Proposal G is pending owner approval. All production F/native/performance, mock93×3 and canonical70 initial/comparison gates pass. Real attempt001 failed in the unbound Playwright API factory before journeys; the receiver-only tool repair now passes24 contracts/lint/types. Real attempt002 passes10, fails2, and serial mode leaves2 not run. Both disposable stacks were cleaned; no shared resources or backend/fixtures were changed.

W5 §5.6 requires:「失敗 attempt 先追加 real 表後停止；不得在 W5 自行修改 spec assertion 或產品碼，也不得記成 skipped。」Therefore no real journey assertion or product repair has been applied after attempt002. Proposal G specifically amends this restriction for the two new harness cases below; production changes remain excluded.

## Verification

- Final product complete25Vitals, mock93×3 and canonicalCI60axe/11hardening/70visual pass — passed
- Real001 stack healthy, Playwright setup TypeError `_playwright` due bare `request.newContext`; no journeys ran; retained `real-e2e-logs/001` — failed
- Receiver repair preserves injectable factory and bound Playwright object; focused isolated original-source Red shows exact receiver assertion; final runner/helper24, lint/types pass. Initial broad Red terminated without an actionable assertion; retained separately rather than counted as intended Red — passed
- Real002 `npm run e2e`, exit1:10passed,2failed,2notrun; retained `real-e2e-logs/002`; record counts4notpassed, not4executedfailures — failed
- Admin audit first row is latest LOGIN_SUCCESS; UI correctly shows null-detail state. OpenAPI AuditEventDetail.detail is nullable (2700–2702); AuthService passes null for successful login; product renders `audit-detail-none`. New harness unconditionally expects `audit-detail-json` — failed
- Board selecting CMS Scaffold then mouse drag yields no PATCH, card staysready; current source matches existing mock drag steps. Real differs by preceding RadixSelect interaction. Pointer hit/actionability/render timing is a hypothesis, not a confirmed product defect — failed
- Both attempt cleanup logs remove5ownedcontainers/2volumes/network; no ownedresource remains, private directories deleted — passed
- G has not been implemented; no success inferred for remainingreal14 — skipped

## Documentation

Proposed G, maximum2 diagnostic/repair real attempts after approval:

1. Keep all14 journey titles/order and every existing isolation/mutation assertion. Only realAdminaudit andBackboard harness plus strictly owned setup/regression helpers may change. No product/API/schema/seed/dependency or snapshot changes, no threshold/timeout relaxation.
2. Admin: first-row detail must match its actual API response, including exact null-detail UI. Preserve real nonempty JSON coverage by preparing a uniquely named temporary album through existing authorized APIs in the runner-owned stack, publishing only that new test entry to produce a known `entry.publish` event with revisionNo. Filter/open that event through Admin UI and compare its visible parsedJSON exactly with API detail. The new entry belongs only to the disposable test stack and is removed with owned cleanup; no external/shared publication.
3. Board: instrument pointer hit target, closed Select/body pointer-events state and drag activation; then fix only the evidenced harness actionability/timing. Continue actual mouse drag, require a successful sole PATCH with payload status=in_progress, card in destination and no publish/boards/publicationState writes. No menu/API substitution for the drag. If evidence reveals a product defect, stop with a separate concrete proposal.
4. Retain all attempts, rerun focused contracts/lint/types and fullreal14. Reuse existing complete mock/Vitals/visual evidence when product source remains unchanged. Only merge PR300 after real14/cleanup and required CI pass.

## Risks and Follow-ups

Owner approval is required because G changes the exact Admin#2 blueprint assertion and real setup scope. Sourcefix/canonical/evidence work already authorized may be saved while G remains pending. No permission is being requested again for commit/push/PR/merge, and this pause is from W5§5.6, not automatic approval review.
