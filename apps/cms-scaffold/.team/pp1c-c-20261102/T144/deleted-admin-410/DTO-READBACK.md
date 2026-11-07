# Remaining API semantic readback

Read-only source review following root's first actual fixture failure. No product/runtime changes were made.

- `MediaService.privateBytes` checks private authorization before unavailable/deleted state and throws `MediaException.gone`; `ErrorCode.MEDIA_GONE` maps to HTTP410. OpenAPI's private media file route also documents410. Anonymous `publicBytes` checks publiclyReadable first and returns404 for the deleted asset. Correction changes only the extra admin deleted-file expectation, leaving anonymous404 and physical byte retention intact.
- `EntryService.create` preserves a copy of the supplied payload and creates version1/DRAFT; `EntryController` POST returns201 and `ContentProjection.work` exposes id/version/publicationState/payload/dirty. `PublicationState.wire` is lowercase. No additional default payload keys were found in this path.
- `EntryService.publish` first publish increments version, preserves payload and snapshots publishedPayload, inserts revisionNo1, returns PUBLISHED. Re-publishing a clean published entry can be a no-op, but the fixed fixture publishes each newly created draft only once; the version-increase assertion is therefore appropriate.
- `preparePatch` requires the actual current version, merges the supplied fields, increments version, preserves publication state and publishedPayload. The fixed same-field A→B payload change therefore remains published and dirty. No unpublish API call is issued.
- `EntryController.revisions` returns `items` with integer revisionNo/slug/publishedAt; it does not return revision UUIDs. The module checks revisionNo1 and hashes the complete list.
- `ContentProjection.published` expands public media-ref via MediaService JSON; the media object includes id and mediaId. `?include=refs` uses the complete work projection and role-filtered refs, so independent admin/operator response hashes remain necessary.
- `PrincipalAdminService` creates active principals with supplied temporary password, fixed operator role assignments require explicit type scope, and permission replacement preserves supplied nonempty surfaces and null predicate. Readback includes extra permission id which the module deliberately excludes from the fixed permission comparison.
- `AuthController` returns active principal plus role assignments and CSRF token; `CookieSupport` sets Secure/Path=/SameSite=Lax and sessionMax Max-Age, HttpOnly only for session. No force-change field/flow exists in this implementation. Root's observed config remains the source of the expected Max-Age.

No other concrete DTO/status mismatch was found in this bounded readback. Actual remaining API execution is still root's responsibility; this review is not runtime success evidence.
