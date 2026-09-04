# ADR 0001: AES-256-GCM-SIV for Payload AEAD

## Status

Accepted

## Context

MQTT brokers and network paths are untrusted. We need nonce-misuse-resistant AEAD for
application-layer encryption. AES-GCM is sensitive to nonce reuse; AES-GCM-SIV provides
better misuse resistance.

## Decision

Use AES-256-GCM-SIV via `cryptography.hazmat.primitives.ciphers.aead.AESGCMSIV` with
32-byte DEK and 12-byte random nonce per message.

## Consequences

- Startup fails if AESGCMSIV is unavailable (no downgrade to Fernet or AES-GCM).
- Requires `cryptography>=42` in an isolated venv (system packages may be too old).