"""Pure, human-gated draft publication request boundary."""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Callable

from .execution import ContractError, redact
from .orchestrator import OrchestrationEvidence, revalidate_evidence

_BRANCH = re.compile(r"^agent/[A-Za-z0-9][A-Za-z0-9._-]{2,127}$")
_REF_FORBIDDEN = re.compile(r"(?:\.\.|\.lock$|^\.|/$|//|[\x00-\x20~^:?*\\])")


@dataclass(frozen=True)
class PublicationRequest:
    branch: str
    base_ref: str
    title: str
    body: str
    evidence: OrchestrationEvidence
    draft: bool = True


def _safe(value: object, label: str) -> str:
    if (not isinstance(value, str) or not value or len(value) > 10000
            or redact(value) != value or "\x00" in value):
        raise ContractError(f"publication {label} is unsafe")
    return value


def _validate_branch(branch: object, task_id: str) -> str:
    if (not isinstance(branch, str) or redact(branch) != branch
            or branch != f"agent/{task_id}" or not _BRANCH.fullmatch(branch)
            or _REF_FORBIDDEN.search(branch)):
        raise ContractError("publication branch is unsafe")
    return branch


def build_publication_request(evidence: OrchestrationEvidence, *, branch: str, base_ref: str, title: str, body: str) -> PublicationRequest:
    revalidate_evidence(evidence)
    _validate_branch(branch, evidence.contract.task_id)
    if base_ref != "build/full-sdd" or _REF_FORBIDDEN.search(base_ref):
        raise ContractError("publication base must be build/full-sdd")
    return PublicationRequest(branch, base_ref, _safe(title, "title"), _safe(body, "body"), evidence, True)


def publish_draft(request: PublicationRequest, mutate: Callable[[PublicationRequest], object]) -> PublicationRequest:
    """Revalidate a directly constructed request before invoking its draft-only callback."""
    if not isinstance(request, PublicationRequest) or not request.draft or not callable(mutate):
        raise ContractError("publication request is invalid")
    validated = build_publication_request(request.evidence, branch=request.branch, base_ref=request.base_ref, title=request.title, body=request.body)
    mutate(validated)
    return validated
