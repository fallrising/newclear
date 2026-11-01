STATUS: DONE

## Summary

Implemented only new SQLite material_index.go and material_index_test.go in the assigned isolated worktree. Supplied port remains byte-identical to root. Actual HEAD d55db6a9ad4606cd7df30b2bc9411b559d04f75a; intake211da65fffe195dc795656e31a785eceb885d9f4 has identical relevant SQLite/port sources.

Reader uses one deferred readProjection connection, preflights scalar types/byte lengths/counts, reuses guarded WorkItem/Done rehydration, and reads stored Initial/Impact head relations plus exact accepted/current requirements. Legacy AC/Candidate IDs retain exact validText80 bytes. Scoped Run/Candidate histories preserve different input digests and all stored enums; cursor/generation share the snapshot. No policy, content rehash, artifact, executor, writer transaction or ID allocation.

Tests distinguish lawful service legacy history from schema-only accepted/Impact fixtures. Cover all phases, Done corruption, binary ordering, accepted81/120-byte IDs, all five enums, foreign histories,1024/1025 limits for both AC profiles/Run/Candidate/blockers,2MiB/+1 blockers, max signed metadata/ns, scalar corruption, head/exact-set/orphan failures. Independent writer commits while a pinned read retains the complete old snapshot; public reads expose the new snapshot, preserve all durable rows/IDs/allocators and survive reopen.

## Verification

- Full Modern Go1.27 list read before edits; modern-go.txt — passed
- `timeout 180 go test ./internal/domain/sqlite -run TestWorkItemMaterialIndex -count=1`, focused-second.txt,6.017s — passed
- `timeout 300 go test -race ./internal/domain/sqlite -run TestWorkItemMaterialIndex -count=1`, race.txt,117.422s — passed
- `gofmt -l` both new files, empty output — passed
- `git diff --check` plus `git diff --no-index --check /dev/null` for each untracked new file, empty output — passed
- `cmp` supplied port against root copy, unchanged — passed
- Manual final scope/diff/evidence review against assigned checklist — passed

Historical attempts retained: missing future-file Modern Go invocation, sandbox shared-cache setup failure, intended compiling capability Red0.026s, and four immutable-trigger fixture construction failures2.549s. The retry corrected fixture setup only; all required final checks passed. No cache relocation, weakened oracles or deleted failures.

## Source hashes
- material_index.go: e4e03f6c145dbebb91899255b0351ba652f61708d05060918546f6c5b083065d
- material_index_test.go:44488a8af57bde7574e7f291f6918cd7c06efe4ed738283de06f8df5ef6d5c12
- unchanged port:8e4eeff170d6c877f153e0f42e4312aac60d18d298ece3649ef6a6ff5230a8e7

## Documentation

Evidence and oracle map: .local/hai-index-core-20261101/README.md and adjacent logs/hash manifest. Normative docs/API/BOARD/report publication remain root-owned; no out-of-scope document edits.

## Risks and Follow-ups

Accepted Initial/Impact storage fixtures are not lawful command-history acceptance or an implemented Impact writer. Legacy service identity regression uses the existing declared specification test double. Root must complete actual accepted/Fake/multi-AC/HTTP journey,4MiB wire boundaries, independent review, full gates and Git workflow. Snapshot interleaving is tested through the connection-local helper; public-method no-write/reopen is separately covered. No whole M2/full history/current Done applicability or bounded whole-database scan-time claim.

No children, commits, provider/network/model calls, dependencies or migrations. Aggregate tool/provider call counts and active/wait durations uninstrumented/unknown; listed durations are observed package-test durations only.
