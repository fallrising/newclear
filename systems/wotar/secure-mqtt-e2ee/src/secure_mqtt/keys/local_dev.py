"""Backward-compatible re-export of the file keyring provider.

Prefer :class:`secure_mqtt.keys.file_keyring.FileKeyringProvider`.
"""

from __future__ import annotations

from secure_mqtt.keys.file_keyring import FileKeyringProvider, LocalDevKeyProvider

__all__ = ["FileKeyringProvider", "LocalDevKeyProvider"]
