"""Fail-closed composition of sealed builder, gate, and review boundaries."""

from __future__ import annotations

from dataclasses import dataclass
import json
import math
import re
import time
from typing import Callable

from .execution import CommandEvidence
from .routing import RoutingError, TaskUsageLedger, UsageEntry, load_routing_config, normalize_failure_signature


class PipelineError(ValueError):
    """A pipeline request is not a sealed Phase 3 execution boundary."""


_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{1,63}$")
_MAX_OUTPUT_BYTES = 65536
_STAGE_COSTS = {
    ("codex", "builder_primary"): 1.0,
    ("deepseek", "builder_economy"): 0.1,
    ("local", "deterministic_gate"): 0.0,
    ("claude", "reviewer_claude"): 1.0,
    ("grok", "critic_independent"): 0.5,
}
_BUILDERS = frozenset(_STAGE_COSTS) & {("codex", "builder_primary"), ("deepseek", "builder_economy")}
_REVIEWERS = frozenset(_STAGE_COSTS) & {("claude", "reviewer_claude"), ("grok", "critic_independent")}
_GATE = ("local", "deterministic_gate")


@dataclass(frozen=True)
class StageIdentity:
    """Alias-only identity; costs and roles are fixed by this module's route table."""

    provider: str
    alias: str

    def __post_init__(self) -> None:
        if (not isinstance(self.provider, str) or not _NAME.fullmatch(self.provider)
                or not isinstance(self.alias, str) or not _NAME.fullmatch(self.alias)):
            raise PipelineError("invalid pipeline stage identity")

    @property
    def route(self) -> tuple[str, str]:
        return (self.provider, self.alias)


BuilderInvoke = Callable[[], CommandEvidence]
GateInvoke = Callable[[CommandEvidence], CommandEvidence]
ReviewerInvoke = Callable[["ReviewInput"], CommandEvidence]


@dataclass(frozen=True)
class BuilderBoundary:
    identity: StageIdentity
    invoke: BuilderInvoke

    def __post_init__(self) -> None:
        if not isinstance(self.identity, StageIdentity) or self.identity.route not in _BUILDERS or not callable(self.invoke):
            raise PipelineError("builder boundary is not an approved typed route")


@dataclass(frozen=True)
class GateBoundary:
    identity: StageIdentity
    invoke: GateInvoke

    def __post_init__(self) -> None:
        if not isinstance(self.identity, StageIdentity) or self.identity.route != _GATE or not callable(self.invoke):
            raise PipelineError("gate boundary is not the local deterministic route")


@dataclass(frozen=True)
class ReviewerBoundary:
    identity: StageIdentity
    invoke: ReviewerInvoke
    read_only: bool

    def __post_init__(self) -> None:
        if (not isinstance(self.identity, StageIdentity) or self.identity.route not in _REVIEWERS
                or self.read_only is not True or not callable(self.invoke)):
            raise PipelineError("review boundary is not an approved read-only route")


@dataclass(frozen=True)
class PipelineRequest:
    """Immutable request containing only three pre-governed invocation boundaries."""

    builder: BuilderBoundary
    gate: GateBoundary
    reviewer: ReviewerBoundary
    task_budget_usd: float
    prior_failure_signatures: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if (not isinstance(self.builder, BuilderBoundary) or not isinstance(self.gate, GateBoundary)
                or not isinstance(self.reviewer, ReviewerBoundary)
                or self.builder.identity.provider == self.reviewer.identity.provider
                or isinstance(self.task_budget_usd, bool) or not isinstance(self.task_budget_usd, (int, float))
                or not math.isfinite(self.task_budget_usd) or self.task_budget_usd < 0
                or not isinstance(self.prior_failure_signatures, tuple)
                or len(self.prior_failure_signatures) > 2):
            raise PipelineError("invalid fail-closed pipeline request")
        try:
            normalized = tuple(normalize_failure_signature(item) for item in self.prior_failure_signatures)
        except RoutingError as exc:
            raise PipelineError("invalid prior failure evidence") from exc
        if normalized != self.prior_failure_signatures:
            raise PipelineError("prior failure evidence must be normalized")


@dataclass(frozen=True)
class ReviewInput:
    """The review boundary gets bounded execution evidence and nothing else."""

    builder_evidence: CommandEvidence
    gate_evidence: CommandEvidence


@dataclass(frozen=True)
class ReviewFinding:
    accepted: bool
    findings: tuple[str, ...]


@dataclass(frozen=True)
class PipelineResult:
    publishable: bool
    failed_stage: str | None
    builder_evidence: CommandEvidence | None
    gate_evidence: CommandEvidence | None
    review: ReviewFinding | None
    usage: tuple[UsageEntry, ...]


def _valid_evidence(value: object, *, output_required: bool) -> bool:
    if not isinstance(value, CommandEvidence):
        return False
    try:
        output_size = len(value.output.encode("utf-8")) if isinstance(value.output, str) else -1
    except UnicodeEncodeError:
        return False
    if (not isinstance(value.command, tuple) or not value.command
            or not all(isinstance(item, str) and item and "\x00" not in item for item in value.command)
            or isinstance(value.exit_code, bool) or not isinstance(value.exit_code, int)
            or not isinstance(value.output, str) or output_size > _MAX_OUTPUT_BYTES
            or type(value.timed_out) is not bool or type(value.truncated) is not bool):
        return False
    return (value.exit_code == 0 and not value.timed_out and not value.truncated
            and (not output_required or value.output.strip() not in {"", "[no output]"})
            and "[REDACTED]" not in value.output
            and not any("[REDACTED]" in item for item in value.command))


def _unique_json_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _parse_finding(evidence: CommandEvidence) -> ReviewFinding:
    if not _valid_evidence(evidence, output_required=True):
        raise PipelineError("review evidence is invalid")
    try:
        parsed = json.loads(evidence.output, object_pairs_hook=_unique_json_object)
    except (json.JSONDecodeError, ValueError) as exc:
        raise PipelineError("review finding is malformed") from exc
    if (not isinstance(parsed, dict) or set(parsed) != {"accepted", "findings"}
            or not isinstance(parsed["accepted"], bool) or not isinstance(parsed["findings"], list)
            or not all(isinstance(item, str) and item.strip() and len(item) <= 512 for item in parsed["findings"])):
        raise PipelineError("review finding is malformed")
    return ReviewFinding(parsed["accepted"], tuple(parsed["findings"]))


def _ledger(request: PipelineRequest) -> TaskUsageLedger:
    """The pipeline creates its own alias-bound, three-attempt usage ledger."""
    routes = (request.builder.identity, request.gate.identity, request.reviewer.identity)
    aliases = {
        identity.alias: {"provider": identity.provider,
                         "role": "gate" if identity.route == _GATE else ("builder" if identity.route in _BUILDERS else "reviewer"),
                         "tier": 1, "cost_usd": max(_STAGE_COSTS[identity.route], 0.000001),
                         "fallback_aliases": []}
        for identity in routes
    }
    providers = {identity.provider: {"egress": False, "allowed_data_classes": ["internal"], "blocked_data_classes": []}
                 for identity in routes}
    try:
        config = load_routing_config({"version": 1, "attempt_ceiling": 3, "aliases": aliases},
                                      {"default": "deny", "data_classes": ["internal"], "providers": providers})
        return TaskUsageLedger(request.task_budget_usd, config)
    except RoutingError as exc:
        raise PipelineError("pipeline usage ledger is invalid") from exc


def _cost(identity: StageIdentity) -> float:
    return _STAGE_COSTS[identity.route]


def _record(ledger: TaskUsageLedger, identity: StageIdentity, outcome: str, signature: str,
            started: float, *, cost: float | None = None) -> None:
    ledger.record(identity.provider, identity.alias, len(ledger.entries) + 1,
                  max(0.0, time.monotonic() - started), _cost(identity) if cost is None else cost,
                  outcome, signature)


def _result(stage: str, builder: CommandEvidence | None, gate: CommandEvidence | None,
            ledger: TaskUsageLedger) -> PipelineResult:
    return PipelineResult(False, stage, builder, gate, None, ledger.entries)


def _budget_allows(ledger: TaskUsageLedger, identity: StageIdentity) -> bool:
    return len(ledger.entries) < ledger.attempt_ceiling and ledger.total_cost + _cost(identity) <= ledger.task_budget


def _repeated_failure(request: PipelineRequest) -> bool:
    return len(request.prior_failure_signatures) == 2 and len(set(request.prior_failure_signatures)) == 1


def run_pipeline(request: PipelineRequest) -> PipelineResult:
    """Invoke the sealed boundaries in order; every exit other than success is non-publishable."""
    if not isinstance(request, PipelineRequest):
        raise PipelineError("pipeline requires an immutable request")
    ledger = _ledger(request)

    started = time.monotonic()
    if _repeated_failure(request) or not _budget_allows(ledger, request.builder.identity):
        signature = "repeated failure" if _repeated_failure(request) else "budget exhausted"
        _record(ledger, request.builder.identity, "failure", signature, started, cost=0.0)
        return _result("builder", None, None, ledger)
    try:
        built = request.builder.invoke()
    except Exception:
        built = None
    if not _valid_evidence(built, output_required=True):
        _record(ledger, request.builder.identity, "failure", "builder boundary failed", started)
        return _result("builder", built if isinstance(built, CommandEvidence) else None, None, ledger)
    _record(ledger, request.builder.identity, "success", "", started)

    started = time.monotonic()
    if not _budget_allows(ledger, request.gate.identity):
        _record(ledger, request.gate.identity, "failure", "budget exhausted", started, cost=0.0)
        return _result("gate", built, None, ledger)
    try:
        gated = request.gate.invoke(built)
    except Exception:
        gated = None
    if not _valid_evidence(gated, output_required=False):
        _record(ledger, request.gate.identity, "failure", "deterministic gate failed", started)
        return _result("gate", built, gated if isinstance(gated, CommandEvidence) else None, ledger)
    _record(ledger, request.gate.identity, "success", "", started)

    started = time.monotonic()
    if not _budget_allows(ledger, request.reviewer.identity):
        _record(ledger, request.reviewer.identity, "failure", "budget exhausted", started, cost=0.0)
        return _result("reviewer", built, gated, ledger)
    try:
        finding = _parse_finding(request.reviewer.invoke(ReviewInput(built, gated)))
    except Exception:
        finding = None
    if finding is None or not finding.accepted or finding.findings:
        _record(ledger, request.reviewer.identity, "failure", "review rejected", started)
        return _result("reviewer", built, gated, ledger)
    _record(ledger, request.reviewer.identity, "success", "", started)
    return PipelineResult(True, None, built, gated, finding, ledger.entries)
