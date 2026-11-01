import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import office_dispatch as dispatch
from execution_slot import SlotError, execution_slot


class DispatchTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.lab = Path(self.tmp.name)

    def test_default_run_and_plan_never_probe_or_execute(self):
        with patch.object(dispatch, 'detect') as probe, patch.object(os, 'execve') as execute:
            for provider in dispatch.SPECS:
                for action in ('plan', 'run'):
                    with contextlib.redirect_stdout(io.StringIO()) as output:
                        self.assertEqual(dispatch.main([action, provider]), 0)
                    data = json.loads(output.getvalue())
                    self.assertEqual(data['mode'], 'plan')
                    self.assertFalse(data['model_task_started'])
                    self.assertEqual(data['limits']['host_retries'], 0)
            probe.assert_not_called(); execute.assert_not_called()

    def test_remote_execute_without_authorization_and_local_with_remote_are_blocked(self):
        with patch.object(dispatch, 'detect') as probe, patch.object(os, 'execve') as execute:
            for provider in dispatch.SPECS:
                with self.assertRaises(SlotError):
                    dispatch.launch(provider, provider == 'opencode', self.lab)
            probe.assert_not_called(); execute.assert_not_called()

    def test_unknown_provider_extra_command_and_ack_without_confirmation_rejected(self):
        for args in (['run', 'shell'], ['run', 'pi', '--prompt', 'arbitrary'],
                     ['run', 'pi', '--allow-remote'], ['acknowledge-interruption']):
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                dispatch.main(args)

    def test_failed_preflight_never_executes_or_leaves_journal(self):
        with patch.object(dispatch, 'detect', return_value={'launch_prerequisites_present': False}), \
                patch.object(os, 'execve') as execute, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(dispatch.launch('grok', True, self.lab), 1)
            execute.assert_not_called()
        self.assertFalse((self.lab / 'state/dispatch/active.json').exists())

    def test_exact_provider_argv_and_inherited_lock(self):
        for provider, spec in dispatch.SPECS.items():
            with patch.object(dispatch, 'detect', return_value={'launch_prerequisites_present': True}), \
                    patch.object(os, 'execve', side_effect=OSError('test stops before real launch')) as execute:
                with self.assertRaises(OSError):
                    dispatch.launch(provider, spec['remote'], self.lab)
                executable, argv, env = execute.call_args.args
                self.assertEqual(argv, [executable, str(self.lab / 'scripts' / spec['runner']), *spec['args']])
                self.assertGreaterEqual(int(env['LAB_EXECUTION_SLOT_FD']), 3)
                self.assertNotIn('--keep-open', argv)
                self.assertNotIn('--budget-multiplier', argv)

    def test_cancel_check_is_explicit_local_only_and_plan_stays_inert(self):
        with patch.object(dispatch, 'detect') as probe, patch.object(os, 'execve') as execute:
            with contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(dispatch.main(['run', 'opencode', '--check-cancel']), 0)
            self.assertTrue(json.loads(output.getvalue())['native_cancel_check'])
            for provider in ('grok', 'pi', 'cursor'):
                with self.assertRaisesRegex(SlotError, 'local_cancel_check_only'):
                    dispatch.launch(provider, True, self.lab, check_cancel=True)
            probe.assert_not_called(); execute.assert_not_called()
        with patch.object(dispatch, 'detect', return_value={'launch_prerequisites_present': True}), \
                patch.object(os, 'execve', side_effect=OSError('test does not start model')) as execute:
            with self.assertRaises(OSError):
                dispatch.launch('opencode', False, self.lab, check_cancel=True)
            self.assertEqual(execute.call_args.args[1][-1], '--check-cancel')

    def test_failure_plan_never_executes_and_rejects_paid_or_other_provider_modes(self):
        with patch.object(dispatch, 'detect') as probe, patch.object(os, 'execve') as execute:
            with contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(dispatch.main(['run', 'pi', '--check-failure', '401']), 0)
            plan = json.loads(output.getvalue())
            self.assertFalse(plan['remote'])
            self.assertNotIn('--allow-remote', plan['command'])
            for provider, remote, cancel in [('pi', True, False), ('grok', False, False), ('pi', False, True)]:
                with self.assertRaises(SlotError):
                    dispatch.launch(provider, remote, self.lab, check_cancel=cancel, check_failure=401)
            probe.assert_not_called(); execute.assert_not_called()

    def test_failure_launch_needs_runtime_but_not_credentials_and_uses_only_fault_argv(self):
        check = {'launch_prerequisites_present': False, 'cli_compatible': True,
                 'runtime': {'office_build': True}, 'credentials': 'missing'}
        with patch.object(dispatch, 'detect', return_value=check), \
                patch.object(os, 'execve', side_effect=OSError('no real launch')) as execute:
            with self.assertRaises(OSError):
                dispatch.launch('pi', False, self.lab, check_failure=429)
            self.assertEqual(execute.call_args.args[1][2:], ['--check-failure', '429'])

    def test_crash_plan_is_inert_and_rejects_remote_other_provider_and_other_modes(self):
        with patch.object(dispatch, 'detect') as detect, patch.object(os, 'execve') as execute:
            with contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(dispatch.main(['run', 'pi', '--check-crash']), 0)
            plan = json.loads(output.getvalue())
            self.assertFalse(plan['remote'])
            self.assertEqual(plan['limits']['provider_request_cap'], 0)
            self.assertNotIn('--allow-remote', plan['command'])
            for provider, remote, options in [('pi', True, {}), ('grok', False, {}), ('pi', False, {'check_cancel':True}), ('pi', False, {'check_failure':401})]:
                with self.assertRaises(SlotError):
                    dispatch.launch(provider, remote, self.lab, check_crash=True, **options)
            detect.assert_not_called(); execute.assert_not_called()

    def test_crash_launch_needs_runtime_but_no_credentials(self):
        check = {'launch_prerequisites_present': False, 'cli_compatible': True, 'runtime': {'office_build': True}}
        with patch.object(dispatch, 'detect', return_value=check), patch.object(os, 'execve', side_effect=OSError('no launch')) as execute:
            with self.assertRaises(OSError):
                dispatch.launch('pi', False, self.lab, check_crash=True)
            self.assertEqual(execute.call_args.args[1][2:], ['--check-crash'])
            check['runtime']['office_build'] = False
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(dispatch.launch('pi', False, self.lab, check_crash=True), 1)
            self.assertEqual(execute.call_count, 1)

    def test_credentials_metadata_is_not_authentication(self):
        for provider, relative in [('grok', '.local/remote/grok/auth.json'),
                                   ('pi', '.local/remote/pi/auth.json'),
                                   ('cursor', '.local/remote/cursor-home/.cursor/auth.json')]:
            self.assertEqual(dispatch.credentials(provider, self.lab), 'missing')
            path = self.lab / relative; path.parent.mkdir(parents=True); path.write_text('not even valid credentials'); path.chmod(0o600)
            self.assertEqual(dispatch.credentials(provider, self.lab), 'present_unverified')
            path.chmod(0o644)
            self.assertEqual(dispatch.credentials(provider, self.lab), 'unsafe')
            path.unlink(); path.symlink_to(self.lab / 'outside')
            self.assertEqual(dispatch.credentials(provider, self.lab), 'unsafe')

    def test_detect_keeps_cli_auth_and_runtime_separate(self):
        with patch.object(dispatch.remote_cli, 'probe', return_value={'compatible': True, 'network_denied': True}), \
                patch.object(dispatch, 'runtime_ready', return_value={'office_build': False}):
            result = dispatch.detect('pi', self.lab)
            self.assertTrue(result['cli_compatible'])
            self.assertFalse(result['launch_prerequisites_present'])
            self.assertFalse(result['authentication_verified'])
            self.assertFalse(result['model_inference_verified'])

    def test_opencode_version_and_capabilities(self):
        help_text = 'opencode run --model M --session S --port N --hostname H '
        self.assertIsNone(dispatch.assess_opencode('1.19.5\n', help_text))
        self.assertEqual(dispatch.assess_opencode('1.19.50', help_text), 'cli_version_mismatch')
        self.assertEqual(dispatch.assess_opencode('1.19.5', help_text.replace('--session', '--sessions')), 'required_capability_missing')

    def test_native_probe_captures_pty_and_removes_ansi(self):
        code, output = dispatch.capture_probe([sys.executable, '-c', 'print("\\x1b[32mversion\\x1b[0m")'],
                                             self.lab, os.environ)
        self.assertEqual(code, 0)
        self.assertEqual(output.strip(), 'version')

    def test_native_probe_timeout_cleans_up(self):
        with self.assertRaisesRegex(ValueError, 'probe_timed_out'):
            dispatch.capture_probe([sys.executable, '-c', 'import time;time.sleep(30)'],
                                   self.lab, os.environ, timeout=0.1)

    def test_pinned_plan_matches_existing_remote_runner_dry_runs(self):
        scripts = Path(__file__).resolve().parent
        for provider in ('grok', 'pi', 'cursor'):
            process = subprocess.run([sys.executable, str(scripts / dispatch.SPECS[provider]['runner'])],
                                     capture_output=True, text=True, timeout=10)
            self.assertEqual(process.returncode, 0, process.stderr)
            native = json.loads(process.stdout)
            self.assertEqual(dispatch.plan(provider)['model'].split('/')[-1], native['model'])
            self.assertEqual(dispatch.plan(provider)['limits']['timeout_seconds'], native['timeout_seconds'])

    def test_all_direct_runner_entrypoints_obey_busy_slot(self):
        scripts = Path(__file__).resolve().parent
        cases = [(spec, spec['args']) for spec in dispatch.SPECS.values()]
        cases += [(dispatch.SPECS['pi'], ['--check-failure', '401']),
                  (dispatch.SPECS['pi'], ['--check-failure=429']),
                  (dispatch.SPECS['pi'], ['--check-crash'])]
        for spec, args in cases:
            # Replace probes with a tripwire; even a broken gate cannot issue a model request.
            code = f'''import sys,runpy,types
from pathlib import Path
sys.path.insert(0,{str(scripts)!r})
import execution_slot,remote_cli,cursor_cli
original=execution_slot.execution_slot
execution_slot.execution_slot=lambda:original(Path({str(self.lab)!r}))
def forbidden(*a,**k): raise AssertionError('preflight reached before busy gate')
remote_cli.probe=forbidden
cursor_cli.probe=forbidden
sys.modules['psutil']=types.ModuleType('psutil')
sys.argv={[str(scripts / spec['runner']), *args]!r}
runpy.run_path(sys.argv[0],run_name='__main__')
'''
            with execution_slot(self.lab):
                result = subprocess.run([sys.executable, '-c', code], capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertIn('execution_busy', result.stderr)
            self.assertNotIn('preflight reached', result.stderr)


if __name__ == '__main__':
    unittest.main()
