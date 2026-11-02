# T-0426 Ordered inline instructions for Claude continuation

Owner authorized continuing Claude after PR970/973. Claim PR397 merged before this design and implementation. Original17AC/history and prior closed live budgets remain unchanged.

## Scope and acceptance before implementation

DC-1: For `/v1/messages` routed to Claude Code, preserve provenance: the top-level `system` stays in the stable instruction signature; `messages` entries with role system/developer remain ordered inline instruction context. Only adapter conversion may mark that provenance; raw incoming marker fields are ignored/reconstructed. Generic Anthropic-to-Chat conversion, direct Chat/Responses requests, Cursor and HTTP fallback retain their existing strict contracts. Equivalent supported text-block/string representations remain equivalent; no billing-header or notice text is stripped.

DC-2: Fresh rendering keeps inline instructions in original conversation position with explicit instruction-role delimiters. An idle or saved run can continue with an appended suffix of inline instructions and user messages, only when at least one user message is present and the already-heard normalized history, resolved model, stable instructions and tools still match. Send only the suffix, once, in original order. Replayed inline instructions must participate in prefix checks; changed historical instructions cannot attach to an unaware run. Native TUI input still transports these as external instruction text, not a new privileged system-role API.

DC-3: Waiting-tool admission remains strict. A result request can reuse when its previously heard inline history is unchanged and the existing exact assistant/result suffix matches. Newly added inline context around pending results must not be silently discarded or delivered after results; use ordinary fresh-run selection with complete ordered context. Reliable in-place tool-notice queue/ACK, dynamic tool sets and ID remapping are outside this scope. Cancellation, usage settlement and saved-session checks remain intact. Old shelf entries need not be rewritten; unchanged ordinary normalization remains compatible, changed provenance produces a different history/signature match.

DC-4: Genuine RED for ordering/continuation, proportionate converter/core regressions and fake-TUI end-to-end same-process plus restart; focused/full Rust1.99 locked tests, fmt/Clippy/build, component Python and required offline walkthroughs/contracts/indexes, independent review, normalCI/merge/readback/journaldesk, complete separate backup and only owned cleanmergedWT cleanup. No real provider/officialCLI/profile/privateDB, Docker, dependency or permission changes. Stop after this bounded scope, mainline incomplete/usable_tag none.

Estimate60–90active minutes plus bounded600secondCI waits;20minute checkpoints. Per issue initial diagnosis plus2reasoned corrections. Whole-session tools/model/provider/tokens/cost/activewait unknown/null.

## Design and reference

Pinned yetone/magpie `b0174e7615ae7be8c2df3b64b85c4c87f492c285`; latest fetched Claude gateway/TUI blobs are unchanged from the previous pinned reference. Magpie separates Request.System from ordered Messages and renders only the suffix for continuation. Its billing-header stripping, notice classifications and tool-side queueing are not copied. This implementation preserves all supported external instruction text and uses existing strict matching rules.

Use an adapter-only conversion variant to annotate inline system/developer entries, without changing their role. The proxy reconstructs this only from the original Anthropic body for Claude targets; it removes any caller-supplied internal annotation for direct Chat/Responses. The annotation participates in normalized history, but only stable instructions participate in the signature. Fresh/turn renderers explicitly label inline instruction roles; idle and shelf suffix eligibility requires only inline/user messages and at least one user. Pending-tool shape/ID/history checks stay unchanged and naturally reject added context. No private annotation is sent to an HTTP provider.

## Planned scenarios

- Same text as top-level versus inline has distinct provenance; inline before first user remains inline. Text-block/string equivalents match.
- Fresh prompt and appended continuation preserve system/developer role, every word and order; only new suffix reaches existing child and native saved-session restart.
- Changed stable instructions/model/tools or rewritten earlier inline history requires fresh selection; pure instruction suffix does not resume by itself.
- Public marker spoofing cannot weaken direct Chat/Responses strict signature; generic converter/HTTP target body stays unannotated.
- Previously heard inline history permits exact MCP results; new context beside a result remains undelivered to old callback and appears in fresh full context. Existing cancellation/accounting regressions stay valid.

Independent T001 design review accepted before runtime changes. Additional shelf condition: reject a suffix after the last assistant that lacks a user turn before consuming shelf_take; pure inline-only context must leave the saved row/session available for a later valid user continuation.

## Implemented behavior and observed verification

Adapter-only provenance reconstruction, ordered rendering, shared user-required suffix eligibility and pre-take pure-instruction shelf rejection are implemented. The existing strict tool matcher now includes heard inline context through normalized history; new context at the tool-result boundary selects full-context fresh execution. Generic/direct protocols remain strict. Independent T001 design and T002 source/corrected-fixture reviews accepted the bounded scope.

- Genuine pre-fix DC1 regression failed because inline context preceded its original user message; all5focused DC converter/core tests now pass.
- Initial14case fake-TUI suite:12passed/2failed on first-request502. Source diagnosis found the synthetic peer acknowledged only the first bracketed paste, while unchanged production TUI sends multiple text blocks before Enter. Fixture now accumulates/acknowledges every piece; original assertions and all text remain. Corrected3newcases passed, then full14case suite passed within the full run.
- `cargo +1.99.0 test --locked`:444passed/25groups; `cargo +1.99.0 fmt --check`, `cargo +1.99.0 clippy --locked --all-targets -- -D warnings`, `cargo +1.99.0 build --locked` passed.
- Component `python3 -m unittest discover -s scripts/tests -v`:199passed; `offline_walkthrough.py --check` and `named_http_walkthrough.py --check` passed using the separately retained new binary and owned synthetic endpoints.
- Repository `python3 scripts/check_project_success.py`:55contracts; `python3 scripts/check_indexes.py`:9indexes; `python3 -m unittest discover -s scripts/tests -v`:20passed. Final staged diff check remains a commit gate.

Actual fake-TUI evidence proves appended inline/user turns reuse the same child with only new ordered content, saved restart resumes only the suffix, rewritten past selects fresh, forged direct-Chat markers do not enable dynamic reuse, and tool notices start fresh without consuming the old callback; a later valid result still completes there. Existing cancel/usage/other protocol regressions passed. No official client or provider was invoked; no actual-client cache/subscription result follows.

Required remoteCI/normalmerge/readback, journal/desk, full separate backup and ownedcleanup are later delivery gates at this source checkpoint. Original17AC/mainline incomplete and closed live budgets remain unchanged.
