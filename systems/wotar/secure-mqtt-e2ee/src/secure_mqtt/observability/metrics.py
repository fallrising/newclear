"""Low-cardinality counters per OPS-002."""

from __future__ import annotations

import threading
from collections import defaultdict
from dataclasses import dataclass, field

ALLOWED_COUNTERS = frozenset(
    {
        "mqtt_connect_total",
        "mqtt_disconnect_total",
        "mqtt_publish_total",
        "mqtt_puback_total",
        "mqtt_suback_total",
        "mqtt_receive_total",
        "envelope_open_fail_total",
        "envelope_open_success_total",
        "inbox_handler_total",
        "inbox_retry_total",
        "outbox_prepare_total",
        "outbox_ack_total",
        "replay_duplicate_total",
        "queue_full_total",
    }
)

ALLOWED_LABELS = frozenset({"result", "reason", "state"})


@dataclass
class Metrics:
    """Thread-safe in-process counters with bounded label cardinality."""

    _counters: defaultdict[str, int] = field(
        default_factory=lambda: defaultdict(int),
        repr=False,
    )
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def inc(self, name: str, **labels: str) -> None:
        if name not in ALLOWED_COUNTERS:
            msg = f"Unknown metric counter: {name}"
            raise ValueError(msg)
        for label in labels:
            if label not in ALLOWED_LABELS:
                msg = f"Unknown metric label: {label}"
                raise ValueError(msg)
        key = self._format_key(name, labels)
        with self._lock:
            self._counters[key] += 1

    def get(self, name: str, **labels: str) -> int:
        key = self._format_key(name, labels)
        with self._lock:
            return self._counters[key]

    def snapshot(self) -> dict[str, int]:
        with self._lock:
            return dict(self._counters)

    @staticmethod
    def _format_key(name: str, labels: dict[str, str]) -> str:
        if not labels:
            return name
        parts = ",".join(f"{key}={labels[key]}" for key in sorted(labels))
        return f"{name}{{{parts}}}"
