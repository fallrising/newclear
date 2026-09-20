---
id: SDD-0004
title: Synthetic knowledge ingestion MVP
status: approved
owner: fallrising
risk: high
data_class: internal
budget_usd: 6
allowed_paths:
  - "src/ice_maker/**"
  - "tests/**"
  - "knowledge/90-meta/**"
  - "pyproject.toml"
  - "docs/verification/**"
  - "docs/runbooks/**"
forbidden_paths:
  - ".git/**"
  - "docs/sdd/**"
  - ".github/**"
  - "orchestration/policies/**"
---

# Synthetic knowledge ingestion MVP

## Context

Phase 4 must turn untrusted documents into locally searchable, provenance-rich
knowledge candidates. Production PDF/OCR tools and object storage are absent,
so this phase uses byte-valid synthetic PDFs and a deterministic bitmap OCR
fixture boundary without claiming production OCR accuracy.

## Goals

- G-1: Provide `knowledge ingest`, `extract`, `index`, and `propose` stages with
  content-addressed manifests and idempotent local state.
- G-2: Extract one text PDF, one scanned PDF, and one image while preserving
  exact source hash, page, region, method, and chunk provenance.
- G-3: Reject unsafe sources, taxonomy drift, and provider-ineligible content
  before any proposal boundary.

## Non-goals

- Production OCR quality, arbitrary PDF compatibility, malware-engine claims,
  cloud AI calls, real credentials, or raw sensitive corpus ingestion.
- Git storage of original documents, generated indexes, or extracted private
  text; runtime state remains under the ignored `.ice-maker/` directory.
- Promotion to knowledge/pattern/principle or publication, which belong to
  Phases 5 and 6.

## User stories

- As a curator, I can rerun a source and receive the same manifest without
  repeating OCR.
- As a reviewer, I can trace every proposed item to source hash, page, region,
  extraction method, and chunk.
- As a security owner, I can stop sensitive or restricted material before a
  provider-facing proposal boundary.

## Functional requirements

- FR-1: Intake regular PDF/PBM inputs by SHA-256 and content signature, copy a
  bounded source into quarantine without replacement, and deduplicate by hash.
- FR-2: Scan source bytes for secret-like/PII controls, record data class and
  rights decision, and expose an explicit local-only/provider-eligible decision.
- FR-3: Extract PDF text locally and OCR deterministic synthetic bitmap pages
  and standalone images without a third-party dependency.
- FR-4: Cache extraction by content hash and extractor version so a rerun does
  not execute OCR again.
- FR-5: Normalize bounded chunks with immutable page/region/method provenance
  and validate every taxonomy value against the canonical taxonomy file.
- FR-6: Build a local SQLite FTS5/BM25 index, retrieve related chunks, and emit
  a deterministic proposal that cites every source chunk and remains explicitly
  unpromoted.
- FR-7: Expose the four stages through a deterministic offline CLI and prove a
  text-PDF and scanned-PDF end-to-end run.

## Non-functional requirements

- Python 3.11 standard library only; bounded source, page, chunk, OCR glyph,
  SQLite, and output sizes; deterministic ordering and JSON serialization.
- Refuse symlinks, traversal, malformed formats, duplicate JSON keys, hash
  mismatch, unsafe Unicode/control content, and partial publication.
- Untrusted document text is data, never executable instructions. No stage
  accepts shell, network, provider credential, workspace mutation, or publisher
  capability.

## Acceptance criteria

Scenario: Ingest text and scanned PDFs end to end
Given one synthetic text-layer PDF and one synthetic scanned bitmap PDF
When each runs through ingest, extract, index, and propose
Then both yield searchable chunks and every proposal citation identifies the
exact source hash, page, region, extraction method, and chunk identifier.

Scenario: Reuse content-addressed extraction
Given a scanned PDF has completed OCR once
When the same bytes are ingested and extracted again under another filename
Then intake reports a duplicate and OCR invocation count does not increase.

Scenario: Stop unsafe provider input
Given a source contains a sensitive pattern, is restricted, lacks rights, or
uses a taxonomy value outside the canonical list
When proposal eligibility is evaluated
Then the operation fails closed before any provider boundary and preserves only
truthful local quarantine evidence.

## Failure modes

- Unsupported/malformed document: reject without manifest promotion or index
  mutation; retain no partial generated record.
- Hash/cache mismatch: reject the cache and require deterministic re-extraction.
- FTS5 unavailable: report an unmet local runtime dependency; do not silently
  substitute a weaker search claim.
- Real OCR/object storage absent: keep the local MVP usable and mark production
  evidence external-pending.

## Open questions

- Production PDF parser, OCR engine/languages, malware service, and object store
  remain operator-owned external decisions.
- Rights approval for any non-synthetic corpus remains a human blocking gate.
