"""Public CLI to real bootstrap/replay/generation journals on offline roots.

Only clock, source identity, archive bytes, host roots, command results and the
pinned transport are synthetic. Production admission, derivation, evidence
validation, copied helpers, local commit and lineage run without PASS seams.
"""
from contextlib import redirect_stdout
import base64
import copy
from datetime import timedelta
import hashlib
import io
import json
import os
import sys
import time
import unittest
from unittest.mock import patch

import fresh_bootstrap_ops as bootstrap
import fresh_execution_ops
import fresh_generation as generation_contract
import fresh_generation_ops as generation
import fresh_rebuild_ops
import fresh_replay as replay_contract
import fresh_replay_ops as replay
import fresh_replay_ssh as replay_ssh
import fresh_run_ops as driver
import labctl
from labops import ClusterLock
import pending_generation
import test_fresh_bootstrap_integration as bootstrap_integration
import test_fresh_bootstrap_ops as fixtures
import test_fresh_bootstrap_host as bootstrap_hosts
import test_fresh_replay_host as replay_hosts
import test_fresh_replay_integration as replay_integration
import test_fresh_replay_ssh as replay_transport
from test_fresh_run_authority_integration import renewal


class CompletionMainlineTests(unittest.TestCase):
    def test_cli_complete_chain_prefix_recovery_lineage_and_ordinary_consumer(self):
        started = time.monotonic()
        def checkpoint(stage):
            print('completion integration: ' + stage + ' (' + str(round(time.monotonic() - started, 3)) + 's)', file=sys.stderr, flush=True)
        original = bootstrap_integration.BootstrapMainlineTests()
        self.addCleanup(original.doCleanups)
        fixture = fixtures.NetworkBootstrapFixture()
        prepare_inputs = fixture.prepare_inputs
        def complete_capacities():
            prepare_inputs()
            for row in fixture.document['capacities']:
                row['resource_capacity'] = {
                    'cpumem': {'cpu': 4, 'cpu_map': {str(i): 100 for i in range(4)},
                        'memory': 2 * 1024**3, 'numa_memory': {}, 'numa': {}},
                    'resource-storage': {'volumes': {}, 'disks': [], 'storage': 10 * 1024**3}}
            fixture.inputsha = fixture.write(fixture.inputpath, fixture.document)
            return {'path': fixture.inputpath, 'sha256': fixture.inputsha}
        fixture.prepare_inputs = complete_capacities
        captured = {}
        bootstrap_factory = bootstrap_hosts.BootstrapHarness

        def capture_bootstrap(*args, **kwargs):
            value = bootstrap_factory(*args, **kwargs)
            core_alias = value.render['hosts'][0]['alias']
            core_runner = value.runners[core_alias]
            baseline = replay_hosts.Harness()
            self.addCleanup(baseline.close)
            def core_commands(argv):
                # Synthetic Eru commands update the same full-keyspace records
                # that replay later observes; bootstrap cannot attest an empty
                # metadata table while a different replay fixture adopts one.
                registered = {node['name'] for node in value.nodes}
                baseline.plan['render']['workers'] = [copy.deepcopy(worker)
                    for worker in value.render['workers'] if worker['node'] in registered]
                core_runner.keys = [{'key': base64.b64encode(key.encode()).decode(),
                    'value': base64.b64encode(raw.encode()).decode()}
                    for key, raw in baseline.metadata_state().items()]
                return core_runner(argv)
            core_commands.services = core_runner.services
            value.runners[core_alias] = core_commands
            captured['bootstrap'] = value
            return value

        with patch.object(fixtures, 'NetworkBootstrapFixture', return_value=fixture), \
                patch.object(bootstrap_hosts, 'BootstrapHarness', side_effect=capture_bootstrap):
            original.assert_public_mainline_lost_reply_renewal_status_and_no_replay()
        checkpoint('bootstrap prefix verified')
        f = fixture
        pending_before = pending_generation.inspect(f.project)
        before_generation = json.loads((f.project / generation_contract.PATHS[2]).read_bytes())['generation']
        boot = json.loads((f.project / bootstrap.AREA / f.run / 'plan.json').read_bytes())
        ready = json.loads((f.project / bootstrap.AREA / f.run / 'steps/step-21/receipt.json').read_bytes())
        original_next, original_recover = driver.next_step, driver.recover_run
        adapters, counter = {}, 0

        def cli(operation, parameters):
            nonlocal counter
            counter += 1
            ref = renewal(f.network.f, operation, parameters, at=f.now, ref_only=True)
            request = {'schema_version': 1, 'operation': 'fresh-run-step', 'run_id': f.run,
                'execution_sha256': f.execution['sha256'], 'pending_sha256': pending_before['sha256'],
                'step': operation, 'parameters': parameters, 'renewal': ref}
            path = 'private/completion-driver-' + str(counter) + '.json'
            digest = f.write(path, request)
            args = ['labctl', 'fresh-run', 'recover' if operation.startswith('reconcile_') else 'next',
                '--run', f.run, '--sha256', f.execution['sha256'], '--input', path, '--input-sha256', digest]
            options = {'now': lambda: f.now, 'source_state': f.source, 'adapters': adapters}
            output = io.StringIO()
            with patch.object(labctl, 'PROJECT', f.project), patch('sys.argv', args), \
                    patch.object(driver, 'next_step', side_effect=lambda *a, **k: original_next(*a, **{**options, **k})), \
                    patch.object(driver, 'recover_run', side_effect=lambda *a, **k: original_recover(*a, **{**options, **k})), \
                    patch.object(labctl, 'Operator', side_effect=AssertionError('ordinary operator forbidden')), \
                    redirect_stdout(output):
                labctl.main()
            for secret in ('private/', 'machine_id', 'resource_capacity', 'binary_base64', f.token.decode()):
                self.assertNotIn(secret, output.getvalue())
            return json.loads(output.getvalue())

        planned = cli('prepare_replay', {'run_id': f.run, 'bootstrap_sha': boot['sha256'],
            'bootstrap_receipt_sha': ready['sha256']})
        self.assertEqual(planned['status'], 'replay-planned', planned)
        replay_sha = planned['replay_sha256']
        replay_plan = json.loads((f.project / replay.AREA / f.run / 'plan.json').read_bytes())['plan']
        replay_integration.assert_prepared_replay(self, f,
            {'plan': replay_plan, 'sha256': replay_sha}, planned)
        h = replay_hosts.Harness()
        self.assertEqual(h.identity_profile, 'containerd')
        h.with_status = True
        self.addCleanup(h.close)
        h.plan, h.digest, h.now = replay_plan, replay_sha, f.now
        h.roots = [captured['bootstrap'].roots[row['alias']] for row in replay_plan['network_render']['hosts']]
        h.keys = {row['alias']: line.split(' ', 1)[1] for row, line in zip(
            replay_plan['network_render']['hosts'], replay_plan['network_render']['controller_known_hosts'].splitlines())}
        for root in h.roots:
            for relative in ('var/lib/cni/networks/eru', 'run/eru/workloads'):
                (root / relative).mkdir(parents=True, exist_ok=True, mode=0o700)
        transport_case = replay_transport.ReplaySSHTests()
        transport_case.h, transport_case.dispatches = h, []
        lost = [True]

        def transport(host, source, key):
            result = transport_case.transport(host, source, key)
            # The transport test executes the actual bundled helper first.
            if lost[0] and len(transport_case.dispatches) == 1:
                lost[0] = False
                raise TimeoutError('synthetic reply lost after completed replay writer')
            return result

        real_adapter = replay_ssh.SSHReplayAdapter
        factory_patch = patch.object(replay_ssh, 'SSHReplayAdapter',
            side_effect=lambda keys: real_adapter(keys, transport=transport))
        factory_patch.start()
        self.addCleanup(factory_patch.stop)
        # Current network readiness is freshly collected by the real probe
        # fixture used in bootstrap. Capture its admitted collector directly.
        import fresh_network_probe

        def collector(rendered, keys, *, setup, now, expected_services):
            # NetworkReadyTests' collector is an evidence fixture; use the real
            # production SSH/probe bundle on its documented synthetic runners.
            from test_fresh_network_probe_ssh import SyntheticProbe
            env = captured.get('probe')
            if env is None:
                env = SyntheticProbe(rendered, setup)
                captured['probe'] = env
                self.addCleanup(env.close)
                env.setup = copy.deepcopy(setup)
                for i, row in enumerate(rendered['hosts']):
                    root = env.root / str(i)
                    (root / 'usr/local/libexec/eru-ssh-command').write_bytes(b'reviewed-helper')
                    (root / 'home/ckc/.ssh/authorized_keys').write_text(row['files'][1]['content'])
                original_run = env.run
                def phase_run(index, argv, limit, timeout, **kwargs):
                    if index is not None and argv[0] == '/usr/bin/systemctl':
                        active = expected_services[index][argv[-1]] == 'active'
                        return (b'LoadState=loaded\nActiveState=active\nSubState=running\n' if active
                            else b'LoadState=not-found\nActiveState=inactive\nSubState=dead\n')
                    if index is not None and argv[0] == '/usr/bin/ps':
                        return ('init\n' + '\n'.join(unit.removesuffix('.service') for unit, phase in expected_services[index].items() if phase == 'active') + '\n').encode()
                    return original_run(index, argv, limit, timeout, **kwargs)
                env.run = phase_run
            return fresh_network_probe.collect_network_evidence(rendered, keys, setup=setup, now=now,
                expected_services=expected_services, transport=env.transport, runner=env.runner)
        adapters['replay_network_collector'] = collector

        replay_auth_refs = {}
        def execute(index):
            # A retained intent owns its original immutable authorization ref.
            # A rejected request without an intent receives a new current ref.
            intent_path = f.project / replay._path(f.run, index) / 'intent.json'
            if index not in replay_auth_refs or not intent_path.exists():
                auth = {'schema_version': 1, 'operation': 'fresh-replay-authorization',
                    'plan_id': f.plan['id'], 'plan_sha256': f.plan['sha256'],
                    'execution_sha256': f.execution['sha256'], 'pending_sha256': pending_before['sha256'],
                    'replay_sha256': replay_sha, 'step_index': index, 'scope': 'fresh-replay-one-step-only',
                    'owner_confirmed': True, 'authorized_at': f.now.isoformat(),
                    'expires_at': (f.now + timedelta(minutes=15)).isoformat()}
                path = 'private/replay-authority-' + str(index) + '-' + str(counter) + '.json'
                digest = f.write(path, auth)
                replay_auth_refs[index] = path, digest
            path, digest = replay_auth_refs[index]
            h.now = f.now
            return cli('execute_replay', {'run_id': f.run, 'replay_sha': replay_sha,
                'step_index': index, 'authorization_file': path, 'authorization_sha': digest})

        self.assertEqual(execute(0)['status'], 'replay-step-complete')
        first = execute(1)
        self.assertEqual(first['status'], 'uncertain', first)
        calls = list(transport_case.dispatches)
        self.assertEqual(execute(1)['status'], 'uncertain')
        self.assertEqual(execute(2)['status'], 'blocked')
        self.assertEqual(transport_case.dispatches, calls)
        f.now += timedelta(minutes=16)
        h.now = f.now
        recovered = cli('reconcile_replay', {'run_id': f.run, 'step_index': 1,
            'expected_intent_sha': first['intent_sha256']})
        self.assertEqual(recovered['status'], 'replay-step-complete', recovered)
        self.assertFalse(recovered['remote_mutation_performed'])
        self.assertEqual(transport_case.dispatches, calls)
        for index in range(2, len(replay_plan['steps'])):
            result = execute(index)
            descriptor = replay_plan['steps'][index]
            expected = replay_contract.stage(index, replay_plan['steps']) if descriptor['step'] in ('apps-accept', 'resources-accept', 'residue-accept') else 'replay-step-complete'
            self.assertEqual(result['status'], expected, (index, descriptor, result))
            if index % 10 == 0 or index == len(replay_plan['steps']) - 1:
                checkpoint('replay receipts verified ' + str(index + 1) + '/' + str(len(replay_plan['steps'])))
            f.now += timedelta(seconds=2)
        proof = replay.load_acceptance(f.project, f.run, replay_sha, now=lambda: f.now, source_state=f.source)
        self.assertEqual(pending_generation.inspect(f.project), pending_before)
        self.assertEqual(json.loads((f.project / generation_contract.PATHS[2]).read_bytes())['generation'], before_generation)
        binding = generation._binding(proof)
        fence = json.loads((f.project / proof['context']['execution']['execution']['evidence']['writer_fence']['path']).read_bytes())
        timing = {'quiesced_at': fence['observed_at'],
            'installation_started_at': proof['timing']['bootstrap']['installation_started_at'],
            'v01_completed_at': proof['timing']['bootstrap']['ready_at'],
            'residue_completed_at': proof['timing']['residue_completed_at'],
            'provider_queue_intervals': [], 'no_queue_observed': True}
        from fresh_execution import timestamp
        timing['total_monotonic_seconds'] = (timestamp(timing['residue_completed_at']) - timestamp(timing['quiesced_at'])).total_seconds()
        timing['installation_monotonic_seconds'] = (timestamp(timing['v01_completed_at']) - timestamp(timing['installation_started_at'])).total_seconds()
        console = {}
        for ref in proof['evidence_refs']:
            if ref['kind'] != 'json':
                continue
            value = json.loads((f.project / ref['path']).read_bytes())
            if type(value) is dict and value.get('kind') in ('fresh-console-action', 'fresh-console-receipt'):
                console.setdefault(value['target']['alias'], {})[value['kind']] = (
                    value, {key: ref[key] for key in ('path', 'sha256')})
        queue_refs = []
        for row in replay_plan['network_render']['hosts']:
            action, action_ref = console[row['alias']]['fresh-console-action']
            receipt, receipt_ref = console[row['alias']]['fresh-console-receipt']
            source = {'schema_version': 1, 'operation': 'fresh-generation-console-queue',
                'binding': binding, 'alias': row['alias'], 'node': row['node'],
                'action': action_ref, 'receipt': receipt_ref,
                'provider_console_action_ref': action['provider_console_action_ref'],
                'requested_at': action['created_at'], 'started_at': action['created_at'],
                'owner_confirmed': True}
            path = 'private/completion-queue-' + row['alias'] + '.json'
            queue_refs.append({'path': path, 'sha256': f.write(path, source)})
        clock_refs = {}
        origin = timestamp(timing['quiesced_at'])
        for kind, start, end in (
                ('total', timing['quiesced_at'], timing['residue_completed_at']),
                ('installation', timing['installation_started_at'], timing['v01_completed_at'])):
            source = {'schema_version': 1, 'operation': 'fresh-generation-clock-interval',
                'binding': binding, 'kind': kind, 'observer': 'synthetic-controller',
                'clock_id': 'synthetic-monotonic-clock', 'started_at': start, 'completed_at': end,
                'started_monotonic_ns': 10**12 + round((timestamp(start) - origin).total_seconds() * 10**9),
                'completed_monotonic_ns': 10**12 + round((timestamp(end) - origin).total_seconds() * 10**9)}
            path = 'private/completion-clock-' + kind + '.json'
            clock_refs[kind] = {'path': path, 'sha256': f.write(path, source)}
        observation = {'schema_version': 1, 'operation': 'fresh-generation-timing-observation',
            'binding': binding, 'timing': timing, 'source': 'manual-console-owner-review',
            'owner_confirmed': True, 'reviewed_at': f.now.isoformat(),
            'console_queues': queue_refs, 'clock_intervals': clock_refs}
        path = 'private/completion-clock-observation.json'
        digest = f.write(path, observation)
        timing_input = {'schema_version': 1, 'operation': 'fresh-generation-timing',
            'binding': binding, 'timing': timing, 'proofs': [{'path': path, 'sha256': digest}]}
        path = 'private/completion-clock-input.json'
        digest = f.write(path, timing_input)
        prepared = cli('prepare_generation', {'run_id': f.run, 'replay_sha': replay_sha,
            'input_file': path, 'input_sha': digest})
        self.assertEqual(prepared['status'], 'generation-prepared', prepared)
        checkpoint('complete acceptance and timing index prepared')
        generation_sha = prepared['generation_sha256']
        parameters = {'run_id': f.run, 'generation_sha': generation_sha}
        replace = generation._replace
        cuts = [0]
        original_load = generation._load
        load_errors = []
        def observed_load(*args, **kwargs):
            # Preserve the actual reader and exception; explain a blocked gate
            # before the write counter without adding a semantic PASS seam.
            try:
                return original_load(*args, **kwargs)
            except Exception as error:
                detail = type(error).__name__ + ': ' + str(error)[:160]
                load_errors.append(detail)
                checkpoint('generation reader raised ' + detail)
                raise
        def fail_second(*args, **kwargs):
            cuts[0] += 1
            if cuts[0] == 2:
                raise OSError('synthetic crash after first durable state write')
            return replace(*args, **kwargs)
        with patch.object(generation, '_load', new=observed_load), \
                patch.object(generation, '_replace', side_effect=fail_second):
            self.assertEqual(cli('finalize_generation', parameters)['status'], 'blocked')
        self.assertEqual(cuts[0], 2,
            'finalize must reach the injected second-write crash; reader errors=' + repr(load_errors))
        with patch.object(generation, '_load', new=observed_load):
            status = driver.status_run(f.project, f.run, f.execution['sha256'], now=f.now, source_state=f.source)
        self.assertEqual(status['status'], 'generation-prefix', {'status': status, 'reader_errors': load_errors})
        self.assertEqual(status['prefix_length'], 1)
        self.assertFalse(status['stage_accepted'])
        self.assertFalse(status['current_authority_verified'])
        with self.assertRaises(RuntimeError):
            with ClusterLock(f.project):
                self.fail('ordinary operation admitted before durable completion')
        with patch.object(generation, '_load', new=observed_load):
            completed = cli('finalize_generation', parameters)
        self.assertEqual(completed['status'], 'completed', {'status': completed, 'reader_errors': load_errors})
        checkpoint('local prefix recovery completed')
        self.assertEqual(json.loads((f.project / generation_contract.PATHS[2]).read_bytes())['generation'], before_generation + 1)
        # Fixture source identity is the one documented synthetic seam used
        # above; ordinary consumers still run all actual proof validation.
        with patch.object(fresh_rebuild_ops, '_git_source', return_value=f.source), \
                patch.object(fresh_execution_ops, '_git_source', return_value=f.source):
            with ClusterLock(f.project):
                inventory = json.loads((f.project / generation_contract.PATHS[0]).read_bytes())
                inventory[0]['ordinary_consumer_note'] = 'legitimate later update'
                f.write(generation_contract.PATHS[0], inventory)
            with ClusterLock(f.project):
                pass
            self.assertEqual(pending_generation.inspect(f.project)['status'], 'absent')
            acceptance_path = generation.ACCEPTED + '/' + proof['context']['review']['plan']['id'] + '.json'
            raw = (f.project / acceptance_path).read_bytes()
            generation.verify_accepted_lineage(f.project, {'path': acceptance_path,
                'sha256': hashlib.sha256(raw).hexdigest()}, now=f.now, source_state=f.source)
            historical_bytes = {path: path.read_bytes() for path in (f.project / 'private').rglob('*.json')}
            remote_calls = (len(h.calls), len(transport_case.dispatches))
            real_open = os.open
            def readonly(path, flags, *args, **kwargs):
                self.assertFalse(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC))
                return real_open(path, flags, *args, **kwargs)
            with patch.object(os, 'open', new=readonly):
                status = driver.status_run(f.project, f.run, f.execution['sha256'],
                    now=f.now + timedelta(days=1), source_state=f.source)
            self.assertEqual(status['status'], 'completed', status)
            for key in ('generation_changed', 'stage_accepted', 'current_authority_verified', 'current_network_ready'):
                self.assertFalse(status[key])
            self.assertTrue(status['barrier_completed'])
            self.assertEqual(historical_bytes, {path: path.read_bytes() for path in historical_bytes})
            self.assertEqual(remote_calls, (len(h.calls), len(transport_case.dispatches)))
            # A byte drift in retained original authority poisons history and
            # ordinary admission, even after legitimate current-state changes.
            authority_path = f.project / bootstrap.AREA / f.run / 'steps/step-0/intent.json'
            original_raw = authority_path.read_bytes()
            authority_path.write_bytes(original_raw + b' ')
            with self.assertRaises(RuntimeError):
                with ClusterLock(f.project):
                    self.fail('retained raw drift admitted a controller')
            self.assertEqual(driver.status_run(f.project, f.run, f.execution['sha256'],
                now=f.now, source_state=f.source)['status'], 'blocked')
            authority_path.write_bytes(original_raw)
        self.assertEqual(json.loads((f.project / generation_contract.PATHS[2]).read_bytes())['generation'], before_generation + 1)
