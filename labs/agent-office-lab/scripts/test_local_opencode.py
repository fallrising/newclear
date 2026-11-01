"""Configuration boundary tests; no CLI, dependency download or model is started."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import local_opencode


class ConfigurationBoundary(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'configs').mkdir()
        original = local_opencode.LAB / 'configs/opencode-strata-local.json'
        (self.root / 'configs/opencode-strata-local.json').write_bytes(original.read_bytes())
        self.original = original.read_bytes()
        sdk = self.root / 'tools/opencode-plugin'
        (sdk / 'node_modules').mkdir(parents=True)
        for name in ('package.json', 'package-lock.json'):
            (sdk / name).write_text('{}')
        self.out = self.root / 'run'
        self.out.mkdir()
        self.workspace = self.out / 'workspace'
        self.workspace.mkdir()

    def prepare(self, office, mode):
        with patch.object(local_opencode, 'LAB', self.root), patch.dict(os.environ, {
            'LAB_OPENCODE_PERMISSION_MODE': mode, 'OPENCODE_CONFIG_CONTENT': '{}',
            'OPENAI_API_KEY': 'synthetic-secret',
        }):
            return local_opencode.prepare(self.out, self.workspace, office=office)

    def test_office_ask_keeps_local_model_and_sandbox_without_changing_base(self):
        command, env = self.prepare(True, 'ask')
        cfg = json.loads((self.out / 'opencode.json').read_text())
        self.assertEqual(cfg['permission']['edit'], 'ask')
        self.assertEqual(cfg['permission']['bash'], 'ask')
        self.assertEqual(cfg['permission']['*'], 'deny')
        self.assertEqual(cfg['enabled_providers'], ['strata'])
        self.assertEqual(command[0], '/usr/bin/sandbox-exec')
        self.assertNotIn('OPENAI_API_KEY', env)
        self.assertEqual((self.root / 'configs/opencode-strata-local.json').read_bytes(), self.original)

    def test_direct_cli_does_not_inherit_office_permission_mode(self):
        self.prepare(False, 'ask')
        self.assertEqual(json.loads((self.out / 'opencode.json').read_text())['permission']['edit'], 'allow')

    def test_unknown_mode_fails_before_writing_configuration(self):
        with self.assertRaisesRegex(ValueError, 'Unknown local permission mode'):
            self.prepare(True, 'always')
        self.assertFalse((self.out / 'opencode.json').exists())


if __name__ == '__main__':
    unittest.main()
