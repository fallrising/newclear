---
id: SDD-0005
title: Provenance-bound knowledge synthesis
status: approved
owner: fallrising
risk: high
data_class: internal
budget_usd: 4
allowed_paths:
  - "src/ice_maker/**"
  - "tests/**"
  - "docs/verification/**"
  - "docs/runbooks/**"
forbidden_paths:
  - ".git/**"
  - "docs/sdd/**"
  - ".github/**"
  - "orchestration/policies/**"
---

# Provenance-bound knowledge synthesis

## Context

Phase 5 must turn retrieved Phase 4 candidates into reviewable knowledge without
letting generated prose become evidence. The local build has no real production
corpus or provider execution, so acceptance uses explicitly synthetic
production-experience fixtures whose claims remain bound to source chunks.

## Goals

- G-1: Compare related notes and report duplicates, contradictions, and orphan
  links deterministically.
- G-2: Model explicit information, knowledge, pattern, and principle promotion
  states with immutable provenance and hypothesis labels.
- G-3: Require an independent critic decision and a distinct human approval
  before any promotion; no automatic publisher boundary exists.

## Non-goals

- Claims about real production experience, provider quality, organizational
  approval, or production corpus completeness.
- Automatic taxonomy changes, Git publication, merge, deployment, or network
  provider calls.
- Phase 6 book assembly or Phase 7 infrastructure operations.

## User stories

- As a curator, I can see why two experiences are related and which exact chunks
  support a proposed pattern.
- As a reviewer, I can distinguish grounded conclusions from hypotheses and
  block a promotion independently of the builder.
- As a maintainer, I can find duplicate, contradictory, and orphaned knowledge
  before it is promoted.

## Functional requirements

- FR-1: Load bounded immutable note records and retrieve/compare them using
  deterministic taxonomy, term, relation, and citation evidence.
- FR-2: Emit stable duplicate, contradiction, and orphan-link reports that cite
  the exact involved note and chunk identifiers.
- FR-3: Represent every conclusion as either `grounded` with non-empty exact
  citations or `hypothesis` with an explicit reason and no fabricated source.
- FR-4: Permit only information → knowledge → pattern → principle transitions;
  every transition binds the prior artifact digest and preserves all citations.
- FR-5: Require an accepted critic record from a reviewer distinct from the
  builder and a separate explicit human approval bound to the candidate digest.
- FR-6: Compare at least two synthetic production-experience fixtures
  horizontally and form one cited pattern candidate without claiming the
  fixtures are real production evidence.

## Non-functional requirements

- Python 3.11 standard library only; bounded collections/text, canonical JSON,
  immutable values, deterministic sorting, no clocks in evidence identities.
- Reject duplicate JSON keys, unknown fields/states/relations, path traversal,
  secret/control text, citation drift, stale decisions, and actor reuse.
- Synthesis is local-only and consumes validated objects; no shell, network,
  credential, provider, Git, publisher, or protected-path capability.

## Acceptance criteria

Scenario: Form a pattern from synthetic experiences
Given two explicitly synthetic production-experience notes with independent
source chunks and a shared operational outcome
When retrieval compares them and a builder proposes a pattern
Then the candidate names both notes, cites both source chunks, records the
horizontal comparison, and remains pending until critic and human gates pass.

Scenario: Report integrity conflicts
Given duplicate notes, opposed grounded conclusions, and a missing related note
When the integrity scan runs twice in different input order
Then both runs emit byte-identical duplicate, contradiction, and orphan reports
with exact note and citation identifiers.

Scenario: Mark unsupported inference
Given a conclusion has no source citation
When synthesis validates the proposal
Then it is represented only as a hypothesis with an explicit reason and cannot
be promoted as grounded evidence.

Scenario: Enforce independent human promotion
Given a digest-bound candidate and an accepted critic decision
When the reviewer is the builder, the human approval is absent, or either
decision is stale
Then promotion fails closed and no higher-level artifact is emitted.

## Failure modes

- Malformed or forged provenance: reject the entire candidate without partial
  state output.
- Missing/ambiguous comparison evidence: retain an unpromoted candidate or an
  explicit hypothesis; never infer a source.
- Critic rejection or missing human approval: remain at the current stage.
- Real production corpus absent: complete only synthetic local acceptance and
  retain the external-evidence limitation.

## Open questions

- Production curator identities, approval service, and audit retention remain
  operator-owned Phase 7 decisions.
- A real production experience may be admitted only after rights, privacy, and
  provenance evidence exists; it is not part of this build.
