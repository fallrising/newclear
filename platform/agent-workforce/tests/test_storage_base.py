"""Independent checks of the root-owned SQLite boundary."""
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest

from agent_workforce.storage_base import StorageBase, ConflictError, StoreError

class SQLiteBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)/'state.sqlite'
        self.store = StorageBase(self.path)
        self.addCleanup(self.store.close)

    def test_instance_lock_covers_same_inode_and_releases_on_close(self):
        alias = self.path.with_name('alias.sqlite')
        os.link(self.path, alias)
        for path in (self.path, alias):
            with self.assertRaises(ConflictError):
                StorageBase(path)
        epoch = self.store.controller_epoch
        self.store.close()
        with StorageBase(self.path) as reopened:
            self.assertEqual(reopened.controller_epoch, epoch+1)

    def test_nested_rollback_preserves_only_outer_mutation(self):
        with self.store.transaction():
            self.store._audit('outer', {'value': 1})
            try:
                with self.store.transaction():
                    self.store._audit('inner', {'value': 2})
                    raise RuntimeError('synthetic rollback')
            except RuntimeError:
                pass
            self.store._audit('after', {'value': 3})
        self.assertEqual([r['kind'] for r in self.store.audit_rows()], ['outer','after'])
        with sqlite3.connect(self.path) as reader:
            self.assertEqual(reader.execute('SELECT count(*) FROM audit').fetchone()[0], 2)

    def test_outer_rollback_removes_completed_savepoint(self):
        with self.assertRaises(RuntimeError):
            with self.store.transaction():
                with self.store.transaction():
                    self.store._audit('inner', {})
                raise RuntimeError('outer rollback')
        self.assertEqual(self.store.audit_rows(), [])

    def test_serialized_threads_and_detached_observations(self):
        errors = []
        def write(i):
            try:
                with self.store.transaction():
                    self.store._audit('thread', {'value': [i]})
            except Exception as exc:
                errors.append(exc)
        threads = [threading.Thread(target=write, args=(i,)) for i in range(4)]
        for thread in threads: thread.start()
        for thread in threads:
            thread.join(5)
            self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])
        rows = self.store.audit_rows()
        self.assertEqual(len(rows), 4)
        rows[0]['payload']['value'].append(99)
        self.assertEqual(len(self.store.audit_rows()[0]['payload']['value']), 1)

    def test_json_is_bounded_strict_and_canonical(self):
        for value in [float('nan'), float('inf'), {'a': object()}, {1: 'bad'}, 'x'*65537, '\ud800']:
            with self.subTest(value=type(value).__name__), self.assertRaises(StoreError):
                self.store._json(value)
        deep = None
        for _ in range(42): deep = [deep]
        with self.assertRaises(StoreError): self.store._json(deep)
        self.assertEqual(self.store._json({'b':2,'a':1}), '{"a":1,"b":2}')

    def test_audit_fault_rolls_back_and_closed_store_rejects_transaction(self):
        def fail(point):
            if point == 'audit_before_write': raise RuntimeError('injected')
        self.store.fault = fail
        with self.assertRaises(RuntimeError):
            with self.store.transaction(): self.store._audit('failed', {})
        self.assertEqual(self.store.audit_rows(), [])
        self.store.close()
        with self.assertRaises(StoreError):
            with self.store.transaction(): pass

    def test_unknown_schema_version_rejected_and_failed_open_releases_lock(self):
        self.store.close()
        with sqlite3.connect(self.path) as connection:
            connection.execute('PRAGMA user_version=99')
        with self.assertRaises(StoreError): StorageBase(self.path)
        with sqlite3.connect(self.path) as connection:
            connection.execute('PRAGMA user_version=1')
        self.store = StorageBase(self.path)
        self.addCleanup(self.store.close)

    def test_initial_v1_attempts_gain_expiry_flag_and_preserve_identity(self):
        from agent_workforce.store import Store
        old_path=self.path.with_name('initial-v1.sqlite')
        with sqlite3.connect(old_path) as db:
            db.executescript('''
                CREATE TABLE metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
                INSERT INTO metadata VALUES ('controller_epoch',4),('fence',7);
                CREATE TABLE commands (command_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, step_id TEXT NOT NULL, input_digest TEXT NOT NULL, input_payload TEXT NOT NULL, worker_id TEXT NOT NULL, route_policy TEXT NOT NULL, grant_id TEXT NOT NULL, state TEXT NOT NULL, UNIQUE(job_id,step_id));
                CREATE TABLE attempts (attempt_id TEXT PRIMARY KEY, command_id TEXT NOT NULL REFERENCES commands(command_id), operation_id TEXT NOT NULL UNIQUE, state TEXT NOT NULL, route TEXT NOT NULL, grant_snapshot TEXT NOT NULL, controller_epoch INTEGER NOT NULL, fence INTEGER NOT NULL, lease_until REAL NOT NULL, stop_proven INTEGER NOT NULL DEFAULT 0, effects_resolved INTEGER NOT NULL DEFAULT 0, result TEXT);
                PRAGMA user_version=1;
            ''')
            db.execute('INSERT INTO commands VALUES(?,?,?,?,?,?,?,?,?)',('command','job','step','digest','{}','worker','{}','grant','outcome_unknown'))
            db.execute('INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',('attempt','command','prior-operation','outcome_unknown','{}','{}',4,7,200,0,0,'{"kept":1}'))
        with Store(old_path) as migrated:
            row=migrated.attempt('attempt')
            self.assertEqual(row['operation_id'],'prior-operation')
            self.assertEqual(row['result'],{'kept':1})
            self.assertFalse(row['lease_expired'])
            self.assertEqual(migrated.controller_epoch,5)
            self.assertEqual(migrated.claim_lease('attempt',now=100,lease_until=300),8)
            migrated.expire_leases(300)
            self.assertTrue(migrated.attempt('attempt')['lease_expired'])
