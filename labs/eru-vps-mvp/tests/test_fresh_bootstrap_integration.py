"""Public CLI/driver through real journals, probes and copied host bundles.

Only roots, command runners, transport, artifact bytes, clock and source identity
are synthetic. Admission, renewal, validators and production operations run as-is.
"""
import ast
import base64
from contextlib import redirect_stdout
import copy
from datetime import timedelta
import hashlib
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

import fresh_bootstrap_ops as bootstrap
import fresh_bootstrap_ssh as ssh
import fresh_network_probe as probe
import fresh_run_ops as driver
import labctl
import pending_generation
from labops import ClusterLock
import test_fresh_bootstrap_host as hosts
import test_fresh_bootstrap_ops as fixtures
from test_fresh_network_probe_ssh import SyntheticProbe
from test_fresh_run_authority_integration import renewal


class BootstrapMainlineTests(unittest.TestCase):
    def assert_public_mainline_lost_reply_renewal_status_and_no_replay(self):
        # Called once by the full completion journey. Keep every original
        # bootstrap assertion while avoiding duplicate costly end-to-end setup.
        lock = json.loads((Path(bootstrap.__file__).resolve().parents[1] / 'artifacts.amd64.lock.json').read_text())
        names = {'etcd-io/etcd': ['etcd', 'etcdctl', 'etcdutl'], 'projecteru2/cli': ['eru-cli'],
                 'projecteru2/resource-extend': ['resource-storage'], 'projecteru2/agent': ['eru-agent'],
                 'containernetworking/plugins': ['bridge', 'host-local', 'loopback'], 'projecteru2/core': ['eru-core']}
        archives = {}
        for artifact in lock['artifacts']:
            raw = hosts.make_archive(names[artifact['repository']])
            archives[artifact['repository']] = raw
            artifact['sha256'] = hashlib.sha256(raw).hexdigest()
        f = fixtures.NetworkBootstrapFixture()
        f.setUp(artifact_lock=lock)
        self.addCleanup(f.doCleanups)
        pending_before = pending_generation.inspect(f.project)
        original_next, original_recover = driver.next_step, driver.recover_run
        bootstrap_sha = None
        counter = 0
        harness = None
        adapters = {}

        def cli(operation, parameters):
            nonlocal counter
            counter += 1
            authority = renewal(f.network.f, operation, parameters, at=f.now, ref_only=True)
            request = {'schema_version': 1, 'operation': 'fresh-run-step', 'run_id': f.run,
                'execution_sha256': f.execution['sha256'], 'pending_sha256': pending_before['sha256'],
                'step': operation, 'parameters': parameters, 'renewal': authority}
            path = 'private/driver-bootstrap-' + str(counter) + '.json'
            digest = f.write(path, request)
            command = 'recover' if operation == 'reconcile_bootstrap' else 'next'
            args = ['labctl', 'fresh-run', command, '--run', f.run, '--sha256', f.execution['sha256'],
                    '--input', path, '--input-sha256', digest]
            output = io.StringIO()
            options = {'now': lambda: f.now, 'source_state': f.source, 'adapters': adapters}
            with patch.object(labctl, 'PROJECT', f.project), patch('sys.argv', args), \
                    patch.object(driver, 'next_step', side_effect=lambda *a, **k: original_next(*a, **{**options, **k})), \
                    patch.object(driver, 'recover_run', side_effect=lambda *a, **k: original_recover(*a, **{**options, **k})), \
                    patch.object(labctl, 'Operator', side_effect=AssertionError('ordinary operator forbidden')), \
                    redirect_stdout(output):
                labctl.main()
            value = json.loads(output.getvalue())
            for secret in ('private/', 'machine_id', 'resource_capacity', 'binary_base64', f.token.decode()):
                self.assertNotIn(secret, output.getvalue())
            self.assertFalse(value['generation_changed'])
            return value

        planned = cli('prepare_bootstrap', {'plan_id': f.plan['id'], 'plan_sha': f.plan['sha256'],
            'network_receipt_sha': f.accepted['receipt_sha256'], 'input_file': f.inputpath, 'input_sha': f.inputsha})
        self.assertEqual(planned['status'], 'bootstrap-planned')
        bootstrap_sha = planned['bootstrap_sha256']
        plan = json.loads((f.project / bootstrap.AREA / f.run / 'plan.json').read_text())['plan']
        env = SyntheticProbe(plan['network_render'], plan['network_setup'])
        self.addCleanup(env.close)
        env.setup = copy.deepcopy(plan['network_setup'])
        for i, h in enumerate(env.render['hosts']):
            root = env.root / str(i)
            (root / 'usr/local/libexec/eru-ssh-command').write_bytes(b'reviewed-helper')
            (root / 'home/ckc/.ssh/authorized_keys').write_text(h['files'][1]['content'])
        roots = {h['alias']: env.root / str(i) for i, h in enumerate(env.render['hosts'])}
        harness = hosts.BootstrapHarness(plan['render'], archives, roots=roots, now=f.now)
        self.addCleanup(harness.close)
        network_run = env.run
        def phase_run(index, argv, limit, timeout, **kw):
            if index is not None and argv[0] == '/usr/bin/systemctl':
                states = harness.runners[env.render['hosts'][index]['alias']].services
                active = states.get(argv[-1], {}).get('ActiveState') == 'active'
                return (b'LoadState=loaded\nActiveState=active\nSubState=running\n' if active
                        else b'LoadState=not-found\nActiveState=inactive\nSubState=dead\n')
            if index is not None and argv[0] == '/usr/bin/ps':
                states = harness.runners[env.render['hosts'][index]['alias']].services
                names = [u.removesuffix('.service') for u in probe.SERVICES if states.get(u, {}).get('ActiveState') == 'active']
                return ('init\n' + '\n'.join(names) + '\n').encode()
            return network_run(index, argv, limit, timeout, **kw)
        env.run = phase_run
        def collector(rendered, keys, *, setup, now, expected_services):
            return probe.collect_network_evidence(rendered, keys, setup=setup, now=now,
                expected_services=expected_services, transport=env.transport, runner=env.runner)
        adapters['bootstrap_network_collector'] = collector
        lost = [True]
        dispatches = []
        def transport(host, source, key):
            tree = ast.parse(source)
            request = json.loads(base64.b64decode(tree.body[-1].value.args[0].value))
            if request['operation'] == 'dispatch':
                dispatches.append(request['action']['step_index'])
            result = harness.transport(host, source, key)
            if request['operation'] == 'dispatch' and lost[0]:
                lost[0] = False
                raise TimeoutError('synthetic reply lost after completed install')
            return result
        real_adapter = ssh.SSHBootstrapAdapter
        factory = lambda keys: real_adapter(keys, transport=transport)

        def execute(index):
            authorization = {'schema_version': 1, 'operation': 'fresh-bootstrap-authorization',
                'plan_id': f.plan['id'], 'plan_sha256': f.plan['sha256'],
                'execution_sha256': f.execution['sha256'], 'pending_sha256': pending_before['sha256'],
                'bootstrap_sha256': bootstrap_sha, 'step_index': index,
                'scope': 'fresh-bootstrap-one-step-only', 'owner_confirmed': True,
                'authorized_at': f.now.isoformat(), 'expires_at': (f.now + timedelta(minutes=15)).isoformat()}
            path = 'private/bootstrap-step-' + str(index) + '.json'
            digest = f.write(path, authorization)
            return cli('execute_bootstrap', {'run_id': f.run, 'bootstrap_sha': bootstrap_sha,
                'step_index': index, 'authorization_file': path, 'authorization_sha': digest})

        with patch.object(ssh, 'SSHBootstrapAdapter', side_effect=factory):
            first = execute(0)
            self.assertEqual(first['status'], 'uncertain')
            self.assertEqual(dispatches, [0])
            # A fresh writer never replays a durable uncertain intent.
            self.assertEqual(execute(0)['status'], 'uncertain')
            self.assertEqual(execute(1)['status'], 'blocked')
            self.assertEqual(dispatches, [0])
            f.now += timedelta(minutes=16)
            harness.now = f.now
            recovered = cli('reconcile_bootstrap', {'run_id': f.run, 'step_index': 0,
                'expected_intent_sha': first['intent_sha256']})
            self.assertEqual(recovered['status'], 'bootstrap-step-complete')
            self.assertFalse(recovered['remote_mutation_performed'])
            self.assertEqual(dispatches, [0])
            env.wrong_route = True
            self.assertEqual(execute(1)['status'], 'blocked')
            self.assertEqual(dispatches, [0])
            env.wrong_route = False
            for index in range(1, 22):
                result = execute(index)
                self.assertEqual(result['status'], 'empty-control-plane' if index == 2 else
                                 'cluster-bootstrapped' if index == 21 else 'bootstrap-step-complete', (index, result))
            self.assertEqual(dispatches, [i for i in range(22) if i not in (2, 21)])
        self.assertEqual(pending_generation.inspect(f.project), pending_before)
        with self.assertRaisesRegex(RuntimeError, 'pending generation'):
            with ClusterLock(f.project):
                self.fail('ordinary mutation admitted during fresh bootstrap')
        self.assertEqual(len(harness.nodes), 3)
        self.assertTrue(all(n['available'] and not n['bypass'] for n in harness.nodes))
        self.assertEqual(result['next_stage'], 'apps-replayed')
        self.assertTrue(result['stage_accepted'])
        saved = {p: p.read_bytes() for p in (f.project / bootstrap.AREA / f.run).rglob('*.json')}
        calls_before = (len(harness.calls), len(env.calls))
        real_open = os.open
        def readonly(path, flags, *a, **k):
            self.assertFalse(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC))
            return real_open(path, flags, *a, **k)
        with patch.object(os, 'open', side_effect=readonly):
            status = driver.status_run(f.project, f.run, f.execution['sha256'],
                now=f.now + timedelta(days=1), source_state=f.source)
        self.assertEqual(status['status'], 'bootstrap-history-verified')
        self.assertEqual(status['completed_step_count'], 22)
        self.assertFalse(status['current_network_ready'])
        self.assertFalse(status['stage_accepted'])
        self.assertEqual(calls_before, (len(harness.calls), len(env.calls)))
        self.assertEqual(saved, {p: p.read_bytes() for p in saved})
