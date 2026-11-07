import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from remote_cli import SPECS, assess, installed_cli, isolated_env, private_directory, probe, setup_pi


class RemoteBoundary(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def install(self, provider='pi'):
        spec = SPECS[provider]
        package = self.root / 'tools' / provider / 'node_modules' / spec['package']
        package.mkdir(parents=True)
        (package / 'package.json').write_text(json.dumps({'name': spec['package'], 'version': spec['version'], 'bin': {provider: spec['bin']}}))
        binary = package / spec['bin'];binary.parent.mkdir(parents=True);binary.write_text('fixture')
        return package, binary

    def test_missing_wrong_identity_and_version_fail_before_execution(self):
        self.assertEqual(probe('pi', self.root)['reason'], 'not_installed')
        package, binary = self.install()
        self.assertEqual(installed_cli('pi', self.root), binary.resolve())
        for field, value in [('name', 'unrelated-pi'), ('version', '0.87.0')]:
            meta = json.loads((package / 'package.json').read_text());meta[field] = value
            (package / 'package.json').write_text(json.dumps(meta))
            with self.assertRaises(ValueError): installed_cli('pi', self.root)

    def test_malformed_metadata_is_reported_without_running_cli(self):
        package, _ = self.install()
        for content in ('{', '[]', 'null'):
            (package / 'package.json').write_text(content)
            result = probe('pi', self.root)
            self.assertFalse(result['compatible'])
            self.assertEqual(result['reason'], 'invalid_package_metadata')

    def test_foreign_entrypoint_and_symlink_escape_fail(self):
        package, binary = self.install()
        binary.unlink();target = self.root / 'outside';target.write_text('outside');binary.symlink_to(target)
        with self.assertRaises(ValueError): installed_cli('pi', self.root)

    def test_cli_output_requires_exact_version_identity_and_full_flags(self):
        for provider, spec in SPECS.items():
            help_text = spec['banner'] + '\n' + '\n'.join(f'{f} <value>' for f in spec['flags'])
            self.assertIsNone(assess(provider, spec['version'], help_text))
            self.assertEqual(assess(provider, spec['version'] + '.1', help_text), 'cli_version_mismatch')
            self.assertEqual(assess(provider, spec['version'], help_text.replace(spec['banner'], 'other')), 'cli_identity_mismatch')
            self.assertEqual(assess(provider, spec['version'], help_text.replace('--session-id ', '--session-id-other ')), 'required_capability_missing')
        self.assertEqual(assess('grok', spec['version'], help_text, False), 'native_adapter_trust_flag_unsupported')

    def test_probe_does_not_echo_untrusted_stderr_or_exception(self):
        self.install()
        with patch('remote_cli.subprocess.run', side_effect=OSError('PRIVATE-CREDENTIAL')):
            result = probe('pi', self.root)
        self.assertNotIn('PRIVATE-CREDENTIAL', json.dumps(result))
        self.assertFalse(result['compatible'])

    def test_environment_never_inherits_credentials_configuration_or_code_injection(self):
        parent = {'PATH': '/bin', 'HOME': '/private/home', 'DEEPSEEK_API_KEY': 'secret',
                  'XAI_API_KEY': 'secret', 'NODE_OPTIONS': '--import attacker', 'PYTHONPATH': 'attacker',
                  'GROK_HOME': '/private/grok', 'PI_PACKAGE_DIR': 'attacker', 'HTTP_PROXY': 'secret'}
        for provider in SPECS:
            env = isolated_env(self.root, provider, parent)
            self.assertEqual(env['HOME'], str(self.root))
            for name in ('DEEPSEEK_API_KEY', 'XAI_API_KEY', 'NODE_OPTIONS', 'PYTHONPATH', 'PI_PACKAGE_DIR', 'HTTP_PROXY'):
                self.assertNotIn(name, env)

    def test_private_setup_stores_only_deepseek_with_private_modes_and_no_output(self):
        (self.root / 'configs').mkdir()
        (self.root / 'configs/pi-models.example.json').write_text('{"providers":{"deepseek":{}}}')
        output = io.StringIO()
        with contextlib.redirect_stdout(output): setup_pi('synthetic_test_key_12345', self.root)
        home = self.root / '.local/remote'
        auth = home / 'pi/auth.json'
        self.assertEqual(set(json.loads(auth.read_text())), {'deepseek'})
        self.assertEqual(auth.stat().st_mode & 0o777, 0o600)
        self.assertEqual(home.stat().st_mode & 0o777, 0o700)
        self.assertEqual(output.getvalue(), '')
        with self.assertRaises(ValueError): setup_pi('different_test_key_1234', self.root)
        self.assertIn('synthetic_test_key_12345', auth.read_text())

    def test_setup_rejects_commands_and_private_directory_symlinks(self):
        for key in ('!run-secret-command', '$DEEPSEEK_API_KEY', 'key with spaces', 'short'):
            with self.assertRaises(ValueError): setup_pi(key, self.root)
        outside = self.root / 'outside';outside.mkdir()
        (self.root / '.local').symlink_to(outside)
        with self.assertRaises(ValueError): private_directory(self.root / '.local/remote', self.root)
        self.assertEqual(list(outside.iterdir()), [])

    def test_setup_rejects_changed_model_endpoint_before_saving_key(self):
        (self.root / 'configs').mkdir()
        (self.root / 'configs/pi-models.example.json').write_text('{"providers":{"deepseek":{}}}')
        agent = private_directory(self.root / '.local/remote/pi', self.root)
        (agent / 'models.json').write_text('{"providers":{"other":{}}}')
        with self.assertRaises(ValueError): setup_pi('synthetic_test_key_12345', self.root)
        self.assertFalse((agent / 'auth.json').exists())


if __name__ == '__main__': unittest.main()
