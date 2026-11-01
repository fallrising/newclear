# ADR-005 — Pending renderer performance direction

Status: proposed, awaiting owner decision. Date: 2026-10-23. No implementation or acceptance change is authorized by this proposal. SPEC §4.1 fixes unified/remark/rehype; N03 retains a synchronous complete-model budget below300ms for a1MiB mixed GFM/CJK/code document.

## Evidence

The retained synthetic fixture is exactly1048576 UTF-8 bytes, SHA256 `b02f7cd9db316877a56618e0dca1a6e3e013860cdbe13273ccde2c9cb6067a68`, with4177 mixed semantic blocks. The optimized candidate produces104426 segments, roughly16.36MB HTML and32.52MB hinted model JSON. Node production-bundle runs took13.58–14.41s; actual WebKitGTK2.50.6 measured7.975/9.139s with hints. These timings belong to the measured pre-table-repair source, as recorded in N03 verification/T010. Source-map cost itself passed the <=2x ratio and is not the bottleneck.

A separate CPU profile on the repaired source SHA256 `17d1b18278acd7dbfdebfe0a83dc562a9ace99cf42f9ae51d7bcca7d4768b3a8` used the same fixture. It is diagnostic, not acceptance timing. Sampled self time was43.54% in micromark edit-map consumption,12.62% in garbage collection and10.8% in parse5 node detachment. Pinned-source inspection found repeated accumulated event-array copying and sibling-array shifting. T012 records exact modules and bounded equivalence experiments. Even eliminating all observed parse/raw phases would not by itself establish300ms; canonical construction and serialization remain material costs.

The benchmark fixture, public synchronous API, source/canonical hash rules, security corpus, UTF-8 range semantics and model schema have not been relaxed. N03 is blocked under protocol §8, N04 is not unlocked, and M1 has no acceptance claim.

## Proposed directions for owner selection

1. **Recommended: retain the300ms target and authorize a parser/pipeline redesign.** Evaluate a bounded prototype against the exact fixture, all existing model/sanitizer/DOM fixtures and100-repeat equality. Retain a single TypeScript-owned semantic pipeline, original-byte hashing, final-DOM range mapping, controlled assets/links and no network. Any change to SPEC's named pipeline must be explicit; no second Rust Markdown parser is implied. This authorizes investigation, not a promise that an unmeasured replacement meets the budget. Freeze the selected design and semantic regression evidence before further product integration.
2. **Retain the named pipeline and propose a revised performance contract.** First present measured document profiles, blocking latency and memory/output costs for review, including this unchanged stress fixture. Do not adopt a new limit, asynchronous API, easier fixture or first-paint-only measurement without an explicit approved specification revision. Existing failed runs remain failed against the original contract.

Root asked the owner to choose while N02 independent work continues. No reply or elapsed time is treated as approval. The separate three-consecutive-day real-KB gate still requires an owner-supplied local path and actual elapsed trial evidence.
