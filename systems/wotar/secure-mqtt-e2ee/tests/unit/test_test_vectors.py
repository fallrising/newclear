"""Reproduce fixed protocol test vectors from docs/test-vectors.md."""

from __future__ import annotations

from tests.fixtures import test_vector

from secure_mqtt.protocol import codec, envelope

PROTECTED_HEADER_HEX = (
    "ab617601636b69646b64656b2d76312d7465737463736571182a6573756974657341"
    "32353647434d2d5349562b45643235353139666578705f6d731b0000018bcfe9fbe066"
    "6961745f6d731b0000018bcfe56800666d73675f696450101112131415161718191a1b1"
    "c1d1e1f677369675f6b69646b7369672d76312d7465737469736368656d615f69646e"
    "73656e736f722e74656d702e76316973656e6465725f69646a6465766963652d303031"
    "6c636f6e74656e745f74797065706170706c69636174696f6e2f6a736f6e"
)
AAD_HEX = (
    "534d512d453245452f76310000000016746573742f653265652f766563746f72312f64617461ab617601636b6964"
    "6b64656b2d76312d7465737463736571182a657375697465734132353647434d2d5349562b456432353531396665"
    "78705f6d731b0000018bcfe9fbe0666961745f6d731b0000018bcfe56800666d73675f6964501011121314151617"
    "18191a1b1c1d1e1f677369675f6b69646b7369672d76312d7465737469736368656d615f69646e73656e736f72"
    "2e74656d702e76316973656e6465725f69646a6465766963652d3030316c636f6e74656e745f74797065706170706c"
    "69636174696f6e2f6a736f6e"
)
SIGNATURE_INPUT_HEX = (
    "534d512d5349474e2f763100000000f2534d512d453245452f763100000000167465"
    "73742f653265652f766563746f72312f64617461ab617601636b69646b64656b2d7631"
    "2d7465737463736571182a657375697465734132353647434d2d5349562b4564323535"
    "3139666578705f6d731b0000018bcfe9fbe0666961745f6d731b0000018bcfe5680066"
    "6d73675f696450101112131415161718191a1b1c1d1e1f677369675f6b69646b736967"
    "2d76312d7465737469736368656d615f69646e73656e736f722e74656d702e76316973"
    "656e6465725f69646a6465766963652d3030316c636f6e74656e745f7479706570617070"
    "6c69636174696f6e2f6a736f6ea0a1a2a3a4a5a6a7a8a9aaab3e6638e971e9acb1d087"
    "7f7b843fdd37057c87078750939c95ce48bbe0"
)


def test_sealed_envelope_matches_docs(sealed_envelope) -> None:
    assert sealed_envelope.wire_bytes.hex() == test_vector.ENVELOPE_HEX
    assert sealed_envelope.ciphertext.hex() == test_vector.CIPHERTEXT_HEX
    assert sealed_envelope.signature.hex() == test_vector.SIGNATURE_HEX


def test_protected_header_cbor_matches_docs(sealed_envelope) -> None:
    protected = sealed_envelope.protected.to_dict()
    encoded = codec.encode_canonical_cbor(protected)
    assert encoded.hex() == PROTECTED_HEADER_HEX


def test_aad_matches_docs(sealed_envelope) -> None:
    protected = sealed_envelope.protected.to_dict()
    aad = envelope.build_aad(test_vector.TOPIC, protected)
    assert aad.hex() == AAD_HEX


def test_signature_input_matches_docs(sealed_envelope) -> None:
    protected = sealed_envelope.protected.to_dict()
    aad = envelope.build_aad(test_vector.TOPIC, protected)
    sig_input = envelope.build_signature_input(
        aad, sealed_envelope.nonce, sealed_envelope.ciphertext
    )
    assert sig_input.hex() == SIGNATURE_INPUT_HEX


def test_open_roundtrip(sealed_envelope) -> None:
    opened = envelope.open_envelope(
        topic=test_vector.TOPIC,
        wire_bytes=sealed_envelope.wire_bytes,
        dek=test_vector.DEK,
        public_key=test_vector.public_key(),
        now_ms=test_vector.IAT_MS + 1000,
    )
    assert opened.plaintext == test_vector.PLAINTEXT
    assert opened.protected.seq == 42
