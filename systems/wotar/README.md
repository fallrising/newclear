# wotar

Secure MQTT tooling: **end-to-end encrypted** publish/subscribe so the broker is
only a transport pipe. You own the keys; you can switch MQTT backends without
changing the crypto layer.

| Path | What it is |
|------|------------|
| [`secure-mqtt-e2ee/`](secure-mqtt-e2ee/) | Python library + CLI (`secure-mqtt`) for EMQX / MQTT v5 |

Repository: https://github.com/fallrising/wotar

---

## Background

MQTT brokers (including shared or cloud-hosted ones) typically see **plaintext
payloads** unless the application encrypts them. TLS protects the hop to the
broker; it does **not** stop the broker (or its operators) from reading messages.

**wotar** addresses that gap with an application-layer E2EE client:

- Encrypt and sign on the publisher before MQTT publish
- Verify and decrypt only on trusted subscribers that hold the keyring
- Treat every broker as untrusted storage/routing
- Keep key material under operator control (local JSON keyring — not AWS/Azure KMS)

Typical targets: IoT / sensor telemetry, private device channels, or any workflow
where you want “data stays confidential even if the MQ changes or is shared.”

**Not a silver bullet:** endpoint compromise exposes the keyring. Public brokers
are for synthetic smoke only — never real secrets.

---

## Design

### Trust model

| Trusted | Untrusted |
|---------|-----------|
| Endpoint process (before compromise) | MQTT broker and its admins |
| Self-managed keyring + signing seed | Network attackers |
| Administrator-provisioned public-key registry | Other tenants on a public broker |

### Crypto & protocol

| Piece | Choice |
|-------|--------|
| Payload AEAD | AES-256-GCM-SIV |
| Sender authenticity | Ed25519 over envelope fields |
| Wire format | Canonical CBOR envelope v1 |
| Topic binding | MQTT topic in AEAD AAD |
| Transport | MQTT v5 over strict TLS (no `CERT_NONE`) |
| Keys | Operator-owned `FileKeyringProvider` (JSON file) |

### Key model (official)

`FileKeyringProvider` loads DEKs and the signing seed from a local keyring file
(POSIX `0600`). Peers trust publishers via `public-keys.json`. Rotation uses
`ACTIVE` / `DECRYPT_ONLY` / `RETIRED` / `REVOKED`.

Cloud-vendor KMS is **out of scope**. To back up off-host, encrypt the keyring
yourself, then store the ciphertext wherever you like.

Profiles share the same keyring; only broker/TLS env vars change:

| Profile | Broker | Use |
|---------|--------|-----|
| `local-dev` | Docker EMQX + mTLS | Day-to-day development |
| `public-dev` | `broker.emqx.io:8883` | Synthetic smoke / broker-swap check |
| `production` | Self-hosted / EMQX Cloud / other MQTT | Real deployments (`broker.emqx.io` rejected) |

### Data flow

```
                         [ keyring.json ]
                         [ public-keys.json ]
                                   |
                                   v
 +-------------+         +---------------------+
 | Application | ------> |  SecureMqttClient   |
 |  pub / sub  | <------ |                     |
 +-------------+         +----------+----------+
                                    |
              +---------------------+---------------------+
              |                                           |
              v                                           v
        PUBLISH PATH                               RECEIVE PATH
              |                                           |
              v                                           v
   resolve topic policy                       size gate + queue
   seal AES-GCM-SIV + Ed25519                 parse + verify sig
   bind topic (AAD)                           decrypt by kid
   persist Outbox (ciphertext)                Inbox + replay dedup
   PublishWorker → PUBACK                     handler (off net thread)
              |                                           ^
              +-----------> Paho TLS / MQTT v5 -----------+
                                 |
                                 v
                      [ Broker — topic + ciphertext only ]
```

More detail: [`secure-mqtt-e2ee/docs/architecture.md`](secure-mqtt-e2ee/docs/architecture.md),
[`self-managed-key-design.md`](secure-mqtt-e2ee/docs/self-managed-key-design.md),
[`threat-model.md`](secure-mqtt-e2ee/docs/threat-model.md).

---

## Usage

### Requirements

- Python **3.12+**
- OpenSSL with AES-GCM-SIV (via `cryptography>=42`)
- Docker (optional, for local EMQX integration)

### Install

```bash
git clone git@github.com:fallrising/wotar.git
cd wotar/secure-mqtt-e2ee
make install
make doctor
```

### Local EMQX (recommended first path)

```bash
bash scripts/generate_dev_certs.sh
.venv/bin/python scripts/bootstrap_local_keys.py   # default + vector1 topic groups
docker compose up -d

set -a && source .env.example && set +a

secure-mqtt pub --topic "test/e2ee/vector1/data" --message '{"temp":21.5}' --json \
  --public-keys-file config/public-keys.local.json

secure-mqtt sub --topic "test/e2ee/#" --qos 1 \
  --public-keys-file config/public-keys.local.json
```

### Public EMQX smoke (synthetic only)

Same keyring, different broker — validates broker independence:

```bash
cp .env.public-dev.example .env.public-dev
set -a && source .env.public-dev && set +a
SECURE_MQTT_RUN_PUBLIC_SMOKE=1 .venv/bin/pytest -m public_smoke -q
```

Do **not** put real data on `broker.emqx.io`.

### Keys

```bash
# Inspect (never prints secrets)
secure-mqtt keys list --path .secure_mqtt/keyring.json

# Rotate a topic-group DEK
secure-mqtt keys add-pending --path .secure_mqtt/keyring.json --topic-group vector1 --kid dek-v2
secure-mqtt keys activate --path .secure_mqtt/keyring.json --topic-group vector1 --kid dek-v2
secure-mqtt keys mark-decrypt-only --path .secure_mqtt/keyring.json --topic-group vector1 --kid dek-v1

secure-mqtt keys validate --path .secure_mqtt/keyring.json
```

Distribute keyrings and `public-keys*.json` out-of-band (scp, USB, private store).
See [`docs/key-lifecycle.md`](secure-mqtt-e2ee/docs/key-lifecycle.md).

### Library sketch

```python
from secure_mqtt.client import SecureMqttClient, build_default_policy_resolver
from secure_mqtt.config import load_config_from_env
from secure_mqtt.policy.loader import load_public_key_registry

config = load_config_from_env()
registry = load_public_key_registry(Path("config/public-keys.local.json"))
client = SecureMqttClient(
    config=config,
    registry=registry,
    policy_resolver=build_default_policy_resolver(),
)

def on_message(msg):
    print(msg.topic, msg.plaintext)

client.register_subscription("test/e2ee/#", on_message, qos=1)
client.connect()
client.publish_json("test/e2ee/vector1/data", {"temp": 21.5}, wait_ack=True)
```

### Tests

```bash
make test                 # unit + security + property
make test-integration     # local Docker EMQX
SECURE_MQTT_RUN_PUBLIC_SMOKE=1 .venv/bin/pytest -m public_smoke
```

### Examples

```bash
set -a && source .env.example && set +a
.venv/bin/python examples/publisher.py
.venv/bin/python examples/json_sensor.py
bash examples/key_rotation_demo.sh
```

---

## Docs map

| Doc | Purpose |
|-----|---------|
| [`secure-mqtt-e2ee/docs/progress.md`](secure-mqtt-e2ee/docs/progress.md) | Goals, SDD phases, backlog |
| [`architecture.md`](secure-mqtt-e2ee/docs/architecture.md) | Layers & profiles |
| [`self-managed-key-design.md`](secure-mqtt-e2ee/docs/self-managed-key-design.md) | Official key ownership model |
| [`protocol.md`](secure-mqtt-e2ee/docs/protocol.md) | Envelope wire format |
| [`operations.md`](secure-mqtt-e2ee/docs/operations.md) | Runbook |
| [`residual-risks.md`](secure-mqtt-e2ee/docs/residual-risks.md) | Known limitations |
| [`threat-model.md`](secure-mqtt-e2ee/docs/threat-model.md) | Trust boundaries |

---

## License

See [`secure-mqtt-e2ee/LICENSE`](secure-mqtt-e2ee/LICENSE).
