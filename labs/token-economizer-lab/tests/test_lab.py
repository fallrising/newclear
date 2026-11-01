from __future__ import annotations
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from run import run
from source import LOCK, verify, prepare

SOURCE = Path(os.environ.get('TOKEN_ECONOMIZER_SOURCE', ROOT / '.upstream/TokenEconomizer')).resolve()


class SourceTests(unittest.TestCase):
    def test_real_pin_matches(self):
        self.assertEqual(verify(SOURCE), SOURCE)

    def test_prepare_reuses_only_verified_source(self):
        self.assertEqual(prepare(SOURCE), SOURCE)

    def altered(self, change):
        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp)
            shutil.copytree(SOURCE / 'tokeneconomizer', copy / 'tokeneconomizer')
            change(copy)
            # Pin lookup isolated here; all package bytes are really read and hashed.
            with patch('source.git', return_value=LOCK['commit']):
                with self.assertRaisesRegex(ValueError, 'manifest mismatch|symlink'):
                    verify(copy)

    def test_modified_file_rejected(self):
        self.altered(lambda p: (p / 'tokeneconomizer/__init__.py').write_text('raise Exception()'))

    def test_missing_file_rejected(self):
        self.altered(lambda p: (p / 'tokeneconomizer/__init__.py').unlink())

    def test_extra_file_rejected(self):
        self.altered(lambda p: (p / 'tokeneconomizer/extra.py').write_text('pass'))

    def test_symlink_rejected(self):
        self.altered(lambda p: (p / 'tokeneconomizer/link.py').symlink_to(p / 'tokeneconomizer/__init__.py'))

    def test_wrong_revision_rejected(self):
        with patch('source.git', return_value='0' * 40):
            with self.assertRaisesRegex(ValueError, 'commit mismatch'):
                verify(SOURCE)


class GuardTests(unittest.TestCase):
    def child(self, operation):
        with tempfile.TemporaryDirectory() as tmp:
            sandbox = Path(tmp) / 'sandbox'
            sandbox.mkdir()
            outside = Path(tmp) / 'outside.txt'
            outside.write_text('do not read or modify')
            program = f'''
import sys, pathlib, socket, subprocess, os
sys.path.insert(0, {str(ROOT)!r})
from isolation import install
sandbox = pathlib.Path({str(sandbox)!r})
outside = pathlib.Path({str(outside)!r})
blocked = install(sandbox, {str(SOURCE)!r})
{operation}
'''
            return subprocess.run([sys.executable, '-I', '-B', '-c', program],
                                  cwd=sandbox, text=True, capture_output=True)

    def denied(self, operation):
        p = self.child('try:\n    ' + operation + '\nexcept PermissionError:\n    print("denied")\nelse:\n    raise AssertionError("not blocked")')
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.strip(), 'denied')

    def test_socket_denied(self):
        self.denied('socket.socket()')

    def test_subprocess_denied(self):
        self.denied('subprocess.run([sys.executable, "-c", "pass"])')

    def test_system_denied(self):
        self.denied('os.system("true")')

    def test_outside_write_denied(self):
        self.denied('outside.write_text("changed")')

    def test_outside_read_denied(self):
        self.denied('outside.read_text()')

    def test_outside_rename_denied(self):
        self.denied('outside.rename(sandbox / "renamed")')

    def test_sandbox_write_allowed(self):
        p = self.child('(sandbox / "ok").write_text("ok")\nassert (sandbox / "ok").read_text() == "ok"')
        self.assertEqual(p.returncode, 0, p.stderr)

    def test_symlink_escape_denied(self):
        self.denied('(sandbox / "link").symlink_to(outside)')


class IntegrationTests(unittest.TestCase):
    def test_real_scenarios_and_deterministic_report(self):
        with patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'synthetic-do-not-inherit',
                                     'TE_MICROSKILLS': 'on', 'TE_LOOPGUARD': 'on'}):
            a = run(SOURCE)
            b = run(SOURCE)
        self.assertEqual(a, b)
        self.assertEqual(a['result'], 'passed')
        self.assertEqual(len(a['scenarios']), 4)
        self.assertTrue(all(s['status'] == 'passed' for s in a['scenarios']))
        self.assertEqual(a['provider_calls'], 0)
        self.assertFalse(a['real_savings_measured'])
        self.assertEqual(a['runtime_guard']['blocked_attempts'], [])
        self.assertNotIn('synthetic-do-not-inherit', json.dumps(a))
        self.assertNotIn(str(SOURCE), json.dumps(a))
        self.assertGreaterEqual(a['assertions'], 31)

    def test_unverified_checkout_root_cannot_shadow_imports(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp)
            shutil.copytree(SOURCE / 'tokeneconomizer', source / 'tokeneconomizer')
            (source / '.git').write_text('gitdir: ' + str(SOURCE / '.git') + '\n')
            (source / 'shlex.py').write_text('raise RuntimeError("UNVERIFIED_ROOT_MODULE_EXECUTED")')
            self.assertEqual(verify(source), source)
            report = run(source)
            self.assertEqual(report['result'], 'passed')
            self.assertNotIn('UNVERIFIED_ROOT_MODULE_EXECUTED', json.dumps(report))

    def test_report_file_never_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'report.json'
            out.write_text('existing evidence')
            p = subprocess.run([sys.executable, '-B', str(ROOT / 'run.py'),
                                '--source', str(SOURCE), '--out', str(out)],
                               text=True, capture_output=True)
            self.assertNotEqual(p.returncode, 0)
            self.assertEqual(out.read_text(), 'existing evidence')


if __name__ == '__main__':
    unittest.main()
