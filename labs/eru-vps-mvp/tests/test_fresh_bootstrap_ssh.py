"""Execute the actual copied-source bundle with local synthetic host seams."""
import ast
import base64
import copy
import os
import sys
import unittest
from unittest.mock import patch

import fresh_bootstrap_host as host
import fresh_bootstrap_render as render
import fresh_bootstrap_ssh as ssh
import test_fresh_bootstrap_host as fixture


class SSHTests(unittest.TestCase):
    def setUp(self):
        self.f = fixture.HostTests(); self.f.setUp(); self.addCleanup(self.f.doCleanups)
        self.keys = {'ckc-disposable-%02d' % i: 'ssh-ed25519 ' + base64.b64encode(
            b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20' + bytes([i]) * 32).decode() for i in range(1, 5)}
        self.calls = []
        self.adapter = ssh.SSHBootstrapAdapter(self.keys, transport=self.transport)

    def transport(self, h, source, key):
        self.calls.append((h, key))
        tree = ast.parse(source)
        encoded = tree.body[-1].value.args[0].value
        tree.body.pop()
        namespace = {}
        # Bundle module registration is scoped to this fixture; no real process calls.
        with patch.dict(sys.modules):
            exec(compile(tree, '<actual-bootstrap-bundle>', 'exec'), namespace)
            request = namespace['_decode'](base64.b64decode(encoded, validate=True))
            self.f.identity(request['action']['host_index'])
            result = namespace['handle'](request, root=str(self.f.root), owner_uid=os.getuid(), owner_gid=os.getgid(),
                now=self.f.now, runner=self.f.runner, artifact_reader=lambda a: self.f.archives[a['repository']])
        return render.canonical(result)

    def test_actual_bundle_install_start_empty_and_readonly_recovery(self):
        a = self.f.action(0)
        self.assertEqual(self.adapter.observe(a)['state'], 'absent')
        self.assertEqual(self.adapter.dispatch(a, 'a' * 64)['state'], 'complete')
        self.assertEqual(self.adapter.observe(a)['provenance']['intent_sha256'], 'a' * 64)
        with self.assertRaises(ValueError):
            self.adapter.dispatch(a, 'a' * 64)
        self.adapter.dispatch(self.f.action(1), 'b' * 64)
        self.assertEqual(self.adapter.observe(self.f.action(2))['state'], 'complete')
        self.assertEqual(len(self.calls), 6)

    def test_wrong_pinned_key_and_wire_injection_zero_transport(self):
        action = self.f.action(0); action['host']['host_key_sha256'] = 'e' * 64
        with self.assertRaises(ValueError):
            self.adapter.observe(action)
        for field in ('root', 'module', 'command', 'runner'):
            request = {'schema_version': 1, 'operation': 'observe', 'action': self.f.action(0), field: 'evil'}
            with self.assertRaises(ValueError):
                ssh.build_program(request)
        self.assertEqual(self.calls, [])

    def test_response_duplicate_keys_bad_provenance_and_capacity_fail(self):
        action = self.f.action(0)
        with self.assertRaises(ValueError):
            ssh._response(b'{"schema_version":1,"schema_version":1}', action, None)
        observed = self.adapter.dispatch(action, 'a' * 64)
        forged = copy.deepcopy(observed); forged['provenance']['intent_sha256'] = 'b' * 64
        with self.assertRaises(ValueError):
            ssh._response(render.canonical(forged), action, 'a' * 64)
        forged = copy.deepcopy(observed); forged['provenance']['completed_at'] = '2026-10-05T00:00:00+00:00'
        with self.assertRaises(ValueError):
            ssh._response(render.canonical(forged), action, None)

    def test_large_binary_request_program_is_bounded_and_deduplicated(self):
        raw = b'x' * (17 * 1024 * 1024)
        import hashlib
        action = self.f.action(0)
        options = action['render']['inputs']
        options['safe_core']['selection']['artifact_sha256'] = hashlib.sha256(raw).hexdigest()
        options['safe_core']['binary_base64'] = base64.b64encode(raw).decode()
        action['render'] = render.build_render(options['access_render'], options['artifact_lock'],
            base64.b64decode(options['token_base64']), run_id='run-1',
            target_token_sha256=action['render']['target_token_sha256'], prior_token_sha256=options['prior_token_sha256'],
            safe_core=options['safe_core'], capacities=options['capacities'])
        request = {'schema_version': 1, 'operation': 'observe', 'action': action}
        program = ssh.build_program(request)
        self.assertGreater(len(program), 16 * 1024 * 1024)
        self.assertLess(len(program), host.PROGRAM_LIMIT)
        self.assertLess(len(render.canonical(request)), host.WIRE_LIMIT)
        self.assertEqual(self.calls, [])

    def test_lost_transport_reply_does_not_redispatch(self):
        def lost(h, source, key):
            self.transport(h, source, key)
            raise TimeoutError('synthetic transport loss')
        adapter = ssh.SSHBootstrapAdapter(self.keys, transport=lost)
        with self.assertRaises(ValueError):
            adapter.dispatch(self.f.action(0), 'a' * 64)
        count = len(self.f.runner.writes)
        self.assertEqual(self.adapter.observe(self.f.action(0))['state'], 'complete')
        self.assertEqual(len(self.f.runner.writes), count)
