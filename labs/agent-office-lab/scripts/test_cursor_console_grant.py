"""Cursor grant control boundary; no native CLI, credentials or network."""
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

import console_grant_harness as harness
import office_console as console
import office_dispatch as dispatch
import remote_grant as grants
import run_cursor_work as runner
from execution_slot import execution_slot, SlotError


class CursorGrantTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.lab = Path(self.tmp.name).resolve()
        harness.copy_sources(self.lab)
        harness.copy_sources(self.lab, 'cursor')

    def grant(self, provider='cursor'):
        return grants.create(self.lab, provider, 900)

    def test_fixed_limits_and_single_pending_across_providers(self):
        row = self.grant()
        self.assertEqual(row['model'], 'composer-2.5')
        self.assertEqual(row['pinned_version'], '2026.10.22-27dcf5f')
        self.assertEqual(row['limits'], {'timeout_seconds':120, 'host_retries':0,
            'provider_request_cap':None, 'output_tokens_per_request_cap':None,
            'money_cap':None, 'tool_hook_gate':4, 'max_prompts':1, 'artifact_bytes_cap':4096})
        self.assertIsNone(grants.pending(self.lab, 'pi'))
        with self.assertRaises(grants.GrantError): self.grant('pi')
        with self.assertRaises(grants.GrantError): grants.consume(self.lab, row['id'], 'pi', 'cli')
        self.assertIsNotNone(grants.pending(self.lab, 'cursor'))
        grants.revoke(self.lab, row['id'])
        pi = self.grant('pi')
        with self.assertRaises(grants.GrantError): self.grant()
        with self.assertRaises(grants.GrantError): grants.consume(self.lab, pi['id'], 'cursor', 'cli')

    def test_grok_stays_cli_only(self):
        app = console.Console(self.lab, remote_grant_providers=['pi','cursor'])
        self.addCleanup(app.close)
        planned = app.plan({'provider':'grok', 'mode':'task'})
        self.assertFalse(planned['executable'])
        self.assertEqual(planned['plan']['authorization']['reason'], 'remote_grant_provider_not_supported')

    def test_cursor_retry_and_legacy_version_are_rejected(self):
        with self.assertRaisesRegex(grants.GrantError, 'retry_not_supported'):
            grants.create(self.lab, 'cursor', 900, retry_parent='pi-work-other')
        row = self.grant()
        file = self.lab/'state/remote-grants/pending'/(row['id']+'.json')
        value = json.loads(file.read_text())
        value['retry'] = {'parent':'pi-work-other', 'attempt':1}
        file.write_text(json.dumps(value))
        with self.assertRaisesRegex(grants.GrantError, 'retry_not_supported'):
            grants.inspect(self.lab, row['id'], 'cursor')
        value.pop('retry'); value['version'] = 1
        file.write_text(json.dumps(value))
        with self.assertRaises(grants.GrantError): grants.inspect(self.lab, row['id'], 'cursor')

    def test_all_cursor_sources_and_runtime_pin_are_bound(self):
        row = self.grant()
        for name in row['source_sha256']:
            file = self.lab/name if name.startswith('tools/') else self.lab/'scripts'/name
            original = file.read_bytes()
            with self.subTest(name=name):
                file.write_bytes(original+b'\n')
                with self.assertRaises(grants.GrantError): grants.inspect(self.lab, row['id'], 'cursor')
                file.write_bytes(original)
        grants.inspect(self.lab, row['id'], 'cursor')

    def test_preflight_busy_and_exec_failure_have_correct_consumption(self):
        row = self.grant()
        with patch.object(dispatch, 'detect', return_value={'launch_prerequisites_present':True}), patch.object(dispatch.os, 'execve') as spawn:
            with execution_slot(self.lab), self.assertRaises(SlotError):
                dispatch.launch('cursor', False, self.lab, remote_grant=row['id'])
            spawn.assert_not_called()
        with patch.object(dispatch, 'detect', return_value={'launch_prerequisites_present':False}):
            self.assertEqual(dispatch.launch('cursor', False, self.lab, remote_grant=row['id']), 1)
        self.assertFalse(grants.consumed(self.lab, row['id']))
        def fail_exec(executable, argv, env):
            self.assertEqual(argv[1:], [str(self.lab/'scripts/run_cursor_work.py'), '--allow-remote', '--authorization-ref', row['id']])
            self.assertTrue(grants.consumed(self.lab, row['id'], 'cursor'))
            raise OSError('synthetic exec failure')
        with patch.object(dispatch, 'detect', return_value={'launch_prerequisites_present':True}), patch.object(dispatch.os, 'execve', side_effect=fail_exec):
            with self.assertRaises(OSError): dispatch.launch('cursor', False, self.lab, remote_grant=row['id'])
        self.assertTrue(grants.consumed(self.lab, row['id']))
        self.assertIsNone(grants.pending(self.lab, 'cursor'))

    def test_console_requires_matching_optin_and_only_exposes_fingerprint(self):
        row = self.grant()
        for enabled, executable in [((),False),(('pi',),False),(('cursor',),True),(('pi','cursor'),True)]:
            app = console.Console(self.lab, remote_grant_providers=enabled)
            self.addCleanup(app.close)
            planned = app.plan({'provider':'cursor', 'mode':'task'})
            self.assertEqual(planned['executable'], executable)
            self.assertNotIn(row['id'], json.dumps(planned)+json.dumps(app.snapshot()))
        grants.revoke(self.lab, row['id'])
        self.assertFalse(app.plan({'provider':'cursor', 'mode':'task'})['executable'])

    def test_revocation_and_expiry_after_plan_prevent_spawn(self):
        for action in ('revoke', 'expire'):
            with self.subTest(action=action):
                row = self.grant()
                app = console.Console(self.lab, remote_grant_providers=['cursor'])
                self.addCleanup(app.close)
                planned = app.plan({'provider':'cursor', 'mode':'task'})
                if action == 'revoke': grants.revoke(self.lab, row['id'])
                with patch.object(grants.time, 'time', return_value=time.time()+1000 if action=='expire' else time.time()), patch.object(app, 'spawn') as spawn:
                    with self.assertRaises(grants.GrantError): app.execute(planned['plan_id'])
                    spawn.assert_not_called()

    def test_runner_cannot_relabel_pi_grant_or_raise_grant_deadline(self):
        row = self.grant('pi')
        grants.consume(self.lab, row['id'], 'pi', 'cli')
        for extra in ([], ['--timeout-seconds','240']):
            with patch.object(runner, 'LAB', self.lab), patch.object(runner.sys, 'argv', ['runner','--allow-remote','--authorization-ref',row['id'],*extra]), patch.object(runner, 'probe') as probe:
                with self.assertRaises(ValueError): runner.main()
                probe.assert_not_called()


if __name__ == '__main__': unittest.main()
