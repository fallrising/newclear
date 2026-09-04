"""Protocol constants and parser limits."""

from __future__ import annotations

PROTOCOL_VERSION = 1
CIPHER_SUITE = "A256GCM-SIV+Ed25519"

AAD_DOMAIN = b"SMQ-E2EE/v1\x00"
SIGN_DOMAIN = b"SMQ-SIGN/v1\x00"

DEK_SIZE = 32
NONCE_SIZE = 12
MSG_ID_SIZE = 16
SIGNATURE_SIZE = 64

MAX_ENVELOPE_SIZE = 512 * 1024
MAX_PLAINTEXT_SIZE = 256 * 1024
MAX_SENDER_ID_LEN = 128
MAX_KID_LEN = 256
MAX_SCHEMA_ID_LEN = 128
MAX_CONTENT_TYPE_LEN = 128

DEFAULT_CLOCK_SKEW_SECONDS = 60
DEFAULT_MESSAGE_TTL_SECONDS = 300
DEFAULT_MAX_TTL_SECONDS = 24 * 3600

PROTECTED_HEADER_KEYS = frozenset(
    {
        "v",
        "suite",
        "kid",
        "sender_id",
        "sig_kid",
        "msg_id",
        "seq",
        "iat_ms",
        "exp_ms",
        "content_type",
        "schema_id",
    }
)

ENVELOPE_KEYS = PROTECTED_HEADER_KEYS | frozenset({"nonce", "ciphertext", "signature"})

MQTT_CONTENT_TYPE = "application/vnd.secure-mqtt-envelope+cbor"
