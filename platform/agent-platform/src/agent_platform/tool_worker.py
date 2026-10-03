"""Explicit mock-only Worker tool lifecycle; uncertain authority is never recreated."""

import json
import time
from dataclasses import fields
from uuid import UUID

from .connector_journal import private_file
from .domain import Problem
from .store import event
from .tool_broker.broker import Broker
from .tool_broker.policy import Policy
from .tool_session import ToolSession


def read_policy(path):
    if not path:
        raise Problem(409, "tool_mock_config_missing")

    def unique(pairs):
        value = dict(pairs)
        if len(value) != len(pairs):
            raise ValueError()
        return value

    try:
        config = private_file(path)
        if config.stat().st_size > 65536:
            raise ValueError()
        value = json.loads(config.read_text(), object_pairs_hook=unique)
        expected = {field.name for field in fields(Policy)} - {"secret"} | {"secret_file"}
        if type(value) is not dict or set(value) != expected:
            raise ValueError()
        for key in ("service_id", "credential_revision"):
            parsed = UUID(value[key])
            if str(parsed) != value[key]:
                raise ValueError()
            value[key] = parsed
        for key in ("paths", "issues", "operations"):
            if type(value[key]) is not list:
                raise ValueError()
            value[key] = tuple(value[key])
        if type(value["secret_file"]) is not str:
            raise ValueError()
        secret = private_file(value.pop("secret_file"))
        if secret.stat().st_size > 4096:
            raise ValueError()
        value["secret"] = secret.read_text().strip()
        policy = Policy(**value)
        policy.bind(policy.repository_path)
        return policy
    except Exception:
        raise Problem(409, "tool_mock_config_invalid") from None


class ToolLifecycle:
    def __init__(self, worker, claim):
        self.worker, self.claim = worker, claim
        self.broker, self.session = None, None
        self.closed = False

    def configure(self, run):
        policy = read_policy(self.worker.tool_config)
        if (
            run["canonical_repo"] != f"https://github.com/{policy.owner}/{policy.repository}"
            or run["base_sha"] != policy.commit
        ):
            raise Problem(409, "tool_mock_scope_mismatch")
        self.broker = Broker(self.worker.db, policy)

    def start(self, run):
        if self.claim.get("recovery"):
            raise Problem(409, "tool_recovery_unconfirmed")
        self.broker.provision(
            run["id"],
            run["generation"],
            self.worker.owner,
            run["sandbox_id"],
            expires_at=run["deadline"],
        )
        self.session = ToolSession(
            self.broker,
            self.worker.connector,
            run_id=run["id"],
            generation=run["generation"],
            owner=self.worker.owner,
            binding_id=run["sandbox_id"],
        )
        self.step(run)

    def step(self, run):
        if run["state"] != "running":
            return
        if self.session is None or self.session.closed:
            raise Problem(409, "tool_session_unavailable")
        self.session.step()
        if self.session.closed or self.session.error:
            raise Problem(409, "tool_session_unavailable")

    def _pending(self):
        # ToolSession currently has no public drain interface. Its pending slot is
        # set before executor submission, unlike SQL which can lag the submission.
        # Inspect only here; a closed/error session is checked separately in step().
        return self.session._pending is not None

    def _settled(self, conn, run):
        return (
            conn.execute("SELECT 1 FROM tool_broker_runs WHERE run_id=%s", (run["id"],)).fetchone()
            and not conn.execute(
                "SELECT 1 FROM tool_broker_operations WHERE run_id=%s "
                "AND (status!='succeeded' OR delivery!='acknowledged') LIMIT 1",
                (run["id"],),
            ).fetchone()
        )

    def finish(self):
        deadline = time.monotonic() + self.broker.policy.total_timeout + 1
        while True:
            with self.worker.owned(self.claim) as (_, run):
                if run["state"] != "running":
                    raise Problem(409, "tool_completion_unconfirmed")
            self.step(run)
            with self.worker.owned(self.claim) as (conn, current):
                ready = not self._pending() and self._settled(conn, current)
            if ready:
                break
            if time.monotonic() >= deadline:
                raise Problem(409, "tool_completion_unconfirmed")
            time.sleep(0.05)
        self.close()
        if self.session.error:
            raise Problem(409, "tool_completion_unconfirmed")
        with self.worker.owned(self.claim) as (conn, run):
            event(conn, run["id"], "tool.session_drained", {}, source_id="tools-drained")

    def recovered_result(self):
        with self.worker.owned(self.claim) as (conn, run):
            if (
                not self._settled(conn, run)
                or not conn.execute(
                    "SELECT 1 FROM run_events WHERE run_id=%s AND type='tool.session_drained' "
                    "AND source='platform' AND source_event_id='tools-drained'",
                    (run["id"],),
                ).fetchone()
            ):
                raise Problem(409, "tool_recovery_unconfirmed")

    def close(self):
        if self.closed:
            return
        if self.session is not None:
            self.session.close()
        else:
            # Recovery/configuration failure must revoke persisted authority even
            # when the configured Policy can no longer be loaded. Preserve counters.
            with self.worker.owned(self.claim) as (conn, run):
                conn.execute(
                    "UPDATE tool_broker_runs SET revoked_at=clock_timestamp() WHERE run_id=%s",
                    (run["id"],),
                )
                conn.execute(
                    "UPDATE tool_broker_tokens SET revoked_at=clock_timestamp() "
                    "WHERE run_id=%s AND revoked_at IS NULL",
                    (run["id"],),
                )
        self.closed = True
