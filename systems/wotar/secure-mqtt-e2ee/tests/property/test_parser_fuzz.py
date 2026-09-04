"""Property tests for malformed CBOR envelope parsing."""

from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from secure_mqtt.errors import EnvelopeFormatError, PayloadTooLargeError, SecureMqttError
from secure_mqtt.protocol import codec
from secure_mqtt.protocol.constants import MAX_ENVELOPE_SIZE


@given(data=st.binary(min_size=0, max_size=2048))
@settings(max_examples=200)
def test_parse_envelope_map_never_raises_unhandled(data: bytes) -> None:
    try:
        codec.parse_envelope_map(data)
    except (EnvelopeFormatError, PayloadTooLargeError):
        pass
    except SecureMqttError:
        pass


def test_oversized_input_rejected() -> None:
    oversized = b"\x00" * (MAX_ENVELOPE_SIZE + 1)
    with pytest.raises(PayloadTooLargeError):
        codec.parse_envelope_map(oversized)
