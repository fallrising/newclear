"""Static analysis guards for insecure TLS settings."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PAHO_TRANSPORT = ROOT / "src" / "secure_mqtt" / "mqtt" / "paho_transport.py"


def test_no_cert_none_in_transport_source() -> None:
    source = PAHO_TRANSPORT.read_text(encoding="utf-8")
    assert "verify_mode = ssl.CERT_REQUIRED" in source
    assert "verify_mode = ssl.CERT_NONE" not in source


def test_no_tls_insecure_set_true() -> None:
    source = PAHO_TRANSPORT.read_text(encoding="utf-8")
    assert "tls_insecure_set(True)" not in source
    assert "tls_insecure_set(False)" in source
