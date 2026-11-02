"""CU-M3-U01–03 exact command evidence: real DB, zero runtime dispatch."""

import hashlib
import json
from uuid import uuid4

from psycopg.types.json import Jsonb
from test_control_plane import PlatformFixture

from agent_platform.command_lookup import lookup
from agent_platform.domain import Problem


class CommandLookupTests(PlatformFixture):
    def lookup(self, key, suffix="tasks"):
        return self.client.get(f"/api/v1/commands/{key}/{suffix}")

    def test_u01_exact_original_receipt_zero_writes(self):
        key = str(uuid4())
        original = self.create(key)
        with self.db.transaction() as conn:
            before = {
                t: conn.execute(f"SELECT count(*) AS n FROM {t}").fetchone()["n"]
                for t in ("commands", "tasks", "runs", "jobs", "run_events", "audit_events")
            }
            conn.execute("UPDATE runs SET state='cancelled' WHERE id=%s", (original["run"]["id"],))
        response = self.lookup(key)
        self.assertEqual(response.status_code, 200, response.text)
        evidence = response.json()
        self.assertEqual(evidence["version"], "fanz-command-evidence-v1")
        self.assertEqual(evidence["key"], key)
        self.assertEqual(evidence["route"], "tasks.create")
        self.assertEqual(evidence["request"], self.payload)
        self.assertEqual(evidence["receipt"], original)
        self.assertEqual(evidence["receipt"]["run"]["state"], "queued")
        expected = hashlib.sha256(
            json.dumps(self.payload, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        self.assertEqual(evidence["payload_hash"], expected)
        for table, count in before.items():
            self.assertEqual(self.scalar(f"SELECT count(*) FROM {table}"), count)

    def test_u02_missing_pending_corrupt_and_other_owner_fail_closed(self):
        key = str(uuid4())
        self.assertEqual(self.lookup(key).status_code, 404)
        original = self.create(key)
        with self.db.transaction() as conn:
            saved = conn.execute(
                "SELECT * FROM commands WHERE idempotency_key=%s", (key,)
            ).fetchone()
        for changes in (
            {"status": "pending"},
            {"payload_hash": "0" * 64},
            {"run_id": None},
            {"result": {"status": 202, "body": {}}},
        ):
            with self.db.transaction() as conn:
                for field, value in changes.items():
                    conn.execute(
                        f"UPDATE commands SET {field}=%s WHERE idempotency_key=%s",
                        (Jsonb(value) if field == "result" else value, key),
                    )
            self.assertEqual(self.lookup(key).status_code, 409)
            with self.db.transaction() as conn:
                for field in changes:
                    conn.execute(
                        f"UPDATE commands SET {field}=%s WHERE idempotency_key=%s",
                        (Jsonb(saved[field]) if field == "result" else saved[field], key),
                    )
        with self.assertRaises(Problem) as denied:
            lookup(self.db, uuid4(), key)
        self.assertEqual(denied.exception.status, 404)
        self.client.cookies.clear()
        self.assertEqual(self.lookup(key).status_code, 401)
        self.assertEqual(
            self.scalar("SELECT count(*) FROM runs WHERE id=%s", (original["run"]["id"],)), 1
        )

    def test_u03_unicode_key_order_and_noncanonical_ids(self):
        self.payload = dict(
            reversed(list({**self.payload, "title": "修復😀", "goal": "行\n\té\u007f"}.items()))
        )
        key = str(uuid4())
        self.create(key)
        response = self.lookup(key)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["request"], self.payload)
        self.assertEqual(
            response.json()["payload_hash"],
            hashlib.sha256(
                json.dumps(self.payload, sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest(),
        )
        for bad in (key.upper(), key.replace("-", ""), "not-a-key"):
            self.assertEqual(self.lookup(bad).status_code, 422)
        self.assertEqual(self.lookup(key, "projects").status_code, 404)

    def test_u02_oversized_or_wrong_identity_original_receipt_is_not_evidence(self):
        key = str(uuid4())
        self.create(key)
        with self.db.transaction() as conn:
            original = conn.execute(
                "SELECT result FROM commands WHERE idempotency_key=%s", (key,)
            ).fetchone()["result"]
        for field, value in (("created_by", str(uuid4())), ("id", str(uuid4()))):
            changed = json.loads(json.dumps(original))
            changed["body"]["task"][field] = value
            with self.db.transaction() as conn:
                conn.execute(
                    "UPDATE commands SET result=%s WHERE idempotency_key=%s", (Jsonb(changed), key)
                )
            self.assertEqual(self.lookup(key).status_code, 409)
        original["body"]["oversized"] = "x" * (2 * 1024 * 1024)
        with self.db.transaction() as conn:
            conn.execute(
                "UPDATE commands SET result=%s WHERE idempotency_key=%s", (Jsonb(original), key)
            )
        self.assertEqual(self.lookup(key).status_code, 409)
