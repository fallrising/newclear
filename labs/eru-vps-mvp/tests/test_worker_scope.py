"""Test destructive-scope selection using a temporary filesystem, never a VPS."""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from worker_scope import audit, MANIFEST, REINSTALL_FILES, SHARED_FILES, STATE_DIRS


class ScopeTests(unittest.TestCase):
    def setUp(self):
        previous_umask = os.umask(0o022)
        self.addCleanup(os.umask, previous_umask)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.files = {}
        for name in REINSTALL_FILES + SHARED_FILES:
            data = ('fixture:' + name).encode()
            path = self.root / name.lstrip('/')
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            path.chmod(0o644)
            self.files[name] = hashlib.sha256(data).hexdigest()
        for name in STATE_DIRS:
            path = self.root / name.lstrip('/')
            path.mkdir(parents=True)
            path.chmod(0o755)
            (path / 'cursor').write_text('fixture-state')
            (path / 'cursor').chmod(0o600)
        self.write_manifest()

    def write_manifest(self, owner='eru-vps-mvp'):
        path = self.root / MANIFEST.lstrip('/')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({'owner': owner, 'files': self.files}))
        path.chmod(0o600)

    def inspect(self):
        return audit(self.root, os.getuid())

    def test_only_six_files_selected_shared_runtime_preserved(self):
        before = {str(p): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        result = self.inspect()
        self.assertTrue(result['scope_verified'], result)
        self.assertEqual({x['path'] for x in result['files_to_reinstall']}, set(REINSTALL_FILES))
        self.assertEqual(result['preserved_owned_files'], list(SHARED_FILES))
        self.assertEqual({x['path'] for x in result['state_to_quarantine']}, set(STATE_DIRS))
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_selected_worker_identity_must_match_owned_agent_unit(self):
        unit = self.root / 'etc/systemd/system/eru-agent.service'
        for node in ('worker-2', 'worker-3', 'worker-4'):
            unit.write_text('[Service]\nEnvironment=ERU_HOSTNAME=' + node + '\n')
            self.files['/etc/systemd/system/eru-agent.service'] = hashlib.sha256(unit.read_bytes()).hexdigest()
            self.write_manifest()
            scope = audit(self.root, os.getuid(), expected_node=node)
            self.assertTrue(scope['scope_verified'], scope)
            self.assertEqual(scope['node'], node)
            other = 'worker-3' if node != 'worker-3' else 'worker-4'
            self.assertIn('identity', audit(self.root, os.getuid(), expected_node=other)['blockers'][0])
        self.assertIn('unsupported worker', audit(self.root, os.getuid(), expected_node='core')['blockers'][0])

    def test_external_file_edit_blocks(self):
        (self.root / REINSTALL_FILES[0].lstrip('/')).write_text('externally modified')
        result = self.inspect()
        self.assertFalse(result['scope_verified'])
        self.assertIn('changed outside installer', result['blockers'][0])

    def test_wrong_owner_and_unlisted_path_block(self):
        self.write_manifest(owner='someone-else')
        self.assertFalse(self.inspect()['scope_verified'])
        self.files['/etc/ssh/sshd_config'] = '0' * 64
        self.write_manifest()
        self.assertIn('allowlist', self.inspect()['blockers'][0])

    def test_core_state_blocks(self):
        (self.root / 'etc/eru/core.yaml').write_text('control-plane')
        self.assertIn('control-plane state', self.inspect()['blockers'][0])

    def test_symlinked_file_and_parent_block(self):
        target = self.root / REINSTALL_FILES[0].lstrip('/')
        data = target.read_bytes()
        target.unlink()
        external = self.root / 'external'
        external.write_bytes(data)
        target.symlink_to(external)
        self.assertIn('symlink', self.inspect()['blockers'][0])
        target.unlink()
        target.write_bytes(data)
        target.chmod(0o644)
        parent = self.root / 'etc/eru'
        moved = self.root / 'moved-etc-eru'
        parent.rename(moved)
        parent.symlink_to(moved)
        self.assertIn('symlink', self.inspect()['blockers'][0])

    def test_symlink_nested_in_state_blocks(self):
        (self.root / 'var/lib/eru-agent/link').symlink_to('/etc')
        self.assertIn('symlink', self.inspect()['blockers'][0])

    def test_hardlink_blocks(self):
        source = self.root / REINSTALL_FILES[0].lstrip('/')
        os.link(source, self.root / 'second-link')
        self.assertIn('hard-linked', self.inspect()['blockers'][0])

    def test_group_writable_file_blocks(self):
        (self.root / REINSTALL_FILES[0].lstrip('/')).chmod(0o664)
        self.assertIn('write permissions', self.inspect()['blockers'][0])

    def test_target_mount_blocks_but_run_tmpfs_parent_is_allowed(self):
        target = self.root / 'var/lib/eru-agent'
        with patch('worker_scope.os.path.ismount', side_effect=lambda p: Path(p) == target):
            self.assertIn('mount boundary', self.inspect()['blockers'][0])
        run = self.root / 'run'
        with patch('worker_scope.os.path.ismount', side_effect=lambda p: Path(p) == run):
            self.assertTrue(self.inspect()['scope_verified'])

    def test_missing_optional_state_is_recorded(self):
        state = self.root / 'run/eru/workloads'
        (state / 'cursor').unlink()
        state.rmdir()
        result = self.inspect()
        self.assertTrue(result['scope_verified'])
        record = next(x for x in result['state_to_quarantine'] if x['path'] == '/run/eru/workloads')
        self.assertFalse(record['exists'])


    def test_bind_mount_from_mountinfo_blocks_even_when_ismount_is_false(self):
        info = self.root / 'proc/self/mountinfo'
        info.parent.mkdir(parents=True)
        info.write_text('31 22 0:42 /other /var/lib/eru-agent rw - ext4 /dev/test rw\n')
        with patch('worker_scope.os.path.ismount', return_value=False):
            self.assertIn('mount boundary', self.inspect()['blockers'][0])

    def test_writable_ancestor_blocks(self):
        (self.root / 'etc/eru').chmod(0o777)
        self.assertIn('ancestor', self.inspect()['blockers'][0])


if __name__ == '__main__':
    unittest.main()
