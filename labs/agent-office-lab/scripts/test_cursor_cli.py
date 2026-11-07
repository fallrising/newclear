import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from cursor_cli import PIN, FLAGS, assess, installed_cli, tree_digest, isolated_cursor_env, extract_archive, probe


class CursorBoundary(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.lab = Path(self.tmp.name)

    def test_preflight_is_exact_and_missing_install_fails_closed(self):
        help_text = 'Start the Cursor Agent\n' + '\n'.join(f'{f} <value>' for f in FLAGS)
        self.assertIsNone(assess(PIN['version'], help_text))
        self.assertEqual(assess(PIN['version'] + '-other', help_text), 'cli_version_mismatch')
        self.assertEqual(assess(PIN['version'], help_text.replace('Cursor', 'Grok')), 'cli_identity_mismatch')
        self.assertEqual(assess(PIN['version'], help_text.replace('--trust ', '--trust-other ')), 'required_capability_missing')
        self.assertEqual(probe(self.lab)['reason'], 'not_installed')

    def test_environment_drops_keys_endpoints_plugins_and_host_switches(self):
        env = isolated_cursor_env(self.lab, {'PATH': '/bin', 'HOME': '/other', 'CURSOR_API_KEY': 'secret',
            'CURSOR_CONFIG_DIR': '/other', 'CURSOR_API_ENDPOINT': 'https://other.invalid',
            'NODE_OPTIONS': '--import other', 'AGENT_CLI_CREDENTIAL_STORE': 'keychain',
            'GROK_HOME': '/other', 'HTTPS_PROXY': 'https://other.invalid'})
        self.assertEqual(env['HOME'], str(self.lab))
        self.assertEqual(env['CURSOR_CONFIG_DIR'], str(self.lab / '.cursor'))
        self.assertEqual(env['AGENT_CLI_CREDENTIAL_STORE'], 'file')
        for key in ['CURSOR_API_KEY', 'CURSOR_API_ENDPOINT', 'NODE_OPTIONS', 'GROK_HOME', 'HTTPS_PROXY']:
            self.assertNotIn(key, env)

    def test_modified_runtime_and_symlink_are_rejected(self):
        root = self.lab / 'tools/cursor/runtime' / PIN['version']; root.mkdir(parents=True)
        binary = root / 'cursor-agent'; binary.write_text('fixture'); binary.chmod(0o755)
        (root / 'package.json').write_text(json.dumps({'name': PIN['package']}))
        pin = dict(PIN, runtime_tree_sha256=tree_digest(root))
        self.assertEqual(installed_cli(self.lab, pin), binary.resolve())
        binary.write_text('modified')
        with self.assertRaisesRegex(ValueError, 'digest'): installed_cli(self.lab, pin)
        binary.unlink(); binary.symlink_to(self.lab / 'missing')
        with self.assertRaises(ValueError): tree_digest(root)

    def test_archive_traversal_symlinks_devices_and_duplicates_rejected_before_write(self):
        for name, kind, duplicate in [('dist-package/../../escape', tarfile.REGTYPE, False),
                                     ('/absolute', tarfile.REGTYPE, False),
                                     ('dist-package/link', tarfile.SYMTYPE, False),
                                     ('dist-package/device', tarfile.CHRTYPE, False),
                                     ('dist-package/file', tarfile.REGTYPE, True)]:
            archive = self.lab / 'archive.tar'; dest = self.lab / 'out'; dest.mkdir(exist_ok=True)
            with tarfile.open(archive, 'w') as bundle:
                item = tarfile.TarInfo(name); item.type = kind; item.size = 0
                bundle.addfile(item, io.BytesIO())
                if duplicate: bundle.addfile(item, io.BytesIO())
            with self.assertRaises(ValueError): extract_archive(archive, dest)
            self.assertEqual(list(dest.iterdir()), [])

    def test_probe_never_exposes_arbitrary_process_error(self):
        with patch('cursor_cli.installed_cli', side_effect=OSError('PRIVATE-CREDENTIAL')):
            result = probe(self.lab)
        self.assertNotIn('PRIVATE-CREDENTIAL', json.dumps(result))
        self.assertFalse(result['compatible'])


if __name__ == '__main__': unittest.main()
