"""Metrics counter validation."""

from __future__ import annotations

import pytest

from secure_mqtt.observability.metrics import Metrics


def test_metrics_increment_and_snapshot() -> None:
    metrics = Metrics()
    metrics.inc("mqtt_connect_total", result="success")
    metrics.inc("envelope_open_fail_total", reason="InvalidSignatureError")
    assert metrics.get("mqtt_connect_total", result="success") == 1
    assert metrics.get("envelope_open_fail_total", reason="InvalidSignatureError") == 1
    snapshot = metrics.snapshot()
    assert "mqtt_connect_total{result=success}" in snapshot


def test_unknown_counter_rejected() -> None:
    metrics = Metrics()
    with pytest.raises(ValueError, match="Unknown metric counter"):
        metrics.inc("not_allowed_total")
