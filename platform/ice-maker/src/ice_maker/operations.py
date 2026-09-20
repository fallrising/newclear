"""Strict, local-only observability and Phase 7 evidence contracts."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
from types import MappingProxyType
from typing import Any, Mapping


class OperationsError(ValueError):
    """An observability contract or local evidence item is unsafe or invalid."""


_NAME = re.compile(r"^[a-z][a-z0-9_]{1,63}$")
_ARTIFACT_DIGEST = re.compile(r"^[0-9a-f]{64}$")
_COMMIT_DIGEST = re.compile(r"^[0-9a-f]{40}$")
_SENSITIVE = re.compile(r"(?i)\b(?:api[_-]?key|authorization|bearer|credential|password|private[ _-]?key|token|secret)\b")
_MAX_CONFIGURATION_BYTES = 65_536
_REQUIRED_METRICS = (
    "broken_links", "cache_hit_rate", "duplicate_ratio", "estimated_cost_usd",
    "lead_time_seconds", "notes_without_provenance", "ocr_confidence",
    "provider_latency_seconds", "retry_count", "revert_rate", "review_findings",
    "runner_queue_seconds", "sandbox_cleanup_failures", "secret_scan_findings",
    "task_block_rate", "task_failure_rate", "task_success_rate", "taxonomy_proposals",
    "test_pass_rate", "token_usage", "tool_usage",
)
_MINIMUM_METRICS = frozenset({
    "cache_hit_rate", "ocr_confidence", "task_success_rate", "test_pass_rate",
})
DEVELOPMENT_COMPLETE = "DEVELOPMENT_COMPLETE"
LOCAL_EVIDENCE_INVALID = "LOCAL_EVIDENCE_INVALID"
EXTERNAL_PRODUCTION_GATES = (
    "EXTERNAL_RUNNER_ATTESTATION", "EXTERNAL_IDENTITY_ATTESTATION",
    "EXTERNAL_EGRESS_ATTESTATION", "EXTERNAL_RESTORE_ATTESTATION",
    "EXTERNAL_CREDENTIAL_ROTATION_ATTESTATION",
    "EXTERNAL_TELEMETRY_COST_ALERT_ATTESTATION",
    "EXTERNAL_COMPROMISED_RUNNER_DRILL_ATTESTATION",
    "HUMAN_PRODUCTION_APPROVAL",
)


def _reject_constant(_: str) -> None:
    raise OperationsError("non-finite JSON number")


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise OperationsError("duplicate JSON key")
        value[key] = item
    return value


def _load_json(path: str | Path) -> Any:
    directory_fd = -1
    file_fd = -1
    try:
        raw_path = os.fspath(path)
        if (not isinstance(raw_path, str) or not raw_path or "\x00" in raw_path
                or ".." in Path(raw_path).parts):
            raise OperationsError("configuration path is unsafe")
        parts = Path(os.path.abspath(raw_path)).parts
        if len(parts) < 2:
            raise OperationsError("configuration path is unsafe")
        directory_fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        for component in parts[1:-1]:
            next_fd = os.open(
                component,
                os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW,
                dir_fd=directory_fd,
            )
            os.close(directory_fd)
            directory_fd = next_fd
        file_fd = os.open(
            parts[-1], os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW,
            dir_fd=directory_fd,
        )
        metadata = os.fstat(file_fd)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > _MAX_CONFIGURATION_BYTES:
            raise OperationsError("configuration path is unsafe")
        raw = os.read(file_fd, _MAX_CONFIGURATION_BYTES + 1)
        if len(raw) > _MAX_CONFIGURATION_BYTES or os.read(file_fd, 1):
            raise OperationsError("configuration path is unsafe")
        return json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
    except (OSError, TypeError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise OperationsError("configuration is unreadable") from exc
    finally:
        if file_fd >= 0:
            os.close(file_fd)
        if directory_fd >= 0:
            os.close(directory_fd)


def _safe_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 128 or any(ord(char) < 32 for char in value):
        raise OperationsError("invalid " + field)
    if _SENSITIVE.search(value) or "-----begin" in value.lower():
        raise OperationsError("unsafe " + field)
    return value


def _finite(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise OperationsError("invalid " + field)
    result = float(value)
    if not math.isfinite(result) or result < 0:
        raise OperationsError("invalid " + field)
    return result


@dataclass(frozen=True, slots=True)
class MetricDefinition:
    name: str
    maximum: float
    threshold: float
    direction: str

    def __post_init__(self) -> None:
        if (not isinstance(self.name, str) or self.name not in _REQUIRED_METRICS
                or self.direction != ("minimum" if self.name in _MINIMUM_METRICS else "maximum")):
            raise OperationsError("invalid metric definition")
        maximum = _finite(self.maximum, "metric maximum")
        threshold = _finite(self.threshold, "metric threshold")
        if maximum <= 0 or threshold > maximum:
            raise OperationsError("metric bounds are invalid")


@dataclass(frozen=True, slots=True)
class MetricSample:
    name: str
    value: float
    labels: tuple[tuple[str, str], ...]

    def __post_init__(self) -> None:
        if (not isinstance(self.name, str) or self.name not in _REQUIRED_METRICS
                or _finite(self.value, "metric value") != float(self.value)
                or not isinstance(self.labels, tuple) or len(self.labels) > 8):
            raise OperationsError("metric labels must be a bounded tuple")
        prior = ""
        for pair in self.labels:
            if not isinstance(pair, tuple) or len(pair) != 2:
                raise OperationsError("metric label is invalid")
            key, value = pair
            _safe_text(key, "metric label")
            _safe_text(value, "metric label")
            if not _NAME.fullmatch(key) or key <= prior:
                raise OperationsError("metric labels are not deterministically ordered")
            prior = key


@dataclass(frozen=True, slots=True)
class MetricRegistry:
    metrics: Mapping[str, MetricDefinition]

    def __post_init__(self) -> None:
        if (not isinstance(self.metrics, Mapping) or tuple(self.metrics) != _REQUIRED_METRICS
                or any(not isinstance(value, MetricDefinition) or value.name != name
                       for name, value in self.metrics.items())):
            raise OperationsError("invalid metric registry")
        object.__setattr__(self, "metrics", MappingProxyType(dict(self.metrics)))


@dataclass(frozen=True, slots=True)
class DashboardPanel:
    identifier: str
    metric: str
    threshold: float
    direction: str

    def __post_init__(self) -> None:
        if (not isinstance(self.identifier, str) or not _NAME.fullmatch(self.identifier)
                or not isinstance(self.metric, str) or not _NAME.fullmatch(self.metric)
                or self.direction not in {"minimum", "maximum"}):
            raise OperationsError("invalid dashboard panel")
        _finite(self.threshold, "dashboard threshold")


@dataclass(frozen=True, slots=True)
class Dashboard:
    panels: tuple[DashboardPanel, ...]

    def __post_init__(self) -> None:
        if (not isinstance(self.panels, tuple) or len(self.panels) != len(_REQUIRED_METRICS)
                or any(not isinstance(panel, DashboardPanel) for panel in self.panels)
                or tuple(panel.identifier for panel in self.panels)
                != tuple(sorted(panel.identifier for panel in self.panels))
                or {panel.metric for panel in self.panels} != set(_REQUIRED_METRICS)):
            raise OperationsError("invalid dashboard")


@dataclass(frozen=True, slots=True)
class MetricSnapshot:
    samples: tuple[MetricSample, ...]
    violations: tuple[str, ...]

    def __post_init__(self) -> None:
        if (not isinstance(self.samples, tuple) or not isinstance(self.violations, tuple)
                or any(not isinstance(sample, MetricSample) for sample in self.samples)
                or tuple(sample.name for sample in self.samples) != _REQUIRED_METRICS
                or len(set(self.violations)) != len(self.violations)
                or any(violation not in {
                    "metric:" + name + ":threshold" for name in _REQUIRED_METRICS
                } for violation in self.violations)
                or tuple(self.violations) != tuple(sorted(
                    self.violations,
                    key=lambda violation: _REQUIRED_METRICS.index(violation.split(":")[1]),
                ))):
            raise OperationsError("invalid metric snapshot")


def load_metric_registry(raw: Any) -> MetricRegistry:
    if not isinstance(raw, Mapping) or set(raw) != {"version", "metrics"} or raw.get("version") != 1:
        raise OperationsError("metric registry schema is invalid")
    entries = raw["metrics"]
    if not isinstance(entries, list) or len(entries) != len(_REQUIRED_METRICS):
        raise OperationsError("metric registry is incomplete")
    metrics: dict[str, MetricDefinition] = {}
    previous = ""
    for entry in entries:
        if not isinstance(entry, Mapping) or set(entry) != {"name", "maximum", "threshold", "direction"}:
            raise OperationsError("metric definition schema is invalid")
        name = entry["name"]
        if not isinstance(name, str) or name not in _REQUIRED_METRICS or name <= previous:
            raise OperationsError("metric names are invalid or unordered")
        metrics[name] = MetricDefinition(name, entry["maximum"], entry["threshold"], entry["direction"])
        previous = name
    if tuple(metrics) != _REQUIRED_METRICS:
        raise OperationsError("required metrics are missing")
    return MetricRegistry(metrics)


def load_metric_registry_file(path: str | Path) -> MetricRegistry:
    return load_metric_registry(_load_json(path))


def load_dashboard(raw: Any, registry: MetricRegistry) -> Dashboard:
    if not isinstance(registry, MetricRegistry) or not isinstance(raw, Mapping) or set(raw) != {"version", "panels"} or raw.get("version") != 1:
        raise OperationsError("dashboard schema is invalid")
    entries = raw["panels"]
    if not isinstance(entries, list) or len(entries) != len(registry.metrics):
        raise OperationsError("dashboard is incomplete")
    panels: list[DashboardPanel] = []
    prior = ""
    seen_metrics: set[str] = set()
    for entry in entries:
        if not isinstance(entry, Mapping) or set(entry) != {"identifier", "metric", "threshold", "direction"}:
            raise OperationsError("dashboard panel schema is invalid")
        identifier, name = entry["identifier"], entry["metric"]
        if not isinstance(identifier, str) or not _NAME.fullmatch(identifier) or identifier <= prior or name not in registry.metrics or name in seen_metrics:
            raise OperationsError("dashboard panel is invalid")
        threshold = _finite(entry["threshold"], "dashboard threshold")
        definition = registry.metrics[name]
        if threshold != definition.threshold or entry["direction"] != definition.direction:
            raise OperationsError("dashboard threshold does not match metric registry")
        panels.append(DashboardPanel(identifier, name, threshold, entry["direction"]))
        seen_metrics.add(name)
        prior = identifier
    return Dashboard(tuple(panels))


def load_dashboard_file(path: str | Path, registry: MetricRegistry) -> Dashboard:
    return load_dashboard(_load_json(path), registry)


def evaluate_snapshot(registry: MetricRegistry, samples: tuple[MetricSample, ...]) -> MetricSnapshot:
    if not isinstance(registry, MetricRegistry) or not isinstance(samples, tuple) or len(samples) != len(registry.metrics):
        raise OperationsError("metric samples must be a complete immutable tuple")
    previous = ""
    violations: list[str] = []
    for sample in samples:
        if not isinstance(sample, MetricSample) or sample.name not in registry.metrics or sample.name <= previous:
            raise OperationsError("metric samples are invalid or unordered")
        value = _finite(sample.value, "metric value")
        definition = registry.metrics[sample.name]
        if value > definition.maximum:
            raise OperationsError("metric value exceeds configured bound")
        if ((definition.direction == "maximum" and value > definition.threshold)
                or (definition.direction == "minimum" and value < definition.threshold)):
            violations.append("metric:" + sample.name + ":threshold")
        previous = sample.name
    if tuple(sample.name for sample in samples) != tuple(registry.metrics):
        raise OperationsError("metric samples are incomplete")
    return MetricSnapshot(samples, tuple(violations))


@dataclass(frozen=True, slots=True)
class LocalEvidence:
    control: str
    commit_digest: str
    environment_class: str
    result: str
    artifact_digest: str
    digest: str

    def __post_init__(self) -> None:
        _validate_local_evidence(self)


def _evidence_digest(control: str, commit_digest: str, artifact_digest: str) -> str:
    encoded = json.dumps({"artifact_digest": artifact_digest, "commit_digest": commit_digest,
                          "control": control, "environment_class": "local", "result": "passed"},
                         sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _validate_local_evidence(item: LocalEvidence) -> None:
    if (not isinstance(item.control, str) or not _NAME.fullmatch(item.control)
            or _safe_text(item.control, "evidence control") != item.control
            or not isinstance(item.commit_digest, str) or not _COMMIT_DIGEST.fullmatch(item.commit_digest)
            or item.environment_class != "local" or item.result != "passed"
            or not isinstance(item.artifact_digest, str) or not _ARTIFACT_DIGEST.fullmatch(item.artifact_digest)
            or not isinstance(item.digest, str) or not _ARTIFACT_DIGEST.fullmatch(item.digest)
            or item.digest != _evidence_digest(item.control, item.commit_digest, item.artifact_digest)):
        raise OperationsError("invalid local evidence")


def build_local_evidence(control: str, commit_digest: str, artifact_digest: str) -> LocalEvidence:
    if not isinstance(control, str) or not _NAME.fullmatch(control) or _safe_text(control, "evidence control") != control:
        raise OperationsError("invalid evidence control")
    if (not isinstance(commit_digest, str) or not _COMMIT_DIGEST.fullmatch(commit_digest)
            or not isinstance(artifact_digest, str) or not _ARTIFACT_DIGEST.fullmatch(artifact_digest)):
        raise OperationsError("invalid evidence digest")
    return LocalEvidence(control, commit_digest, "local", "passed", artifact_digest,
                         _evidence_digest(control, commit_digest, artifact_digest))


@dataclass(frozen=True, slots=True)
class Readiness:
    status: str
    external_gates: tuple[str, ...]

    def __post_init__(self) -> None:
        if self.status not in {DEVELOPMENT_COMPLETE, LOCAL_EVIDENCE_INVALID} or self.external_gates != EXTERNAL_PRODUCTION_GATES:
            raise OperationsError("invalid local readiness")


def evaluate_readiness(evidence: tuple[LocalEvidence, ...], required_controls: tuple[str, ...]) -> Readiness:
    invalid = Readiness(LOCAL_EVIDENCE_INVALID, EXTERNAL_PRODUCTION_GATES)
    if not isinstance(evidence, tuple) or not isinstance(required_controls, tuple) or not required_controls:
        return invalid
    if (any(not isinstance(control, str) or not _NAME.fullmatch(control) or _SENSITIVE.search(control)
            for control in required_controls)
            or len(set(required_controls)) != len(required_controls)):
        return invalid
    if len(evidence) != len(required_controls):
        return invalid
    commits: set[str] = set()
    controls: set[str] = set()
    for item in evidence:
        if not isinstance(item, LocalEvidence):
            return invalid
        try:
            _validate_local_evidence(item)
        except OperationsError:
            return invalid
        controls.add(item.control)
        commits.add(item.commit_digest)
    if controls != set(required_controls) or len(commits) != 1:
        return invalid
    return Readiness(DEVELOPMENT_COMPLETE, EXTERNAL_PRODUCTION_GATES)
