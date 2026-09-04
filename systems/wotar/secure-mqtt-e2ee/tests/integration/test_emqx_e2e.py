"""Local EMQX Docker end-to-end integration tests."""

from __future__ import annotations

import sqlite3
import tempfile
import time
from pathlib import Path

import pytest
from tests.fixtures.test_vector import DEK, NONCE, PLAINTEXT, signing_key
from tests.integration.conftest import (
    CERTS,
    MessageCollector,
    emqx_available,
    make_client,
)

from secure_mqtt.config import TlsConfig
from secure_mqtt.errors import (
    ConfigurationError,
    ConnectionError,
    DecryptionError,
    InvalidSignatureError,
    PublishError,
)
from secure_mqtt.keys.memory import InMemoryKeyProvider
from secure_mqtt.keys.provider import KeyState
from secure_mqtt.mqtt.paho_transport import PahoMqttTransport
from secure_mqtt.mqtt.transport import ConnectionState, IncomingMessage
from secure_mqtt.observability.metrics import Metrics
from secure_mqtt.persistence.database import Database
from secure_mqtt.protocol import envelope
from secure_mqtt.protocol.envelope import open_envelope

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("require_emqx")]


def test_emqx_tls_port_reachable() -> None:
    assert emqx_available()


def test_valid_publisher_subscriber(unique_topic, registry, local_tls) -> None:
    collector = MessageCollector()
    with tempfile.TemporaryDirectory() as tmp:
        sub = make_client(
            client_id="sub-int-001", db_path=Path(tmp) / "sub.db", tls=local_tls, registry=registry
        )
        sub.register_subscription(unique_topic, collector.handler, qos=1)
        sub.connect()
        try:
            pub = make_client(
                client_id="pub-int-001",
                db_path=Path(tmp) / "pub.db",
                tls=local_tls,
                registry=registry,
            )
            pub.connect()
            try:
                pub.publish_text(unique_topic, "integration-hello", wait_ack=True)
                collector.wait_for(1, timeout=20.0)
                assert collector.messages[0][1] == b"integration-hello"
            finally:
                pub.shutdown()
        finally:
            sub.shutdown()


def test_wrong_ca_rejects_connection(registry) -> None:
    if not (CERTS / "ca.pem").exists():
        pytest.skip("certs missing")
    # Use server cert as bogus CA — verification must fail
    bad_tls = TlsConfig(
        ca_file=CERTS / "server.pem",
        server_hostname="localhost",
    )
    transport = PahoMqttTransport(
        host="localhost",
        port=8883,
        client_id="bad-ca-test",
        tls=bad_tls,
        metrics=Metrics(),
    )
    transport.start()
    try:
        with pytest.raises(ConnectionError):
            transport.connect(timeout=10.0)
    finally:
        transport.stop()


def test_missing_ca_file_fails_at_config() -> None:
    tls = TlsConfig(ca_file=Path("/nonexistent/ca.pem"))
    with pytest.raises(ConfigurationError, match="CA file not found"):
        tls.validate()


def test_topic_substitution_rejected(unique_topic, registry, local_tls) -> None:
    """Envelope sealed for topic A must fail decrypt on topic B."""
    priv = signing_key()
    sealed = envelope.seal(
        topic=unique_topic,
        plaintext=b"bound-to-topic",
        dek=DEK,
        signing_key=priv,
        kid="dek-v1-test",
        sender_id="device-001",
        sig_kid="sig-v1-test",
        seq=1,
        schema_id="default.v1",
        content_type="text/plain",
        nonce=NONCE,
        iat_ms=1700000000000,
        ttl_seconds=300,
    )
    wrong_topic = unique_topic + "/evil"
    with pytest.raises((DecryptionError, InvalidSignatureError)):
        open_envelope(
            topic=wrong_topic,
            wire_bytes=sealed.wire_bytes,
            dek=DEK,
            public_key=priv.public_key(),
            now_ms=1700000001000,
        )


def test_ciphertext_on_broker_plaintext_not_visible(unique_topic, registry, local_tls) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        pub = make_client(
            client_id="pub-cipher-001",
            db_path=Path(tmp) / "pub.db",
            tls=local_tls,
            registry=registry,
        )
        pub.connect()
        try:
            pub.publish_text(unique_topic, "secret-payload-xyzzy", wait_ack=True)
            row = pub._outbox._db.connection.execute(  # noqa: SLF001
                "SELECT envelope FROM outbox ORDER BY id DESC LIMIT 1"
            ).fetchone()
            assert row is not None
            assert b"secret-payload-xyzzy" not in bytes(row["envelope"])
        finally:
            pub.shutdown()


def test_duplicate_delivery_handler_once(unique_topic, registry, local_tls) -> None:
    collector = MessageCollector()
    sealed_once: list[bytes] = []

    with tempfile.TemporaryDirectory() as tmp:
        sub = make_client(
            client_id="sub-dup-001", db_path=Path(tmp) / "sub.db", tls=local_tls, registry=registry
        )
        sub.register_subscription(unique_topic, collector.handler, qos=1)
        sub.connect()
        try:
            pub = make_client(
                client_id="pub-dup-001",
                db_path=Path(tmp) / "pub.db",
                tls=local_tls,
                registry=registry,
            )
            pub.connect()
            try:
                receipt = pub.publish_text(unique_topic, "dup-test", wait_ack=True)
                collector.wait_for(1, timeout=20.0)
                row = pub._outbox._db.connection.execute(  # noqa: SLF001
                    "SELECT envelope FROM outbox WHERE id = ?",
                    (receipt.outbox_id,),
                ).fetchone()
                assert row is not None
                sealed_once.append(bytes(row["envelope"]))
                # Simulate broker duplicate delivery
                sub._receive_worker.offer(  # noqa: SLF001
                    IncomingMessage(topic=unique_topic, payload=sealed_once[0], qos=1)
                )
                time.sleep(2.0)
                assert len(collector.messages) == 1
            finally:
                pub.shutdown()
        finally:
            sub.shutdown()


def test_restart_resumes_pending_outbox(unique_topic, registry, local_tls) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "shared.db"
        pub = make_client(
            client_id="pub-restart-001", db_path=db_path, tls=local_tls, registry=registry
        )
        pub.connect()
        record = pub._outbox.prepare_publish(  # noqa: SLF001
            topic=unique_topic,
            plaintext=b"pending-after-restart",
            content_type="text/plain",
        )
        pub.shutdown()

        pub2 = make_client(
            client_id="pub-restart-002", db_path=db_path, tls=local_tls, registry=registry
        )
        pub2.connect()
        try:
            pub2._publish_worker.enqueue(record.id)  # noqa: SLF001
            deadline = time.time() + 20
            while time.time() < deadline:
                updated = pub2._outbox.get_by_id(record.id)  # noqa: SLF001
                if updated is not None and updated.state.value == "acked":
                    break
                time.sleep(0.1)
            else:
                pytest.fail("Outbox not acked after restart")
        finally:
            pub2.shutdown()


def test_key_rotation_decrypt_only_still_works(registry, local_tls, unique_topic) -> None:
    """Historical messages decrypt with DECRYPT_ONLY key after rotation."""
    old_dek = DEK
    new_dek = bytes([0xFF] * 32)
    priv = signing_key()

    keys = InMemoryKeyProvider(
        sender_id="device-001",
        sig_kid="sig-v1-test",
        signing_seed=bytes([0x5D] * 32),
    )
    keys.add_dek("default", "dek-old", old_dek, KeyState.DECRYPT_ONLY)
    keys.add_dek("default", "dek-new", new_dek, KeyState.ACTIVE)

    sealed_old = envelope.seal(
        topic=unique_topic,
        plaintext=PLAINTEXT,
        dek=old_dek,
        signing_key=priv,
        kid="dek-old",
        sender_id="device-001",
        sig_kid="sig-v1-test",
        seq=1,
        schema_id="default.v1",
        content_type="application/json",
        nonce=NONCE,
        iat_ms=1700000000000,
        ttl_seconds=300,
    )
    opened = open_envelope(
        topic=unique_topic,
        wire_bytes=sealed_old.wire_bytes,
        dek=old_dek,
        public_key=priv.public_key(),
        now_ms=1700000001000,
    )
    assert opened.plaintext == PLAINTEXT

    sealed_new = envelope.seal(
        topic=unique_topic,
        plaintext=b"new-key-msg",
        dek=new_dek,
        signing_key=priv,
        kid="dek-new",
        sender_id="device-001",
        sig_kid="sig-v1-test",
        seq=2,
        schema_id="default.v1",
        content_type="text/plain",
        iat_ms=1700000000000,
        ttl_seconds=300,
    )
    opened_new = open_envelope(
        topic=unique_topic,
        wire_bytes=sealed_new.wire_bytes,
        dek=new_dek,
        public_key=priv.public_key(),
        now_ms=1700000001000,
    )
    assert opened_new.plaintext == b"new-key-msg"


def test_plaintext_port_not_used_for_client(local_tls, registry, unique_topic) -> None:
    """Client must connect on TLS 8883, not plaintext 1883."""
    with tempfile.TemporaryDirectory() as tmp:
        client = make_client(
            client_id="tls-only-001", db_path=Path(tmp) / "c.db", tls=local_tls, registry=registry
        )
        assert client.config.broker_port == 8883
        client.connect()
        try:
            assert client.transport.connection_state == ConnectionState.CONNECTED
        finally:
            client.shutdown()


def test_outbox_never_contains_plaintext(unique_topic, registry, local_tls) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "outbox.db"
        pub = make_client(
            client_id="outbox-audit", db_path=db_path, tls=local_tls, registry=registry
        )
        pub.connect()
        try:
            secret = b"TOP_SECRET_PLAINTEXT_MARKER"
            pub.publish_bytes(unique_topic, secret, wait_ack=True)
        finally:
            pub.shutdown()
        conn = sqlite3.connect(db_path)
        rows = conn.execute("SELECT envelope FROM outbox").fetchall()
        for row in rows:
            assert b"TOP_SECRET_PLAINTEXT_MARKER" not in row[0]


def test_wrong_hostname_rejects_connection() -> None:
    """TLS hostname verification must fail when server_hostname does not match cert SAN."""
    import socket
    import ssl

    if not (CERTS / "ca.pem").exists():
        pytest.skip("certs missing")
    context = ssl.create_default_context(cafile=str(CERTS / "ca.pem"))
    context.check_hostname = True
    context.verify_mode = ssl.CERT_REQUIRED
    context.load_cert_chain(
        certfile=str(CERTS / "client.pem"),
        keyfile=str(CERTS / "client.key"),
    )
    with socket.create_connection(("127.0.0.1", 8883), timeout=5.0) as sock:
        with pytest.raises(ssl.SSLCertVerificationError):
            context.wrap_socket(sock, server_hostname="wrong-hostname.example")


def test_unauthorized_client_publish_rejected(unique_topic, registry, local_tls) -> None:
    """ACL denies client IDs not matching ^secure-.*."""
    transport = PahoMqttTransport(
        host="localhost",
        port=8883,
        client_id="unauthorized-pub-test",
        tls=local_tls,
        metrics=Metrics(),
    )
    transport.start()
    try:
        transport.connect(timeout=15.0)
        with pytest.raises(PublishError):
            mid = transport.publish(unique_topic, b"\x00test", qos=1)
            transport.wait_puback(mid, timeout=10.0)
    finally:
        transport.stop()


def test_reconnect_with_queued_outbox(unique_topic, registry, local_tls) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "reconnect.db"
        pub = make_client(
            client_id="pub-reconn-001", db_path=db_path, tls=local_tls, registry=registry
        )
        pub.connect()
        record = pub._outbox.prepare_publish(  # noqa: SLF001
            topic=unique_topic,
            plaintext=b"queued-during-reconnect",
            content_type="text/plain",
        )
        pub.transport.disconnect()
        pub.shutdown()

        pub2 = make_client(
            client_id="pub-reconn-002", db_path=db_path, tls=local_tls, registry=registry
        )
        pub2.connect()
        try:
            pub2._publish_worker.enqueue(record.id)  # noqa: SLF001
            deadline = time.time() + 25
            while time.time() < deadline:
                updated = pub2._outbox.get_by_id(record.id)  # noqa: SLF001
                if updated is not None and updated.state.value == "acked":
                    break
                time.sleep(0.2)
            else:
                pytest.fail("Queued outbox not acked after reconnect")
        finally:
            pub2.shutdown()


def test_restart_resumes_pending_inbox(unique_topic, registry, local_tls) -> None:
    """Security matrix #40: pending inbox rows processed after restart."""
    from secure_mqtt.persistence.inbox import InboxState, InboxStore

    collector = MessageCollector()
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "inbox-restart.db"
        pub = make_client(
            client_id="pub-inbox-r", db_path=Path(tmp) / "pub.db", tls=local_tls, registry=registry
        )
        pub.connect()
        try:
            pub.publish_text(unique_topic, "inbox-restart-payload", wait_ack=True)
        finally:
            pub.shutdown()

        # Copy sealed envelope from pub outbox into shared inbox as PENDING
        pub_db = Path(tmp) / "pub.db"
        import sqlite3 as sq

        conn = sq.connect(pub_db)
        row = conn.execute(
            "SELECT envelope, msg_id FROM outbox ORDER BY id DESC LIMIT 1"
        ).fetchone()
        conn.close()
        assert row is not None

        inbox = InboxStore(Database(db_path))
        inserted = inbox.insert_received(
            topic=unique_topic,
            sender_id="device-local-001",
            msg_id=bytes(row[1]),
            envelope=bytes(row[0]),
            plaintext=b"inbox-restart-payload",
            schema_id="default.v1",
            content_type="text/plain; charset=utf-8",
        )
        assert inserted is not None
        inbox._db.connection.execute(  # noqa: SLF001
            "UPDATE inbox SET state = ? WHERE id = ?",
            (InboxState.PENDING.value, inserted.id),
        )
        inbox._db.connection.commit()

        sub = make_client(
            client_id="sub-inbox-r", db_path=db_path, tls=local_tls, registry=registry
        )
        sub.register_subscription(unique_topic, collector.handler, qos=1)
        sub.connect()
        try:
            collector.wait_for(1, timeout=25.0)
            assert collector.messages[0][1] == b"inbox-restart-payload"
        finally:
            sub.shutdown()
