# Key Lifecycle

Official key path: `FileKeyringProvider` (self-managed JSON keyring). See
[self-managed-key-design.md](self-managed-key-design.md).

## DEK States

| State | Seal (publish) | Decrypt (receive) |
|-------|----------------|-------------------|
| `active` | Yes | Yes |
| `decrypt_only` | No | Yes |
| `retired` | No | No |
| `revoked` | No | No |

## Rotation Flow

1. **add-pending** — generate a new DEK kid stored as `retired` (not active).
2. **activate** — promote pending kid to `active`; previous active becomes `decrypt_only`.
3. **mark-decrypt-only** — manually demote a kid for controlled rollover.
4. **retire** — remove decrypt capability after all peers have rotated.
5. **revoke** — emergency disable; cannot decrypt historical ciphertext.

## Signing Keys

Signing keys are separate from DEK keyrings. Trusted publisher public keys live in
`public-keys.json` and are referenced by `sig_kid` in each envelope.

Each registry entry may define inclusive `not_before` and `not_after` RFC 3339
timestamps. Receivers compare these bounds with the signed envelope `iat_ms`, not the
receive time. This permits a message issued just before key expiry to remain valid until
its own TTL expires while rejecting messages claiming issuance outside the key's window.
Both fields must include a UTC offset; omit either field for an open-ended interval.

## CLI

```bash
secure-mqtt keys generate-local --path .secure_mqtt/keyring.json
secure-mqtt keys list --path .secure_mqtt/keyring.json
secure-mqtt keys add-pending --path .secure_mqtt/keyring.json --topic-group vector1
secure-mqtt keys activate --path .secure_mqtt/keyring.json --topic-group vector1 --kid <kid>
secure-mqtt keys validate --path .secure_mqtt/keyring.json
```

The bootstrap script defaults to both `default` (built-in policy resolver) and
`vector1` (`config/topic-policies.example.toml`). Pass `--topic-group` (repeatable)
to override.

`keys list` never prints `dek_hex` or `signing_seed_hex`.

## Emergency Key Revocation Runbook

When a DEK or endpoint is suspected compromised:

1. **Revoke DEK immediately** (cannot decrypt after revoke):
   ```bash
   secure-mqtt keys revoke --path .secure_mqtt/keyring.json \
     --topic-group <group> --kid <compromised-kid>
   ```
2. **Activate a clean pending DEK** if none is active:
   ```bash
   secure-mqtt keys add-pending --path .secure_mqtt/keyring.json --topic-group <group>
   secure-mqtt keys activate --path .secure_mqtt/keyring.json --topic-group <group> --kid <new-kid>
   ```
3. **Revoke signing key** — remove or mark `revoked` in `public-keys.json` registry;
   distribute updated registry to all subscribers before endpoints rotate signing material.
4. **Validate** all keyrings: `secure-mqtt keys validate --path ...`
5. **Monitor** `unknown_kid_total`, `invalid_signature_total` metrics for continued abuse.

Do not log revoked key material. Historical ciphertext sealed with revoked DEKs cannot be decrypted.
