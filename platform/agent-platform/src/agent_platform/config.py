"""Explicit deployment settings; HTTP cookies are opt-in for loopback development."""

import os
from dataclasses import dataclass, field
from urllib.parse import urlsplit


@dataclass(frozen=True)
class Settings:
    database_url: str = field(repr=False)
    origin: str = "https://localhost:8443"
    insecure_local: bool = False
    session_seconds: int = 28800
    stream_seconds: float = 300

    def __post_init__(self):
        url = urlsplit(self.origin)
        if (
            url.scheme not in {"http", "https"}
            or not url.hostname
            or url.username
            or url.password
            or url.path
            or url.query
            or url.fragment
        ):
            raise ValueError("APP_ORIGIN must be an exact HTTP(S) origin without a path")
        if url.scheme == "http" and not (
            self.insecure_local and url.hostname in {"localhost", "127.0.0.1", "[::1]", "::1"}
        ):
            raise ValueError("HTTP requires APP_INSECURE_LOCAL=1 and a loopback origin")
        if not self.database_url or self.session_seconds <= 0 or self.stream_seconds <= 0:
            raise ValueError("Invalid database/session configuration")

    @property
    def secure(self):
        return urlsplit(self.origin).scheme == "https"

    @property
    def session_cookie(self):
        return "__Host-ap-session" if self.secure else "ap-session-local"

    @property
    def csrf_cookie(self):
        return "__Host-ap-csrf" if self.secure else "ap-csrf-local"

    @classmethod
    def from_env(cls):
        return cls(
            database_url=os.environ["DATABASE_URL"],
            origin=os.environ.get("APP_ORIGIN", "https://localhost:8443"),
            insecure_local=os.environ.get("APP_INSECURE_LOCAL") == "1",
        )
