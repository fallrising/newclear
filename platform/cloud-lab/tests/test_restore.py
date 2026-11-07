"""Durable snapshot boundaries used by the isolated restore qualification."""
from contextlib import closing
import importlib.util
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('restore_fixture', Path(__file__).parent/'fixtures/restore_journal.py')
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)

class RestoreBackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source, self.target = self.root/'source.sqlite', self.root/'restore.sqlite'
        self.db = sqlite3.connect(self.source)
        self.addCleanup(self.db.close)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA wal_autocheckpoint=0')
        self.db.execute('CREATE TABLE executions(command_id TEXT PRIMARY KEY, identity_digest TEXT, external_ref BLOB, state TEXT, result BLOB)')
        self.db.execute('INSERT INTO executions VALUES(?,?,?,?,?)', ('command','digest',b'{"external_id":"command"}','completed',b'{"artifact":"  exact bytes\\n"}'))
        self.db.commit()

    def test_online_backup_reads_committed_wal_and_preserves_original_bytes(self):
        self.assertGreater(Path(str(self.source)+'-wal').stat().st_size, 32)
        before = self.db.execute('SELECT * FROM executions').fetchall()
        f.backup(self.source, self.target)
        with closing(sqlite3.connect(self.target)) as restored:
            self.assertEqual(restored.execute('SELECT * FROM executions').fetchall(), before)
            self.assertEqual(restored.execute('PRAGMA integrity_check').fetchone(), ('ok',))
        self.assertEqual(self.db.execute('SELECT * FROM executions').fetchall(), before)
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o600)

    def test_snapshot_remains_independent_after_source_changes_and_reopens(self):
        f.backup(self.source, self.target)
        self.db.execute("UPDATE executions SET state='unknown',result=NULL")
        self.db.commit()
        with closing(sqlite3.connect(self.target)) as restored:
            self.assertEqual(restored.execute('SELECT state FROM executions').fetchone(), ('completed',))
            self.assertEqual(restored.execute('SELECT result FROM executions').fetchone()[0], b'{"artifact":"  exact bytes\\n"}')

    def test_existing_destination_and_symlink_are_never_overwritten(self):
        self.target.write_bytes(b'unique evidence')
        with self.assertRaises(FileExistsError): f.backup(self.source, self.target)
        link=self.root/'link';link.symlink_to(self.target)
        with self.assertRaises(FileExistsError): f.backup(self.source, link)
        self.assertEqual(self.target.read_bytes(), b'unique evidence')

    def test_missing_source_does_not_create_an_empty_source_or_destination(self):
        missing=self.root/'missing.sqlite'
        with self.assertRaises((FileNotFoundError, sqlite3.OperationalError)): f.backup(missing, self.target)
        self.assertFalse(missing.exists())
        self.assertFalse(self.target.exists())
