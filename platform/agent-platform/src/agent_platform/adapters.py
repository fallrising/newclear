"""Deterministic, DB-backed fixtures. These adapters perform no host/VM/model work."""

from typing import Protocol
from uuid import uuid4

from psycopg.types.json import Jsonb

from .domain import CAPABILITIES, Problem


class AgentBackend(Protocol):
    def capabilities(self) -> dict: ...
    def create(self, conn, run: dict, operation_id: str) -> dict: ...
    def send_message(self, conn, run: dict, command_id: str) -> dict: ...
    def events(self, conn, run: dict, cursor: str | None) -> list[dict]: ...
    def inspect(self, conn, run: dict) -> dict: ...


class SandboxProvider(Protocol):
    def capabilities(self) -> dict: ...
    def allocate(self, conn, run: dict, operation_id: str) -> dict: ...
    def release(self, conn, run: dict, operation_id: str) -> dict: ...
    def inspect(self, conn, run: dict) -> dict: ...


def record(conn, run_id, operation_id, kind, result):
    conn.execute(
        "INSERT INTO adapter_operations(operation_id,run_id,kind,result) VALUES (%s,%s,%s,%s) "
        "ON CONFLICT(operation_id) DO NOTHING",
        (operation_id, run_id, kind, Jsonb(result)),
    )
    row = conn.execute(
        "SELECT * FROM adapter_operations WHERE operation_id=%s", (operation_id,)
    ).fetchone()
    if row["run_id"] != run_id or row["kind"] != kind:
        raise Problem(409, "adapter_operation_conflict")
    return row["result"]


class FakeAgentBackend:
    def capabilities(self):
        return CAPABILITIES.copy()

    def create(self, conn, run, operation_id):
        return record(
            conn, run["id"], operation_id, "agent.create", {"ref": f"fake-conversation:{run['id']}"}
        )

    def send_message(self, conn, run, command_id):
        return record(
            conn,
            run["id"],
            command_id,
            "agent.prompt",
            {
                "id": str(uuid4()),
                "role": "assistant",
                "content": (
                    "已收到任務。這次執行使用 M1 "
                    "測試環境，已驗證任務排程與事件保存；尚未執行 repository "
                    "編輯或程式測試。"
                ),
            },
        )

    def events(self, conn, run, cursor=None):
        rows = conn.execute(
            "SELECT operation_id,result FROM adapter_operations "
            "WHERE run_id=%s AND kind='agent.prompt' ORDER BY created_at,operation_id",
            (run["id"],),
        ).fetchall()
        if cursor is not None:
            positions = [i for i, row in enumerate(rows) if row["operation_id"] == cursor]
            if not positions:
                raise Problem(409, "backend_cursor_unknown")
            rows = rows[positions[0] + 1 :]
        return [
            {
                "cursor": row["operation_id"],
                "event_id": row["result"]["id"],
                "type": "message.created",
                "payload": row["result"],
            }
            for row in rows
        ]

    def inspect(self, conn, run):
        created = conn.execute(
            "SELECT result FROM adapter_operations WHERE run_id=%s AND kind='agent.create'",
            (run["id"],),
        ).fetchone()
        messages = self.events(conn, run)
        return {
            "ref": created["result"]["ref"] if created else None,
            "observed_state": "completed" if messages else "ready" if created else "absent",
            "cursor": messages[-1]["cursor"] if messages else None,
        }

    def unsupported(self, capability):
        raise Problem(409, "unsupported_capability:" + capability)


class FakeSandboxProvider:
    def inspect(self, conn, run):
        row = conn.execute(
            "SELECT provider_handle,observed_state,cleanup_state,last_seen "
            "FROM sandbox_bindings WHERE id=%s AND run_id=%s AND generation=%s",
            (run["sandbox_id"], run["id"], run["generation"]),
        ).fetchone()
        if row is None:
            raise Problem(404, "sandbox_binding_not_found")
        return dict(row)

    def capabilities(self):
        return {
            "templates": ["fixture:m1"],
            "tiers": ["large"],
            "lease_renewal": False,
            "port_relay": False,
            "checkpoint": False,
            "fork": False,
            "hibernate": False,
        }

    def allocate(self, conn, run, operation_id):
        result = record(
            conn,
            run["id"],
            operation_id,
            "sandbox.allocate",
            {"handle": f"fake-sandbox:{run['id']}"},
        )
        conn.execute(
            (
                "UPDATE sandbox_bindings SET "
                "observed_state='running',last_seen=now() WHERE id=%s AND "
                "generation=%s"
            ),
            (run["sandbox_id"], run["generation"]),
        )
        return result

    def release(self, conn, run, operation_id):
        result = record(
            conn,
            run["id"],
            operation_id,
            "sandbox.release",
            {"observed_state": "stopped", "execution_mode": "fake"},
        )
        conn.execute(
            (
                "UPDATE sandbox_bindings SET "
                "observed_state='stopped',desired_state='stopped',cleanup_state='c"
                "onfirmed',last_seen=now() WHERE id=%s AND generation=%s"
            ),
            (run["sandbox_id"], run["generation"]),
        )
        return result
