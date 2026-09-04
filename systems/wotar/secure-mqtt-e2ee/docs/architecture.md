# Architecture

## Overview

```
Application
    │
    ▼
SecureMqttClient ─────────────────────────────────────────┐
    │                                                        │
    ├── publish_bytes/text/json ──► PublishWorker ──► Outbox (SQLite)
    │                                      │                 │
    │                                      ▼                 │
    │                              PahoMqttTransport ──► MQTT Broker (TLS)
    │                                      │                 │
    ├── register_subscription ◄────────────┘                 │
    │                                                        │
    └── handler callback ◄── ReceiveWorker ◄── Inbox ◄──────┘
                ▲                    │
                │                    ├── EnvelopeParser
                │                    ├── SigningVerifier (registry)
                │                    ├── AEAD decrypt (KeyProvider)
                │                    └── ReplayGuard
```

Broker choice (local EMQX, public EMQX smoke, self-hosted, EMQX Cloud) is a
transport concern only. Payload confidentiality and authenticity are enforced in
the client via the self-managed keyring.

## Layers

1. **Transport (TLS)**: `PahoMqttTransport` — MQTT v5, strict SSLContext, reconnect backoff,
   SUBACK/PUBACK tracking, subscription registry.
2. **Protocol**: Canonical CBOR envelope v1 — seal/open, AAD topic binding, size limits.
3. **Crypto**: AES-256-GCM-SIV AEAD, Ed25519 signatures, domain separation.
4. **Key Management**: `FileKeyringProvider` — DEK keyring per topic_group; separate
   signing public-key registry. Official self-managed path (see `self-managed-key-design.md`).
5. **Policy**: `TopicPolicyResolver` — maps topics to topic_group, schema, TTL, ACL.
6. **Persistence**: SQLite WAL — outbox, inbox, sender seq, replay dedup.
7. **Workers**: Bounded queues; network thread never runs application handlers.
8. **Observability**: Structured JSON logs, low-cardinality counters.

## Data Flow — Publish

1. Resolve topic policy → topic_group, schema, TTL
2. Transaction: allocate seq, generate msg_id, seal envelope
3. Insert ciphertext envelope into outbox (no plaintext)
4. PublishWorker sends via MQTT; wait PUBACK for QoS 1
5. Mark outbox row ACKED

## Data Flow — Receive

1. Network callback: size gate → bounded queue
2. Worker: parse → verify signature → time window → decrypt by kid
3. Insert inbox row (dedup via UNIQUE constraint)
4. Schema validate → invoke handler off network thread
5. Mark DONE or retry/dead-letter

## Deployment Profiles

| Profile | Broker | TLS | Keys |
|---------|--------|-----|------|
| `local-dev` | Docker EMQX | Local CA + mTLS | `FileKeyringProvider` |
| `public-dev` | `broker.emqx.io:8883` | System CA | `FileKeyringProvider` (synthetic data only) |
| `production` | Self-hosted / EMQX Cloud / other MQTT | Customer CA/mTLS as required | `FileKeyringProvider` (operator-owned keyring) |

`production` rejects well-known public smoke brokers (e.g. `broker.emqx.io`).
Key material stays under operator control; switching brokers does not require a
different key provider.
