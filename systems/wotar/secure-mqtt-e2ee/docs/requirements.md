# Requirements

## Functional Requirements

| ID | Requirement | Module | Planned Tests |
|----|-------------|--------|---------------|
| FR-001 | Client connects to MQTT Broker with strict TLS | `mqtt/paho_transport.py`, `mqtt/transport.py` | `tests/security/test_tls.py`, `tests/integration/test_emqx_tls.py` |
| FR-002 | Application can publish bytes, str, or JSON-compatible objects | `client.py` | `tests/unit/test_client_publish.py` |
| FR-003 | Application can register exact topic or wildcard subscriptions | `mqtt/subscriptions.py`, `client.py` | `tests/unit/test_subscriptions.py` |
| FR-004 | Application callback receives only validated decrypted plaintext | `workers/receive_worker.py`, `client.py` | `tests/unit/test_receive_pipeline.py` |
| FR-005 | Active key for new messages; decrypt-only for historical | `keys/provider.py`, `keys/file_keyring.py` | `tests/unit/test_key_rotation.py` |
| FR-006 | Subscriptions registered before connect; SUBSCRIBE after CONNACK | `mqtt/paho_transport.py` | `tests/unit/test_mqtt_subscribe.py` |
| FR-007 | Client safely restores subscriptions on reconnect | `mqtt/paho_transport.py` | `tests/unit/test_mqtt_reconnect.py` |
| FR-008 | QoS 1 publish tracks PUBACK; no delivered before ACK | `workers/publish_worker.py`, `mqtt/paho_transport.py` | `tests/unit/test_publish_ack.py` |
| FR-009 | Publish persists encrypted envelope to outbox before send | `persistence/outbox.py`, `workers/publish_worker.py` | `tests/unit/test_outbox.py` |
| FR-010 | Receive persists to inbox before worker processing | `persistence/inbox.py`, `workers/receive_worker.py` | `tests/unit/test_inbox.py` |
| FR-011 | Handler failure retries per retry policy | `persistence/inbox.py`, `workers/receive_worker.py` | `tests/unit/test_inbox_retry.py` |
| FR-012 | Public EMQX smoke test opt-in with random namespace | `tests/integration/test_public_smoke.py` | `tests/integration/test_public_smoke.py` |

## Security Requirements

| ID | Requirement | Module | Planned Tests |
|----|-------------|--------|---------------|
| SEC-001 | No `ssl.CERT_NONE` | `mqtt/paho_transport.py` | `tests/security/test_tls_static.py` |
| SEC-002 | No `tls_insecure_set(True)` | `mqtt/paho_transport.py` | `tests/security/test_tls_static.py` |
| SEC-003 | Missing CA file causes startup failure | `mqtt/paho_transport.py`, `config.py` | `tests/security/test_tls.py` |
| SEC-004 | No active key => startup/publish failure; no temp keys | `keys/provider.py`, `client.py` | `tests/unit/test_key_provider.py` |
| SEC-005 | No key material in logs/exceptions/repr/metrics | `observability/logging.py`, `crypto/key_material.py` | `tests/security/test_no_secrets.py` |
| SEC-006 | Ciphertext bound to actual MQTT topic | `protocol/envelope.py` | `tests/security/test_tamper_matrix.py` |
| SEC-007 | Ed25519 publisher signature on every message | `crypto/signing.py`, `protocol/envelope.py` | `tests/security/test_tamper_matrix.py` |
| SEC-008 | sender_id bound to trusted registry public key | `keys/public_key_registry.py` | `tests/security/test_tamper_matrix.py` |
| SEC-009 | Authenticated msg_id, iat, exp, seq in every message | `protocol/envelope.py` | `tests/security/test_tamper_matrix.py` |
| SEC-010 | Receiver persists deduplication state | `persistence/replay.py` | `tests/unit/test_replay.py` |
| SEC-011 | Unknown kid/sig_kid, retired/revoked keys, expired/future, bad sig/tag fail closed | `protocol/envelope.py`, `keys/provider.py` | `tests/security/test_tamper_matrix.py` |
| SEC-012 | Malformed/oversized envelope cannot crash or leak secrets | `protocol/codec.py`, `protocol/envelope.py` | `tests/property/test_parser_fuzz.py` |

## Reliability Requirements

| ID | Requirement | Module | Planned Tests |
|----|-------------|--------|---------------|
| REL-001 | All network-facing queues bounded | `client.py`, `workers/*` | `tests/unit/test_bounded_queues.py` |
| REL-002 | MQTT callback does not run application handler | `workers/receive_worker.py` | `tests/unit/test_receive_worker.py` |
| REL-003 | connect/publish/shutdown timeouts | `client.py`, `mqtt/paho_transport.py` | `tests/unit/test_timeouts.py` |
| REL-004 | Exponential reconnect backoff | `mqtt/paho_transport.py` | `tests/unit/test_mqtt_reconnect.py` |
| REL-005 | Duplicate delivery does not invoke handler twice for same sender_id/msg_id | `persistence/replay.py`, `workers/receive_worker.py` | `tests/unit/test_replay.py`, `tests/integration/test_emqx_e2e.py` |

## Operational Requirements

| ID | Requirement | Module | Planned Tests |
|----|-------------|--------|---------------|
| OPS-001 | Structured logs without plaintext/keys/full ciphertext | `observability/logging.py` | `tests/security/test_no_secrets.py` |
| OPS-002 | Low-cardinality metrics (see threat-model) | `observability/metrics.py` | `tests/unit/test_metrics.py` |
| OPS-003 | All timestamps timezone-aware UTC | all modules | `tests/unit/test_timestamps.py` |