"""Client configuration and environment loading."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from secure_mqtt.errors import ConfigurationError
from secure_mqtt.keys.file_keyring import FileKeyringProvider
from secure_mqtt.keys.provider import KeyProvider

# Shared/public EMQX hosts used only for synthetic public-dev smoke tests.
_PUBLIC_DEV_BROKER_HOSTS = frozenset({"broker.emqx.io"})


@dataclass(frozen=True)
class TlsConfig:
    """TLS settings for strict broker authentication."""

    ca_file: Path
    cert_file: Path | None = None
    key_file: Path | None = None
    server_hostname: str | None = None

    def validate(self) -> None:
        if not self.ca_file.exists():
            msg = f"CA file not found: {self.ca_file}"
            raise ConfigurationError(msg)
        if self.cert_file is not None and not self.cert_file.exists():
            msg = f"Client certificate not found: {self.cert_file}"
            raise ConfigurationError(msg)
        if self.key_file is not None and not self.key_file.exists():
            msg = f"Client key not found: {self.key_file}"
            raise ConfigurationError(msg)
        if (self.cert_file is None) != (self.key_file is None):
            msg = "Client certificate and key must both be set or both omitted"
            raise ConfigurationError(msg)


@dataclass
class ClientConfig:
    """Runtime configuration for SecureMqttClient."""

    broker_host: str
    broker_port: int
    client_id: str
    tls: TlsConfig
    key_provider: KeyProvider
    db_path: Path
    profile: str = "local-dev"
    sender_id: str = ""
    connect_timeout_seconds: float = 30.0
    publish_timeout_seconds: float = 30.0
    shutdown_timeout_seconds: float = 10.0
    receive_queue_size: int = 256
    publish_queue_size: int = 256
    reconnect_base_seconds: float = 1.0
    reconnect_max_seconds: float = 30.0
    clock_skew_seconds: int = 60
    max_inbox_retries: int = 5
    inbox_retry_base_seconds: float = 1.0
    topic_policies: list[dict[str, object]] = field(default_factory=list)

    def validate(self) -> None:
        if not self.broker_host:
            raise ConfigurationError("broker_host is required")
        if self.broker_port <= 0 or self.broker_port > 65535:
            raise ConfigurationError("broker_port out of range")
        if not self.client_id:
            raise ConfigurationError("client_id is required")
        if self.receive_queue_size <= 0 or self.publish_queue_size <= 0:
            raise ConfigurationError("Queue sizes must be positive")
        self.tls.validate()
        # Self-managed FileKeyringProvider is the official key path for all profiles.
        # Production must not use shared public brokers (synthetic smoke only).
        if self.profile == "production" and self.broker_host.lower() in _PUBLIC_DEV_BROKER_HOSTS:
            msg = (
                "Public EMQX brokers (e.g. broker.emqx.io) are not allowed in "
                "production profile; use public-dev for synthetic smoke only"
            )
            raise ConfigurationError(msg)
        if not self.sender_id:
            self.sender_id = self.key_provider.sender_id


def _env_path(name: str, default: str | None = None) -> Path | None:
    value = os.environ.get(name, default)
    if value is None or value == "":
        return None
    return Path(value).expanduser()


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return int(raw)


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return float(raw)


def load_config_from_env(
    *,
    key_provider: KeyProvider | None = None,
) -> ClientConfig:
    """Load ClientConfig from SECURE_MQTT_* environment variables."""
    ca_file = _env_path("SECURE_MQTT_TLS_CA_FILE")
    if ca_file is None:
        raise ConfigurationError("SECURE_MQTT_TLS_CA_FILE is required")

    keyring_path = _env_path("SECURE_MQTT_KEYRING_PATH")
    provider = key_provider
    if provider is None:
        if keyring_path is None:
            raise ConfigurationError("key_provider or SECURE_MQTT_KEYRING_PATH is required")
        provider = FileKeyringProvider.from_path(keyring_path)

    db_path = _env_path("SECURE_MQTT_DB_PATH", ".secure_mqtt/state.db")
    if db_path is None:
        raise ConfigurationError("SECURE_MQTT_DB_PATH resolved to empty path")

    config = ClientConfig(
        broker_host=os.environ.get("SECURE_MQTT_BROKER_HOST", "localhost"),
        broker_port=_env_int("SECURE_MQTT_BROKER_PORT", 8883),
        client_id=os.environ.get("SECURE_MQTT_CLIENT_ID", "secure-mqtt-client"),
        tls=TlsConfig(
            ca_file=ca_file,
            cert_file=_env_path("SECURE_MQTT_TLS_CERT_FILE"),
            key_file=_env_path("SECURE_MQTT_TLS_KEY_FILE"),
            server_hostname=os.environ.get("SECURE_MQTT_TLS_SERVER_HOSTNAME"),
        ),
        key_provider=provider,
        db_path=db_path,
        profile=os.environ.get("SECURE_MQTT_PROFILE", "local-dev"),
        sender_id=os.environ.get("SECURE_MQTT_SENDER_ID", ""),
        connect_timeout_seconds=_env_float("SECURE_MQTT_CONNECT_TIMEOUT", 30.0),
        publish_timeout_seconds=_env_float("SECURE_MQTT_PUBLISH_TIMEOUT", 30.0),
        shutdown_timeout_seconds=_env_float("SECURE_MQTT_SHUTDOWN_TIMEOUT", 10.0),
        receive_queue_size=_env_int("SECURE_MQTT_RECEIVE_QUEUE_SIZE", 256),
        publish_queue_size=_env_int("SECURE_MQTT_PUBLISH_QUEUE_SIZE", 256),
    )
    config.validate()
    return config
