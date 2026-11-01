# PP1c endpoint lifecycle clarification — proposed, not approved

Desk T-0351, B helper integration. Approved source: docs/v2/waves/PP1c.md §4.2a helper row and §4.2/annex§1 create→inspect→start lifecycle. Existing owner standing Git authority does not silently approve changed SDD behavior.

Original endpoint clause: `endpoint 無 network 時 null，否則恰 {networkId,address}，address 為 inspect 的非空 IP`.

The same approved lifecycle persists CREATED after create/complete inspection and before start. Docker has no active network IP before starting and clears it after exit. Read-only observation2026-11-01T18:01Z of all four retained PP1b API containers found State.Status=exited with both data/web IPAddress and EndpointID empty. No container/network/volume was changed. Existing v1 target inspector also explicitly requires empty stopped API endpoint. We have not created a new probe to manufacture evidence or broaden runtime authority.

Proposed exact replacement, limited to endpoint lifecycle:

- network=none: endpoint is always null.
- networked CREATED: endpoint must be null; no backend/permit/start-success claim is possible.
- networked RUNNING/READY/PERMITTED: endpoint must be `{networkId,address}` from the fresh exact helper inspection, with a nonempty private IP on the pinned side network. Bind it once on the observed CREATED→RUNNING transition; reject subsequent network/IP replacement.
- EXITED: retain the last verified endpoint as historical evidence; null is allowed only if the helper never reached observed RUNNING. Require full-ID stopped inspection and zero matching DB backend independently; the stored endpoint is not evidence of a live connection.

Everything else remains required: immutable image/argv/env/mount/UID/security policy, exact full ID before start and cleanup, private capability, same PID/epoch, no extra backend and fail-closed unknown state. No permission/dependency/side-network change.

Acceptance after approval: named validator tests for each phase/null combination, changed-IP/backend refusal, created/no-permit, exited/historical-only; helper lifecycle regression plus full native/independent review/CI. Until approval, affected networked CREATED registration remains held. Media no-network and independent framing/registry checks can continue within current authorized B budget.

Separate earlier pending decision: parent restore receipt rawSnapshotSha256/mediaInventorySha256 preimages. Recommendation remains DB snapshot hash plus media header hash, alternative media field binds full inventory artifact. No C/D producer implementation before owner response.

## Concrete receipt preimage proposal

The proposed parent §4.2 paragraph binds rawSnapshotSha256 to the recomputed equal RAW_VERIFIED Inventory.dbSnapshotSha256, and mediaInventorySha256 to SHA256(canonicalBytes({version:1,files:Inventory.files})), equal to its mediaHeaderSha256. This includes every file's key/size/hash/classification and all orphan/deleted files. It does not replace raw comparison, artifact/file verification, session invalidation or browser/restart proofs. Alternative discussed with owner is mediaInventorySha256 binding full inventory.json; it has not been selected. Both this paragraph and endpoint amendment remain DRAFT until explicit owner decision.

Current implementation facts: A PR955 mergedb0bf709f after requiredCI/T118 and completecomponentreadback. B frozen current cores pass388combinedNode tests; H02b/capture wiring and completeB delivery remain pending. No B product commit/PR, native fullwave verification or restore acceptance has occurred.
