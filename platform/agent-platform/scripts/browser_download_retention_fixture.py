"""Owned historical INSERTs and archive-only GC for download failure qualification."""

import json
import os

from browser_m4_retention_fixture import AUTHORITY, digest, facts, require, rows, seed

from agent_platform import archive_retention


def snapshot(conn, manifest):
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
    require(not rows(conn, "github_exports"))
    return {
        table: rows(conn, table)
        for table in (
            *AUTHORITY,
            "runs",
            "tasks",
            "agent_profile_revisions",
            "run_events",
            "run_event_identities",
            "github_exports",
        )
    }


def archives(conn, manifest, *, pruned):
    metadata = {}
    for label in ("a", "b"):
        item = manifest[label]
        value = conn.execute(
            "SELECT * FROM result_archives WHERE id=%s", (item["artifact_id"],)
        ).fetchone()
        require(value is not None and str(value["run_id"]) == item["run_id"])
        require(value["sha256"] == item["sha256"] and value["size"] == item["size"])
        require(value["created_at"].isoformat() == manifest["historical_at"])
        payload, pruned_at = value.pop("payload"), value.pop("pruned_at")
        if pruned:
            require(payload is None and pruned_at is not None)
        else:
            require(pruned_at is None and digest(bytes(payload).hex()) == item["payload"])
        metadata[label] = value
    return metadata


def download_retention_action(action, db, output):
    fixture = json.loads(output.read_text())
    path = output.with_name("browser-download-retention-" + digest(fixture)[:16] + ".json")
    if action == "download-retention-seed":
        print(json.dumps(seed(db, fixture, path)))
        return
    require(action == "download-retention-prune")
    require(
        path.is_file()
        and not path.is_symlink()
        and path.stat().st_uid == os.getuid()
        and path.stat().st_nlink == 1
        and path.stat().st_mode & 0o777 == 0o600
        and path.stat().st_size < 131072
    )
    manifest = json.loads(path.read_text())
    with db.transaction() as conn:
        before = snapshot(conn, manifest)
        identities = archives(conn, manifest, pruned=False)
    plan = archive_retention.preview(db)
    expected = sorted(manifest[label]["artifact_id"] for label in ("a", "b"))
    require(sorted(item["id"] for item in plan["candidates"]) == expected)
    with db.transaction() as conn:
        require(snapshot(conn, manifest) == before)
        require(archives(conn, manifest, pruned=False) == identities)
    receipt = archive_retention.apply(db, plan, approval_digest=plan["approval_digest"])
    require(receipt["count"] == 2 and sorted(receipt["artifact_ids"]) == expected)
    with db.transaction() as conn:
        require(snapshot(conn, manifest) == before)
        require(archives(conn, manifest, pruned=True) == identities)
    print(json.dumps({"receipt": receipt, "owned": True, "authority_unchanged": True}))
