# Local knowledge ingestion

The Phase 4 workflow is a local-only, synthetic-fixture MVP. From a repository
root, run each dependency-aware stage explicitly:

```sh
knowledge ingest example.pdf --rights confirmed --data-class internal
knowledge extract --manifest <source-sha256>
knowledge index --manifest <source-sha256> --extraction <extract-evidence-sha256>
knowledge propose --manifest <source-sha256> --index <index-sha256> \
  --query 'idempotency' --destination concepts/idempotency --conclusion 'local evidence'
```

`python -m ice_maker.knowledge_cli` accepts the same commands. Each successful
command prints one canonical JSON object to stdout; errors are actionable on
stderr and exit nonzero. `--state-root` is only for isolated tests and must be
inside the current repository, outside both `knowledge/` and `.git/`.

Runtime originals, extraction cache, SQLite FTS data, and stage evidence live
under `.ice-maker/knowledge/`, never under tracked `knowledge/` paths. The
stages validate the prior manifest/result hashes before mutating the next local
store. `extract` publishes immutable canonical evidence whose digest is its
`extraction_id`; `index` loads that exact evidence and never re-extracts. Each
index has its own SQLite database and evidence-bound chunk set, so a proposal
cannot cite another manifest's chunks. Re-ingesting renamed identical bytes
reuses the content-addressed cache.

Manifest policy is rederived from the immutable quarantined source at every
downstream stage. Canonical JSON, source hashes, evidence digests, and all
manifest/quarantine/extract/index/proposal paths are checked and symlinks are
rejected. Evidence publication is no-replace and atomic.
Deleting `.ice-maker/knowledge/` and repeating a journey rebuilds canonical JSON
evidence identically; SQLite physical bytes and filesystem timestamps are not
deterministic evidence.

Only marked synthetic PDFs and deterministic ASCII PBM 3x5 glyph fixtures are
accepted. This is not a production PDF parser or OCR service. Production PDF
coverage, OCR engines/languages/accuracy, malware scanning, object storage,
rights approval for non-synthetic material, and any provider call remain
external-pending gates. A source that is sensitive, restricted, rights
unconfirmed, or taxonomy-invalid cannot reach the unpromoted-proposal boundary.
