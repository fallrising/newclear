# Requirement Traceability

See [progress.md](progress.md) for project goals, SDD phase status, and backlog.

| Requirement | Status | Test(s) | Notes |
|-------------|--------|---------|-------|
| FR-001 | implemented | `tests/security/test_tls.py`, `tests/integration/test_emqx_e2e.py` | Strict TLS |
| FR-002 | implemented | `tests/unit/test_outbox.py`, `examples/json_sensor.py` | bytes/text/json |
| FR-003 | implemented | `tests/unit/test_subscriptions.py` | wildcard dispatch |
| FR-004 | implemented | `tests/security/test_tamper_matrix.py`, `tests/unit/test_receive_worker.py` | validated plaintext only |
| FR-005 | implemented | `tests/unit/test_key_rotation.py`, `examples/key_rotation_demo.sh` | ACTIVE + DECRYPT_ONLY |
| FR-006 | implemented | `tests/unit/test_mqtt_subscribe.py` | subscribe before connect |
| FR-007 | implemented | `tests/unit/test_mqtt_reconnect.py`, `tests/integration/test_emqx_e2e.py` | resubscribe on connect |
| FR-008 | implemented | `tests/unit/test_publish_ack.py` | no ACK before PUBACK |
| FR-009 | implemented | `tests/unit/test_outbox.py` | encrypted outbox |
| FR-010 | implemented | `tests/unit/test_inbox.py` | durable inbox |
| FR-011 | implemented | `tests/unit/test_inbox_retry.py`, `tests/unit/test_inbox_extended.py` | retry + dead-letter |
| FR-012 | implemented | `tests/integration/test_public_smoke.py` | opt-in `SECURE_MQTT_RUN_PUBLIC_SMOKE=1` |
| SEC-001 | implemented | `tests/security/test_tls_static.py` | CERT_REQUIRED |
| SEC-002 | implemented | `tests/security/test_tls_static.py` | no tls_insecure_set(True) |
| SEC-003 | implemented | `tests/security/test_tls.py` | missing CA fails |
| SEC-004 | implemented | `tests/unit/test_key_provider.py` | no temp keys |
| SEC-005 | implemented | `tests/security/test_no_secrets.py` | redaction |
| SEC-006 | implemented | `tests/security/test_tamper_matrix.py` | topic binding |
| SEC-007 | implemented | `tests/security/test_tamper_matrix.py` | Ed25519 |
| SEC-008 | implemented | `tests/security/test_tamper_matrix.py` | registry binding |
| SEC-009 | implemented | `tests/security/test_tamper_matrix.py` | msg_id/iat/exp/seq |
| SEC-010 | implemented | `tests/unit/test_replay.py` | replay table |
| SEC-011 | implemented | `tests/security/test_tamper_matrix.py` | 40-case matrix |
| SEC-012 | implemented | `tests/property/test_parser_fuzz.py` | malformed CBOR |
| REL-001 | implemented | `tests/unit/test_bounded_queues.py` | bounded queues |
| REL-002 | implemented | `tests/unit/test_receive_worker.py` | off network thread |
| REL-003 | implemented | `tests/unit/test_timeouts.py` | connect/publish/shutdown |
| REL-004 | implemented | `tests/unit/test_mqtt_reconnect.py` | reconnect backoff config |
| REL-005 | implemented | `tests/unit/test_replay.py`, `examples/replay_demo.py` | dedup |
| OPS-001 | implemented | `tests/security/test_no_secrets.py` | structured logs |
| OPS-002 | implemented | `tests/unit/test_metrics.py` | counters |
| OPS-003 | implemented | `tests/unit/test_timestamps.py` | UTC timestamps |

*Updated after completing deferred tests, examples, and integration hardening.*