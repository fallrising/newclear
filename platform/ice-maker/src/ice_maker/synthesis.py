"""Synthetic-only composition of knowledge retrieval and promotion.

This local adapter deliberately delegates provenance, comparison, integrity, and
review validation to :mod:`knowledge_graph` and :mod:`promotion`.  It never
turns a fixture into production evidence.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass

from .knowledge_graph import (
    Comparison,
    GraphError,
    IntegrityReport,
    Note,
    compare_notes,
    integrity_report,
    retrieve_notes,
)
from .promotion import (
    Artifact,
    CriticDecision,
    HumanApproval,
    Hypothesis,
    PromotionStateMachine,
    promote,
)


class SynthesisError(ValueError):
    """The local synthetic journey is incomplete or unsafe."""


@dataclass(frozen=True, slots=True)
class SyntheticExperience:
    """A validated note explicitly confined to local synthetic acceptance."""

    note: Note
    synthetic: bool

    def __post_init__(self) -> None:
        if type(self.note) is not Note or type(self.synthetic) is not bool:
            raise SynthesisError("synthetic experience is malformed")


@dataclass(frozen=True, slots=True)
class SynthesisJourney:
    """Pending pattern and its comparison evidence; it is not a publication."""

    pattern_note_ids: tuple[str, str]
    comparison: Comparison
    integrity: IntegrityReport
    information: Artifact
    knowledge: Artifact
    pattern: Artifact
    hypothesis: Artifact | None
    synthetic_only: bool
    _machine: PromotionStateMachine
    experiences: tuple[SyntheticExperience, SyntheticExperience]

    def __post_init__(self) -> None:
        if (type(self.pattern_note_ids) is not tuple or len(self.pattern_note_ids) != 2
                or type(self.comparison) is not Comparison
                or type(self.integrity) is not IntegrityReport
                or any(type(item) is not Artifact for item in
                       (self.information, self.knowledge, self.pattern))
                or (self.hypothesis is not None and type(self.hypothesis) is not Artifact)
                or type(self.synthetic_only) is not bool or not self.synthetic_only
                or type(self._machine) is not PromotionStateMachine):
            raise SynthesisError("synthetic journey is malformed")
        items = _experiences(self.experiences)
        left, right = (item.note for item in items)
        expected_comparison = compare_notes(left, right)
        citations = tuple(sorted({citation.chunk_id for note in (left, right)
                                  for citation in note.citations}))
        common_terms = tuple(sorted(set(left.terms) & set(right.terms)))
        if (not common_terms
                or tuple(note.note_id for note in retrieve_notes((left, right), common_terms[0], limit=2))
                != expected_comparison.note_ids
                or len(citations) < 2
                or self.pattern_note_ids != expected_comparison.note_ids
                or self.comparison != expected_comparison
                or self.integrity != integrity_report((left, right))
                or self.integrity.records):
            raise SynthesisError("synthetic journey evidence is malformed")
        content = (f"synthetic horizontal comparison of {self.pattern_note_ids[0]} "
                   f"and {self.pattern_note_ids[1]}")
        artifacts = (self.information, self.knowledge, self.pattern)
        if (tuple(item.stage for item in artifacts) != ("information", "knowledge", "pattern")
                or any(item.content != content or item.grounded_citations != citations
                       or item.hypotheses for item in artifacts)
                or len({item.builder for item in artifacts}) != 1
                or self.information.parent_digest is not None
                or self.knowledge.parent_digest != self.information.digest
                or self.pattern.parent_digest != self.knowledge.digest):
            raise SynthesisError("synthetic journey artifacts are malformed")
        if self.hypothesis is not None:
            hypothesis = self.hypothesis
            if (hypothesis.stage != "information" or hypothesis.builder != self.information.builder
                    or hypothesis.parent_digest is not None or hypothesis.grounded_citations
                    or len(hypothesis.hypotheses) != 1
                    or hypothesis.content != hypothesis.hypotheses[0].reason):
                raise SynthesisError("synthetic journey hypothesis is malformed")


def _experiences(values: object) -> tuple[SyntheticExperience, SyntheticExperience]:
    if type(values) is not tuple or len(values) != 2:
        raise SynthesisError("experiences must be a pair")
    items = values
    if (any(type(item) is not SyntheticExperience for item in items)
            or not all(item.synthetic for item in items)):
        raise SynthesisError("only two explicitly synthetic experiences are accepted")
    if items[0].note.note_id == items[1].note.note_id:
        raise SynthesisError("experiences must name distinct notes")
    if any(not item.note.citations for item in items):
        raise SynthesisError("each experience needs exact source chunks")
    return tuple(sorted(items, key=lambda item: item.note.note_id))  # type: ignore[return-value]


def inspect_experiences(experiences: object) -> IntegrityReport:
    """Return the graph-owned deterministic integrity report for fixtures."""
    items = _experiences(experiences)
    try:
        return integrity_report(tuple(item.note for item in items))
    except GraphError as exc:
        raise SynthesisError("experience integrity cannot be inspected") from exc


def compose_pattern(
    experiences: object, builder: str, *, inference: str | None = None,
) -> SynthesisJourney:
    """Build a pending, cited pattern candidate from two synthetic experiences."""
    items = _experiences(experiences)
    report = inspect_experiences(items)
    if report.records:
        raise SynthesisError("integrity findings block pattern composition")
    left, right = (item.note for item in items)
    common_terms = tuple(sorted(set(left.terms) & set(right.terms)))
    if not common_terms:
        raise SynthesisError("comparison lacks shared retrieval evidence")
    try:
        retrieved = retrieve_notes((left, right), common_terms[0], limit=2)
        comparison = compare_notes(left, right)
    except GraphError as exc:
        raise SynthesisError("comparison is invalid") from exc
    if tuple(note.note_id for note in retrieved) != comparison.note_ids:
        raise SynthesisError("retrieval did not resolve both compared experiences")
    citations = tuple(sorted({citation.chunk_id for note in (left, right) for citation in note.citations}))
    if len(citations) < 2:
        raise SynthesisError("comparison requires independent source chunks")
    names = comparison.note_ids
    content = f"synthetic horizontal comparison of {names[0]} and {names[1]}"
    information = Artifact("information", content, citations, (), builder, None)
    knowledge = Artifact("knowledge", content, citations, (), builder, information.digest)
    pattern = Artifact("pattern", content, citations, (), builder, knowledge.digest)
    hypothesis = None
    if inference is not None:
        hypothesis = Artifact("information", inference, (), (Hypothesis(inference),), builder, None)
    return SynthesisJourney(names, comparison, report, information, knowledge, pattern,
                            hypothesis, True, PromotionStateMachine(), items)


def approve_pattern(
    journey: SynthesisJourney,
    knowledge_critic: CriticDecision | None,
    knowledge_human: HumanApproval | None,
    pattern_critic: CriticDecision | None,
    pattern_human: HumanApproval | None,
) -> Artifact:
    """Promote the pending candidate only through both independent review gates."""
    if type(journey) is not SynthesisJourney:
        raise SynthesisError("journey must be canonical")
    # Validate both transitions against a snapshot before the retained ledger is
    # changed.  The state machine remains the sole source of transition rules.
    preflight = deepcopy(journey._machine)
    promote(preflight, journey.information, journey.knowledge,
            knowledge_critic, knowledge_human)
    promote(preflight, journey.knowledge, journey.pattern,
            pattern_critic, pattern_human)
    promote(journey._machine, journey.information, journey.knowledge,
            knowledge_critic, knowledge_human)
    return promote(journey._machine, journey.knowledge, journey.pattern,
                   pattern_critic, pattern_human)
