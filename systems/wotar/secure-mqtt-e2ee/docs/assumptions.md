# Assumptions and Environment Plan

## Runtime Environment

| Component | Requirement | Verified |
|-----------|-------------|----------|
| Python | 3.12+ | 3.12.13 via `uv python install 3.12` |
| OpenSSL | TLS 1.2+, AES-GCM-SIV | OpenSSL 3.0.15; AESGCMSIV via cryptography>=42 |
| Docker | Local EMQX integration | Docker 27.5.1 available |
| paho-mqtt | 2.x, MQTT v5, CallbackAPIVersion.VERSION2 | Declared in pyproject.toml |

System Python 3.11.2 lacks AESGCMSIV in distro `cryptography`. Project uses an
isolated `.venv` with `cryptography>=42` — **no algorithm downgrade**.

## Cryptographic Assumptions

- **AEAD**: AES-256-GCM-SIV only. If `AESGCMSIV` import fails at startup, the process
  exits (fail closed). No Fernet, no AES-GCM fallback.
- **Signatures**: Ed25519 via `cryptography`.
- **Wire format**: Canonical CBOR (`cbor2` canonical encoding). No base64-JSON envelope.
- **DEK size**: 32 bytes. **Nonce**: 12 random bytes per message.

## Trust Boundaries

See `docs/threat-model.md`. Broker and network are untrusted. Endpoint process,
self-managed keyring, and device public-key registry are trusted.

## Key Management Assumptions

- `FileKeyringProvider` is the **official** key path for local-dev, public-dev, and
  production. Operators own and distribute the keyring file.
- Cloud-vendor KMS adapters are intentionally out of scope. Remote backup is an
  operator concern (encrypt the keyring yourself before off-host storage).
- Signing keys are separate from payload DEK keyring.
- POSIX keyring files must not be group/world readable.

## MQTT Assumptions

- MQTT v5 only.
- TLS required for all profiles (public and local). No plaintext MQTT in local integration.
- Public EMQX profile (`broker.emqx.io:8883`, `public-dev`) is for synthetic smoke
  and key-path validation only. Smoke tests are opt-in; CI does not depend on the
  public broker. Real data must not use public-dev.
- Broker is swappable: envelope crypto does not bind to a specific MQTT vendor.

## Persistence Assumptions

- SQLite with WAL mode for outbox, inbox, replay/dedup, and sender sequence state.
- Plaintext is never written to outbox.

## Operational Assumptions

- All timestamps are timezone-aware UTC.
- Structured logs never contain plaintext, key material, or full ciphertext.
- Bounded queues on all network-facing paths.

## Dependency Plan

| Package | Version | Purpose |
|---------|---------|---------|
| paho-mqtt | >=2.1,<3 | MQTT v5 transport |
| cryptography | >=42 | AES-GCM-SIV, Ed25519, TLS |
| cbor2 | >=5.6 | Canonical CBOR codec |
| pytest, hypothesis | dev | Testing |
| ruff, mypy | dev | Lint and type check |
| pip-audit | dev | Dependency audit |

## Non-Goals (Explicit)

- Traffic-analysis resistance
- Broker drop/delay prevention
- Endpoint compromise recovery
- Forward secrecy for previously distributed group DEKs
- Application-level exactly-once delivery
- Cloud-vendor KMS integration
