"""Signing public-key registry validity-window tests."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from tests.fixtures import test_vector

from secure_mqtt.errors import ConfigurationError, UnknownSenderError
from secure_mqtt.keys.public_key_registry import SigningPublicKeyRecord, SigningPublicKeyRegistry
from secure_mqtt.policy.loader import load_public_key_registry


def _record(**kwargs: object) -> SigningPublicKeyRecord:
    values = {
        "sig_kid": "sig-v1-test",
        "sender_id": "device-001",
        "public_key": test_vector.public_key(),
    }
    values.update(kwargs)
    return SigningPublicKeyRecord(**values)  # type: ignore[arg-type]


@pytest.mark.parametrize("issued_at_ms", [1_000, 2_000, 3_000])
def test_validity_window_is_inclusive(issued_at_ms: int) -> None:
    registry = SigningPublicKeyRegistry(
        [
            _record(
                not_before=datetime.fromtimestamp(1, tz=UTC),
                not_after=datetime.fromtimestamp(3, tz=UTC),
            )
        ]
    )

    resolved = registry.resolve_for_envelope(
        "device-001",
        "sig-v1-test",
        issued_at_ms=issued_at_ms,
    )

    assert resolved.sig_kid == "sig-v1-test"


@pytest.mark.parametrize("issued_at_ms", [999, 3_001])
def test_validity_window_rejects_outside_issuance_time(issued_at_ms: int) -> None:
    registry = SigningPublicKeyRegistry(
        [
            _record(
                not_before=datetime.fromtimestamp(1, tz=UTC),
                not_after=datetime.fromtimestamp(3, tz=UTC),
            )
        ]
    )

    with pytest.raises(UnknownSenderError, match="validity window"):
        registry.resolve_for_envelope(
            "device-001",
            "sig-v1-test",
            issued_at_ms=issued_at_ms,
        )


def test_validity_window_rejects_naive_or_inverted_bounds() -> None:
    with pytest.raises(ValueError, match="UTC offset"):
        _record(not_before=datetime(2026, 1, 1))

    with pytest.raises(ValueError, match="not_after"):
        _record(
            not_before=datetime(2026, 1, 2, tzinfo=UTC),
            not_after=datetime(2026, 1, 1, tzinfo=UTC),
        )


def test_lookup_by_sender_id_returns_record() -> None:
    registry = SigningPublicKeyRegistry([_record()])

    assert registry.lookup_by_sender_id("device-001").sig_kid == "sig-v1-test"


def test_lookup_by_sender_id_rejects_unknown_sender() -> None:
    registry = SigningPublicKeyRegistry()

    with pytest.raises(UnknownSenderError, match="Unknown sender"):
        registry.lookup_by_sender_id("unknown-device")


def test_registry_loader_parses_and_normalizes_validity_bounds(tmp_path: Path) -> None:
    path = tmp_path / "public-keys.json"
    path.write_text(
        json.dumps(
            {
                "keys": [
                    {
                        "sig_kid": "sig-v1-test",
                        "sender_id": "device-001",
                        "public_key_hex": test_vector.PUBKEY_HEX,
                        "not_before": "2026-01-01T01:00:00+01:00",
                        "not_after": "2027-01-01T00:00:00Z",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    record = load_public_key_registry(path).lookup_by_sig_kid("sig-v1-test")

    assert record.not_before == datetime(2026, 1, 1, tzinfo=UTC)
    assert record.not_after == datetime(2027, 1, 1, tzinfo=UTC)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("not_before", "not-a-timestamp"),
        ("not_after", "2027-01-01T00:00:00"),
        ("not_after", 123),
    ],
)
def test_registry_loader_rejects_invalid_validity_bounds(
    tmp_path: Path,
    field: str,
    value: object,
) -> None:
    path = tmp_path / "public-keys.json"
    key = {
        "sig_kid": "sig-v1-test",
        "sender_id": "device-001",
        "public_key_hex": test_vector.PUBKEY_HEX,
        field: value,
    }
    path.write_text(json.dumps({"keys": [key]}), encoding="utf-8")

    with pytest.raises(ConfigurationError, match=field):
        load_public_key_registry(path)
