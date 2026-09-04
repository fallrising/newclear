"""Additional codec validation edge-case tests."""

from __future__ import annotations

import pytest

from secure_mqtt.errors import EnvelopeFormatError, PayloadTooLargeError
from secure_mqtt.protocol import codec


def test_uint32_be_overflow() -> None:
    with pytest.raises(EnvelopeFormatError):
        codec.uint32_be(-1)
    with pytest.raises(EnvelopeFormatError):
        codec.uint32_be(2**32)


def test_decode_invalid_cbor() -> None:
    with pytest.raises(EnvelopeFormatError):
        codec.decode_cbor(b"\xbf\x63foo")  # indefinite map without break stop


def test_parse_envelope_empty() -> None:
    with pytest.raises(EnvelopeFormatError):
        codec.parse_envelope_map(b"")


def test_parse_envelope_oversized() -> None:
    with pytest.raises(PayloadTooLargeError):
        codec.parse_envelope_map(b"\x00" * 10, max_size=5)


def test_parse_envelope_wrong_type() -> None:
    with pytest.raises(EnvelopeFormatError):
        codec.parse_envelope_map(codec.encode_canonical_cbor([1, 2, 3]))
