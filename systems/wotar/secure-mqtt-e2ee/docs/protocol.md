# Secure MQTT Envelope v1

## Wire Format

Canonical CBOR map (`cbor2` canonical encoding). Binary fields are CBOR byte strings.
No base64-JSON. No compression by default.

## Protected Header Fields

| Field | Type | Constraint |
|-------|------|------------|
| `v` | integer | Must be `1` |
| `suite` | text | Must be `"A256GCM-SIV+Ed25519"` |
| `kid` | text | DEK key identifier |
| `sender_id` | text | Logical sender identity |
| `sig_kid` | text | Signing key identifier |
| `msg_id` | byte string | Exactly 16 bytes |
| `seq` | unsigned integer | Monotonic per sender |
| `iat_ms` | unsigned integer | Issue time (UTC ms) |
| `exp_ms` | unsigned integer | Expiry time (UTC ms), must be > `iat_ms` |
| `content_type` | text | MIME-like content type |
| `schema_id` | text | Application schema identifier |

## Unprotected Binary Containers

Still authenticated via AEAD tag and Ed25519 signature:

| Field | Type | Constraint |
|-------|------|------------|
| `nonce` | byte string | Exactly 12 bytes |
| `ciphertext` | byte string | AES-GCM-SIV output including tag |
| `signature` | byte string | Exactly 64 bytes (Ed25519) |

**No sender public key in the envelope.**

## AAD Construction

```
domain       = ASCII("SMQ-E2EE/v1") + NUL
topic_bytes  = UTF-8(actual MQTT topic)
aad          = domain
             + uint32_be(len(topic_bytes))
             + topic_bytes
             + canonical_cbor(protected_header)
```

Receiver **must** use `msg.topic` from the MQTT layer, not any envelope-declared topic.

## Signature Input

```
signature_input = ASCII("SMQ-SIGN/v1") + NUL
                + uint32_be(len(aad))
                + aad
                + nonce
                + ciphertext
```

## Encryption

```
ciphertext = AESGCMSIV(dek).encrypt(nonce, plaintext, aad)
```

- DEK: 32 bytes
- Nonce: 12 random bytes per message

## Signature

```
signature = Ed25519PrivateKey.sign(signature_input)
```

Public key resolved from trusted registry by `sig_kid`.

## Parser Limits (defaults)

| Limit | Value |
|-------|-------|
| Max envelope size | 512 KiB |
| Max plaintext size | 256 KiB |
| Max sender_id | 128 UTF-8 bytes |
| Max kid | 256 UTF-8 bytes |
| Max schema_id | 128 UTF-8 bytes |
| Max content_type | 128 UTF-8 bytes |
| Clock skew | 60 seconds |
| Default TTL | 300 seconds |
| Max TTL | 24 hours (configurable) |

## Validation Order (Receiver)

1. Size gate on raw bytes
2. Parse canonical CBOR map (exact key set)
3. Verify Ed25519 signature
4. Validate `iat_ms` / `exp_ms` window
5. Resolve DEK by `kid` (no brute-force key trial)
6. Decrypt with AAD built from actual MQTT topic
7. Plaintext size check