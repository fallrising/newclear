"""Atomic commands, queue admission and durable event sequence allocation."""

import base64
import hashlib
import json
from datetime import datetime
from uuid import UUID, uuid4

from psycopg.types.json import Jsonb

from .auth import audit
from .domain import TERMINAL, Problem, capabilities


def json_value(value):
    return json.loads(
        json.dumps(
            value,
            default=lambda item: item.isoformat() if isinstance(item, datetime) else str(item),
        )
    )


def event(conn, run_id, kind, payload, *, source="platform", source_id=None):
    source_id = source_id or str(uuid4())
    # Row locking serializes producers; duplicate replay never consumes another seq.
    conn.execute("SELECT id FROM runs WHERE id=%s FOR UPDATE", (run_id,)).fetchone()
    old = conn.execute(
        "SELECT * FROM run_events WHERE run_id=%s AND source=%s AND source_event_id=%s",
        (run_id, source, source_id),
    ).fetchone()
    if old:
        return old
    seq = conn.execute(
        "UPDATE runs SET last_event_seq=last_event_seq+1 WHERE id=%s RETURNING last_event_seq",
        (run_id,),
    ).fetchone()["last_event_seq"]
    return conn.execute(
        "INSERT INTO run_events(run_id,seq,event_id,source,source_event_id,type,payload) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *",
        (run_id, seq, uuid4(), source, source_id, kind, Jsonb(json_value(payload))),
    ).fetchone()


def run_view(row):
    return {
        **row,
        "capabilities": capabilities(row["backend"]),
        "execution_mode": "cocoon-fixture" if row["backend"] == "openhands" else "fake",
    }


def require_row(row, code="not_found"):
    if row is None:
        raise Problem(404, code)
    return row


class Store:
    def __init__(self, db):
        self.db = db

    def command(self, operator, route, key, data, handler):
        if (
            not key
            or not 1 <= len(key) <= 128
            or not key.isascii()
            or any(ord(c) < 33 for c in key)
        ):
            raise Problem(422, "idempotency_key_required")
        payload = data.model_dump(mode="json")
        fingerprint = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        with self.db.transaction() as conn:
            command_id = uuid4()
            inserted = conn.execute(
                (
                    "INSERT INTO commands(id,operator_id,route,idempotency_key,payload"
                    "_hash,status) VALUES (%s,%s,%s,%s,%s,'pending') ON "
                    "CONFLICT(operator_id,route,idempotency_key) DO NOTHING RETURNING "
                    "id"
                ),
                (command_id, operator, route, key, fingerprint),
            ).fetchone()
            if not inserted:
                existing = conn.execute(
                    "SELECT payload_hash,result,status FROM commands "
                    "WHERE operator_id=%s AND route=%s AND idempotency_key=%s FOR UPDATE",
                    (operator, route, key),
                ).fetchone()
                if existing["payload_hash"] != fingerprint:
                    raise Problem(409, "idempotency_conflict")
                if existing["status"] != "completed":
                    raise Problem(409, "command_pending")
                return existing["result"]
            result = json_value(handler(conn, command_id))
            conn.execute(
                "UPDATE commands SET status='completed',result=%s WHERE id=%s",
                (Jsonb(result), command_id),
            )
            audit(conn, operator, route, str(command_id))
            return result

    def create_project(self, conn, data):
        row = conn.execute(
            "INSERT INTO projects(id,name,canonical_repo) VALUES (%s,%s,%s) RETURNING *",
            (uuid4(), data.name, data.canonical_repo),
        ).fetchone()
        return {"status": 201, "body": row}

    def create_profile(self, conn, data):
        if data.require_approval and data.backend != "openhands":
            raise Problem(409, "unsupported_capability:approval")
        profile = data.profile_id or uuid4()
        revision = 1
        if data.profile_id:
            conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))", (str(profile),))
            old = require_row(
                conn.execute(
                    (
                        "SELECT revision FROM agent_profile_revisions WHERE profile_id=%s "
                        "ORDER BY revision DESC LIMIT 1"
                    ),
                    (profile,),
                ).fetchone()
            )
            revision = old["revision"] + 1
        template = "fixture:m1"
        egress_policy = None
        if data.backend == "openhands":
            catalog = conn.execute(
                "SELECT * FROM runtime_catalog WHERE node_id='cocoon-local'"
            ).fetchone()
            if not catalog:
                raise Problem(503, "runtime_not_configured")
            template = catalog["template_digest"]
            egress_policy = catalog["egress_policy_sha256"]
            if not egress_policy:
                raise Problem(503, "runtime_egress_policy_unconfirmed")
        row = conn.execute(
            (
                "INSERT INTO agent_profile_revisions(id,profile_id,revision,name,b"
                "ackend,model_ref,template_digest,tool_policy,limits) VALUES "
                "(%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *"
            ),
            (
                uuid4(),
                profile,
                revision,
                data.name,
                data.backend,
                "fixture:m2" if data.backend == "openhands" else "fixture:m1",
                template,
                Jsonb(
                    {
                        "exec": data.backend == "openhands",
                        "network": data.backend == "openhands",
                        "egress_policy_sha256": egress_policy,
                        "require_approval": data.require_approval,
                    }
                ),
                Jsonb(
                    {
                        "deadline_seconds": data.deadline_seconds,
                        "cpu": 4,
                        "memory_bytes": 4 * 1024**3,
                    }
                ),
            ),
        ).fetchone()
        return {"status": 201, "body": {**row, "capabilities": capabilities(row["backend"])}}

    def _run(self, conn, task, attempt, data, command_id):
        profile = require_row(
            conn.execute(
                "SELECT * FROM agent_profile_revisions WHERE id=%s", (data.profile_revision,)
            ).fetchone(),
            "profile_not_found",
        )
        egress_policy = profile["tool_policy"].get("egress_policy_sha256")
        if profile["backend"] == "openhands":
            catalog = conn.execute(
                "SELECT * FROM runtime_catalog WHERE node_id='cocoon-local'"
            ).fetchone()
            repo = conn.execute(
                "SELECT p.canonical_repo FROM tasks t JOIN projects p ON "
                "p.id=t.project_id WHERE t.id=%s",
                (task,),
            ).fetchone()["canonical_repo"]
            if not catalog or catalog["template_digest"] != profile["template_digest"]:
                raise Problem(503, "runtime_template_unavailable")
            if not egress_policy or egress_policy != catalog["egress_policy_sha256"]:
                raise Problem(409, "runtime_egress_policy_changed")
            if not any(
                r["canonical_repo"] == repo and r["base_sha"] == data.base_sha
                for r in catalog["repositories"]
            ):
                raise Problem(422, "repository_revision_not_registered")
        run_id = uuid4()
        row = conn.execute(
            (
                "INSERT INTO runs(id,task_id,attempt_no,base_sha,profile_revision,"
                "goal,backend,require_approval,egress_policy_sha256,state,deadline) VALUES "
                "(%s,%s,%s,%s,%s,%s,%s,%s,%s,'queued',now()+make_interval(secs=>%s)) "
                "RETURNING *"
            ),
            (
                run_id,
                task,
                attempt,
                data.base_sha,
                data.profile_revision,
                data.goal,
                profile["backend"],
                profile["tool_policy"].get("require_approval", False),
                egress_policy,
                profile["limits"]["deadline_seconds"],
            ),
        ).fetchone()
        conn.execute("INSERT INTO jobs(id,run_id,kind) VALUES (%s,%s,'execute')", (uuid4(), run_id))
        conn.execute("UPDATE commands SET run_id=%s WHERE id=%s", (run_id, command_id))
        message_id = uuid4()
        conn.execute(
            (
                "INSERT INTO run_messages(id,run_id,role,content,command_id) "
                "VALUES (%s,%s,'user',%s,%s)"
            ),
            (message_id, run_id, data.goal, command_id),
        )
        event(
            conn,
            run_id,
            "run.queued",
            {
                "state": "queued",
                "state_version": 1,
                "execution_mode": "cocoon-fixture" if profile["backend"] == "openhands" else "fake",
            },
        )
        event(
            conn,
            run_id,
            "message.created",
            {"id": message_id, "role": "user", "content": data.goal},
        )
        row["last_event_seq"] = 2
        return run_view(row)

    def create_task(self, conn, operator, data, command_id):
        require_row(
            conn.execute("SELECT id FROM projects WHERE id=%s", (data.project_id,)).fetchone(),
            "project_not_found",
        )
        task = conn.execute(
            ("INSERT INTO tasks(id,project_id,title,created_by) VALUES (%s,%s,%s,%s) RETURNING *"),
            (uuid4(), data.project_id, data.title, operator),
        ).fetchone()
        run = self._run(conn, task["id"], 1, data, command_id)
        return {
            "status": 202,
            "location": f"/api/v1/tasks/{task['id']}",
            "body": {"task": task, "run": run},
        }

    def retry(self, conn, task_id, data, command_id):
        require_row(
            conn.execute("SELECT id FROM tasks WHERE id=%s FOR UPDATE", (task_id,)).fetchone()
        )
        latest = conn.execute(
            "SELECT * FROM runs WHERE task_id=%s ORDER BY attempt_no DESC LIMIT 1", (task_id,)
        ).fetchone()
        if latest["state_version"] != data.expected_state_version:
            raise Problem(409, "state_conflict")
        if latest["state"] not in TERMINAL:
            raise Problem(409, "active_run_exists")
        run = self._run(conn, task_id, latest["attempt_no"] + 1, data, command_id)
        conn.execute(
            "UPDATE commands SET expected_version=%s WHERE id=%s",
            (data.expected_state_version, command_id),
        )
        return {"status": 202, "location": f"/api/v1/runs/{run['id']}", "body": run}

    def projects(self):
        with self.db.transaction() as conn:
            return conn.execute("SELECT * FROM projects ORDER BY created_at,id").fetchall()

    def profiles(self):
        with self.db.transaction() as conn:
            rows = conn.execute(
                "SELECT * FROM agent_profile_revisions ORDER BY created_at DESC,id"
            ).fetchall()
            return [{**row, "capabilities": capabilities(row["backend"])} for row in rows]

    def tasks(self, cursor=None, limit=30):
        args = []
        where = ""
        if cursor:
            try:
                stamp, identifier = json.loads(
                    base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
                )
                stamp, identifier = datetime.fromisoformat(stamp), UUID(identifier)
                if stamp.tzinfo is None:
                    raise ValueError()
            except (ValueError, TypeError, UnicodeDecodeError):
                raise Problem(422, "invalid_cursor") from None
            where = "WHERE (t.created_at,t.id)<(%s,%s)"
            args = [stamp, identifier]
        with self.db.transaction() as conn:
            rows = conn.execute(
                "SELECT t.*,p.name AS project_name,r.id AS run_id,r.state,r.attempt_no "
                "FROM tasks t JOIN projects p ON p.id=t.project_id "
                "JOIN LATERAL (SELECT id,state,attempt_no FROM runs WHERE task_id=t.id "
                "ORDER BY attempt_no DESC LIMIT 1) r ON true "
                + where
                + " ORDER BY t.created_at DESC,t.id DESC LIMIT %s",
                (*args, limit + 1),
            ).fetchall()
        more = len(rows) > limit
        rows = rows[:limit]
        next_cursor = None
        if more:
            next_cursor = (
                base64.urlsafe_b64encode(
                    json.dumps([rows[-1]["created_at"].isoformat(), str(rows[-1]["id"])]).encode()
                )
                .decode()
                .rstrip("=")
            )
        return {"items": rows, "next_cursor": next_cursor}

    def task(self, task_id):
        with self.db.transaction() as conn:
            task = require_row(
                conn.execute(
                    (
                        "SELECT t.*,p.name AS project_name FROM tasks t JOIN projects p "
                        "ON p.id=t.project_id WHERE t.id=%s"
                    ),
                    (task_id,),
                ).fetchone()
            )
            runs = conn.execute(
                "SELECT * FROM runs WHERE task_id=%s ORDER BY attempt_no DESC", (task_id,)
            ).fetchall()
            return {"task": task, "runs": [run_view(r) for r in runs]}

    def run(self, run_id):
        with self.db.transaction() as conn:
            return run_view(
                require_row(conn.execute("SELECT * FROM runs WHERE id=%s", (run_id,)).fetchone())
            )

    def events(self, run_id, after):
        with self.db.transaction() as conn:
            run = require_row(
                conn.execute(
                    "SELECT event_floor,last_event_seq FROM runs WHERE id=%s", (run_id,)
                ).fetchone()
            )
            if after < run["event_floor"] - 1:
                raise Problem(410, "events_archived")
            if after > run["last_event_seq"]:
                raise Problem(422, "cursor_ahead")
            return conn.execute(
                (
                    "SELECT event_id,run_id,seq,type,created_at,payload FROM "
                    "run_events WHERE run_id=%s AND seq>%s ORDER BY seq LIMIT 200"
                ),
                (run_id, after),
            ).fetchall()

    def action(self, conn, run_id, data, command_id):
        if data.action in {"pause", "resume"}:
            from .controls import request_control

            return request_control(conn, run_id, data, command_id)
        from .cancellation import request_cancel

        return request_cancel(conn, run_id, data, command_id)

    def runtime(self):
        with self.db.transaction() as conn:
            nodes = conn.execute(
                "SELECT c.*, (SELECT count(*) FROM resource_reservations rr JOIN "
                "sandbox_bindings b ON b.id=rr.sandbox_id WHERE b.node_id=c.node_id "
                "AND rr.released_at IS NULL) AS occupied FROM runtime_capacity c ORDER"
                " BY node_id"
            ).fetchall()
            catalog = conn.execute(
                "SELECT * FROM runtime_catalog WHERE node_id='cocoon-local'"
            ).fetchone()
            active = [n for n in nodes if n["node_id"] == "fake-local" or catalog]
            return {
                "slots": 4,
                "occupied": sum(n["occupied"] for n in active),
                "queued": conn.execute(
                    "SELECT count(*) AS n FROM runs WHERE state='queued'"
                ).fetchone()["n"],
                "interrupted": conn.execute(
                    "SELECT count(*) AS n FROM runs WHERE state='interrupted'"
                ).fetchone()["n"],
                "execution_mode": "mixed" if catalog else "fake",
                "available_backends": ["fake", "openhands"] if catalog else ["fake"],
                "nodes": active,
                "repositories": catalog["repositories"] if catalog else [],
            }
