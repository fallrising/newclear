# Project Progress

Central index for **goals**, **Spec-Driven Development (SDD) phase status**, **requirement coverage**, and **remaining work**.

Repository: [fallrising/wotar](https://github.com/fallrising/wotar)  
Package: `secure-mqtt-e2ee` (Python module `secure_mqtt`)  
Last updated: 2026-07-29

## Project Goals

Build an end-to-end encrypted MQTT client library for EMQX (and broker-swappable MQTT)
that provides:

| # | Capability | Primary docs |
|---|------------|--------------|
| 1 | Strict TLS transport (no insecure bypass) | `architecture.md`, `tests/security/test_tls*.py` |
| 2 | Application-layer payload encryption (broker cannot decrypt) | `protocol.md`, ADR-0001 |
| 3 | Per-topic-group, versioned data encryption keys (DEKs) | `key-lifecycle.md`, `keys/` |
| 4 | Per-device Ed25519 sender signatures | ADR-0003, `crypto/signing.py` |
| 5 | Key rotation with historical decrypt compatibility | `key-lifecycle.md`, `examples/key_rotation_demo.sh` |
| 6 | Topic binding (ciphertext bound to MQTT topic) | `protocol.md`, tamper matrix |
| 7 | Replay detection and deduplication | `persistence/replay.py`, `examples/replay_demo.py` |
| 8 | Durable encrypted outbox and inbox | ADR-0004, `persistence/` |
| 9 | MQTT reconnect, resubscribe, PUBACK/SUBACK handling | `mqtt/paho_transport.py` |
| 10 | Self-managed file keyring + public EMQX synthetic smoke | `self-managed-key-design.md`, `tests/integration/` |

**Key model:** operator-owned `FileKeyringProvider` (not cloud-vendor KMS). See
[residual-risks.md](residual-risks.md).

## SDD Phase Tracker

All phases from the original spec are complete.

| Phase | Scope | Status | Key artifacts |
|-------|-------|--------|---------------|
| 0 | Environment, skeleton, assumptions | Done | `pyproject.toml`, `Makefile`, `docs/assumptions.md`, `tests/unit/test_phase0_skeleton.py` |
| 1 | Requirements, threat model, ADRs, traceability | Done | `requirements.md`, `threat-model.md`, `docs/adr/`, `traceability.md`, `tests/unit/test_phase1_docs.py` |
| 2 | Protocol spec, test vectors, codec skeleton | Done | `protocol.md`, `test-vectors.md`, `protocol/codec.py` |
| 3 | Cryptographic core (AEAD, signing, envelope) | Done | `crypto/`, `protocol/envelope.py`, security tamper matrix |
| 4 | Key providers, lifecycle, CLI keys | Done | `keys/`, `cli.py`, `self-managed-key-design.md` |
| 5 | Persistence, replay, inbox/outbox | Done | `persistence/`, inbox/outbox/replay tests |
| 6 | MQTT transport (Paho, TLS) | Done | `mqtt/paho_transport.py`, TLS static checks |
| 7 | SecureMqttClient orchestration | Done | `client.py`, `workers/` |
| 8 | CLI, examples, README | Done | `cli.py`, `examples/`, package `README.md` |
| 9 | Docker EMQX integration tests | Done | `docker-compose.yml`, `tests/integration/`, `config/emqx/acl.conf` |
| 10 | Hardening, coverage, deferred follow-ups | Done | extended tests, examples, `residual-risks.md`, traceability update |

## Requirement Coverage

All 33 requirements (FR/SEC/REL/OPS) are marked **implemented** in [traceability.md](traceability.md).

| Category | Count | Status |
|----------|-------|--------|
| Functional (FR) | 12 | 12 implemented |
| Security (SEC) | 12 | 12 implemented |
| Reliability (REL) | 5 | 5 implemented |
| Operational (OPS) | 3 | 3 implemented |

Verification gates:

```bash
make test              # unit + security + property (no docker)
make test-integration  # local EMQX (docker compose up -d)
make coverage          # core modules gated at 86%+ (see pyproject.toml)
make doctor            # Python 3.12+, AES-GCM-SIV, OpenSSL
```

## Deliverables Checklist

| Area | Status | Notes |
|------|--------|-------|
| Library (`src/secure_mqtt/`) | Done | installable via `pip install -e .` |
| CLI (`secure-mqtt`) | Done | pub, sub, keys, doctor |
| Examples | Done | publisher, subscriber, json_sensor, key_rotation, replay |
| Unit / property / security tests | Done | incl. 40-case tamper matrix |
| Integration tests (local EMQX) | Done | TLS + E2E + ACL negative |
| Public EMQX smoke | Done | opt-in: `SECURE_MQTT_RUN_PUBLIC_SMOKE=1` |
| Docker EMQX profile | Done | `docker compose up -d` |
| Design docs + ADRs | Done | `docs/` |
| Dev cert / key bootstrap scripts | Done | `scripts/` |
| Self-managed keyring positioning | Done | `FileKeyringProvider` official for all profiles |

## Backlog

| Priority | Item | Suggested next step |
|----------|------|---------------------|
| High | Optional passphrase/wrap for keyring-at-rest | Encrypt JSON keyring for safer operator backup/sync |
| Medium | Production broker ACL review | Replace file-based dev ACL with reviewed policy |
| Medium | No forward secrecy for distributed DEKs | Design per-message key agreement if required |
| Low | Full package coverage below 90% | Raise `fail_under` after mqtt/workers tests expand |
| Low | No CI secret scanning / pip-audit gate | Add GitHub Actions workflow |
| Low | Pluggable payload schema validators | Extend beyond JSON-parse check |

## Document Map

| Document | Purpose |
|----------|---------|
| [progress.md](progress.md) | This file — goals, phases, backlog |
| [requirements.md](requirements.md) | Normative requirement IDs |
| [traceability.md](traceability.md) | Req → implementation → tests |
| [threat-model.md](threat-model.md) | Trust boundaries and non-goals |
| [architecture.md](architecture.md) | Layers and data flow |
| [self-managed-key-design.md](self-managed-key-design.md) | Official key ownership model |
| [residual-risks.md](residual-risks.md) | Known limitations |
| [operations.md](operations.md) | Runbook for local/public/production profiles |

## Changelog

| Date | Change |
|------|--------|
| 2026-07-29 | Reposition keys: `FileKeyringProvider` official; drop cloud-KMS production requirement; `production` rejects public EMQX hosts |
| 2026-07-16 | Initial `progress.md`; SDD phases 0–10 complete; all requirements implemented per traceability |
| 2026-07-16 | Follow-up pass: deferred tests, examples, integration hardening, `residual-risks.md` |
| 2026-07-16 | Enforced signing-key validity windows from the trusted public-key registry |
| 2026-07-16 | Aligned local key bootstrap defaults with the shipped `vector1` topic policy |
