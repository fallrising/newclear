"""Structured JSON logging without secrets."""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime
from typing import Any

_SECRET_PATTERNS = (
    re.compile(r"(?i)(password|secret|token|key_material|signing_seed|dek_hex|private_key)"),
    re.compile(r"(?i)\b(dek|seed|nonce|ciphertext|signature|envelope)\b"),
)


def _looks_sensitive(key: str, value: object) -> bool:
    if any(pattern.search(key) for pattern in _SECRET_PATTERNS):
        return True
    if isinstance(value, (bytes, bytearray)) and key not in {"event", "level", "logger"}:
        return True
    return False


def _sanitize_value(key: str, value: object) -> object:
    if _looks_sensitive(key, value):
        return "<redacted>"
    if isinstance(value, dict):
        return {str(k): _sanitize_value(str(k), v) for k, v in value.items()}
    if isinstance(value, list):
        return [_sanitize_value(key, item) for item in value]
    return value


class JsonLogFormatter(logging.Formatter):
    """Emit single-line JSON log records."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        for key, value in record.__dict__.items():
            if key.startswith("_") or key in {
                "name",
                "msg",
                "args",
                "levelname",
                "levelno",
                "pathname",
                "filename",
                "module",
                "exc_info",
                "exc_text",
                "stack_info",
                "lineno",
                "funcName",
                "created",
                "msecs",
                "relativeCreated",
                "thread",
                "threadName",
                "processName",
                "process",
                "message",
            }:
                continue
            payload[key] = _sanitize_value(key, value)
        return json.dumps(payload, separators=(",", ":"), default=str)


def configure_logging(level: int = logging.INFO) -> None:
    """Configure root logger with JSON formatter."""
    handler = logging.StreamHandler()
    handler.setFormatter(JsonLogFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)
