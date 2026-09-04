"""Security tamper matrix — 40 fail-closed validation cases."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import cbor2
import pytest
from tests.fixtures import test_vector

from secure_mqtt.errors import (
    DecryptionError,
    EnvelopeFormatError,
    ExpiredMessageError,
    FutureMessageError,
    InvalidKeyStateError,
    InvalidSignatureError,
    PayloadTooLargeError,
    UnknownKeyError,
    UnknownSenderError,
    UnsupportedProtocolError,
)
from secure_mqtt.keys.memory import InMemoryKeyProvider
from secure_mqtt.keys.provider import KeyState
from secure_mqtt.keys.public_key_registry import SigningPublicKeyRecord, SigningPublicKeyRegistry
from secure_mqtt.mqtt.subscriptions import SubscriptionRegistry
from secure_mqtt.mqtt.transport import IncomingMessage
from secure_mqtt.observability.metrics import Metrics
from secure_mqtt.persistence.inbox import InboxStore
from secure_mqtt.persistence.replay import ReplayGuard
from secure_mqtt.policy.topic_policy import TopicPolicyResolver, TopicPolicyRule
from secure_mqtt.protocol import codec, envelope
from secure_mqtt.protocol.constants import MAX_ENVELOPE_SIZE
from secure_mqtt.workers.receive_worker import ReceiveWorker


@dataclass(frozen=True)
class TamperCase:
    case_id: str
    expect_success: bool
    expected_errors: tuple[type[Exception], ...] = ()


def _flip_bit(data: bytearray, index: int) -> bytes:
    data[index] ^= 0x01
    return bytes(data)


def _modify_envelope_map(
    wire: bytes,
    *,
    field: str,
    value: Any,
    resign: bool = False,
) -> bytes:
    obj = cbor2.loads(wire)
    if not isinstance(obj, dict):
        raise TypeError("envelope must be map")
    obj[field] = value
    if resign:
        protected = codec.extract_protected_header(obj)
        aad = envelope.build_aad(test_vector.TOPIC, protected)
        nonce = obj["nonce"]
        ciphertext = obj["ciphertext"]
        sig_input = envelope.build_signature_input(aad, nonce, ciphertext)
        obj["signature"] = test_vector.signing_key().sign(sig_input)
    return codec.encode_envelope(obj)


def _build_receive_worker(
    keys: InMemoryKeyProvider,
    registry: SigningPublicKeyRegistry,
) -> ReceiveWorker:
    import tempfile
    from pathlib import Path

    from secure_mqtt.persistence.database import Database

    tmp = Path(tempfile.mkdtemp())
    db = Database(tmp / "state.db")
    return ReceiveWorker(
        key_provider=keys,
        registry=registry,
        policy_resolver=TopicPolicyResolver(
            [
                TopicPolicyRule(
                    filter="test/e2ee/#",
                    topic_group="vector1",
                    schema_id="sensor.temp.v1",
                    ttl_seconds=300,
                    max_ttl_seconds=24 * 3600,
                )
            ]
        ),
        replay_guard=ReplayGuard(db),
        inbox=InboxStore(db),
        subscriptions=SubscriptionRegistry(),
        metrics=Metrics(),
        clock_skew_seconds=60,
        max_queue_size=8,
    )


TAMPER_MATRIX: list[TamperCase] = [
    TamperCase("01_valid_decrypt", True),
    TamperCase("02_wrong_topic", False, (InvalidSignatureError, DecryptionError)),
    TamperCase("03_wrong_topic_prefix", False, (InvalidSignatureError, DecryptionError)),
    TamperCase("04_wrong_topic_suffix", False, (InvalidSignatureError, DecryptionError)),
    TamperCase("05_sig_flip_bit0", False, (InvalidSignatureError,)),
    TamperCase("06_sig_flip_bit32", False, (InvalidSignatureError,)),
    TamperCase("07_sig_zeroed", False, (InvalidSignatureError, EnvelopeFormatError)),
    TamperCase("08_sig_truncated", False, (EnvelopeFormatError, InvalidSignatureError)),
    TamperCase("09_ciphertext_flip_bit0", False, (DecryptionError, InvalidSignatureError)),
    TamperCase("10_ciphertext_flip_last", False, (DecryptionError, InvalidSignatureError)),
    TamperCase(
        "11_ciphertext_truncated",
        False,
        (EnvelopeFormatError, DecryptionError, InvalidSignatureError),
    ),
    TamperCase(
        "12_ciphertext_appended",
        False,
        (EnvelopeFormatError, DecryptionError, InvalidSignatureError),
    ),
    TamperCase("13_nonce_flip_bit0", False, (DecryptionError, InvalidSignatureError)),
    TamperCase("14_nonce_wrong_length", False, (EnvelopeFormatError,)),
    TamperCase("15_msg_id_flip_bit", False, (InvalidSignatureError, DecryptionError)),
    TamperCase("16_msg_id_wrong_length", False, (EnvelopeFormatError,)),
    TamperCase("17_sender_id_modified", False, (InvalidSignatureError,)),
    TamperCase("18_sig_kid_modified", False, (InvalidSignatureError, UnknownSenderError)),
    TamperCase("19_kid_unknown", False, (UnknownKeyError,)),
    TamperCase("20_seq_modified", False, (InvalidSignatureError,)),
    TamperCase("21_iat_future", False, (FutureMessageError, EnvelopeFormatError)),
    TamperCase("22_exp_expired", False, (ExpiredMessageError, EnvelopeFormatError)),
    TamperCase("23_exp_before_iat", False, (EnvelopeFormatError,)),
    TamperCase("24_suite_modified", False, (UnsupportedProtocolError, InvalidSignatureError)),
    TamperCase("25_version_modified", False, (EnvelopeFormatError, InvalidSignatureError)),
    TamperCase("26_content_type_modified", False, (InvalidSignatureError,)),
    TamperCase("27_schema_id_modified", False, (InvalidSignatureError,)),
    TamperCase("28_unknown_sig_kid", False, (UnknownSenderError,)),
    TamperCase("29_sender_registry_mismatch", False, (UnknownSenderError,)),
    TamperCase("30_revoked_signing_key", False, (UnknownSenderError,)),
    TamperCase("31_decrypt_only_dek_ok", True),
    TamperCase("32_retired_dek_fail", False, (InvalidKeyStateError,)),
    TamperCase("33_revoked_dek_fail", False, (InvalidKeyStateError,)),
    TamperCase("34_empty_envelope", False, (EnvelopeFormatError,)),
    TamperCase("35_invalid_cbor", False, (EnvelopeFormatError,)),
    TamperCase("36_extra_envelope_key", False, (EnvelopeFormatError,)),
    TamperCase("37_missing_nonce_key", False, (EnvelopeFormatError,)),
    TamperCase("38_oversized_envelope", False, (PayloadTooLargeError,)),
    TamperCase("39_unsupported_suite", False, (UnsupportedProtocolError,)),
    TamperCase("40_replay_duplicate", False, ()),
]


def _fresh_iat_ms() -> int:
    return int(datetime.now(UTC).timestamp() * 1000) - 1000


@pytest.fixture
def sealed() -> envelope.SealedEnvelope:
    return envelope.seal(
        topic=test_vector.TOPIC,
        plaintext=test_vector.PLAINTEXT,
        dek=test_vector.DEK,
        signing_key=test_vector.signing_key(),
        kid="dek-v1-test",
        sender_id="device-001",
        sig_kid="sig-v1-test",
        seq=42,
        schema_id="sensor.temp.v1",
        content_type="application/json",
        msg_id=test_vector.MSG_ID,
        nonce=test_vector.NONCE,
        iat_ms=_fresh_iat_ms(),
        ttl_seconds=300,
    )


def _apply_tamper(case_id: str, sealed_env: envelope.SealedEnvelope) -> tuple[bytes, str]:
    wire = sealed_env.wire_bytes
    topic = test_vector.TOPIC

    if case_id == "01_valid_decrypt":
        return wire, topic
    if case_id == "02_wrong_topic":
        return wire, "other/topic/data"
    if case_id == "03_wrong_topic_prefix":
        return wire, "wrong/e2ee/vector1/data"
    if case_id == "04_wrong_topic_suffix":
        return wire, "test/e2ee/vector1/other"
    if case_id in {"05_sig_flip_bit0", "06_sig_flip_bit32"}:
        obj = cbor2.loads(wire)
        sig = bytearray(obj["signature"])
        sig[0 if case_id == "05_sig_flip_bit0" else 32] ^= 0x01
        obj["signature"] = bytes(sig)
        return codec.encode_envelope(obj), topic
    if case_id == "07_sig_zeroed":
        return _modify_envelope_map(wire, field="signature", value=b"\x00" * 64), topic
    if case_id == "08_sig_truncated":
        return _modify_envelope_map(wire, field="signature", value=b"\x00" * 32), topic
    if case_id == "09_ciphertext_flip_bit0":
        data = bytearray(wire)
        ct = bytes.fromhex(test_vector.CIPHERTEXT_HEX)
        idx = wire.find(ct)
        return _flip_bit(data, idx), topic
    if case_id == "10_ciphertext_flip_last":
        obj = cbor2.loads(wire)
        ct = bytearray(obj["ciphertext"])
        ct[-1] ^= 0x01
        obj["ciphertext"] = bytes(ct)
        return codec.encode_envelope(obj), topic
    if case_id == "11_ciphertext_truncated":
        return _modify_envelope_map(wire, field="ciphertext", value=b"\x00" * 8), topic
    if case_id == "12_ciphertext_appended":
        obj = cbor2.loads(wire)
        obj["ciphertext"] = obj["ciphertext"] + b"\xff"
        return codec.encode_envelope(obj), topic
    if case_id == "13_nonce_flip_bit0":
        return _modify_envelope_map(
            wire, field="nonce", value=_flip_bit(bytearray(test_vector.NONCE), 0)
        ), topic
    if case_id == "14_nonce_wrong_length":
        return _modify_envelope_map(wire, field="nonce", value=b"\x00" * 8), topic
    if case_id == "15_msg_id_flip_bit":
        flipped = _flip_bit(bytearray(test_vector.MSG_ID), 0)
        return _modify_envelope_map(wire, field="msg_id", value=flipped), topic
    if case_id == "16_msg_id_wrong_length":
        return _modify_envelope_map(wire, field="msg_id", value=b"\x00" * 8), topic
    if case_id == "17_sender_id_modified":
        return _modify_envelope_map(wire, field="sender_id", value="attacker-999"), topic
    if case_id == "18_sig_kid_modified":
        return _modify_envelope_map(wire, field="sig_kid", value="sig-unknown"), topic
    if case_id == "19_kid_unknown":
        return _modify_envelope_map(wire, field="kid", value="dek-unknown"), topic
    if case_id == "20_seq_modified":
        return _modify_envelope_map(wire, field="seq", value=9999), topic
    if case_id in {"21_iat_future", "22_exp_expired"}:
        obj = cbor2.loads(wire)
        if case_id == "21_iat_future":
            future = _fresh_iat_ms() + 3600_000
            obj["iat_ms"] = future
            obj["exp_ms"] = future + 300_000
        else:
            past = _fresh_iat_ms() - 7200_000
            obj["iat_ms"] = past
            obj["exp_ms"] = past + 300_000
        protected = codec.extract_protected_header(obj)
        aad = envelope.build_aad(topic, protected)
        sig_input = envelope.build_signature_input(aad, obj["nonce"], obj["ciphertext"])
        obj["signature"] = test_vector.signing_key().sign(sig_input)
        return codec.encode_envelope(obj), topic
    if case_id == "23_exp_before_iat":
        return _modify_envelope_map(
            wire,
            field="exp_ms",
            value=test_vector.IAT_MS - 1,
        ), topic
    if case_id == "24_suite_modified":
        return _modify_envelope_map(wire, field="suite", value="AES-GCM"), topic
    if case_id == "25_version_modified":
        return _modify_envelope_map(wire, field="v", value=99), topic
    if case_id == "26_content_type_modified":
        return _modify_envelope_map(wire, field="content_type", value="text/plain"), topic
    if case_id == "27_schema_id_modified":
        return _modify_envelope_map(wire, field="schema_id", value="other.schema"), topic
    if case_id == "28_unknown_sig_kid":
        return _modify_envelope_map(wire, field="sig_kid", value="sig-not-in-registry"), topic
    if case_id == "29_sender_registry_mismatch":
        return _modify_envelope_map(wire, field="sender_id", value="other-device"), topic
    if case_id == "30_revoked_signing_key":
        return wire, topic
    if case_id == "31_decrypt_only_dek_ok":
        return wire, topic
    if case_id == "32_retired_dek_fail":
        return wire, topic
    if case_id == "33_revoked_dek_fail":
        return wire, topic
    if case_id == "34_empty_envelope":
        return b"", topic
    if case_id == "35_invalid_cbor":
        return b"\xff\xfe\xfd", topic
    if case_id == "36_extra_envelope_key":
        obj = cbor2.loads(wire)
        obj["extra"] = "bad"
        return codec.encode_envelope(obj), topic
    if case_id == "37_missing_nonce_key":
        obj = cbor2.loads(wire)
        del obj["nonce"]
        return codec.encode_envelope(obj), topic
    if case_id == "38_oversized_envelope":
        return wire + b"\x00" * (MAX_ENVELOPE_SIZE + 1), topic
    if case_id == "39_unsupported_suite":
        return _modify_envelope_map(wire, field="suite", value="Fernet"), topic
    if case_id == "40_replay_duplicate":
        return wire, topic
    raise AssertionError(f"Unhandled tamper case: {case_id}")


def _registry_for_case(case_id: str) -> SigningPublicKeyRegistry:
    state = KeyState.REVOKED if case_id == "30_revoked_signing_key" else KeyState.ACTIVE
    record = SigningPublicKeyRecord(
        sig_kid="sig-v1-test",
        sender_id="device-001",
        public_key=test_vector.public_key(),
        state=state,
    )
    return SigningPublicKeyRegistry([record])


def _keys_for_case(case_id: str) -> InMemoryKeyProvider:
    keys = InMemoryKeyProvider(
        sender_id="device-001",
        sig_kid="sig-v1-test",
        signing_seed=test_vector.SIGN_SEED,
    )
    if case_id == "31_decrypt_only_dek_ok":
        keys.add_dek("vector1", "dek-v1-test", test_vector.DEK, state=KeyState.DECRYPT_ONLY)
        keys.topic_groups["vector1"].active_kid = "dek-v1-test"
    elif case_id == "32_retired_dek_fail":
        keys.add_dek("vector1", "dek-v1-test", test_vector.DEK, state=KeyState.RETIRED)
    elif case_id == "33_revoked_dek_fail":
        keys.add_dek("vector1", "dek-v1-test", test_vector.DEK, state=KeyState.REVOKED)
    else:
        keys.add_dek("vector1", "dek-v1-test", test_vector.DEK, state=KeyState.ACTIVE)
    return keys


@pytest.mark.parametrize("case", TAMPER_MATRIX, ids=[c.case_id for c in TAMPER_MATRIX])
def test_tamper_matrix(case: TamperCase, sealed: envelope.SealedEnvelope) -> None:
    assert len(TAMPER_MATRIX) == 40
    wire, topic = _apply_tamper(case.case_id, sealed)

    if case.case_id == "40_replay_duplicate":
        worker = _build_receive_worker(
            _keys_for_case(case.case_id), _registry_for_case(case.case_id)
        )
        incoming = IncomingMessage(topic=topic, payload=wire, qos=1)
        worker._handle_incoming(incoming)
        before = worker.metrics.get("envelope_open_success_total", result="success")
        worker._handle_incoming(incoming)
        after = worker.metrics.get("envelope_open_success_total", result="success")
        assert after == before
        replay_hits = worker.metrics.get("replay_duplicate_total", result="guard")
        replay_hits += worker.metrics.get("replay_duplicate_total", result="inbox")
        assert replay_hits >= 1
        return

    if case.case_id in {
        "19_kid_unknown",
        "28_unknown_sig_kid",
        "29_sender_registry_mismatch",
        "30_revoked_signing_key",
        "31_decrypt_only_dek_ok",
        "32_retired_dek_fail",
        "33_revoked_dek_fail",
        "18_sig_kid_modified",
    }:
        worker = _build_receive_worker(
            _keys_for_case(case.case_id), _registry_for_case(case.case_id)
        )
        incoming = IncomingMessage(topic=topic, payload=wire, qos=1)
        if case.expect_success:
            worker._handle_incoming(incoming)
            assert worker.metrics.get("envelope_open_success_total", result="success") == 1
            return
        worker._handle_incoming(incoming)
        assert worker.metrics.get("envelope_open_success_total", result="success") == 0
        snapshot = worker.metrics.snapshot()
        assert any(key.startswith("envelope_open_fail_total") for key in snapshot)
        return

    if case.case_id == "38_oversized_envelope":
        worker = _build_receive_worker(
            _keys_for_case(case.case_id), _registry_for_case(case.case_id)
        )
        worker._handle_incoming(IncomingMessage(topic=topic, payload=wire, qos=1))
        assert worker.metrics.get("envelope_open_fail_total", reason="oversized") == 1
        return

    if case.expect_success:
        opened = envelope.open_envelope(
            topic=topic,
            wire_bytes=wire,
            dek=test_vector.DEK,
            public_key=test_vector.public_key(),
            now_ms=_fresh_iat_ms() + 1000,
        )
        assert opened.plaintext == test_vector.PLAINTEXT
        return

    with pytest.raises(case.expected_errors):
        envelope.open_envelope(
            topic=topic,
            wire_bytes=wire,
            dek=test_vector.DEK,
            public_key=test_vector.public_key(),
            now_ms=_fresh_iat_ms() + 1000,
        )
