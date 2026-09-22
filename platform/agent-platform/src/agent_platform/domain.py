"""M1 API inputs and shared errors. Unsupported production adapters stay explicit."""

from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

TERMINAL = {"succeeded", "failed", "cancelled"}
CAPABILITIES = {
    "protocol_revision": "m1-fake-1",
    "event_replay": True,
    "durable_resume": False,
    "pause": False,
    "resume": False,
    "cancel": False,
    "approval": False,
    "usage": False,
    "terminal_output": False,
}


class Problem(Exception):
    def __init__(self, status, code):
        self.status = status
        self.code = code
        super().__init__(code)


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Login(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=1024)


class ProjectInput(Input):
    name: str = Field(min_length=1, max_length=120)
    canonical_repo: str = Field(max_length=500)

    @field_validator("canonical_repo")
    @classmethod
    def repository(cls, value):
        url = urlsplit(value)
        if (
            url.scheme != "https"
            or not url.hostname
            or url.username
            or url.password
            or url.query
            or url.fragment
            or not url.path.strip("/")
        ):
            raise ValueError("Use an HTTPS repository URL without credentials")
        return value.rstrip("/")


class ProfileInput(Input):
    name: str = Field(min_length=1, max_length=120)
    profile_id: UUID | None = None
    backend: Literal["fake", "openhands"] = "fake"
    deadline_seconds: int = Field(default=1800, ge=30, le=7200)
    require_approval: bool = False


class RunInput(Input):
    goal: str = Field(min_length=1, max_length=20000)
    base_sha: str = Field(pattern=r"^([0-9a-f]{40}|[0-9a-f]{64})$")
    profile_revision: UUID


class TaskInput(RunInput):
    project_id: UUID
    title: str = Field(min_length=1, max_length=200)


class RetryInput(RunInput):
    expected_state_version: int = Field(ge=1)


OPENHANDS_CAPABILITIES = {
    **CAPABILITIES,
    "protocol_revision": "m3-openhands-approval-1",
    "approval": True,
    "cancel": True,
    "terminal_output": True,
}


def capabilities(backend):
    return (OPENHANDS_CAPABILITIES if backend == "openhands" else CAPABILITIES).copy()


class ActionInput(Input):
    action: Literal["pause", "resume", "cancel", "approval"]
    expected_state_version: int = Field(ge=1)


class DecisionInput(Input):
    decision: Literal["approve", "deny"]
    action_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    generation: int = Field(ge=1)
    expected_state_version: int = Field(ge=1)
