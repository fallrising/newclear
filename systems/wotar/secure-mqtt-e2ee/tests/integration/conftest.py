"""Integration test fixtures for local EMQX."""

from __future__ import annotations

import socket
import ssl
import threading
import time
import uuid
from pathlib import Path

import pytest

from secure_mqtt.client import SecureMqttClient, build_default_policy_resolver
from secure_mqtt.config import ClientConfig, TlsConfig
from secure_mqtt.keys.file_keyring import FileKeyringProvider
from secure_mqtt.keys.public_key_registry import SigningPublicKeyRegistry
from secure_mqtt.policy.loader import load_public_key_registry

ROOT = Path(__file__).resolve().parents[2]
CERTS = ROOT / "certs"
KEYRING = ROOT / ".secure_mqtt" / "keyring.json"
PUBLIC_KEYS = ROOT / "config" / "public-keys.local.json"


def emqx_available(host: str = "localhost", port: int = 8883) -> bool:
    """A listening Docker proxy is insufficient: require authenticated mutual TLS."""
    try:
        context = ssl.create_default_context(cafile=str(CERTS / "ca.pem"))
        context.load_cert_chain(str(CERTS / "client.pem"), str(CERTS / "client.key"))
        with socket.create_connection((host, port), timeout=2.0) as sock:
            with context.wrap_socket(sock, server_hostname="localhost"):
                return True
    except (OSError, ssl.SSLError):
        return False


@pytest.fixture(scope="session")
def require_emqx() -> None:
    deadline = time.time() + 60
    while time.time() < deadline:
        if emqx_available():
            return
        time.sleep(2)
    pytest.skip("EMQX mutual TLS is not ready on localhost:8883")


@pytest.fixture
def registry() -> SigningPublicKeyRegistry:
    if not PUBLIC_KEYS.exists():
        pytest.skip("Run scripts/bootstrap_local_keys.py first")
    return load_public_key_registry(PUBLIC_KEYS)


@pytest.fixture
def local_tls() -> TlsConfig:
    ca = CERTS / "ca.pem"
    if not ca.exists():
        pytest.skip("Run scripts/generate_dev_certs.sh first")
    return TlsConfig(
        ca_file=ca,
        cert_file=CERTS / "client.pem",
        key_file=CERTS / "client.key",
        server_hostname="localhost",
    )


def make_client(
    *,
    client_id: str,
    db_path: Path,
    tls: TlsConfig,
    registry: SigningPublicKeyRegistry,
    require_client_cert: bool = True,
) -> SecureMqttClient:
    provider = FileKeyringProvider.from_path(KEYRING)
    effective_tls = tls
    if require_client_cert and tls.cert_file is None:
        effective_tls = TlsConfig(
            ca_file=tls.ca_file,
            cert_file=CERTS / "client.pem",
            key_file=CERTS / "client.key",
            server_hostname=tls.server_hostname,
        )
    # EMQX ACL allows client IDs matching ^secure-.*
    broker_client_id = client_id if client_id.startswith("secure-") else f"secure-{client_id}"
    config = ClientConfig(
        broker_host="localhost",
        broker_port=8883,
        client_id=broker_client_id,
        tls=effective_tls,
        key_provider=provider,
        db_path=db_path,
        profile="local-dev",
        connect_timeout_seconds=20.0,
        publish_timeout_seconds=20.0,
    )
    return SecureMqttClient(
        config=config,
        registry=registry,
        policy_resolver=build_default_policy_resolver(),
    )


@pytest.fixture
def unique_topic() -> str:
    return f"test/e2ee/{uuid.uuid4().hex}/data"


class MessageCollector:
    """Thread-safe handler invocation collector."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.messages: list[tuple[str, bytes]] = []
        self.errors: list[Exception] = []

    def handler(self, msg) -> None:
        with self._lock:
            self.messages.append((msg.sender_id, msg.plaintext))

    def wait_for(self, count: int = 1, timeout: float = 15.0) -> None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            with self._lock:
                if len(self.messages) >= count:
                    return
            time.sleep(0.1)
        msg = f"Expected {count} messages, got {len(self.messages)}"
        raise TimeoutError(msg)
