"""Owned synthetic historical INSERTs; actual GC/API/export remain production.

Never represents observed worker history. No reset, immutable guard bypass,
timestamp rewrite, or maintenance HTTP endpoint. One private manifest per API boot.
"""

import hashlib
import json
import os
import secrets
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from psycopg import sql
from psycopg.types.json import Jsonb

from agent_platform import archive_retention, event_retention
from agent_platform.result_archive import archive_id, serialize

AUTHORITY = ("jobs", "sandbox_bindings", "resource_reservations", "adapter_operations")


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def require(condition):
    if not condition:
        raise AssertionError("m4_retention_ownership_or_state_mismatch")


def rows(conn, table):
    return sorted(
        json.dumps(row["value"], sort_keys=True)
        for row in conn.execute(
            sql.SQL("SELECT to_jsonb(t) AS value FROM {} t").format(sql.Identifier(table))
        ).fetchall()
    )


def facts(conn, item):
    run = conn.execute(
        "SELECT to_jsonb(r) AS value FROM runs r WHERE id=%s", (item["run_id"],)
    ).fetchone()
    task = conn.execute(
        "SELECT to_jsonb(t) AS value FROM tasks t WHERE id=%s", (item["task_id"],)
    ).fetchone()
    require(run is not None and task is not None)
    run = run["value"]
    require(run["task_id"] == item["task_id"] and task["value"]["title"] == item["title"])
    require(run["state"] == "failed" and run["cleanup_state"] == "not_allocated")
    require(run["generation"] == 0 and run["sandbox_id"] is None and run["backend_ref"] is None)
    for table in ("jobs", "sandbox_bindings", "adapter_operations"):
        require(
            conn.execute(
                sql.SQL("SELECT count(*) AS n FROM {} WHERE run_id=%s").format(
                    sql.Identifier(table)
                ),
                (item["run_id"],),
            ).fetchone()["n"]
            == 0
        )
    profile = conn.execute(
        "SELECT to_jsonb(p) AS value FROM agent_profile_revisions p WHERE id=%s",
        (run["profile_revision"],),
    ).fetchone()["value"]
    require(profile["created_at"] == run["created_at"] == task["value"]["created_at"])
    del run["event_floor"]  # The one intentional run mutation by event GC.
    return digest({"run": run, "task": task["value"], "profile": profile})


def inspect(conn, manifest, *, pruned, events_pruned=None):
    if events_pruned is None:
        events_pruned = pruned
    require(conn.info.dbname == "agent_platform_test")
    require(
        str(conn.execute("SELECT id FROM maintenance_identity").fetchone()["id"])
        == manifest["identity"]
    )
    require({table: rows(conn, table) for table in AUTHORITY} == manifest["authority"])
    for label in ("a", "b"):
        item = manifest[label]
        require(item["title"].endswith(manifest["nonce"]))
        require(facts(conn, item) == item["facts"])
        archive = conn.execute(
            "SELECT * FROM result_archives WHERE run_id=%s", (item["run_id"],)
        ).fetchone()
        require(archive is not None and str(archive["id"]) == item["artifact_id"])
        require(archive["sha256"] == item["sha256"] and archive["size"] == item["size"])
        require(archive["created_at"].isoformat() == manifest["historical_at"])
        if label == "b" and pruned:
            require(archive["payload"] is None and archive["pruned_at"] is not None)
        else:
            require(
                archive["pruned_at"] is None
                and digest(bytes(archive["payload"]).hex()) == item["payload"]
            )
        require(
            conn.execute(
                "SELECT count(*) AS n FROM github_exports WHERE run_id=%s", (item["run_id"],)
            ).fetchone()["n"]
            == (1 if label == "a" else 0)
        )
        state = conn.execute(
            "SELECT event_floor,last_event_seq FROM runs WHERE id=%s", (item["run_id"],)
        ).fetchone()
        require(state["last_event_seq"] == (3 if label == "a" else 0))
        if label == "b":
            require(state["event_floor"] == 1)
            for table in ("run_events", "run_event_identities"):
                require(
                    conn.execute(
                        sql.SQL("SELECT count(*) AS n FROM {} WHERE run_id=%s").format(
                            sql.Identifier(table)
                        ),
                        (item["run_id"],),
                    ).fetchone()["n"]
                    == 0
                )
    identities = conn.execute(
        "SELECT to_jsonb(i) AS value FROM run_event_identities i WHERE run_id=%s ORDER BY seq",
        (manifest["a"]["run_id"],),
    ).fetchall()
    require(digest(identities) == manifest["identities"])
    floor = conn.execute(
        "SELECT event_floor FROM runs WHERE id=%s", (manifest["a"]["run_id"],)
    ).fetchone()["event_floor"]
    require(floor == (3 if events_pruned else 1))
    events = conn.execute(
        "SELECT seq FROM run_events WHERE run_id=%s ORDER BY seq", (manifest["a"]["run_id"],)
    ).fetchall()
    require([r["seq"] for r in events] == ([3] if events_pruned else [1, 2, 3]))


def seed(db, fixture, path):
    require(not path.exists())
    nonce = secrets.token_hex(12)
    old = datetime.now(UTC) - timedelta(days=31)
    manifest = {"nonce": nonce, "historical_at": old.isoformat()}
    with db.transaction() as conn:
        require(conn.info.dbname == "agent_platform_test")
        manifest["identity"] = str(
            conn.execute("SELECT id FROM maintenance_identity").fetchone()["id"]
        )
        template = conn.execute(
            "SELECT t.project_id,t.created_by,r.profile_revision FROM tasks t "
            "JOIN runs r ON r.task_id=t.id WHERE r.id=%s",
            (fixture["run_id"],),
        ).fetchone()
        require(template is not None)
        for label in ("a", "b"):
            task_id, run_id, profile_id = uuid4(), uuid4(), uuid4()
            title = f"Synthetic imported retention {label.upper()} {nonce}"
            conn.execute(
                "INSERT INTO agent_profile_revisions(id,profile_id,revision,name,backend,"
                "model_ref,template_digest,tool_policy,limits,created_at) "
                "SELECT %s,%s,1,%s,backend,model_ref,template_digest,tool_policy,limits,%s "
                "FROM agent_profile_revisions WHERE id=%s",
                (profile_id, uuid4(), title, old, template["profile_revision"]),
            )
            conn.execute(
                "INSERT INTO tasks(id,project_id,title,created_by,created_at) "
                "VALUES (%s,%s,%s,%s,%s)",
                (task_id, template["project_id"], title, template["created_by"], old),
            )
            patch = (
                f"diff --git a/retention-{label}.txt b/retention-{label}.txt\n"
                "new file mode 100644\n"
                f"--- /dev/null\n+++ b/retention-{label}.txt\n@@ -0,0 +1 @@\n"
                f"+synthetic imported {label}\n"
            )
            result = {
                "summary": f"Synthetic imported result {label.upper()}",
                "verification": {"status": "unknown"},
                "execution_mode": "synthetic-import",
                "diff": patch,
                "diff_bytes": len(patch.encode()),
                "diff_sha256": hashlib.sha256(patch.encode()).hexdigest(),
                "base_sha": fixture["export_fixture"]["base_sha"],
            }
            run = conn.execute(
                "INSERT INTO runs(id,task_id,attempt_no,base_sha,profile_revision,goal,"
                "state,deadline,last_event_seq,result,created_at) "
                "VALUES (%s,%s,1,%s,%s,%s,'failed',%s,%s,%s,%s) RETURNING *",
                (
                    run_id,
                    task_id,
                    result["base_sha"],
                    profile_id,
                    title,
                    old + timedelta(hours=1),
                    3 if label == "a" else 0,
                    Jsonb(result),
                    old,
                ),
            ).fetchone()
            payload = serialize(run, result)
            artifact = archive_id(run_id)
            sha = hashlib.sha256(payload).hexdigest()
            conn.execute(
                "INSERT INTO result_archives(id,run_id,payload,sha256,size,created_at) "
                "VALUES (%s,%s,%s,%s,%s,%s)",
                (artifact, run_id, payload, sha, len(payload), old),
            )
            manifest[label] = {
                "task_id": str(task_id),
                "run_id": str(run_id),
                "artifact_id": str(artifact),
                "title": title,
                "sha256": sha,
                "size": len(payload),
                "payload": digest(payload.hex()),
                "result": result,
            }
            manifest[label]["facts"] = facts(conn, manifest[label])
        for seq in (1, 2, 3):
            metadata = (
                manifest["a"]["run_id"],
                seq,
                uuid4(),
                "m4-retention-" + nonce,
                str(seq),
                "fixture.event",
                old if seq < 3 else datetime.now(UTC) - timedelta(days=1),
            )
            conn.execute("INSERT INTO run_event_identities VALUES (%s,%s,%s,%s,%s,%s,%s)", metadata)
            conn.execute(
                "INSERT INTO run_events(run_id,seq,event_id,source,source_event_id,"
                "type,created_at,payload) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    *metadata,
                    Jsonb({"content": "M4 retained suffix" if seq == 3 else "M4 expired prefix"}),
                ),
            )
        manifest["identities"] = digest(
            conn.execute(
                "SELECT to_jsonb(i) AS value FROM run_event_identities i "
                "WHERE run_id=%s ORDER BY seq",
                (manifest["a"]["run_id"],),
            ).fetchall()
        )
        manifest["authority"] = {table: rows(conn, table) for table in AUTHORITY}
    with path.open("x") as target:
        path.chmod(0o600)
        target.write(json.dumps(manifest))
    return {label: manifest[label] for label in ("a", "b")}


def retention_action(action, db, output):
    fixture = json.loads(output.read_text())
    # API boot credentials bind a fresh manifest path without emitting secrets.
    path = output.with_name("browser-m4-retention-" + digest(fixture)[:16] + ".json")
    if action == "m4-retention-seed":
        print(json.dumps(seed(db, fixture, path)))
        return
    require(
        path.is_file()
        and not path.is_symlink()
        and path.stat().st_uid == os.getuid()
        and path.stat().st_nlink == 1
        and path.stat().st_mode & 0o777 == 0o600
        and path.stat().st_size < 131072
    )
    manifest = json.loads(path.read_text())
    if action == "m4-retention-prune":
        with db.transaction() as conn:
            inspect(conn, manifest, pruned=False)
            exports = rows(conn, "github_exports")
        events = event_retention.preview(db)
        require(len(events["candidates"]) == 1)
        candidate = events["candidates"][0]
        require(
            candidate["run_id"] == manifest["a"]["run_id"]
            and candidate["old_floor"] == 1
            and candidate["through_seq"] == 2
            and candidate["event_count"] == 2
        )
        archives = archive_retention.preview(db)
        require([item["id"] for item in archives["candidates"]] == [manifest["b"]["artifact_id"]])
        with db.transaction() as conn:
            inspect(conn, manifest, pruned=False)
        event_receipt = event_retention.apply(db, events, approval_digest=events["approval_digest"])
        with db.transaction() as conn:
            inspect(conn, manifest, pruned=False, events_pruned=True)
            require(rows(conn, "github_exports") == exports)
        archive_receipt = archive_retention.apply(
            db, archives, approval_digest=archives["approval_digest"]
        )
        with db.transaction() as conn:
            inspect(conn, manifest, pruned=True)
            require(rows(conn, "github_exports") == exports)
        print(json.dumps({"event": event_receipt, "archive": archive_receipt}))
    elif action in {"m4-retention-check", "m4-retention-dispatch"}:
        with db.transaction() as conn:
            inspect(conn, manifest, pruned=True)
        if action.endswith("dispatch"):
            from browser_export_fixture import export_action

            export_action("export-dispatch", db, output)
        else:
            print(json.dumps({"owned": True}))
    else:
        raise ValueError("unknown_m4_retention_action")
