# Migration from Fernet

## Why Not Fernet

Fernet uses AES-128-CBC + HMAC with non-AEAD composition. Secure MQTT requires:

- AES-256-GCM-SIV (nonce-misuse resistant AEAD)
- Topic-bound AAD using actual MQTT topic
- Ed25519 publisher signatures with registry-backed public keys
- Canonical CBOR wire format (not base64 JSON)

There is **no runtime downgrade** to Fernet or AES-GCM.

## Mapping

| Fernet concept | Secure MQTT equivalent |
|----------------|------------------------|
| Shared secret key | Per-topic-group DEK keyring (`kid`) |
| Token TTL | `iat_ms` / `exp_ms` envelope fields |
| Implicit sender | `sender_id` + `sig_kid` + Ed25519 signature |
| Single key file | `keyring.json` + `public-keys.json` |

## Migration Steps

1. Provision DEK keyring per topic group and signing key pair.
2. Publish trusted signing public keys to receivers (`public-keys.json`).
3. Replace Fernet encrypt/decrypt calls with `SecureMqttClient.publish_*` and subscriptions.
4. Enable strict TLS to EMQX; retire plaintext MQTT.
5. Run tamper matrix and test vectors before cutover.