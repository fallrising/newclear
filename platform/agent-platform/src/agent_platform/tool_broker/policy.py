"""Immutable, deliberately mock-only tool grants and narrow guest payloads."""

import hashlib
import json
import math
import re
from dataclasses import asdict, dataclass, field
from urllib.parse import urlsplit
from uuid import UUID

from ..domain import Problem

ADAPTER_REVISION = "github-read-mock-v1"
API_REVISION = "2022-11-28"
OPERATIONS = ("github.repository.get", "github.issue.get", "github.file.get")
MAX_REQUEST = 32768
MAX_RESPONSE = 1048576
MAX_FILE = 262144
MAX_HOPS = 8
SHA = re.compile(r"[0-9a-f]{40}\Z")
NAME = re.compile(r"[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}\Z")


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def valid_path(value):
    return (
        type(value) is str
        and 0 < len(value) <= 1024
        and 1 <= len(value.split("/")) <= 4
        and all(part and part not in (".", "..") for part in value.split("/"))
        and not any(not char.isprintable() or char in "\\%?#" for char in value)
        and all(not 0xD800 <= ord(char) <= 0xDFFF for char in value)
    )


def mock_origin(value):
    if type(value) is not str:
        return False
    try:
        url = urlsplit(value)
        return (
            url.scheme == "http"
            and url.hostname == "127.0.0.1"
            and url.port is not None
            and 0 < url.port <= 65535
            and value == f"http://127.0.0.1:{url.port}"
        )
    except ValueError:
        return False


@dataclass(frozen=True)
class Policy:
    service_id: UUID
    credential_revision: UUID
    origin: str
    credential_origin: str
    credential_path_prefix: str
    secret: str = field(repr=False)
    repository_id: int
    owner: str
    repository: str
    commit: str
    paths: tuple[str, ...]
    issues: tuple[int, ...]
    operations: tuple[str, ...] = OPERATIONS
    request_limit: int = 100
    in_flight_limit: int = 2
    total_timeout: float = 10
    idle_timeout: float = 5

    def __post_init__(self):
        valid = (
            type(self.service_id) is UUID
            and type(self.credential_revision) is UUID
            and mock_origin(self.origin)
            and mock_origin(self.credential_origin)
            and type(self.credential_path_prefix) is str
            and self.credential_path_prefix.startswith("/repos/")
            and valid_path(self.credential_path_prefix.strip("/"))
            and type(self.secret) is str
            and 16 <= len(self.secret) <= 4096
            and all(33 <= ord(char) < 127 for char in self.secret)
            and type(self.repository_id) is int
            and 0 < self.repository_id < 2**63
            and type(self.owner) is str
            and NAME.fullmatch(self.owner)
            and type(self.repository) is str
            and NAME.fullmatch(self.repository)
            and type(self.commit) is str
            and SHA.fullmatch(self.commit)
            and type(self.paths) is tuple
            and len(self.paths) <= 100
            and all(valid_path(path) for path in self.paths)
            and type(self.issues) is tuple
            and len(self.issues) <= 100
            and all(type(number) is int and 0 < number < 2**63 for number in self.issues)
            and type(self.operations) is tuple
            and bool(self.operations)
            and all(type(op) is str and op in OPERATIONS for op in self.operations)
            and type(self.request_limit) is int
            and 1 <= self.request_limit <= 100
            and type(self.in_flight_limit) is int
            and 1 <= self.in_flight_limit <= 2
            and type(self.total_timeout) in (float, int)
            and math.isfinite(self.total_timeout)
            and 0 < self.total_timeout <= 10
            and type(self.idle_timeout) in (float, int)
            and math.isfinite(self.idle_timeout)
            and 0 < self.idle_timeout <= 5
        )
        if not valid:
            raise ValueError("Invalid mock tool policy")
        if any(
            len(set(values)) != len(values) for values in (self.paths, self.issues, self.operations)
        ):
            raise ValueError("Duplicate mock tool grant")

    @property
    def digest(self):
        value = asdict(self)
        value["service_id"] = str(self.service_id)
        value["credential_revision"] = str(self.credential_revision)
        value["secret"] = hashlib.sha256(self.secret.encode()).hexdigest()
        value["adapter_revision"] = ADAPTER_REVISION
        value["api_revision"] = API_REVISION
        return hashlib.sha256(canonical(value)).hexdigest()

    @property
    def repository_path(self):
        return f"/repos/{self.owner}/{self.repository}"

    def bind(self, path):
        # Independent credential policy; a reachable mock destination alone is not authority.
        prefix = self.credential_path_prefix.rstrip("/")
        if (
            self.credential_origin != self.origin
            or prefix != self.repository_path
            or not (path == prefix or path.startswith(prefix + "/"))
        ):
            raise Problem(403, "tool_credential_binding")


def normalize_request(policy, payload):
    if type(payload) is not dict:
        raise Problem(422, "tool_request_invalid")
    try:
        if len(canonical(payload)) > MAX_REQUEST:
            raise Problem(413, "tool_request_too_large")
    except (TypeError, ValueError, RecursionError):
        raise Problem(422, "tool_request_invalid") from None
    operation = payload.get("operation")
    if type(operation) is not str or operation not in policy.operations:
        raise Problem(403, "tool_operation_denied")
    fields = {"operation", "repository_id"}
    if operation == "github.issue.get":
        fields.add("issue_number")
    if operation == "github.file.get":
        fields.update(("commit", "path"))
    if set(payload) != fields:
        raise Problem(422, "tool_request_invalid")
    if (
        type(payload["repository_id"]) is not int
        or payload["repository_id"] != policy.repository_id
    ):
        raise Problem(403, "tool_resource_denied")
    if operation == "github.issue.get" and (
        type(payload["issue_number"]) is not int or payload["issue_number"] not in policy.issues
    ):
        raise Problem(403, "tool_resource_denied")
    if operation == "github.file.get" and (
        payload["commit"] != policy.commit
        or not valid_path(payload["path"])
        or payload["path"] not in policy.paths
    ):
        raise Problem(403, "tool_resource_denied")
    policy.bind(policy.repository_path)
    return payload.copy()
