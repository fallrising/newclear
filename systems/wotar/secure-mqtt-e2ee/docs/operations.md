# Operations

## Prerequisites

```bash
make install
make doctor
```

`doctor` verifies Python 3.12+, AES-GCM-SIV availability, and OpenSSL.

## Profiles

| Profile | When to use | Keyring | Notes |
|---------|-------------|---------|-------|
| `local-dev` | Docker EMQX on localhost | `FileKeyringProvider` | mTLS + local CA |
| `public-dev` | Synthetic tests on `broker.emqx.io` | Same keyring file | Random namespace; no real data |
| `production` | Self-hosted / EMQX Cloud / other MQTT | Same keyring file | Rejects public smoke hosts |

Key material does not change when you swap brokers — only TLS and `SECURE_MQTT_BROKER_*`.

## Local EMQX

```bash
./scripts/generate_dev_certs.sh
docker compose up -d
./scripts/bootstrap_local_keys.py
```

Copy `.env.example` to `.env` and adjust paths as needed.

## Public EMQX smoke (`public-dev`)

```bash
./scripts/bootstrap_local_keys.py   # if keyring missing
cp .env.public-dev.example .env.public-dev
set -a && source .env.public-dev && set +a
SECURE_MQTT_RUN_PUBLIC_SMOKE=1 pytest -m public_smoke -q
```

Use only synthetic payloads. Prefer a random topic namespace (the smoke test does this).

## Publish / Subscribe

```bash
secure-mqtt pub --topic test/e2ee/vector1/data --message '{"temp":21.5}' --json
secure-mqtt sub --topic 'test/e2ee/#' --qos 1
```

## Key Administration

See `docs/key-lifecycle.md` and `docs/self-managed-key-design.md`.

For remote backup: encrypt the keyring file with an operator-chosen tool before upload.
Do not commit keyrings or treat public brokers as a key-distribution channel.

## Testing

```bash
make test
make test-security
make test-integration   # requires docker compose
```

## Observability

- Structured JSON logs via `secure_mqtt.observability.logging`
- Low-cardinality counters via `Metrics.snapshot()`
- No secrets in logs, repr, or outbox rows
