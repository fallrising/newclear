"""A clean controller fixture and missing-input checks; no VPS connection."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import controller_preflight as cp


class PreflightTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.project = Path(temp.name) / 'eru-vps-mvp'
        self.project.mkdir()
        self.ssh_home = Path(temp.name) / 'ssh'
        self.ssh_home.mkdir()
        self.private = self.project / 'private'
        self.private.mkdir()
        self.secret = 'PRIVATE-DO-NOT-OUTPUT'
        self.write('artifacts.amd64.lock.json', {'architecture': 'linux/amd64', 'artifacts': [
            {'repository': repo, 'tag': 'v1', 'sha256': 'a' * 64, 'url': 'https://example.invalid'}
            for repo in sorted(cp.ARTIFACT_REPOS)]})
        self.write('upstream.lock.json', {'status': 'baseline'})
        binary = self.private / 'builds/core-lock-context-go1.27.1/eru-core'
        binary.parent.mkdir(parents=True)
        binary.write_bytes(b'patched-core')
        core_sha = hashlib.sha256(binary.read_bytes()).hexdigest()
        patch = self.project / 'patches/core-v0.1.5-lock-context.patch'
        patch.parent.mkdir(parents=True)
        patch.write_bytes(b'patch-bytes')
        self.write('patches/core-v0.1.5-lock-context.validation.json',
                   {'artifact_sha256': core_sha, 'patch_sha256': hashlib.sha256(patch.read_bytes()).hexdigest()})
        inventory = [{'alias': cp.ALIASES[0], 'node': 'worker-1', 'role': 'core'}] + [
            {'alias': alias, 'node': f'worker-{i}', 'role': 'worker'}
            for i, alias in enumerate(cp.ALIASES[1:], 2)]
        self.write('private/deployment-plan.json', inventory)
        self.write('private/verified-host-public-keys.json', {alias: [self.secret] for alias in cp.ALIASES[1:]})
        self.write('private/operations/cluster.json', {'cluster_id': 'eru-vps-mvp', 'generation': 1})
        self.write('private/operations/core-revision.json', {'artifact_sha256': core_sha})
        self.write('private/operations/worker-component-revisions.json', {'worker-4': {'revision': 3}})
        for dirname in ('runs', 'plans'):
            (self.private / 'operations' / dirname).mkdir()
        for alias in cp.ALIASES:
            (self.private / 'preflight').mkdir(exist_ok=True)
            (self.private / 'preflight' / ('20260923T000000Z-' + alias.removeprefix('ckc-') + '-fixture.json')).write_text('{}')
            (self.ssh_home / alias.removeprefix('ckc-')).write_text(self.secret)
        self.dirty = False
        self.bad_alias = None

    def write(self, relative, value):
        path = self.project / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))

    def fake_command(self, argv):
        if argv[:2] == ['dpkg-query', '-W']:
            return 0, 'test-package-version', ''
        if argv == ['git', '--version']:
            return 0, 'git version test', ''
        if argv == ['ssh', '-V']:
            return 0, '', 'OpenSSH_test'
        if argv[0] == 'git' and 'rev-parse' in argv:
            return 0, 'a' * 40 + '\n', ''
        if argv[0] == 'git' and 'status' in argv:
            return 0, ' M scripts/controller_preflight.py\n' if self.dirty else '', ''
        if argv[:2] == ['ssh', '-G']:
            alias = argv[2]
            user = 'root' if alias == self.bad_alias else 'ckc'
            return 0, f'user {user}\nhostname {alias}.example.invalid\n', ''
        raise AssertionError(argv)

    def assess(self):
        return cp.assess(self.project, self.ssh_home, self.fake_command)

    def test_clean_external_inputs_are_review_ready_without_secret_content(self):
        result = self.assess()
        self.assertTrue(result['ready_for_review'], result['blockers'])
        self.assertEqual(set(result['ssh_aliases']), set(cp.ALIASES))
        self.assertEqual(len(result['locks']['artifacts']), 6)
        self.assertNotIn(self.secret, json.dumps(result))

    def test_missing_artifact_or_private_state_fails_closed(self):
        (self.private / 'builds/core-lock-context-go1.27.1/eru-core').unlink()
        (self.private / 'operations/cluster.json').unlink()
        result = self.assess()
        self.assertFalse(result['ready_for_review'])
        self.assertTrue(any('patched core artifact' in item for item in result['blockers']))
        self.assertTrue(any('cluster.json missing' in item for item in result['blockers']))

    def test_wrong_alias_and_dirty_source_fail_closed(self):
        self.bad_alias = cp.ALIASES[1]
        self.dirty = True
        result = self.assess()
        self.assertFalse(result['ready_for_review'])
        self.assertTrue(any('SSH alias' in item for item in result['blockers']))
        self.assertTrue(any('uncommitted' in item for item in result['blockers']))

    def test_absent_external_private_bundle_is_reported_without_secret_content(self):
        import shutil
        shutil.rmtree(self.private)
        result = self.assess()
        self.assertFalse(result['ready_for_review'])
        self.assertTrue(any('deployment-plan.json missing' in item for item in result['blockers']))
        self.assertNotIn(self.secret, json.dumps(result))

    def test_inventory_topology_mismatch_is_rejected(self):
        self.write('private/deployment-plan.json', [{'alias': cp.ALIASES[0], 'node': 'worker-1', 'role': 'core'}])
        result = self.assess()
        self.assertFalse(result['ready_for_review'])
        self.assertTrue(any('topology' in item for item in result['blockers']))


if __name__ == '__main__':
    unittest.main()
