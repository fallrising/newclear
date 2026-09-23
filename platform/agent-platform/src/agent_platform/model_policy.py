"""The proxy supports one explicitly configured, locally metered fixture only.

No paid endpoint, ambient provider credential, redirect, or guest network exception.
The request/response dialect is intentionally smaller than a general provider API.
"""

import hashlib
import json
import re
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field

from .connector_journal import private_file
from .domain import Problem

MAX_REQUEST = 128 * 1024
MAX_RESPONSE = 256 * 1024
MODEL = "fixture:m2"
REVISION = "control-model-proxy-v1"


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def sensitive(value, secrets):
    if isinstance(value, str):
        return any(secret in value for secret in secrets)
    if isinstance(value, dict):
        return any(sensitive(k, secrets) or sensitive(v, secrets) for k, v in value.items())
    if isinstance(value, list):
        return any(sensitive(v, secrets) for v in value)
    return False


@dataclass(frozen=True)
class FixtureBudget:
    """Synthetic credits for the pinned fixture, never a provider price."""

    revision: str
    limit_microcredits: int
    input_microcredits_per_token: int
    output_microcredits_per_token: int

    def __post_init__(self):
        if (
            not isinstance(self.revision, str)
            or not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", self.revision)
            or any(
                type(value) is not int or not 1 <= value <= 10**9
                for value in (
                    self.limit_microcredits,
                    self.input_microcredits_per_token,
                    self.output_microcredits_per_token,
                )
            )
        ):
            raise ValueError("invalid_fixture_budget")


@dataclass(frozen=True)
class Policy:
    origin: str
    credential: str = field(repr=False)
    request_limit: int = 100
    mode: str = "fixture-http-v1"
    budget: FixtureBudget | None = None

    def __post_init__(self):
        # Deliberately no public/provider mode until guest transport and pricing gates.
        url = urlsplit(self.origin)
        if (
            self.mode != "fixture-http-v1"
            or not re.fullmatch(r"http://127\.0\.0\.1:[0-9]{4,5}", self.origin)
            or not 1024 <= (url.port or 0) <= 65535
            or type(self.request_limit) is not int
            or not 1 <= self.request_limit <= 100
            or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", self.credential)
            or (self.budget is not None and not isinstance(self.budget, FixtureBudget))
        ):
            raise ValueError("invalid_model_fixture_policy")

    @property
    def digest(self):
        fields = {
            "revision": REVISION,
            "mode": self.mode,
            "origin": self.origin,
            "model": MODEL,
            "request_limit": self.request_limit,
            "credential_sha256": sha(self.credential.encode()),
        }
        # Preserve the digest of existing, unpriced fixture runs across migration.
        if self.budget:
            fields["fixture_budget"] = {
                "revision": self.budget.revision,
                "limit_microcredits": self.budget.limit_microcredits,
                "input_microcredits_per_token": self.budget.input_microcredits_per_token,
                "output_microcredits_per_token": self.budget.output_microcredits_per_token,
            }
        return sha(canonical(fields))

    @classmethod
    def read(cls, path):
        path = private_file(path)
        if path.stat().st_size > 4096:
            raise ValueError("model_config_too_large")
        data = json.loads(path.read_text())
        if not isinstance(data, dict) or set(data) not in (
            {
                "origin",
                "credential_file",
                "request_limit",
                "mode",
            },
            {
                "origin",
                "credential_file",
                "request_limit",
                "mode",
                "fixture_budget",
            },
        ):
            raise ValueError("invalid_model_fixture_config")
        has_budget = "fixture_budget" in data
        budget = data.pop("fixture_budget", None)
        if has_budget and budget is None:
            raise ValueError("invalid_fixture_budget")
        if budget is not None:
            if not isinstance(budget, dict) or set(budget) != {
                "revision",
                "limit_microcredits",
                "input_microcredits_per_token",
                "output_microcredits_per_token",
            }:
                raise ValueError("invalid_fixture_budget")
            data["budget"] = FixtureBudget(**budget)
        secret = private_file(data.pop("credential_file"))
        if secret.stat().st_size > 129:
            raise ValueError("model_credential_too_large")
        return cls(credential=secret.read_text().strip(), **data)


class Completion(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    model: str = Field(min_length=1, max_length=100)
    messages: list[dict] = Field(min_length=1, max_length=128)
    max_tokens: int = Field(ge=1, le=4096)
    stream: bool = False

    def payload(self):
        if self.model != MODEL:
            raise Problem(403, "model_not_allowed")
        if self.stream:
            raise Problem(422, "model_streaming_unsupported")
        # Text-only fixture. Tools/multimodal/provider-specific parameters need their
        # own contract before the guest SDK is connected to this proxy.
        for item in self.messages:
            if (
                set(item) != {"role", "content"}
                or not isinstance(item["role"], str)
                or item["role"] not in {"system", "user", "assistant"}
                or not isinstance(item["content"], str)
                or not 1 <= len(item["content"]) <= 32768
            ):
                raise Problem(422, "model_message_invalid")
        return self.model_dump()


def response(raw, maximum, secrets):
    """Return a minimal safe response and authoritative token counts, or fail closed."""
    try:
        value = json.loads(raw)
        if sensitive(value, secrets):
            raise Problem(502, "model_sensitive_response")
        if not isinstance(value, dict) or set(value) != {"model", "choices", "usage"}:
            raise ValueError()
        if value["model"] != MODEL or len(value["choices"]) != 1:
            raise ValueError()
        choice = value["choices"][0]
        message = choice["message"]
        if (
            set(choice) != {"index", "message", "finish_reason"}
            or type(choice["index"]) is not int
            or choice["index"] != 0
            or choice["finish_reason"] not in {"stop", "length"}
            or set(message) != {"role", "content"}
            or message["role"] != "assistant"
            or not isinstance(message["content"], str)
        ):
            raise ValueError()
        usage = value["usage"]
        if set(usage) != {"prompt_tokens", "completion_tokens", "total_tokens"}:
            raise ValueError()
        if any(type(n) is not int or not 0 <= n <= 10**9 for n in usage.values()):
            raise ValueError()
        if (
            usage["total_tokens"] != usage["prompt_tokens"] + usage["completion_tokens"]
            or usage["completion_tokens"] > maximum
        ):
            raise ValueError()
        return value, usage
    except (ValueError, TypeError, KeyError, RecursionError):
        raise Problem(502, "model_response_invalid") from None
