"""Deterministic, fail-closed provider alias routing and task usage accounting."""

from __future__ import annotations

from dataclasses import dataclass
import json
import math
import re
from types import MappingProxyType
from typing import Any, Mapping


class RoutingError(ValueError):
    """A routing policy, route, or usage entry is invalid or unavailable."""


_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{1,63}$")
_PROVIDERS = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
_ALIAS_KEYS = frozenset({"provider", "role", "tier", "cost_usd", "fallback_aliases"})
_OUTCOMES = frozenset({"success", "failure"})
_UNSAFE_SIGNATURE = re.compile(r"(?i)(?:api[_-]?key|authorization|bearer|credential|password|private\s+key|secret|token)\s*[:=\s]")


@dataclass(frozen=True)
class AliasRoute:
    alias: str
    provider: str
    role: str
    tier: int
    cost_usd: float


@dataclass(frozen=True)
class UsageEntry:
    provider: str
    alias: str
    attempt: int
    latency: float
    cost_usd: float
    outcome: str
    failure_signature: str


def _finite_nonnegative(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise RoutingError("invalid " + label)
    value = float(value)
    if not math.isfinite(value) or value < 0:
        raise RoutingError("invalid " + label)
    return value


def normalize_failure_signature(value: Any) -> str:
    if not isinstance(value, str):
        raise RoutingError("invalid failure signature")
    if any(ord(c) < 32 for c in value):
        raise RoutingError("invalid failure signature")
    normalized = " ".join(value.split()).lower()
    if (len(normalized) > 256 or _UNSAFE_SIGNATURE.search(normalized)
            or "-----begin" in normalized):
        raise RoutingError("invalid failure signature")
    return normalized


class RoutingConfig:
    def __init__(self, aliases: Mapping[str, AliasRoute], fallbacks: Mapping[str, tuple[str, ...]], attempt_ceiling: int, policy: Mapping[str, Any]):
        self.aliases = MappingProxyType(dict(aliases))
        self.fallbacks = MappingProxyType(dict(fallbacks))
        self.attempt_ceiling = attempt_ceiling
        self.policy = _freeze(policy)


def _freeze(value: Any) -> Any:
    if isinstance(value, Mapping):
        return MappingProxyType({key: _freeze(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(item) for item in value)
    return value


def load_routing_config(raw: Any, provider_policy: Mapping[str, Any]) -> RoutingConfig:
    """Validate exact alias-only routing configuration and its data matrix."""
    if not isinstance(raw, Mapping) or set(raw) != {"version", "attempt_ceiling", "aliases"} or raw.get("version") != 1:
        raise RoutingError("routing configuration schema is invalid")
    ceiling = raw.get("attempt_ceiling")
    if isinstance(ceiling, bool) or not isinstance(ceiling, int) or not 1 <= ceiling <= 32:
        raise RoutingError("invalid attempt ceiling")
    aliases_raw = raw.get("aliases")
    if not isinstance(aliases_raw, Mapping) or not aliases_raw:
        raise RoutingError("routing aliases are invalid")
    if not isinstance(provider_policy, Mapping) or provider_policy.get("default") != "deny":
        raise RoutingError("provider policy denies routing")
    classes = provider_policy.get("data_classes")
    providers = provider_policy.get("providers")
    if not isinstance(classes, list) or not all(isinstance(x, str) for x in classes) or not isinstance(providers, Mapping):
        raise RoutingError("provider policy is malformed")
    if len(set(classes)) != len(classes) or any(not isinstance(item, str) or not _NAME.fullmatch(item) for item in classes):
        raise RoutingError("provider policy is malformed")
    for provider, entry in providers.items():
        if (not isinstance(provider, str) or not _PROVIDERS.fullmatch(provider) or not isinstance(entry, Mapping)
                or set(entry) != {"egress", "allowed_data_classes", "blocked_data_classes"}
                or not isinstance(entry.get("egress"), bool)
                or not isinstance(entry.get("allowed_data_classes"), list)
                or not isinstance(entry.get("blocked_data_classes"), list)
                or not all(isinstance(item, str) for item in entry["allowed_data_classes"])
                or not all(isinstance(item, str) for item in entry["blocked_data_classes"])
                or len(set(entry["allowed_data_classes"])) != len(entry["allowed_data_classes"])
                or len(set(entry["blocked_data_classes"])) != len(entry["blocked_data_classes"])
                or set(entry["allowed_data_classes"]) & set(entry["blocked_data_classes"])
                or any(item not in classes for item in entry["allowed_data_classes"] + entry["blocked_data_classes"])):
            raise RoutingError("provider policy is malformed")
    aliases: dict[str, AliasRoute] = {}
    fallback_values: dict[str, tuple[str, ...]] = {}
    for alias, value in aliases_raw.items():
        if not isinstance(alias, str) or not _NAME.fullmatch(alias) or not isinstance(value, Mapping) or set(value) != _ALIAS_KEYS:
            raise RoutingError("routing alias schema is invalid")
        provider, role, tier, cost = value["provider"], value["role"], value["tier"], value["cost_usd"]
        if not isinstance(provider, str) or not _PROVIDERS.fullmatch(provider) or provider not in providers:
            raise RoutingError("routing alias provider is invalid")
        if not isinstance(role, str) or not _NAME.fullmatch(role) or isinstance(tier, bool) or not isinstance(tier, int) or tier < 0:
            raise RoutingError("routing alias metadata is invalid")
        cost = _finite_nonnegative(cost, "route cost")
        if cost <= 0:
            raise RoutingError("route cost must be positive")
        fallbacks = value["fallback_aliases"]
        if not isinstance(fallbacks, list) or not all(isinstance(x, str) and _NAME.fullmatch(x) for x in fallbacks) or len(set(fallbacks)) != len(fallbacks):
            raise RoutingError("routing fallback aliases are invalid")
        aliases[alias] = AliasRoute(alias, provider, role, tier, cost)
        fallback_values[alias] = tuple(fallbacks)
    for alias, names in fallback_values.items():
        route = aliases[alias]
        for name in names:
            target = aliases.get(name)
            if target is None or target.role != route.role or target.tier != route.tier or name == alias:
                raise RoutingError("fallback must be a distinct equal-tier alias")
    return RoutingConfig(aliases, fallback_values, ceiling, provider_policy)


def select_route(config: RoutingConfig, role: str, data_class: str, health: Mapping[str, str], rate_limited: Mapping[str, bool], remaining_budget: float, *, allow_fallback: bool = False) -> AliasRoute:
    if not isinstance(config, RoutingConfig) or not isinstance(role, str) or not _NAME.fullmatch(role) or not isinstance(data_class, str):
        raise RoutingError("invalid route request")
    remaining_budget = _finite_nonnegative(remaining_budget, "remaining budget")
    if not isinstance(health, Mapping) or not isinstance(rate_limited, Mapping):
        raise RoutingError("provider status is malformed")
    known_providers = set(config.policy["providers"])
    if (any(not isinstance(key, str) or key not in known_providers or value not in {"healthy", "unhealthy"}
            for key, value in health.items())
            or any(not isinstance(key, str) or key not in known_providers or not isinstance(value, bool)
                   for key, value in rate_limited.items())):
        raise RoutingError("provider status is malformed")
    fallback_targets = {name for names in config.fallbacks.values() for name in names}
    candidates = [(name, route) for name, route in config.aliases.items() if route.role == role and name not in fallback_targets]
    if not candidates:
        raise RoutingError("no route is configured for role")
    for name, route in candidates:
        allowed = config.policy["providers"].get(route.provider)
        if not isinstance(allowed, Mapping) or data_class not in config.policy["data_classes"] or data_class not in allowed.get("allowed_data_classes", []) or data_class in allowed.get("blocked_data_classes", []):
            continue
        if health.get(route.provider) != "healthy" or rate_limited.get(route.provider) is not False or route.cost_usd > remaining_budget:
            continue
        return route
    if allow_fallback:
        primary_names = [name for name, route in candidates if route.role == role]
        for primary in primary_names:
            for name in config.fallbacks[primary]:
                route = config.aliases[name]
                allowed = config.policy["providers"].get(route.provider)
                if (health.get(route.provider) == "healthy" and rate_limited.get(route.provider) is False and route.cost_usd <= remaining_budget and data_class in config.policy["data_classes"] and isinstance(allowed, Mapping) and data_class in allowed.get("allowed_data_classes", []) and data_class not in allowed.get("blocked_data_classes", [])):
                    return route
    raise RoutingError("no eligible route; selection failed closed")


class TaskUsageLedger:
    """Append-only ledger; entries are frozen and exposed as an immutable tuple."""
    def __init__(self, task_budget: float, config: RoutingConfig | None = None, *, attempt_ceiling: int | None = None):
        self._task_budget = _finite_nonnegative(task_budget, "task budget")
        if config is not None and not isinstance(config, RoutingConfig):
            raise RoutingError("invalid routing configuration")
        configured_ceiling = config.attempt_ceiling if config is not None else 1
        if attempt_ceiling is None:
            attempt_ceiling = configured_ceiling
        if (isinstance(attempt_ceiling, bool) or not isinstance(attempt_ceiling, int)
                or attempt_ceiling < 1 or attempt_ceiling > configured_ceiling):
            raise RoutingError("invalid attempt ceiling")
        self._attempt_ceiling = attempt_ceiling
        self._config = config
        self._entries: list[UsageEntry] = []

    @property
    def task_budget(self) -> float:
        return self._task_budget

    @property
    def attempt_ceiling(self) -> int:
        return self._attempt_ceiling

    @property
    def entries(self) -> tuple[UsageEntry, ...]:
        return tuple(self._entries)

    @property
    def total_cost(self) -> float:
        return sum(item.cost_usd for item in self._entries)

    def record(self, provider: str, alias: str, attempt: int, latency: float, cost_usd: float, outcome: str, failure_signature: str = "") -> UsageEntry:
        if (not isinstance(provider, str) or not _PROVIDERS.fullmatch(provider)
                or not isinstance(alias, str) or not _NAME.fullmatch(alias)
                or (self._config is not None and (alias not in self._config.aliases
                                                   or self._config.aliases[alias].provider != provider))
                or isinstance(attempt, bool) or not isinstance(attempt, int)
                or attempt != len(self._entries) + 1 or attempt > self.attempt_ceiling):
            raise RoutingError("invalid usage attempt")
        latency = _finite_nonnegative(latency, "latency")
        cost_usd = _finite_nonnegative(cost_usd, "usage cost")
        if not isinstance(outcome, str) or outcome not in _OUTCOMES:
            raise RoutingError("invalid usage outcome")
        signature = normalize_failure_signature(failure_signature)
        if outcome == "failure" and not signature or outcome == "success" and signature:
            raise RoutingError("usage failure signature does not match outcome")
        if self.total_cost + cost_usd > self.task_budget:
            raise RoutingError("task cost ceiling exceeded")
        entry = UsageEntry(provider, alias, attempt, latency, cost_usd, outcome, signature)
        self._entries.append(entry)
        return entry

    def retry_allowed(self, failure_signature: str, attempt: int) -> bool:
        signature = normalize_failure_signature(failure_signature)
        if not signature or attempt >= self.attempt_ceiling:
            return False
        return sum(item.failure_signature == signature for item in self._entries) < 2


def load_routing_file(path: str, provider_policy: Mapping[str, Any]) -> RoutingConfig:
    try:
        with open(path, encoding="utf-8") as handle:
            return load_routing_config(json.load(handle), provider_policy)
    except (OSError, json.JSONDecodeError) as exc:
        raise RoutingError("routing configuration is unreadable") from exc
