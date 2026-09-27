"""Immutable, bounded verification contracts pinned by agent profile revision."""

import hashlib
import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class VerificationCheck(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    id: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,47}$")
    argv: list[str] = Field(min_length=1, max_length=32)
    timeout_seconds: int = Field(ge=1, le=60)

    @field_validator("argv")
    @classmethod
    def bounded_arguments(cls, value):
        if any(not item or len(item.encode("utf-8")) > 512 or "\x00" in item for item in value):
            raise ValueError("invalid_verification_argv")
        return value


class VerificationPolicy(BaseModel):
    """Profile-pinned checks; no task/model field can replace this contract."""

    model_config = ConfigDict(extra="forbid", strict=True)

    mode: Literal["fixture-m2", "commands", "none"] = "none"
    revision: str = Field(default="profile-checks-v1", pattern=r"^[A-Za-z0-9._-]{1,64}$")
    checks: list[VerificationCheck] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def consistent(self):
        identifiers = [check.id for check in self.checks]
        if len(set(identifiers)) != len(identifiers):
            raise ValueError("duplicate_verification_check")
        if self.mode == "commands":
            if not self.checks or sum(check.timeout_seconds for check in self.checks) > 120:
                raise ValueError("invalid_verification_check_budget")
        elif self.checks:
            raise ValueError("checks_require_commands_mode")
        return self


def contract_sha256(policy: VerificationPolicy):
    raw = json.dumps(
        policy.model_dump(mode="json"),
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode()
    return hashlib.sha256(raw).hexdigest()
