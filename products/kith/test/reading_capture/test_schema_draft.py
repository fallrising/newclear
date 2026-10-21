"""Phase-0 SQLite design checks; these are not RC API/browser acceptance."""

import sqlite3
import unittest
from pathlib import Path


KITH = Path(__file__).resolve().parents[2]
DRAFT = KITH / "docs/plans/reading-capture-schema.sql"


class SchemaDraftTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.execute("PRAGMA foreign_keys = ON")
        for migration in sorted((KITH / "migrations").glob("000[1-6]_*.sql")):
            self.db.executescript(migration.read_text())
        self.before = self.db.execute(
            "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY name"
        ).fetchall()
        self.db.execute(
            "INSERT INTO members(id, kind, handle, display_name, password_hash, created_at) "
            "VALUES ('human', 'human', 'fixture', 'Fixture', 'synthetic', '2026-01-01T00:00:00Z')"
        )
        self.db.executescript(DRAFT.read_text())

    def test_promoted_migration_preserves_reviewed_draft(self):
        promoted = (KITH / "migrations/0007_reading_capture.sql").read_text()
        self.assertIn(DRAFT.read_text().split("CREATE TABLE", 1)[1].strip(), promoted)

    def capture(self, **changes):
        row = dict(id="capture-1", body="原文\n keep spacing ", source="web",
                   client_key="request-1", created_at="2026-01-01T00:00:00Z")
        row.update(changes)
        self.db.execute(
            "INSERT INTO captures(id, body, source, client_key, created_at) "
            "VALUES (:id, :body, :source, :client_key, :created_at)", row
        )

    def note(self, **changes):
        row = dict(id="note-1", article_id="article-stable", body="人類補充",
                   updated_at="2026-01-01T00:00:00Z", revision=1)
        row.update(changes)
        self.db.execute(
            "INSERT INTO notes(id, article_id, body, updated_at, revision) "
            "VALUES (:id, :article_id, :body, :updated_at, :revision)", row
        )

    def test_only_two_new_tables_and_existing_chat_unchanged(self):
        after = self.db.execute(
            "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY name"
        ).fetchall()
        self.assertTrue(set(self.before).issubset(set(after)))
        self.assertEqual({r[1] for r in after if r[0] == "table"} -
                         {r[1] for r in self.before if r[0] == "table"}, {"captures", "notes"})
        self.assertEqual(self.db.execute("SELECT display_name FROM members").fetchall(), [("Fixture",)])
        self.assertEqual(self.db.execute("SELECT count(*) FROM messages").fetchone(), (0,))
        self.assertNotIn(DRAFT.parent, (KITH / "migrations").parents)
        self.assertFalse(DRAFT.is_relative_to(KITH / "migrations"))

    def test_capture_original_text_and_pending_export(self):
        self.capture()
        self.assertEqual(self.db.execute("SELECT body, exported_commit FROM captures").fetchone(),
                         ("原文\n keep spacing ", None))

    def test_retry_key_cannot_create_or_overwrite_a_second_capture(self):
        self.capture()
        with self.assertRaises(sqlite3.IntegrityError):
            self.capture(id="capture-2", body="changed retry")
        self.assertEqual(self.db.execute("SELECT id, body FROM captures WHERE client_key=?",
                                        ("request-1",)).fetchall(),
                         [("capture-1", "原文\n keep spacing ")])

    def test_capture_constraints(self):
        for change in ({"id": None}, {"id": ""}, {"client_key": None}, {"client_key": ""},
                       {"body": None}, {"body": ""}, {"body": "界" * 5462},
                       {"source": "slack"}, {"created_at": None}, {"created_at": ""}):
            with self.subTest(change=list(change)):
                with self.assertRaises(sqlite3.IntegrityError):
                    self.capture(**change)

    def test_note_constraints_and_one_supplement_per_article(self):
        for change in ({"id": None}, {"id": ""}, {"article_id": None}, {"article_id": ""},
                       {"body": None}, {"body": ""}, {"body": "界" * 5462},
                       {"updated_at": None}, {"updated_at": ""}, {"revision": 0},
                       {"revision": 1.5}, {"revision": None}):
            with self.subTest(change=list(change)):
                with self.assertRaises(sqlite3.IntegrityError):
                    self.note(**change)
        self.note()
        with self.assertRaises(sqlite3.IntegrityError):
            self.note(id="note-2")

    def test_byte_limit_includes_multibyte_characters(self):
        self.capture(body="x" * 16384)
        self.note(body="界" * 5461 + "x")
        with self.assertRaises(sqlite3.IntegrityError):
            self.capture(id="capture-2", client_key="request-2", body="x" * 16385)

    def test_stale_export_ack_does_not_mark_edited_note_exported(self):
        self.note()
        old_revision = self.db.execute("SELECT revision FROM notes").fetchone()[0]
        # Planned API edit transaction: increment even if the clock has not advanced.
        self.db.execute("UPDATE notes SET body=?, revision=revision+1, exported_commit=NULL WHERE id=?",
                        ("新補充", "note-1"))
        stale = self.db.execute("UPDATE notes SET exported_commit=? WHERE id=? AND revision=?",
                                ("a" * 40, "note-1", old_revision))
        self.assertEqual(stale.rowcount, 0)
        self.assertEqual(self.db.execute("SELECT body, revision, exported_commit FROM notes").fetchone(),
                         ("新補充", 2, None))
        fresh = self.db.execute("UPDATE notes SET exported_commit=? WHERE id=? AND revision=?",
                                ("b" * 40, "note-1", 2))
        self.assertEqual(fresh.rowcount, 1)

    def test_transaction_failure_does_not_leave_half_a_save(self):
        with self.assertRaises(sqlite3.IntegrityError):
            with self.db:
                self.capture()
                self.capture(id="capture-2")
        self.assertEqual(self.db.execute("SELECT count(*) FROM captures").fetchone(), (0,))

    def test_pending_export_queries_have_indexes(self):
        for table, timestamp in (("captures", "created_at"), ("notes", "updated_at")):
            plan = self.db.execute(
                f"EXPLAIN QUERY PLAN SELECT id FROM {table} WHERE exported_commit IS NULL "
                f"ORDER BY {timestamp}, id LIMIT 100"
            ).fetchall()
            self.assertTrue(any(f"{table}_pending_export" in row[3] for row in plan), plan)


if __name__ == "__main__":
    unittest.main()
