# T-0368 / #445 — unaccepted repair checkpoint

This branch preserves existing unfinished code for transfer to a fresh session. It is a WIP source checkpoint, not a milestone acceptance or merge request ready for main. The owner asked to preserve the work in Git rather than leave it only in local dirty trees. Do not merge this draft until the relevant repair slices pass their required tests, independent review and CI. No usable tag or product acceptance.

## Retry / scheduler / Go source

24 files were copied byte-for-byte from the frozen closeout backup. Every file was checked against its SHA-256; tracked base content was also compared with current main before copying. The original dirty worktree and all local failure evidence remain untouched. The [source manifest](../../../../docs/project-success/evidence/ojbquay-wip-checkpoint/retry-source-manifest.json) separates original base from publication base.

Preserved candidates: deadline-aware scheduler wakeup, durable due gate and SKIP LOCKED; worker PostgreSQL connection reuse; transactional notifications; microsecond claim cutoff; eager metadata reader and linger=0; regenerated Go descriptors from unchanged proto; strict retry assertions and diagnostic Kafka/CI failure artifacts. Metadata-prefetch and minimal-endpoint experiments were retired and are not introduced here.

Original strict FAIL remains `[199,311,607] ms`; historical full candidate was132 tests/131PASS/1FAIL with `[703,350,639]`. Later six handler tests and20 scheduler tests are narrower evidence, not final-source full qualification. Existing published dual-observation evidence is in [PR477](https://github.com/fallrising/newclear/pull/477); that SDD measurement proposal remains unapproved. This checkpoint does not apply it, change any oracle, add warmup, or relabel failure.

## Publication checks and continuation

This preservation step checks manifest equality, absence of source overlap/main overwrites, selected-file disclosure, whitespace and project-success document structure. It does not rerun product tests just to reproduce already saved failures. The preservation checks are distinct from the unmet product milestone gate; their success does not satisfy that gate. Required PR CI remains enabled and its actual result must remain visible; no bypass or green claim.

For delivery, extract a bounded, independently valid repair slice from the named source candidates into a branch based on current main, retain the failure history, run the required same-source checks, obtain independent review, and then merge normally. Do not blindly merge this combined checkpoint. The original two working trees and complete backup remain the local investigation history.
