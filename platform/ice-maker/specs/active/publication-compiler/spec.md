---
id: SDD-0006
title: Reproducible publication compiler
status: approved
owner: fallrising
risk: medium
data_class: internal
budget_usd: 3
allowed_paths:
  - "src/ice_maker/**"
  - "tests/**"
  - "books/**"
  - "knowledge/50-patterns/**"
  - "docs/runbooks/**"
  - "docs/verification/**"
forbidden_paths:
  - ".git/**"
  - "docs/sdd/**"
  - ".github/**"
  - "orchestration/policies/**"
---

# Reproducible publication compiler

## Context

Phase 6 treats a book as a generated view over reviewed knowledge. The compiler
must assemble manifests without creating a second source of truth, preserve
cross-references and exact bibliography identities, and make builds reproducible
from a declared Git source commit. Phase 5 evidence remains explicitly synthetic.

## Goals

- G-1: Parse bounded immutable book manifests and knowledge chapter records.
- G-2: Assemble deterministic Markdown and HTML with validated cross-references
  and bibliography entries.
- G-3: Rebuild two books that share one synthetic knowledge source after all
  generated output has been deleted.

## Non-goals

- EPUB/PDF output, WYSIWYG editing, a web server, automatic Git mutation, merge,
  deploy, or network publishing.
- Treating generated output as source of truth or synthetic Phase 5 fixtures as
  real production experience.
- Rights review for a public release or production object storage.

## User stories

- As an author, I can order reviewed knowledge through a manifest and rebuild a
  complete book without editing generated files.
- As a reader, I can follow chapter cross-references and identify every cited
  source chunk in a stable bibliography.
- As a maintainer, I can prove which source commit produced an exact Markdown or
  HTML artifact and reuse one knowledge chapter in multiple books.

## Functional requirements

- FR-1: Accept only strict, bounded, versioned JSON manifests and knowledge
  chapter records with relative repository paths and exact SHA-256 citations.
- FR-2: Assemble chapters in manifest order, resolve declared cross-references,
  reject missing/duplicate sources, and deduplicate bibliography entries by
  exact citation identity.
- FR-3: Render byte-stable Markdown and escaped HTML from the same assembled
  book, including its manifest identity and lowercase 40-hex source commit SHA.
- FR-4: Load sources beneath the repository root without following symlinks and
  publish both outputs beneath a caller-selected output root using atomic,
  fail-closed writes.
- FR-5: A clean build after output deletion emits byte-identical files for the
  same manifest, knowledge bytes, and source commit SHA.
- FR-6: Two tracked book manifests reuse the same explicitly synthetic pattern
  source and independently produce complete Markdown and HTML outputs.

## Non-functional requirements

- Python 3.11 standard library only; bounded bytes, arrays, text, chapters, and
  references; canonical JSON; no timestamps, random values, shell, or network.
- Reject duplicate JSON keys, unknown fields, traversal, absolute/drive paths,
  symlink components, malformed Unicode/control/secret text, citation drift,
  source identity mismatch, output collisions, and generated-file input.
- Generated artifacts live below ignored `.ice-maker/`; tracked manifests and
  knowledge records remain the only publication inputs.

## Acceptance criteria

Scenario: Rebuild two books from shared knowledge
Given two tracked manifests that both name one explicitly synthetic pattern
When their generated directory is deleted and both books are built twice from
the same source commit SHA
Then each Markdown and HTML artifact is byte-identical across rebuilds, records
that SHA, and contains the shared chapter and its exact bibliography citations.

Scenario: Resolve chapters and references
Given a bounded manifest with ordered chapters and valid cross-references
When the compiler assembles the book
Then chapter order is preserved, links resolve to stable anchors, and duplicate
citations appear once in a deterministic bibliography.

Scenario: Reject unsafe publication input
Given a malformed manifest, missing chapter, citation drift, path traversal,
symlinked source, or generated-file source
When a build is attempted
Then no output is published and any existing valid output remains unchanged.

## Failure modes

- Manifest/source drift: reject before rendering and identify only the affected
  relative path, never untrusted content.
- Partial output failure: do not expose one format without the other; retain or
  restore the prior complete pair.
- Unknown rights or production status: keep the fixture synthetic and the
  publication external-pending; never relabel it through a manifest.

## Open questions

- EPUB/PDF toolchain and public-release rights review remain future decisions.
- A production publishing target, CDN, and signing identity are not part of this
  local build.
