"""MQTT v5 property helpers."""

from __future__ import annotations

from paho.mqtt.packettypes import PacketTypes
from paho.mqtt.properties import Properties

from secure_mqtt.protocol.constants import MQTT_CONTENT_TYPE


def envelope_publish_properties(content_type: str = MQTT_CONTENT_TYPE) -> Properties:
    """Build MQTT v5 publish properties for secure envelope payloads."""
    props = Properties(PacketTypes.PUBLISH)  # type: ignore[no-untyped-call]
    props.ContentType = content_type
    return props
