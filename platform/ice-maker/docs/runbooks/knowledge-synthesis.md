# Local synthetic knowledge synthesis

This Phase 5 workflow is local-only acceptance evidence. It does not ingest,
assert, or publish real production experience. Each input must be a
`SyntheticExperience(note, synthetic=True)` whose immutable `Note` has exact
SHA-256 source and chunk identities.

## Local journey

1. Build the exact immutable two-item tuple of marked-synthetic experiences
   from already validated notes. Lists, generators, and other unbounded or
   mutable inputs are rejected at the public boundary.
2. Call `compose_pattern(experiences, builder)`. It delegates retrieval,
   comparison, integrity reporting, and provenance validation to the Phase 5
   graph boundary. Duplicate, contradiction, and orphan findings always block
   composition. Use `inspect_experiences` only to obtain their deterministic
   local diagnostic report.
3. Treat the returned `SynthesisJourney.pattern` as pending. Its content names
   both notes, its `comparison` preserves horizontal evidence, and its grounded
   citations preserve both source chunks.
4. Supply accepted, digest-bound critic and human decisions for the knowledge
   candidate and then the pattern candidate to `approve_pattern`. For each
   candidate the builder, critic, and human are distinct. Both transitions are
   preflighted through a snapshot of the retained state machine before either
   decision is consumed, so correcting a rejected or stale pattern decision can
   reuse still-valid knowledge decisions. Rejected, missing, stale, or replayed
   decisions fail closed.
5. If an inference has no source, pass it as `inference`. It remains a separate
   `Hypothesis` artifact with an explicit reason and no citation; it cannot be
   promoted.

Run the local acceptance check:

```sh
PYTHONPATH=src python3 -m unittest tests.test_synthesis_e2e -v
make check
```

## External-pending gates

Do not label these fixtures as production evidence. A production corpus remains
external-pending until an operator supplies verified rights/privacy/provenance
for each source and chunk. Production curator, independent critic, and human
approval identities plus durable audit retention remain Phase 7 operator-owned
identity gates. This module has no provider, network, credential, publisher,
Git, or deployment capability.
