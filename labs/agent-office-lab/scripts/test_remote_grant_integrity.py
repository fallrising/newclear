"""Integrator checks of grant integrity and conservative consumption reporting."""
import json
import fcntl
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import office_dispatch as dispatch
from execution_slot import execution_slot, SlotError
import os
from pathlib import Path
import shutil
import tempfile
import unittest

import remote_grant as grants


class GrantIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.lab = Path(self.tmp.name).resolve() / 'lab'
        self.lab.mkdir(mode=0o700)
        (self.lab / 'scripts').mkdir(mode=0o755)
        source = Path(__file__).resolve().parent
        for name in grants.SOURCE_NAMES:
            target = self.lab / 'scripts' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source / name, target)
        self.now = 2000000000.0

    def grant(self):
        value = grants.create(self.lab, 'pi', 900, now=self.now)
        file = self.lab / 'state/remote-grants/pending' / (value['id'] + '.json')
        return value, file

    def test_public_source_permissions_are_supported_but_mutation_invalidates(self):
        value, _ = self.grant()
        self.assertEqual(grants.pending(self.lab, 'pi', now=self.now)['id'], value['id'])
        target = self.lab / 'scripts/office_dispatch.py'
        self.assertIn('office_dispatch.py', grants.SOURCE_NAMES)
        target.write_text(target.read_text() + '\n# changed launch boundary\n')
        with self.assertRaises(grants.GrantError):
            grants.consume(self.lab, value['id'], 'pi', 'console', now=self.now)

    def test_nonfinite_timestamps_and_boolean_schema_cannot_authorize(self):
        value, file = self.grant()
        original = file.read_bytes()
        for patch in ({'created_at': float('nan')}, {'expires_at': float('inf')},
                      {'created_at': float('-inf')}, {'version': True}, {'max_runs': True}, {'limits':dict(dispatch.plan('pi')['limits'],host_retries=False)}):
            with self.subTest(patch=patch):
                data = json.loads(original); data.update(patch)
                file.write_text(json.dumps(data))
                with self.assertRaises(grants.GrantError):
                    grants.inspect(self.lab, value['id'], 'pi', now=self.now)
        file.write_bytes(original)

    def test_record_id_must_match_filename_and_unsafe_child_directory_rejected(self):
        value, file = self.grant()
        data = json.loads(file.read_text()); data['id'] = '0' * 32
        file.write_text(json.dumps(data))
        with self.assertRaises(grants.GrantError):
            grants.inspect(self.lab, value['id'], 'pi', now=self.now)
        data['id'] = value['id']; file.write_text(json.dumps(data))
        file.parent.chmod(0o755)
        with self.assertRaises(grants.GrantError):
            grants.pending(self.lab, 'pi', now=self.now)

    def test_consumed_grant_never_looks_unused_when_use_receipt_is_missing(self):
        value, _ = self.grant()
        grants.consume(self.lab, value['id'], 'pi', 'console', now=self.now)
        use = self.lab / 'state/remote-grants/consumed' / (value['id'] + '.use.json')
        use.unlink()
        try:
            state = grants.consumed(self.lab, value['id'])
        except grants.GrantError:
            return  # Unknown/corrupt must fail closed instead of claiming unused.
        self.assertIs(state, True)

    def test_hardlinked_grant_is_rejected(self):
        value, file = self.grant()
        os.link(file, self.lab / 'copy')
        with self.assertRaises(grants.GrantError):
            grants.inspect(self.lab, value['id'], 'pi', now=self.now)

    def test_concurrent_consumers_only_one_wins_and_restored_pending_cannot_reuse(self):
        value, file = self.grant()
        original = file.read_bytes()
        barrier = threading.Barrier(2)
        def consume():
            barrier.wait()
            try: grants.consume(self.lab, value['id'], 'pi', 'console', now=self.now); return True
            except grants.GrantError: return False
        with ThreadPoolExecutor(2) as workers:
            outcomes = list(workers.map(lambda _: consume(), range(2)))
        self.assertEqual(outcomes.count(True), 1)
        file.write_bytes(original); file.chmod(0o600)
        with self.assertRaisesRegex(grants.GrantError, 'remote_grant_used'):
            grants.consume(self.lab, value['id'], 'pi', 'console', now=self.now)

    def test_held_grant_lock_fails_promptly_and_does_not_consume(self):
        value, file = self.grant()
        with (file.parent.parent / 'grants.lock').open('r+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            start = time.monotonic()
            with self.assertRaises(grants.GrantError):
                grants.consume(self.lab, value['id'], 'pi', 'console', now=self.now)
            self.assertLess(time.monotonic() - start, 1)
        self.assertTrue(file.exists())

    def test_duplicates_oversize_and_directory_symlinks_fail_closed(self):
        value, file = self.grant()
        original = file.read_bytes()
        for raw in (original[:-2] + b',"version":1}', b'x' * 4097, b'[' * 1500 + b']' * 1500):
            file.write_bytes(raw)
            with self.assertRaises(grants.GrantError):
                grants.inspect(self.lab, value['id'], 'pi', now=self.now)
        file.write_bytes(original)
        for parent in (file.parent, self.lab / 'scripts'):
            moved = parent.with_name(parent.name + '-moved')
            parent.rename(moved); parent.symlink_to(moved, target_is_directory=True)
            with self.assertRaises(grants.GrantError):
                grants.consume(self.lab, value['id'], 'pi', 'console', now=self.now)
            parent.unlink(); moved.rename(parent)

    def test_receipt_write_failure_still_spends_grant(self):
        value, file = self.grant()
        with patch.object(grants, '_write_json_at', side_effect=OSError('simulated crash after rename')):
            with self.assertRaises(grants.GrantError):
                grants.consume(self.lab, value['id'], 'pi', 'console', now=self.now)
        self.assertFalse(file.exists())
        self.assertTrue(grants.consumed(self.lab, value['id']))
        with self.assertRaisesRegex(grants.GrantError, 'remote_grant_used'):
            grants.consume(self.lab, value['id'], 'pi', 'console', now=self.now)

    def test_dispatch_slot_and_failed_preflight_preserve_grant_but_exec_failure_spends(self):
        value, file = self.grant()
        with patch.object(dispatch, 'detect', return_value={'launch_prerequisites_present':True}), patch.object(os, 'execve') as launch:
            with execution_slot(self.lab), self.assertRaises(SlotError):
                dispatch.launch('pi', False, self.lab, remote_grant=value['id'])
            launch.assert_not_called()
        self.assertTrue(file.exists())
        with patch.object(dispatch, 'detect', return_value={'launch_prerequisites_present':False}), patch.object(os, 'execve') as launch:
            self.assertEqual(dispatch.launch('pi', False, self.lab, remote_grant=value['id']), 1)
            launch.assert_not_called()
        self.assertTrue(file.exists())
        with patch.object(dispatch, 'detect', return_value={'launch_prerequisites_present':True}), patch.object(grants.time, 'time', return_value=self.now), patch.object(os, 'execve', side_effect=OSError('no execution')):
            with self.assertRaises(OSError): dispatch.launch('pi', False, self.lab, remote_grant=value['id'])
        self.assertTrue(grants.consumed(self.lab, value['id']))

    def test_revocation_and_restart_never_recreate_spent_grant(self):
        value, file = self.grant()
        grants.revoke(self.lab, value['id'])
        self.assertFalse(file.exists())
        self.assertIsNone(grants.pending(self.lab, 'pi', now=self.now))
        with self.assertRaises(grants.GrantError):
            grants.consume(self.lab, value['id'], 'pi', 'console', now=self.now)

    def test_permissions_uid_and_lifetime_bounds_are_enforced(self):
        value, file = self.grant()
        original = file.read_bytes()
        for change in ({'uid':os.getuid()+1}, {'created_at':self.now+20}, {'expires_at':self.now+30}, {'expires_at':self.now+1801}):
            data=json.loads(original); data.update(change); file.write_text(json.dumps(data))
            with self.assertRaises(grants.GrantError): grants.inspect(self.lab,value['id'],'pi',now=self.now)
        file.write_bytes(original); file.chmod(0o644)
        with self.assertRaises(grants.GrantError): grants.inspect(self.lab,value['id'],'pi',now=self.now)

    def test_orphaned_use_receipt_does_not_report_unused(self):
        value, _ = self.grant()
        grants.consume(self.lab,value['id'],'pi','console',now=self.now)
        (self.lab/'state/remote-grants/consumed'/(value['id']+'.json')).unlink()
        with self.assertRaises(grants.GrantError): grants.consumed(self.lab,value['id'])
