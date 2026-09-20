---
id: SDD-0009
title: Deterministic readable document results
status: draft
owner: fallrising
risk: high
data_class: restricted
budget_usd: 0
allowed_paths:
  - README.md
  - docs/runbooks/production-document-ingestion.md
  - specs/active/readable-document-results/verification.md
  - src/ice_maker/document_service.py
  - src/ice_maker/knowledge_index.py
  - src/ice_maker/readable_results.py
  - tests/test_document_service.py
  - tests/test_production_ingestion_e2e.py
  - tests/test_readable_results.py
forbidden_paths:
  - .github/workflows/**
  - orchestration/policies/**
---

# Deterministic readable document results

## Context

Production batches already retain searchable text and exact provenance, but the
local service exposes only upload and aggregate status. A curator needs to read
and download one reconstructed result without using SQLite or leaking raw
bytes, original filenames, host paths, or another batch's content.

## Goals

- G-1: List the processed documents in one completed batch using stable source
  hashes and bounded non-content metadata.
- G-2: Reconstruct one source into deterministic, human-readable Markdown and
  expose it through the existing loopback browser service.
- G-3: Preserve page-level source, region, method, and confidence provenance and
  visibly mark low-confidence OCR.
- G-4: Fail closed on incomplete state, source mismatch, corrupt index,
  oversized output, and markup injection.

## Non-goals

- Automatic summarization, semantic rewriting, knowledge promotion, or provider
  calls.
- Layout-perfect tables, typography, embedded images, or PDF visual fidelity.
- Raw-file download, original filename disclosure, remote access, publication,
  or writing extracted private text into Git.

## User stories

- As a curator, I can open a completed batch and read or download each processed
  source as Markdown.
- As a reviewer, I can see page, method, confidence, and region information and
  return to the indexed evidence when OCR is uncertain.
- As a security owner, I can verify that a request is bound to one completed
  batch and that extracted markup remains inert data.

## Functional requirements

- FR-1: `GET /api/batches/{batch_id}/documents` accepts one canonical lowercase
  64-hex batch ID and only succeeds for durable `completed` state. It returns
  `batch_id` plus at most 100 processed documents sorted by source SHA-256.
  Each record contains source SHA-256, sorted page numbers, chunk count, methods,
  UTF-8 byte count, and confidence minimum/mean/maximum. It contains no original
  filename, storage path, absolute path, raw byte, or extracted text.
- FR-2: `GET
  /api/batches/{batch_id}/documents/{source_sha256}/markdown` succeeds only when
  that source is a `processed` member of the exact completed batch. It returns
  `text/markdown; charset=utf-8`. The browser page at
  `/batches/{batch_id}/documents/{source_sha256}` displays the same bytes in an
  escaped `<pre>` and links to the Markdown response for download.
- FR-3: Responses are bounded before publication: at most 10,000 source chunks,
  64 KiB listing JSON, and 256 KiB Markdown or HTML. An exceeded bound returns
  HTTP 413 with `readable_result_too_large` and no partial document body.
- FR-4: Native `pdf-text` chunks use the existing region grammar
  `text:<offset>,0,<length>`; the middle zero is reserved by that schema. For
  each page, sort by offset, length, then chunk ID; require offset zero followed
  by contiguous non-overlapping ranges; concatenate exactly and preserve page
  boundaries. Gaps, overlaps, length mismatch, or non-unit confidence fail.
- FR-5: OCR chunks use `pixels:<left>,<top>,<width>,<height>`. Sort by page,
  top, left, width, height, then chunk ID. Start a line with the first word; join
  the next word with one ASCII space when its top differs from the line anchor
  by at most `max(2, floor(min(anchor_height, word_height) / 2))`; otherwise
  start a new line. This deterministic heuristic does not claim table recovery.
- FR-6: The Markdown header contains the complete source hash. Every page has a
  visible provenance line containing page number, methods, covered region, and
  confidence minimum/mean/maximum. OCR words below `0.80` are visibly wrapped
  with their confidence, while full chunk/rectangle provenance remains in the
  validated local index rather than overwhelming the readable body.
- FR-7: Extracted text is data. Markdown body lines are represented as indented
  code, so HTML, links, headings, images, and backticks stay inert. The browser
  uses a fixed template, HTML-escapes the complete Markdown before placing it in
  `<pre>`, and interpolates only validated IDs into same-origin links. Unsafe
  Unicode or controls fail; the renderer never silently removes source text.
- FR-8: The service resolves membership from validated batch result state before
  reading source chunks. It verifies source hash, chunk identity, region, index
  schema, and FTS integrity, and accepts no caller-provided filesystem path.

## Non-functional requirements

- NFR-1: Identical durable state produces byte-identical JSON and Markdown,
  independent of SQLite row order, request order, and restart.
- NFR-2: These routes are read-only and remain inside the existing loopback,
  network-disabled parser profile; they invoke no parser, OCR, provider, Git,
  publication, or promotion capability.
- NFR-3: Invalid state produces stable non-echoing errors and never a partial
  content response.

## Acceptance criteria

Scenario: Read a completed mixed document
Given a completed batch containing native and OCR pages
When the curator lists its documents and opens one Markdown result
Then the result is deterministic, readable, page-separated, provenance-rich,
and low-confidence OCR is visible.

Scenario: Reconstruct native text by the real schema
Given contiguous chunks using `text:<offset>,0,<length>`
When reconstruction runs
Then text is concatenated by offset without inserted or deleted characters.

Scenario: Reconstruct OCR reading order
Given OCR words on several coordinate lines
When reconstruction runs
Then words and lines follow the documented stable coordinate rule.

Scenario: Isolate batches and unfinished items
Given an incomplete batch, an unprocessed item, or a source from another batch
When a listing or document is requested
Then no extracted content is returned and a stable safe error is reported.

Scenario: Detect corrupt or oversized output
Given invalid durable state, malformed provenance, broken FTS integrity, or a
result above its output bound
When a readable result is requested
Then the service fails closed with no partial body.

Scenario: Keep extracted markup inert
Given extracted script, HTML, Markdown links, images, and backticks
When Markdown and browser views are requested
Then those characters remain visible text and do not execute or create markup.

## Failure modes

- Missing or mismatched resource: `readable_result_not_found` without revealing
  membership in another batch.
- Batch not completed: `readable_result_unavailable` with HTTP 409.
- Corrupt index/state/provenance: `readable_state_invalid` with HTTP 409.
- Output limit: `readable_result_too_large` with HTTP 413.

## Open questions

- UI styling and later semantic summaries remain separate changes and may not
  weaken the source, bounds, provenance, or escaping contract.
- Full OCR character accuracy and accessibility remain real-corpus evidence,
  not claims made by deterministic reconstruction.
