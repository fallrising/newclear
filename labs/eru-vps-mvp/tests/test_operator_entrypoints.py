"""Synthetic CLI planning/reapply propagation; no subprocess or host operations."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import fixture_inventory

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), SCRIPTS / (name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


class OperatorEntrypointTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        self.private = self.project / 'private'
        self.private.mkdir()
        self.rows = fixture_inventory.inventory()
        for i, row in enumerate(self.rows, 1):
            row['alias'] = 'operator-chosen-' + str(i)
        self.inventory = self.private / 'deployment-plan.json'
        self.inventory.write_text(json.dumps(self.rows))

    def test_reapply_uses_explicit_captured_inventory_and_preserves_apply_guard(self):
        smoke = module('smoke-lab')
        command = smoke.reapply_command(self.project, self.rows, 'a' * 64)
        self.assertEqual(command[command.index('--inventory') + 1], str(self.inventory))
        self.assertIn('--apply', command)
        self.assertEqual(command[-2:], ['--core-artifact', 'a' * 64])
        changed = fixture_inventory.inventory()
        self.inventory.write_text(json.dumps(changed))
        with patch('subprocess.run', side_effect=AssertionError('no process operation')):
            with self.assertRaisesRegex(ValueError, 'changed since smoke capture'):
                smoke.reapply_command(self.project, self.rows)
        self.inventory.unlink()
        with self.assertRaisesRegex(ValueError, 'missing or unsafe'):
            smoke.reapply_command(self.project, self.rows)

    def test_deploy_renders_configured_aliases_without_remote_calls(self):
        deploy = module('deploy-lab')
        deploy.PROJECT = self.project
        source_lock = SCRIPTS.parent / 'artifacts.amd64.lock.json'
        (self.project / source_lock.name).write_bytes(source_lock.read_bytes())
        home = self.project / 'synthetic-home'
        keydir = home / '.ssh/hzd-vps/known_hosts'
        keydir.mkdir(parents=True)
        verified = {}
        preflight = self.private / 'preflight'
        preflight.mkdir()
        collector = module('preflight')
        facts = {row['alias']: {'checks': {'tailscale': {'TailscaleIPs': [row['ip']]}},
                                'exit_code': 0} for row in self.rows}
        with patch.object(sys, 'argv', ['preflight', '--inventory', str(self.inventory),
                                       '--output-dir', str(preflight)]), \
                patch.object(collector, 'collect', side_effect=lambda alias: facts[alias]) as collect, \
                patch.object(collector.os, 'umask'), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(collector.main(), 0)
        self.assertEqual([c.args[0] for c in collect.call_args_list], [row['alias'] for row in self.rows])
        for row in self.rows:
            if row['role'] == 'worker':
                public = 'ssh-ed25519 synthetic-public-' + row['node']
                (keydir / row['alias'].removeprefix('ckc-')).write_text(row['alias'] + ' ' + public + '\n')
                verified[row['alias']] = [public]
        (self.private / 'verified-host-public-keys.json').write_text(json.dumps(verified))
        output = io.StringIO()
        with patch.object(sys, 'argv', ['deploy-lab', '--inventory', str(self.inventory)]), \
                patch.object(deploy.Path, 'home', return_value=home), \
                patch.object(deploy.os, 'umask'), \
                patch('subprocess.run', side_effect=AssertionError('no process operation')), \
                contextlib.redirect_stdout(output):
            self.assertEqual(deploy.main(), 0)
        rendered = json.loads(self.inventory.read_text())
        self.assertEqual([row['alias'] for row in rendered], [row['alias'] for row in self.rows])
        self.assertEqual([row['node'] for row in rendered], [row['node'] for row in self.rows])
        self.assertFalse(json.loads(output.getvalue())['apply'])

    def test_prefixed_neutral_inventory_uses_same_preflight_filename_contract(self):
        for row in self.rows:
            row['alias'] = 'ckc-' + row['alias']
        self.inventory.write_text(json.dumps(self.rows))
        self.test_deploy_renders_configured_aliases_without_remote_calls()

    def test_binary_checks_use_configured_aliases_with_mocked_process_only(self):
        binary = module('check-binaries')
        from types import SimpleNamespace
        response = SimpleNamespace(returncode=0, stderr='', stdout=json.dumps({
            'temporary_directory_removed': True, 'results': [{'exit_code': 0}] * 6}))
        output = self.private / 'binary-checks'
        with patch.object(sys, 'argv', ['check-binaries', '--inventory', str(self.inventory),
                                       '--output-dir', str(output)]), \
                patch('subprocess.run', return_value=response) as run, \
                patch.object(binary.os, 'umask'), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(binary.main(), 0)
        self.assertEqual([c.args[0][-2] for c in run.call_args_list], [row['alias'] for row in self.rows])
        self.assertEqual(len(list(output.glob('*.json'))), 4)

    def test_deploy_requires_inventory_before_io(self):
        deploy = module('deploy-lab')
        with patch.object(sys, 'argv', ['deploy-lab']), contextlib.redirect_stderr(io.StringIO()), \
                patch('subprocess.run', side_effect=AssertionError('no process operation')):
            with self.assertRaises(SystemExit) as error:
                deploy.main()
        self.assertEqual(error.exception.code, 2)
