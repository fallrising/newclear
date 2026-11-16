"""Real disk/HTTP authorization checks. No CLI, credentials or model requests."""
from concurrent.futures import ThreadPoolExecutor
import http.client
import json
from pathlib import Path
import shutil
import tempfile
import threading
import unittest
from unittest.mock import patch

import execution_slot as slots
import office_console
import office_dispatch as dispatch
import remote_grant as grants
import result_redaction
import test_pi_retry


class RemoteRetryGrantTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.lab = Path(self.tmp.name).resolve() / 'lab'
        self.lab.mkdir(mode=0o700)
        (self.lab / 'runs').mkdir(mode=0o700)
        for name in grants.SOURCE_NAMES:
            target = self.lab / 'scripts' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(Path(__file__).parent / name, target)
        self.builder = test_pi_retry.RetryTests()
        self.builder.lab = self.lab
        self.builder.fixture = {'marker': 'fixture', 'values': [7, 11, -2, 9]}
        self.parent, _ = self.builder.attempt('pi-work-SYNTHSECRET_0123456789abcdef', mode='task')

    def create(self, parent=None):
        return grants.create(self.lab, 'pi', 900, retry_parent=(parent or self.parent).name)

    def test_binding_public_refs_consumption_and_fresh_scope_separation(self):
        value = self.create()
        self.assertEqual(value['retry']['attempt'], 1)
        self.assertEqual(value['retry'], grants.retry_binding(self.lab, self.parent.name))
        public = grants.public(value)
        self.assertEqual(public['retry']['parent_ref'], result_redaction.make_ref(1, self.parent.name))
        self.assertNotIn(self.parent.name, json.dumps(public))
        self.assertNotIn(value['id'], json.dumps(public))
        for parent in (None, 'pi-work-other'):
            with self.assertRaisesRegex(grants.GrantError, 'task_mismatch'):
                grants.consume(self.lab, value['id'], 'pi', 'dispatcher', retry_parent=parent)
        self.assertFalse(grants.consumed(self.lab, value['id']))
        grants.consume(self.lab, value['id'], 'pi', 'dispatcher', retry_parent=self.parent.name)
        self.assertTrue(grants.consumed(self.lab, value['id']))
        with self.assertRaisesRegex(grants.GrantError, 'used'):
            grants.consume(self.lab, value['id'], 'pi', 'dispatcher', retry_parent=self.parent.name)

    def test_fresh_v1_compatibility_never_authorizes_a_retry(self):
        value = grants.create(self.lab, 'pi', 900)
        path = self.lab / 'state/remote-grants/pending' / (value['id'] + '.json')
        saved = json.loads(path.read_text())
        saved['version'] = 1
        saved.pop('retry')
        path.write_text(json.dumps(saved))
        with self.assertRaisesRegex(grants.GrantError, 'task_mismatch'):
            grants.consume(self.lab, value['id'], 'pi', 'dispatcher', retry_parent=self.parent.name)
        grants.consume(self.lab, value['id'], 'pi', 'dispatcher')

    def test_report_change_invalidates_grant_without_consumption(self):
        value = self.create()
        report = self.parent / 'result.json'
        data = json.loads(report.read_text())
        data['reason'] = 'still_failed_but_changed'
        report.write_text(json.dumps(data))
        with self.assertRaisesRegex(grants.GrantError, 'retry_changed'):
            grants.consume(self.lab, value['id'], 'pi', 'dispatcher', retry_parent=self.parent.name)
        self.assertFalse(grants.consumed(self.lab, value['id']))
        grants.revoke(self.lab, value['id'])

    def test_new_attempt_invalidates_old_grant_and_third_retry_is_rejected(self):
        value = self.create()
        child, _ = self.builder.attempt('pi-work-child', self.parent.name, mode='task')
        with self.assertRaisesRegex(grants.GrantError, 'retry_unavailable'):
            grants.consume(self.lab, value['id'], 'pi', 'dispatcher', retry_parent=self.parent.name)
        grants.revoke(self.lab, value['id'])
        second = self.create(child)
        self.assertEqual(second['retry']['attempt'], 2)
        grants.revoke(self.lab, second['id'])
        last, _ = self.builder.attempt('pi-work-last', child.name, mode='task')
        with self.assertRaisesRegex(grants.GrantError, 'retry_unavailable'):
            self.create(last)

    def test_fault_mode_success_fixture_and_binding_tampering_rejected(self):
        fault, _ = self.builder.attempt('pi-work-fault', mode='http_429')
        with self.assertRaisesRegex(grants.GrantError, 'requires_remote_task'):
            self.create(fault)
        value = self.create()
        pending = self.lab / 'state/remote-grants/pending' / (value['id'] + '.json')
        saved = json.loads(pending.read_text())
        for key, replacement in (('attempt', 2), ('attempt', True), ('attempt', 1.0), ('root', 'pi-work-other'), ('fixture_sha256', '0'*64)):
            altered = json.loads(json.dumps(saved)); altered['retry'][key] = replacement
            pending.write_text(json.dumps(altered))
            with self.assertRaises(grants.GrantError):
                grants.consume(self.lab, value['id'], 'pi', 'dispatcher', retry_parent=self.parent.name)
            self.assertFalse(grants.consumed(self.lab, value['id']))
        pending.write_text(json.dumps(saved))
        (self.parent / 'workspace/input.json').write_text(json.dumps({'marker': 'changed', 'values': [1]}))
        with self.assertRaises(grants.GrantError):
            grants.inspect(self.lab, value['id'], 'pi')

    def test_retry_grant_race_consumes_only_once(self):
        value = self.create()
        barrier = threading.Barrier(2)
        def consume():
            barrier.wait()
            try:
                grants.consume(self.lab, value['id'], 'pi', 'dispatcher', retry_parent=self.parent.name)
                return True
            except grants.GrantError:
                return False
        with ThreadPoolExecutor(2) as pool:
            self.assertEqual(sum(pool.map(lambda _: consume(), range(2))), 1)

    def test_dispatch_preflight_busy_and_exec_failure_semantics(self):
        value = self.create()
        with slots.execution_slot(self.lab), patch.object(dispatch.os, 'execve') as execute:
            with self.assertRaises(slots.SlotError):
                dispatch.launch('pi', False, self.lab, retry_parent=self.parent.name, remote_grant=value['id'])
            execute.assert_not_called()
        with patch.object(dispatch, 'detect', return_value={'launch_prerequisites_present': False}):
            self.assertEqual(dispatch.launch('pi', False, self.lab, retry_parent=self.parent.name, remote_grant=value['id']), 1)
        self.assertFalse(grants.consumed(self.lab, value['id']))
        def failed_exec(executable, command, env):
            self.assertEqual(slots.retry_parent(self.lab), self.parent.name)
            self.assertIn('--authorization-ref', command)
            self.assertTrue(grants.consumed(self.lab, value['id']))
            raise OSError('synthetic launch failure')
        with patch.object(dispatch, 'detect', return_value={'launch_prerequisites_present': True}), patch.object(dispatch.os, 'execve', side_effect=failed_exec):
            with self.assertRaises(OSError):
                dispatch.launch('pi', False, self.lab, retry_parent=self.parent.name, remote_grant=value['id'])
        self.assertTrue(grants.consumed(self.lab, value['id']))

    def test_real_http_ref_plan_restart_wrong_scope_and_revocation(self):
        value = self.create()
        app = office_console.Console(self.lab, remote_grant_providers=['pi'])
        self.addCleanup(app.close)
        server = office_console.serve(app)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        def stop():
            server.shutdown(); server.server_close(); thread.join(timeout=5)
        self.addCleanup(stop)
        def post(path, body):
            connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=5)
            try:
                connection.request('POST', path, json.dumps(body), {'Authorization': 'Bearer '+app.token,
                    'Content-Type': 'application/json', 'Origin': f'http://127.0.0.1:{server.server_port}'})
                response = connection.getresponse(); raw = response.read()
                self.assertNotIn(value['id'].encode(), raw)
                self.assertNotIn(self.parent.name.encode(), raw)
                return response.status, json.loads(raw)
            finally: connection.close()
        code, fresh = post('/api/plan', {'provider': 'pi', 'mode': 'task'})
        self.assertEqual(code, 200); self.assertFalse(fresh['executable'])
        code, retry = post('/api/plan', {'retry_ref': result_redaction.make_ref(1, self.parent.name)})
        self.assertEqual(code, 200); self.assertTrue(retry['executable'])
        restarted = office_console.Console(self.lab, remote_grant_providers=['pi'])
        self.addCleanup(restarted.close)
        self.assertTrue(restarted.plan({'retry_id': self.parent.name})['executable'])
        grants.revoke(self.lab, value['id'])
        with patch.object(app, 'spawn') as spawn:
            self.assertEqual(post('/api/execute', {'plan_id': retry['plan_id']})[0], 409)
            self.assertEqual(post('/api/execute', {'plan_id': retry['plan_id']})[0], 409)
            spawn.assert_not_called()

    def test_cli_requires_confirmation_and_execution_flags(self):
        with patch.object(dispatch, 'LAB', self.lab):
            with self.assertRaises(SystemExit):
                dispatch.main(['grant', 'pi', '--retry-of', self.parent.name])
            with self.assertRaises(SystemExit):
                dispatch.main(['retry', self.parent.name, '--remote-grant', 'a'*32])
            with patch.object(dispatch, 'launch') as launch:
                with self.assertRaises(SystemExit):
                    dispatch.main(['retry', self.parent.name, '--execute', '--allow-remote', '--remote-grant', 'a'*32])
                launch.assert_not_called()


if __name__ == '__main__':
    unittest.main()
