# Threat Model

## Trusted Components

- Application endpoint process (before compromise)
- Endpoint private signing key (stored outside public registry)
- Self-managed file keyring (operator-owned; POSIX permissions enforced)
- Device public-key registry (administrator-provisioned)

## Untrusted Components

- MQTT Broker (EMQX) and its administrators
- Other public broker users
- MQTT retained/offline message storage
- Network attackers (passive and active)
- All received MQTT payloads
- MQTT topic strings as sender identity claims

## Attacker Capabilities

- Read ciphertext on the wire and at the broker
- Modify payload bytes and visible MQTT metadata
- Move ciphertext to a different topic (topic substitution)
- Replay, duplicate, reorder, delay, or drop messages
- Flood malformed payloads
- Publish arbitrary data to the same topic
- Disrupt connections and reconnect timing

## Security Properties Provided

| Property | Mechanism |
|----------|-----------|
| Payload confidentiality | AES-256-GCM-SIV with per-topic-group DEK |
| Payload integrity | AEAD authentication tag |
| Topic binding | AAD includes actual MQTT topic |
| Sender authenticity | Ed25519 signature; pubkey from trusted registry |
| Expiration validation | `iat_ms` / `exp_ms` with clock skew limits |
| Replay detection | Persistent `(sender_id, msg_id)` uniqueness |
| Key rotation compatibility | ACTIVE + DECRYPT_ONLY key states |
| TLS server authentication | Strict SSLContext, hostname verification |
| Application idempotency | Inbox dedup + handler invoked at most once per msg_id |

## Explicit Non-Goals

- Preventing malicious broker message drop or delay
- Traffic-analysis resistance (topics, client IDs, sizes, timing visible)
- Security after endpoint compromise (includes keyring file exposure)
- Automatic application-level exactly-once delivery
- Forward secrecy for previously distributed group DEKs
- Cloud-vendor KMS/KDS control-plane security (out of scope; self-managed keys only)

## Fail-Closed Policy

Any validation failure (unknown kid, bad signature, expired message, wrong topic binding,
malformed envelope, missing keys) results in message rejection without invoking the
application handler. No insecure TLS fallback. No runtime cipher downgrade.