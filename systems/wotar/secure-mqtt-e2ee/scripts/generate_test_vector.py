#!/usr/bin/env python3
"""Generate deterministic protocol test vector."""

from __future__ import annotations

from secure_mqtt.crypto import signing
from secure_mqtt.protocol import codec, envelope

DEK = bytes(range(1, 33))
NONCE = bytes(range(0xA0, 0xAC))
SIGN_SEED = bytes([0x5D] * 32)
TOPIC = "test/e2ee/vector1/data"
PLAINTEXT = b'{"temp":21.5}'
MSG_ID = bytes(range(0x10, 0x20))
IAT_MS = 1700000000000


def main() -> None:
    priv = signing.private_key_from_seed(SIGN_SEED)
    sealed = envelope.seal(
        topic=TOPIC,
        plaintext=PLAINTEXT,
        dek=DEK,
        signing_key=priv,
        kid="dek-v1-test",
        sender_id="device-001",
        sig_kid="sig-v1-test",
        seq=42,
        schema_id="sensor.temp.v1",
        content_type="application/json",
        msg_id=MSG_ID,
        nonce=NONCE,
        iat_ms=IAT_MS,
        ttl_seconds=300,
    )
    protected = sealed.protected.to_dict()
    print("envelope_hex:", sealed.wire_bytes.hex())
    print("aad_hex:", envelope.build_aad(TOPIC, protected).hex())
    print("ciphertext_hex:", sealed.ciphertext.hex())
    print("signature_hex:", sealed.signature.hex())


if __name__ == "__main__":
    main()