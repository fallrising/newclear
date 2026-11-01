# secure-mqtt-e2ee

Part of **[wotar](https://github.com/fallrising/wotar)** — see the [root README](../README.md)
for **background**, **design**, and the end-to-end data-flow diagram.

Python MQTT v5 client with application-layer E2EE (AES-256-GCM-SIV + Ed25519),
self-managed file keyring, durable inbox/outbox, and broker-swappable transport.

## Quick start (local EMQX)

```bash
git clone git@github.com:fallrising/wotar.git
cd wotar/secure-mqtt-e2ee
make install
bash scripts/generate_dev_certs.sh
.venv/bin/python scripts/bootstrap_local_keys.py
docker compose up -d
make doctor
```

```bash
set -a && source .env.example && set +a
secure-mqtt pub --topic "test/e2ee/vector1/data" --message '{"temp":21.5}' --json \
  --public-keys-file config/public-keys.local.json
secure-mqtt sub --topic "test/e2ee/#" --public-keys-file config/public-keys.local.json
```

## Public broker smoke (synthetic only)

```bash
cp .env.public-dev.example .env.public-dev
set -a && source .env.public-dev && set +a
SECURE_MQTT_RUN_PUBLIC_SMOKE=1 .venv/bin/pytest -m public_smoke -q
```

## Keys

```bash
secure-mqtt keys list --path .secure_mqtt/keyring.json
secure-mqtt keys add-pending --path .secure_mqtt/keyring.json --topic-group vector1 --kid dek-v2
secure-mqtt keys activate --path .secure_mqtt/keyring.json --topic-group vector1 --kid dek-v2
secure-mqtt keys mark-decrypt-only --path .secure_mqtt/keyring.json --topic-group vector1 --kid dek-v1
```

## Tests

```bash
make test
make test-integration
SECURE_MQTT_RUN_PUBLIC_SMOKE=1 .venv/bin/pytest -m public_smoke
```

## Examples

```bash
set -a && source .env.example && set +a
.venv/bin/python examples/publisher.py
.venv/bin/python examples/json_sensor.py
bash examples/key_rotation_demo.sh
```

## Docs

| Doc | Purpose |
|-----|---------|
| [progress.md](docs/progress.md) | Goals & backlog |
| [architecture.md](docs/architecture.md) | Layers |
| [self-managed-key-design.md](docs/self-managed-key-design.md) | Key ownership |
| [operations.md](docs/operations.md) | Runbook |
| [residual-risks.md](docs/residual-risks.md) | Limitations |

### Isolated verification

After `make install`, run the original gates with fresh synthetic credentials in a
temporary copy of tracked source:

```sh
python scripts/verify_isolated.py --output /tmp/wotar-check --integration
```

This runs lint, typing, doctor, unit/security/property tests, the unchanged 86%
coverage gate, and real EMQX integration. It needs Docker, OpenSSL and a free
`127.0.0.1:8883`; an existing listener is never adopted or stopped. The EMQX 5.8.3
image is pinned by digest. Credentials/configuration in this checkout remain
untouched. The owned container and network are removed, and cleanup failures fail
the run. Integration readiness requires an authenticated TLS handshake.

Omit `--integration` for native gates only. `--public-smoke` additionally opts into
the existing synthetic public-broker test with a fresh namespace; it sends no
operator payload. Use a new output directory for each run. The output contains
commands, exit codes, source hashes, logs and isolation/cleanup results, but no
private keys. Requested tests that skip make verification fail. Preserve the
output outside `/tmp` when it is needed as delivery evidence.
