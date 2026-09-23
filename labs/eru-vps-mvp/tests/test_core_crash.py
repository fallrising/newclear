"""SIGKILL actual child processes against synthetic files; never invoke VPS/systemd."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import core_update
from core_update import CoreUpdate, BINARY, MANIFEST, UNIT
from labops import atomic_json
from worker_reinstall import sha
import test_core_update as core_fixture


def crash_child(root, operation, point, edge):
    root = Path(root)
    if root == Path('/') or not (root / '.crash-fixture.json').is_file():
        raise ValueError('crash test requires an explicit synthetic fixture')
    before = json.loads((root / '.crash-fixture.json').read_text())
    updater = CoreUpdate(root, os.getuid())

    def hit(label, phase):
        if label == point and phase == edge:
            os.kill(os.getpid(), signal.SIGKILL)

    save, write, replace = updater.save, updater.write_new, os.replace

    def save_at(directory, record):
        label = 'journal:' + directory.name + ':' + record['stage']
        hit(label, 'before')
        result = save(directory, record)
        hit(label, 'after')
        return result

    def write_at(path, *args, **kwargs):
        label = 'write:' + path.name
        hit(label, 'before')
        result = write(path, *args, **kwargs)
        hit(label, 'after')
        return result

    def replace_at(source, destination):
        path = Path(destination)
        label = 'replace:' + ('binary' if path == updater.path(BINARY) else
                              'manifest' if path == updater.path(MANIFEST) else 'other')
        hit(label, 'before')
        result = replace(source, destination)
        hit(label, 'after')
        return result

    updater.save, updater.write_new = save_at, write_at
    os.replace = replace_at
    if operation == 'install':
        updater.install('source', before, b'new-binary', sha(b'new-binary'))
    elif operation == 'rollback':
        updater.rollback('source', 'recovery-killed', updater.inspect_recovery('source'))
    else:
        raise ValueError('unknown test operation')
    raise AssertionError('crash boundary was not reached: ' + point + ':' + edge)


class CoreCrashTests(unittest.TestCase):
    def fixture(self):
        fixture = core_fixture.CoreUpdateTests('test_existing_run_cannot_be_replayed')
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        atomic_json(fixture.root / '.crash-fixture.json', fixture.before)
        return fixture

    def kill(self, fixture, operation, point, edge):
        result = subprocess.run([sys.executable, '-B', __file__, '--crash-child', str(fixture.root),
            operation, point, edge], capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, -signal.SIGKILL, result.stderr or result.stdout)

    def assert_originals(self, fixture):
        self.assertEqual(fixture.updater.path(BINARY).read_bytes(), b'old-binary')
        self.assertEqual(fixture.updater.entry(UNIT), fixture.before['unit'])
        self.assertEqual(fixture.updater.inspect()['manifest_sha256'], fixture.before['manifest_sha256'])

    def test_kill_before_replace_intent_leaves_originals_and_blocks_incomplete_backup(self):
        points = ['journal:source:backing-up', 'write:binary.before', 'write:owner.before', 'write:.eru-core-source']
        for point in points:
            for edge in ('before', 'after'):
                with self.subTest(point=point, edge=edge):
                    fixture = self.fixture()
                    self.kill(fixture, 'install', point, edge)
                    self.assertEqual(fixture.updater.inspect(), fixture.before)
                    with self.assertRaisesRegex(ValueError, 'journal|before replacement'):
                        fixture.updater.inspect_recovery('source')
                    self.assertFalse(fixture.updater.directory('recovery-next').exists())

    def test_kill_across_binary_manifest_and_final_journal_recovers_with_new_id(self):
        points = ['journal:source:replace-intent', 'replace:binary', 'journal:source:binary-replaced',
                  'replace:manifest', 'journal:source:installed']
        for point in points:
            for edge in ('before', 'after'):
                with self.subTest(point=point, edge=edge):
                    fixture = self.fixture()
                    self.kill(fixture, 'install', point, edge)
                    if point == 'journal:source:replace-intent' and edge == 'before':
                        self.assertEqual(fixture.updater.inspect(), fixture.before)
                        with self.assertRaisesRegex(ValueError, 'before replacement'):
                            fixture.updater.inspect_recovery('source')
                        continue
                    observed = fixture.updater.inspect_recovery('source')
                    fixture.updater.rollback('source', 'recovery-next', observed)
                    self.assert_originals(fixture)
                    self.assertEqual(fixture.updater.inspect_recovery('source')['stage'], 'rolled-back')
                    with self.assertRaisesRegex(ValueError, 'already rolled back'):
                        fixture.updater.rollback('source', 'recovery-next')

    def test_killed_rollback_uses_fresh_attempt_and_preserves_killed_attempt(self):
        points = ['journal:recovery-killed:rollback-intent', 'write:.eru-core-recovery-killed',
                  'replace:binary', 'write:.owner-restore-recovery-killed', 'replace:manifest',
                  'journal:recovery-killed:rolled-back', 'journal:source:rolled-back']
        for point in points:
            for edge in ('before', 'after'):
                with self.subTest(point=point, edge=edge):
                    fixture = self.fixture()
                    fixture.updater.install('source', fixture.before, b'new-binary', sha(b'new-binary'))
                    self.kill(fixture, 'rollback', point, edge)
                    directory = fixture.updater.directory('recovery-killed')
                    retained = {p.name: p.read_bytes() for p in directory.iterdir() if p.is_file()}
                    observed = fixture.updater.inspect_recovery('source')
                    if observed['stage'] == 'rolled-back':
                        with self.assertRaisesRegex(ValueError, 'already rolled back'):
                            fixture.updater.rollback('source', 'recovery-next', observed)
                        self.assertFalse(fixture.updater.directory('recovery-next').exists())
                    else:
                        fixture.updater.rollback('source', 'recovery-next', observed)
                    self.assert_originals(fixture)
                    self.assertEqual(retained, {p.name: p.read_bytes() for p in directory.iterdir() if p.is_file()})

    def test_killed_update_does_not_authorize_overwriting_unknown_later_binary(self):
        fixture = self.fixture()
        self.kill(fixture, 'install', 'replace:binary', 'after')
        fixture.updater.path(BINARY).write_bytes(b'unknown-later-binary')
        with self.assertRaisesRegex(ValueError, 'later changes'):
            fixture.updater.rollback('source', 'recovery-next')
        self.assertEqual(fixture.updater.path(BINARY).read_bytes(), b'unknown-later-binary')
        self.assertFalse(fixture.updater.directory('recovery-next').exists())

    def test_recovery_rejects_changed_binary_permissions_even_with_known_bytes(self):
        fixture = self.fixture()
        fixture.updater.install('source', fixture.before, b'new-binary', sha(b'new-binary'))
        fixture.updater.path(BINARY).chmod(0o700)
        with self.assertRaisesRegex(ValueError, 'later changes'):
            fixture.updater.rollback('source', 'recovery-next')
        self.assertEqual(fixture.updater.entry(BINARY)['mode'], 0o700)
        self.assertFalse(fixture.updater.directory('recovery-next').exists())

    def test_hardlinked_or_mounted_update_journal_is_rejected(self):
        fixture = self.fixture()
        fixture.updater.install('source', fixture.before, b'new-binary', sha(b'new-binary'))
        journal = fixture.updater.directory('source') / 'journal.json'
        os.link(journal, fixture.root / 'journal-alias')
        with self.assertRaisesRegex(ValueError, 'hardlink'):
            fixture.updater.inspect_recovery('source')
        (fixture.root / 'journal-alias').unlink()
        fixture.updater.mounts.add('/var/lib/eru-mvp/core-updates/source/journal.json')
        with self.assertRaisesRegex(ValueError, 'mount'):
            fixture.updater.inspect_recovery('source')


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--crash-child':
        crash_child(*sys.argv[2:])
    else:
        unittest.main()
