import json
import os
from pathlib import Path
import select
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import execution_slot as slots

SCRIPTS = Path(__file__).resolve().parent


class ExecutionSlotTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.lab = Path(self.tmp.name)
        self.env = dict(os.environ, PYTHONPATH=str(SCRIPTS))
        self.env.pop(slots.FD_ENV, None)

    def child(self, code, **kwargs):
        return subprocess.run([sys.executable, '-c', code], env=self.env, capture_output=True,
                              text=True, timeout=10, **kwargs)

    def code(self, body):
        return f'from pathlib import Path\nfrom execution_slot import *\nlab=Path({str(self.lab)!r})\n{body}'

    def test_clean_exit_releases_for_next_task(self):
        for _ in range(2):
            with slots.execution_slot(self.lab):
                slots.mark_started(); slots.mark_clean()
        self.assertFalse((self.lab / 'state/dispatch/active.json').exists())

    def test_competing_process_rejected_and_ack_cannot_bypass_live_lock(self):
        with slots.execution_slot(self.lab):
            result = self.child(self.code('with execution_slot(lab):\n print("WRONG")'))
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn('WRONG', result.stdout)
            with self.assertRaisesRegex(slots.SlotError, 'execution_busy'):
                slots.acknowledge_stopped(self.lab)

    def test_unclean_return_blocks_until_explicit_acknowledgement(self):
        with slots.execution_slot(self.lab):
            slots.mark_started()
        with self.assertRaisesRegex(slots.SlotError, 'cleanup_unconfirmed'):
            with slots.execution_slot(self.lab):
                self.fail('unclean run accepted')
        self.assertTrue(slots.acknowledge_stopped(self.lab))
        self.assertEqual(len(list((self.lab / 'state/dispatch').glob('acknowledged-*.json'))), 1)
        with slots.execution_slot(self.lab):
            pass

    def test_preflight_exception_releases_without_marking_task_started(self):
        with self.assertRaises(RuntimeError):
            with slots.execution_slot(self.lab):
                raise RuntimeError('preflight')
        with slots.execution_slot(self.lab):
            pass

    def test_killed_process_leaves_blocking_journal(self):
        code = self.code('import time\nwith execution_slot(lab):\n mark_started()\n print("ready",flush=True)\n time.sleep(30)')
        child = subprocess.Popen([sys.executable, '-c', code], env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            self.assertTrue(select.select([child.stdout], [], [], 5)[0])
            self.assertEqual(child.stdout.readline().strip(), 'ready')
            child.kill(); child.communicate(timeout=5)
            with self.assertRaisesRegex(slots.SlotError, 'cleanup_unconfirmed'):
                with slots.execution_slot(self.lab):
                    self.fail('killed run accepted')
        finally:
            if child.poll() is None:
                child.kill(); child.communicate(timeout=5)

    def test_exec_replacement_adopts_lock_and_keeps_competitors_out(self):
        next_code = self.code('import subprocess,sys,os\nwith execution_slot(lab):\n mark_started()\n r=subprocess.run([sys.executable,"-c",'+repr(self.code('with execution_slot(lab):\n print("WRONG")'))+'],capture_output=True,text=True)\n assert r.returncode != 0\n mark_clean()\n print("adopted")')
        code = self.code('import os,sys\nwith execution_slot(lab) as slot:\n os.execve(sys.executable,[sys.executable,"-c",'+repr(next_code)+'],slot.exec_env(os.environ))')
        result = self.child(code)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'adopted')
        with slots.execution_slot(self.lab):
            pass

    def test_link_or_nonprivate_lock_rejected(self):
        with slots.execution_slot(self.lab):
            pass
        lock = self.lab / 'state/dispatch/execution.lock'
        lock.chmod(0o644)
        with self.assertRaises(slots.SlotError):
            with slots.execution_slot(self.lab):
                pass
        lock.unlink(); lock.symlink_to(self.lab / 'outside')
        with self.assertRaises(OSError):
            with slots.execution_slot(self.lab):
                pass
        self.assertFalse((self.lab / 'outside').exists())

    def test_state_directory_link_rejected(self):
        (self.lab / 'state').symlink_to(self.lab, target_is_directory=True)
        with self.assertRaises(OSError):
            with slots.execution_slot(self.lab):
                pass

    def test_fake_inherited_fd_and_malformed_journal_rejected(self):
        with patch.dict(os.environ, {slots.FD_ENV: '0'}):
            with self.assertRaises(slots.SlotError):
                with slots.execution_slot(self.lab):
                    pass
        journal = self.lab / 'state/dispatch/active.json'
        journal.write_text('{}'); journal.chmod(0o600)
        with self.assertRaises(slots.SlotError):
            with slots.execution_slot(self.lab):
                pass


if __name__ == '__main__':
    unittest.main()
