# Self-Managed Key Design

## Goal

Keep end-to-end payload security independent of the MQTT broker vendor. Operators
own key material in a local (or self-encrypted) keyring file and may point the same
client at local EMQX, public EMQX smoke brokers, self-hosted EMQX, or EMQX Cloud.

Cloud-vendor KMS adapters (AWS KMS, Azure Key Vault, HashiCorp Vault Transit) are
**out of scope**. If operators need remote storage, they encrypt the keyring
themselves and distribute the ciphertext out-of-band.

## Official Provider

`FileKeyringProvider` (`keys/file_keyring.py`) is the official `KeyProvider`:

- Loads DEK keyring + signing seed from a JSON file
- Enforces POSIX `0600` / directory `0700` permissions
- Supports ACTIVE / DECRYPT_ONLY / RETIRED / REVOKED lifecycle via CLI
- Works with every deployment profile (`local-dev`, `public-dev`, `production`)

`LocalDevKeyProvider` remains a deprecated alias of `FileKeyringProvider`.

## Interface

Unchanged `KeyProvider` protocol:

- `get_active_dek(topic_group)`
- `get_dek_for_decrypt(topic_group, kid)`
- `get_signing_key()`
- `sender_id`, `sig_kid`

## Distribution Model

| Step | Operator action |
|------|-----------------|
| 1 | Generate keyring: `secure-mqtt keys generate-local` |
| 2 | Export peer public keys into `public-keys.json` registry |
| 3 | Copy keyring to endpoints via trusted channel (USB, scp, private store) |
| 4 | Optional: encrypt the keyring file with an operator-chosen cipher before upload |
| 5 | Rotate DEKs with `keys add-pending` / `activate` / `mark-decrypt-only` |

Receivers trust publishers only through the administrator-provisioned registry.
There is no online KMS control plane.

## Broker Independence

Encryption, signatures, topic binding, and replay state live in the client.
Changing `SECURE_MQTT_BROKER_HOST` / TLS settings does not change envelope format
or key semantics. Public EMQX (`broker.emqx.io`) is for synthetic `public-dev`
validation only — never for real data under `production`.

## Non-Goals

- No AWS/Azure/Vault adapters in this repository
- No automatic multi-device key agreement / forward secrecy redesign
- No recovery after endpoint compromise (keyring exposure = plaintext exposure)
