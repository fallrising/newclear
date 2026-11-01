# R2 receipt provenance

These UTF-8 receipts are copied from this task's actual ignored runs or root's local Fleet environment receipts. They contain synthetic fixed categories/hashes, not tokens, headers, storageState or screenshots. PNG/raw matrix diagnostics remain private and ignored, to be archived by root.

- `baseline-001.json`: real LOGIN/COOKIE failure; inner cleanup observed.
- baseline002 has **no inner receipt**. Root retains its failing stdout and outer container-removal receipt; do not reconstruct an inner success.
- `baseline-003.json`: untouched binary actual malformed Rollback400 RED after exact release selection, with true cookie/login and cleanup.
- `final-001-fail.json`, `focus-001-fail.json`: original M5 failure and the single diagnostic timeline. Preserve old source/binary hashes.
- `focus-002.json`: corrected exact-row/focus behavior actual PASS, including real15s poll.
- `native-initial.json`, `native-focus-fix.json`, `native-overflow-fix.json`: root `make test vet validate-schema build` receipts before/after the M5 adjustment and final CSS containment fix. Only native-overflow-fix applies to the final nine product/test sources; native-focus-fix applies to the accepted interactions and eleven original screenshots.
- `render-red.log`: focused initial UI regressions fail, API cookie/JSON contract passes. Command: `go test ./internal/ui ./internal/api -run TestReview -count=1`.
- `render-partial-green.log`: same packages, `-run 'TestReview(Responsive|Polling|Empty|Cookie)'`, exit0; M7 not yet applied.
- `m7-before.log`: M7 still absent after a cwd path typo; failure preserved, not a product regression introduced by the fix.
- `render-green.log`: all initial focused review tests pass after M7.
- `fixture-compile-fail.log`: new empty-fixture test used a nonexistent helper; compile failure preserved. `render-final-green.log` uses the existing helper and passes.
- `focus-render-red.log` / `focus-render-green.log`: stricter row selector regression RED then TestReview UI/API GREEN.
- `focus-behavior-red.log` / `focus-behavior-green.log`: actual inline-script VM behavior RED then two tests GREEN, including no-focus-steal negatives.
- `observer-final-tests.log`: Node24 pure pending/positive recovery/safe health/contrast/focus tests, eight PASS. Earlier focused outputs remain alongside it.

Native tests use the existing module/toolchain/cache; no dependency or SDK copied into the task. Metadata provenance is distinguished from actual runtime: later documentation changes are not retroactively represented by earlier source hashes.

`focus-behavior-red.log` is a public derivative with only private worktree paths replaced by `<worktree>` and a provenance header. Original bytes remain in the root-authorized task-local environment/fleet/focus-behavior-red.raw.log and ignored runtime log. Original/public SHA256 and exact redaction boundary are in focus-red-redaction.json.
