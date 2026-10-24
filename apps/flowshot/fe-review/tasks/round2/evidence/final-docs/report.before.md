# T018 paired R2 — first proof checkpoint

Status: PARTIAL. Product/native/runtime acceptance not claimed; targets remains false.

- Focused preload tests — passed, 12/12, actual Node24.18 and locked Loom Tauri SDK2.11.0. Both fixtures were empty at the preserved RED attempt; implementation then passed. Exact command: `node --test apps/flowshot/fe-review/preload.test.mjs apps/loom/fe-review/preload.test.mjs` from repo root. [RED](evidence/proof-red.log), [GREEN](evidence/proof-green.log).
- Flowshot paired runtime guards — passed, 3/3; external origin refusal, safe exception classification, all owned closers attempted despite rejection/hang. Evidence lives in Flowshot `tasks/round2/evidence/guards.log`.
- Flowshot runtime entry syntax — passed (`node --check` on browser-runtime.mjs and run-review.mjs); no server/browser was launched.
- Actual browser, complete Loom M2 scenarios, root native checks and required CI — pending/not run by worker.

Flowshot uses the real eager launch source transpiled by existing TypeScript for the pure seam proof. Loom tests import the actual locked SDK invoke/listen/unlisten; separate event and callback IDs are released. Negative command/Origin/path, save conflict/error, reset, explicit restart/forget, pending-history disposal and no-key AI are covered. This is not native IPC proof.

Both SUCCESS files now contain the scoped plan; SCENARIOS.md maps remaining browser evidence. Runtime files and 19-capture Flowshot entry prepared for root review/launch only. Loom browser driver not yet built. Only assigned review paths and scoped SUCCESS changed. Frozen contract/product/dependency/CI/shared capture unchanged.

Raw proof logs remain ignored in Loom runs; published logs only redact worktree paths to `<worktree>`. All initial failures remain visible. Source hashes at this checkpoint are in result.json. No full Round3/mainline/usable/provider claim.

## Test discovery correction

Root native npm test found Vitest collecting review node:test files under *.test.mjs, while original Flowshot 7 files/29 tests and N03 9 tests passed. Root preserved that native failure. Review tests renamed to *.node.mjs without altering Vitest configuration or original tests. Historical commands/logs above retain the names actually used at the time; current focused command is `node --test apps/flowshot/fe-review/preload.node.mjs apps/flowshot/fe-review/runtime-guards.node.mjs apps/loom/fe-review/preload.node.mjs`.

Flowshot root runtime flowshot001 passed 19 captures and owned cleanup before this rename. Runtime source hash manifest stays immutable; the only post-runtime executable delta is the sourceFiles manifest test-name string. No product or fixture behavior changed, and green browser evidence is not rerun. Contrast incomplete is retained; no full contrast or Round3 acceptance is claimed.

Post-runtime source note: after the filename rename, the paired runtime gained a `unit === 'loom'`-only Vite5 hash-pinned config loader. Flowshot options/behavior are unchanged. [Exact delta](evidence/post-runtime-loom-loader-delta.json) and the artifact audit reconstruct the original runtime hash; green Flowshot browser evidence was not rerun.
