# AI request cancellation and ownership

This maintenance specification extends the [reliability criteria](reliability.md) for the existing AI service. It changes no frozen contracts, provider wire formats or dependencies.

## Observed gaps

At source revision `84d36e53`, `ai_ask` returns a request ID after spawning a task, while `AiService::run` registers cancellation only when that task is polled. An immediate `ai_cancel` can therefore miss a valid request. Dropping an in-progress run future bypasses its final map removal. The document listener cleanup discards local events without cancelling an already active backend request, so closing a document can leave an unwanted provider request running.

## Required behavior

- Admit/register a request synchronously before IPC returns its ID. A cancellation arriving before execution starts must prevent HTTP and successful output. Cancellation and normal execution must use the same owned registration.
- Reject duplicate active request IDs without replacing or cancelling the earlier request. IDs and cancellation state belong to a single execution; do not accumulate permanent cancelled-ID tombstones.
- Dropping an admitted request before execution, aborting/dropping a running future, and success/error/cancellation completion must release its registration. Cleanup from an older execution must never remove a newer registration. A retired ID may be reused safely after ownership is released.
- Preserve existing streamed text, final usage and terminal-event behavior. IPC emits one error/cancelled terminal on failure; cancellation never produces Done. Keep errors credential-safe.
- Each document owns its active request. Closing it cancels that request, including an ID returned after close. Completion/error/cancellation clears ownership, so later cleanup does not cancel a finished request or a different document's request.
- Preserve listener-before-send and early-event buffering. React effect cleanup/setup and late promises from an old lifetime must not activate requests in a new lifetime.
- Explicit Cancel remains available until a terminal event arrives. A rejected cancellation call must be visible while the document is open; it must not silently mark the request completed. Cleanup after unmount must catch rejection without updating an unmounted component.

## Verification and boundaries

Write failing deterministic regressions before implementation. Backend tests exercise immediate cancellation before the first execution poll, dropped admitted work, aborted running work, duplicate IDs, terminal cleanup and isolation with loopback HTTP; do not use live provider credentials. Frontend tests cover active close, late ID, early terminal, failed cancel, and obsolete lifetimes. A browser smoke on the built UI with mocked Tauri IPC checks close/cancel behavior; it is not native GUI acceptance.

Run the full Rust workspace, fmt, contract Clippy and generated-contract drift checks, frontend tests, both typechecks and production build. Independently review the implementation and record actual outcomes in a verification document. Linux Docker is sufficient for this scope; cross-platform and paid provider tests remain separate.
