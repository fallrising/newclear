"""Local, digest-bound knowledge promotion with explicit human gates.

This module deliberately has no publisher, provider, Git, clock, or filesystem
boundary.  It validates already-local values and returns immutable artifacts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
import re


class PromotionError(ValueError):
    """A candidate or review record cannot safely be promoted."""


_STAGES = ("information", "knowledge", "pattern", "principle")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SECRET = re.compile(r"(?i)(?:api[_-]?key|token|password|secret)\s*[:=]")
_MAX_CONTENT = 16_384
_MAX_CITATIONS = 100
_MAX_HYPOTHESES = 1


def _text(value: object, maximum: int, label: str) -> str:
    if (
        not isinstance(value, str)
        or not value.strip()
        or len(value) > maximum
        or any(ord(char) < 32 or ord(char) > 126 for char in value)
        or _SECRET.search(value)
    ):
        raise PromotionError(f"{label} is malformed or unsafe")
    return value


def _identifier(value: object, label: str) -> str:
    if not isinstance(value, str) or not _IDENTIFIER.fullmatch(value):
        raise PromotionError(f"{label} is malformed")
    return value


def _digest(value: object, label: str) -> str:
    if not isinstance(value, str) or not _SHA256.fullmatch(value):
        raise PromotionError(f"{label} is malformed")
    return value


def _canonical_digest(record: dict[str, object]) -> str:
    encoded = json.dumps(
        record, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    ).encode("ascii")
    return hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True, slots=True)
class Hypothesis:
    """An explicitly unsupported conclusion, retained without a fake source."""

    reason: str

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "reason", _text(self.reason, 1_024, "hypothesis reason")
        )


@dataclass(frozen=True, slots=True)
class Artifact:
    """A canonical, immutable conclusion at one promotion stage."""

    stage: str
    content: str
    grounded_citations: tuple[str, ...]
    hypotheses: tuple[Hypothesis, ...]
    builder: str
    parent_digest: str | None
    digest: str = field(init=False)

    def __post_init__(self) -> None:
        if self.stage not in _STAGES:
            raise PromotionError("unknown artifact stage")
        object.__setattr__(
            self, "content", _text(self.content, _MAX_CONTENT, "content")
        )
        object.__setattr__(self, "builder", _identifier(self.builder, "builder"))
        if (
            type(self.grounded_citations) is not tuple
            or len(self.grounded_citations) > _MAX_CITATIONS
        ):
            raise PromotionError("citations are unbounded or mutable")
        citations = tuple(
            _digest(item, "citation ID") for item in self.grounded_citations
        )
        if len(set(citations)) != len(citations):
            raise PromotionError("duplicate citation IDs")
        if (
            type(self.hypotheses) is not tuple
            or len(self.hypotheses) > _MAX_HYPOTHESES
        ):
            raise PromotionError("hypotheses are unbounded or mutable")
        if any(type(item) is not Hypothesis for item in self.hypotheses):
            raise PromotionError("hypothesis is malformed")
        # One artifact carries one conclusion: evidence-backed or explicitly
        # hypothetical, never an ambiguous mixture of the two.
        if bool(citations) == bool(self.hypotheses):
            raise PromotionError(
                "artifact must be grounded or an explicit hypothesis"
            )
        if self.stage == "information":
            if self.parent_digest is not None:
                raise PromotionError("information cannot have a parent")
            parent = None
        else:
            parent = _digest(self.parent_digest, "parent digest")
        object.__setattr__(self, "grounded_citations", citations)
        object.__setattr__(self, "parent_digest", parent)
        record = {
            "builder": self.builder, "content": self.content,
            "grounded_citations": citations,
            "hypotheses": tuple(item.reason for item in self.hypotheses),
            "parent_digest": parent, "stage": self.stage,
        }
        object.__setattr__(self, "digest", _canonical_digest(record))


@dataclass(frozen=True, slots=True)
class CriticDecision:
    candidate_digest: str
    actor: str
    accepted: bool

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "candidate_digest",
            _digest(self.candidate_digest, "candidate digest"),
        )
        object.__setattr__(self, "actor", _identifier(self.actor, "critic actor"))
        if type(self.accepted) is not bool:
            raise PromotionError("critic decision is malformed")


@dataclass(frozen=True, slots=True)
class HumanApproval:
    candidate_digest: str
    actor: str
    approved: bool

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "candidate_digest",
            _digest(self.candidate_digest, "candidate digest"),
        )
        object.__setattr__(self, "actor", _identifier(self.actor, "human actor"))
        if type(self.approved) is not bool:
            raise PromotionError("human approval is malformed")


class PromotionStateMachine:
    """A small local ledger that makes review records single-use."""

    def __init__(self) -> None:
        self._consumed: set[tuple[str, str, str]] = set()

    def promote(
        self,
        parent: Artifact,
        candidate: Artifact,
        critic: CriticDecision | None,
        human: HumanApproval | None,
    ) -> Artifact:
        if type(parent) is not Artifact or type(candidate) is not Artifact:
            raise PromotionError("artifacts must be canonical")
        if parent.stage == "principle":
            raise PromotionError("principle is the final promotion stage")
        expected_stage = _STAGES[_STAGES.index(parent.stage) + 1]
        if candidate.stage != expected_stage:
            raise PromotionError("promotion must advance exactly one stage")
        if candidate.parent_digest != parent.digest:
            raise PromotionError("candidate is stale or detached from its parent")
        if parent.hypotheses:
            raise PromotionError("hypotheses cannot support a promotion")
        if not set(parent.grounded_citations).issubset(candidate.grounded_citations):
            raise PromotionError("promotion lost grounded citations")
        if candidate.hypotheses:
            raise PromotionError("hypotheses cannot be promoted")
        if type(critic) is not CriticDecision or type(human) is not HumanApproval:
            raise PromotionError("independent critic and human decisions are required")
        if not critic.accepted or not human.approved:
            raise PromotionError("promotion was rejected")
        if (
            critic.candidate_digest != candidate.digest
            or human.candidate_digest != candidate.digest
        ):
            raise PromotionError("review decision is stale")
        if len({candidate.builder, critic.actor, human.actor}) != 3:
            raise PromotionError("builder, critic, and human must be distinct")
        keys = (
            ("critic", critic.actor, critic.candidate_digest),
            ("human", human.actor, human.candidate_digest),
        )
        if any(key in self._consumed for key in keys):
            raise PromotionError("review decision was replayed")
        self._consumed.update(keys)
        return candidate


def promote(
    machine: PromotionStateMachine,
    parent: Artifact,
    candidate: Artifact,
    critic: CriticDecision | None,
    human: HumanApproval | None,
) -> Artifact:
    """Promote using the caller-owned ledger that enforces single-use reviews."""
    if type(machine) is not PromotionStateMachine:
        raise PromotionError("a retained promotion state machine is required")
    return machine.promote(parent, candidate, critic, human)
