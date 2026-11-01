"""Explicit deployment settings; HTTP cookies are opt-in for loopback development."""

import json
import os
import re
from dataclasses import dataclass, field
from urllib.parse import urlsplit


def export_targets(value):
    """Validate a bounded public allowlist; credentials are never settings fields."""
    if not isinstance(value, (list, tuple)) or len(value) > 20:
        raise ValueError("export_targets_invalid")
    result = []
    for item in value:
        if not isinstance(item, dict) or set(item) != {"repo", "base_branch"}:
            raise ValueError("export_targets_invalid")
        repo, branch = item["repo"], item["base_branch"]
        if (
            type(repo) is not str
            or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}", repo) is None
            or repo.split("/")[1] in {".", ".."}
            or type(branch) is not str
            or re.fullmatch(r"[A-Za-z0-9_./-]{1,200}", branch) is None
            or ".." in branch
            or "@{" in branch
            or branch == "@"
            or branch.endswith(".")
            or any(
                not part or part.startswith(".") or part.endswith(".lock")
                for part in branch.split("/")
            )
        ):
            raise ValueError("export_targets_invalid")
        normalized = {"repo": repo, "base_branch": branch}
        if normalized in result:
            raise ValueError("export_targets_invalid")
        result.append(normalized)
    return tuple(result)


@dataclass(frozen=True)
class Settings:
    database_url: str = field(repr=False)
    origin: str = "https://localhost:8443"
    insecure_local: bool = False
    session_seconds: int = 28800
    stream_seconds: float = 300
    export_targets: tuple = ()

    def __post_init__(self):
        object.__setattr__(self, "export_targets", export_targets(self.export_targets))
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
            export_targets=json.loads(os.environ.get("APP_EXPORT_TARGETS", "[]")),
        )
