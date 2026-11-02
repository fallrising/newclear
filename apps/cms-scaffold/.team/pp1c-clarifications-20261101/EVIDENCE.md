# Proposed PP1c clarification checks — T-0351

Scope is documentation only, against A merge b0bf709fb687f4a23df868a8d123e5fa447959a3. Both amendments remain DRAFT pending owner decision; no product permission or success is inferred.

- `python3 ../../scripts/check_project_success.py`: PASS52 contracts/navigation.
- Narrow Python/git checks: PASS approved44cardsequenceunchanged, originalparentfullbytesretained, exactly2contractfileschanged, bothamendmentsDRAFT, exactDB/mediahashpreimagespresent, productsourceunchangedagainstAmerge.
- `git diff --check`: PASS; full staged whitespace required before commit.
- Independent T121 read actual docs diff and approved sources, confirmed proposed endpoint lifecycle and separateDB/mediahashpreimages preserve existing security/session/RTO/offsite boundaries. Recommendation: may submit Draft for owner decision; no implementation/merge approval. Full B report remains PARTIAL because endpoint decision and H02b/C07/C08 integration are pending.

Historical check failure preserved: reused `.team/pp1c-seal-20261101/check_docs.py` failed `parent entire existing bytes retained` after the initial proposed paragraph was inserted beside§4.2. The paragraph was moved to an explicit appended§11 amendment so all originalparentbytes remain intact; the narrow prefix check passed. That old checker also pins PR333's pre-A base for its no-product-change assertion and is not this post-A change's scope. It was not weakened or claimed as378currentpasses. Current productdiff is checked against actualAmerge instead.

Read-only Docker evidence: four retained PP1b API containers were exited, with data/web IPAddress and EndpointID empty at2026-11-01T18:01Z. No oldcontainer/network/volume was changed. This is endpointstate evidence only, not a backup/restore drill.

A PR955 delivered after CMS41332354599/contracts41332354518 and T118, mergeb0bf709f, remotecompletecomponentdiffempty. Journal230 mergedbf77165d after41332439481 and exactownrunreadback. B currentcores388Nodepass are explicitly partial; H02b close-before-result/drain requires genuine registry/capability regression before completeBacceptance.

## Approval-delta verification 2026-11-02

Owner approved both recommendations; prior DRAFT conclusions above remain historical. `python3 .team/pp1c-clarifications-20261101/check_approval.py` from component: PASS parent original byte prefix, exact proposed wave/receipt semantics unchanged apart from approval labels, unchanged card bytes, product source unchanged, media header preimage retained. `python3 ../../scripts/check_project_success.py`: PASS52. `git diff --check`: PASS. Initial checker invocation accidentally used workspace root and failed file-not-found (exit2); corrected only working directory, then passed. No product tests were rerun or claimed. T122 independent approval review and exact new-head CI/merge/readback remain pending.

T122 found the original checker used a component-relative Git pathspec with a repository prefix, potentially making the product-diff assertion vacuous. Corrected to `:(top)apps/cms-scaffold/`, require both expected contract paths in the diff, and inspect all nonignored untracked paths. Corrected checker PASS; reviewer independently inspected root-relative tracked/untracked paths. Earlier weak check is not relied on for product preservation.
