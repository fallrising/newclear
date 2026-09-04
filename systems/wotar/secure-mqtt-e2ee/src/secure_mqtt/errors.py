"""Exception hierarchy for secure MQTT client."""


class SecureMqttError(Exception):
    """Base exception; messages must not contain secrets."""


class ConfigurationError(SecureMqttError):
    """Invalid or insecure configuration."""


class ConnectionError(SecureMqttError):
    """MQTT connection failure."""


class PublishError(SecureMqttError):
    """Publish operation failure."""


class SubscriptionError(SecureMqttError):
    """Subscription operation failure."""


class EnvelopeFormatError(SecureMqttError):
    """Malformed envelope structure or encoding."""


class UnsupportedProtocolError(SecureMqttError):
    """Unsupported protocol version or cipher suite."""


class UnknownKeyError(SecureMqttError):
    """Encryption key identifier not found."""


class InvalidKeyStateError(SecureMqttError):
    """Key exists but is not usable for the requested operation."""


class UnknownSenderError(SecureMqttError):
    """Sender or signing key not found in trusted registry."""


class InvalidSignatureError(SecureMqttError):
    """Ed25519 signature verification failed."""


class DecryptionError(SecureMqttError):
    """AEAD decryption failed (invalid tag or ciphertext)."""


class ExpiredMessageError(SecureMqttError):
    """Message past expiration time."""


class FutureMessageError(SecureMqttError):
    """Message issued too far in the future."""


class ReplayError(SecureMqttError):
    """Duplicate or replayed message detected."""


class PayloadTooLargeError(SecureMqttError):
    """Envelope or plaintext exceeds configured limits."""


class SchemaValidationError(SecureMqttError):
    """Application schema validation failed."""


class QueueFullError(SecureMqttError):
    """Bounded queue is full."""
