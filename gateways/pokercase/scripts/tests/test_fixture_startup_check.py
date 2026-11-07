"""Pure contract/mutation tests. No subprocess, socket or gateway is executed."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import fixture_startup_check as check
import fixture_startup_walkthrough as runner


def probe(phase, binary):
    cases = []
    for name in ("port_zero", "occupied_port"):
        green = phase == "green"
        case = dict(scenario=name, layer="actual_gateway_process", http_requests=0, provider_requests=0,
                    announcements=1 if name == "port_zero" or not green else 0,
                    announced_nonzero=green if name == "port_zero" else not green,
                    endpoint_count=4 if name == "port_zero" or not green else 0,
                    endpoints_match_bound=name == "port_zero" or not green,
                    exit_before_cleanup=None if name == "port_zero" else 1, stderr_bytes=700,
                    capture_overflow=False, passed=green, owned_child_reaped=True, temporary_state_removed=True)
        if name == "occupied_port":
            case.update(foreign_connections=0, foreign_listener_preserved=True)
        cases.append(case)
    return dict(schema=1, status="passed" if phase == "green" else "failed", binary_sha256=binary,
                probe_sha256=check.PROBE_SHA256, historical_root_cause="unknown", cases=cases,
                isolation_before_launch=dict(synthetic_home_data=True, environment_cleared=True,
                    no_connections_configured=True, no_inference_refresh_discovery=True,
                    no_http_clients=True, only_loopback_bind=True))


class FixtureStartupCheckTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

        def file(name, data=b"synthetic"):
            path = self.root/name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            return dict(path=str(path), sha256=check.digest(path))

        normal = file("normal")
        native = file("native", b"native synthetic")
        inventory = ''.join(name+': test\n' for name in check.NAMES)+'\n10 tests, 0 benchmarks\n'
        self.inventory = inventory.encode()
        self.manifest = dict(schema_version=1, normal_binary=normal, native_binary=native,
            helpers={name: dict(path=str(SCRIPTS/name), sha256=check.digest(SCRIPTS/name)) for name in check.HELPERS},
            source_inputs=[file(name) for name in check.REQUIRED_INPUTS],
            source_provenance=dict(source_commit='a'*40, dirty=True), native_inventory=list(check.NAMES),
            inventory_sha256=hashlib.sha256(self.inventory).hexdigest(), case_contract=copy.deepcopy(check.CONTRACT),
            listening_probes={phase: file(phase+'.json', json.dumps(probe(phase, normal['sha256'])).encode()) for phase in ('red','green')})
        self.probes = check.verify_manifest(self.manifest)
        stream = check.EvidenceStream()
        for name in check.NAMES:
            stream.feed('stdout', ('test '+name+' ... FS_EVIDENCE '+json.dumps(check.CONTRACT[name])+'\nok\n').encode())
        stream.feed('stdout', b'test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n')
        command = dict(exit_code=0, timed_out=False, elapsed_ms=20, owned_process_reaped=True, descendant_cleanup=None)
        self.report = dict(schema_version=1, status='passed', historical_root_cause='unknown', whole_round_metrics=None,
            live_client_version_provider_verified=False, owner_personal_run_claimed=False,
            fingerprints=check.fingerprints(self.manifest), source_provenance=self.manifest['source_provenance'],
            listening_probes=self.probes, isolation=check.ISOLATION.copy(), temporary_state_removed=True, failure_code=None,
            inventory=dict(**command, output=dict(bytes=len(self.inventory), sha256=self.manifest['inventory_sha256'], overflow=False, names=list(check.NAMES))),
            native=dict(**command, output=stream.result()))

    def validate(self, report=None):
        return check.validate_report(self.report if report is None else report, self.manifest, self.probes)

    def reject(self, mutate):
        candidate = copy.deepcopy(self.report)
        mutate(candidate)
        with self.assertRaises(check.CheckFailure):
            self.validate(candidate)

    def test_positive_pure_report(self):
        with patch('subprocess.Popen', side_effect=AssertionError('no subprocess')), patch('socket.socket', side_effect=AssertionError('no socket')):
            self.assertEqual(self.validate()['scenarios'], 10)
            self.assertEqual(sorted(check.parse_inventory(self.inventory)), list(check.NAMES))

    def test_missing_duplicate_and_unexpected_events(self):
        self.reject(lambda r: r['native']['output']['events'].pop())
        self.reject(lambda r: r['native']['output']['events'].append(r['native']['output']['events'][0]))
        self.reject(lambda r: r['native']['output']['events'][0].update(secret='canary'))

    def test_wrong_layer_counter_bool_and_cleanup(self):
        for field, value in [('layer','pure_parser'), ('children',99), ('passed',1), ('owned_children_reaped',False)]:
            self.reject(lambda r, f=field, v=value: r['native']['output']['events'][0].update({f:v}))
        self.reject(lambda r: r.update(temporary_state_removed=False))
        self.reject(lambda r: next(e for e in r['native']['output']['events'] if e['scenario'] == 'fs_actual_serial_and_concurrent_ownership_cleanup').update(cross_admin_rejected=False))

    def test_pins_exit_overflow_and_claims(self):
        self.reject(lambda r: r['fingerprints'].update(normal_binary='0'*64))
        self.reject(lambda r: r['native'].update(exit_code=101))
        self.reject(lambda r: r['native'].update(timed_out=True))
        self.reject(lambda r: r['native'].update(descendant_cleanup=True))
        self.reject(lambda r: r['native']['output'].update(overflow=True))
        self.reject(lambda r: r['native']['output'].update(panic=True))
        self.reject(lambda r: r['native']['output'].update(summary_count=2))
        self.reject(lambda r: r.update(historical_root_cause='proved'))
        self.reject(lambda r: r.update(owner_personal_run_claimed=True))
        self.reject(lambda r: r.update(whole_round_metrics={'tool_calls':0}))
        self.reject(lambda r: r.update(live_client_version_provider_verified=True))

    def test_manifest_cannot_weaken_fixed_contract(self):
        candidate = copy.deepcopy(self.manifest)
        candidate['case_contract'][check.NAMES[0]]['passed'] = False
        with self.assertRaises(check.CheckFailure):
            check.verify_manifest(candidate)
        candidate = copy.deepcopy(self.manifest)
        candidate['source_inputs'].pop()
        with self.assertRaises(check.CheckFailure):
            check.verify_manifest(candidate)

    def test_binary_pin_path_and_inventory_fail_closed(self):
        for value in ('0'*64, True):
            candidate = copy.deepcopy(self.manifest)
            candidate['normal_binary']['sha256'] = value
            with self.assertRaises(check.CheckFailure):
                check.verify_manifest(candidate)
        for raw in (self.inventory+b'extra: test\n', self.inventory.replace(b'10 tests', b'9 tests'), b''):
            with self.assertRaises(check.CheckFailure):
                check.parse_inventory(raw)

    def test_probe_red_green_semantics_not_status_only(self):
        candidate = probe('green', self.manifest['normal_binary']['sha256'])
        candidate['cases'][0]['announced_nonzero'] = False
        with self.assertRaises(check.CheckFailure):
            check.validate_probe(candidate, 'green', self.manifest['normal_binary']['sha256'])
        candidate = probe('red', self.manifest['normal_binary']['sha256'])
        candidate['historical_root_cause'] = 'bind_race'
        with self.assertRaises(check.CheckFailure):
            check.validate_probe(candidate, 'red', self.manifest['normal_binary']['sha256'])

    def test_stream_chunking_duplicate_and_raw_discard(self):
        event = ('FS_EVIDENCE '+json.dumps(check.CONTRACT[check.NAMES[0]])+'\n').encode()
        stream = check.EvidenceStream()
        for byte in event:
            stream.feed('stdout', bytes([byte]))
        stream.feed('stderr', b'PRIVATE_CANARY arbitrary diagnostic\n')
        stream.feed('stdout', event)
        result = stream.result()
        self.assertTrue(result['invalid_evidence'])
        self.assertEqual(len(result['events']), 1)
        self.assertNotIn('PRIVATE_CANARY', json.dumps(result))

    def test_stream_overflow_keeps_draining(self):
        stream = check.EvidenceStream()
        for _ in range(check.MAX_OUTPUT//4096+1):
            stream.feed('stderr', b'x'*4096)
            self.assertLessEqual(len(stream.buffers['stderr']), check.MAX_LINE)
        stream.feed('stderr', b'\n')
        stream.feed('stdout', ('FS_EVIDENCE '+json.dumps(check.CONTRACT[check.NAMES[0]])+'\n').encode())
        result = stream.result()
        self.assertTrue(result['overflow'])
        self.assertEqual(len(result['events']), 1)

    def test_json_duplicate_and_nonfinite_rejected(self):
        for raw in ('{"a":1,"a":2}', '{"x":NaN}', '{"x":Infinity}'):
            with self.assertRaises(check.CheckFailure):
                check.loads(raw)

    def test_environment_does_not_inherit_credentials_or_proxy(self):
        with patch.dict('os.environ', {'HOME':'PRIVATE', 'HTTPS_PROXY':'PRIVATE', 'ANTHROPIC_API_KEY':'PRIVATE'}):
            env = runner.environment(self.root, self.manifest)
        self.assertEqual(env['HOME'], str(self.root))
        self.assertEqual(env['PATH'], '/usr/bin:/bin')
        self.assertNotIn('HTTPS_PROXY', env)
        self.assertNotIn('ANTHROPIC_API_KEY', env)
        self.assertEqual(env['THINROUTER_TEST_BINARY_SHA256'], self.manifest['normal_binary']['sha256'])

    def test_mocked_runner_order_and_report(self):
        with patch.object(runner, 'execute', side_effect=[self.report['inventory'], self.report['native']]) as execute:
            report = runner.run(self.manifest)
        self.assertEqual(report['status'], 'passed')
        self.assertEqual(execute.call_count, 2)
        self.assertEqual(execute.call_args_list[0].args[1], ['--list'])
        self.assertEqual(execute.call_args_list[1].args[1], ['--nocapture', '--test-threads=1'])
        self.assertTrue(report['temporary_state_removed'])

    def test_inventory_failure_blocks_native_execution(self):
        inv = copy.deepcopy(self.report['inventory'])
        inv['output']['names'].pop()
        with patch.object(runner, 'execute', return_value=inv) as execute:
            report = runner.run(self.manifest)
        self.assertEqual(execute.call_count, 1)
        self.assertEqual(report['failure_code'], 'inventory_gate_failed')
        self.assertIsNone(report['native'])
        self.assertTrue(report['temporary_state_removed'])

    def test_pin_failure_precedes_any_process(self):
        self.manifest['native_binary']['sha256'] = '0'*64
        with patch.object(runner, 'execute', side_effect=AssertionError('must not execute')) as execute:
            with self.assertRaises(check.CheckFailure):
                runner.run(self.manifest)
        execute.assert_not_called()

    def test_exited_leader_exception_still_kills_owned_group(self):
        for exception in (KeyboardInterrupt(), OSError('synthetic read failure')):
            with self.subTest(exception=type(exception).__name__):
                process = MagicMock(pid=812345, returncode=0)
                process.poll.return_value = 0
                selection = MagicMock()
                selection.get_map.return_value = {1: object()}
                selection.select.side_effect = exception
                with patch.object(runner.subprocess, 'Popen', return_value=process), \
                        patch.object(runner.selectors, 'DefaultSelector', return_value=selection), \
                        patch.object(runner.os, 'set_blocking'), \
                        patch.object(runner.os, 'killpg') as kill:
                    with self.assertRaises(type(exception)):
                        runner.execute('/synthetic/native', [], {'HOME':'/synthetic'})
                kill.assert_called_once_with(process.pid, runner.signal.SIGKILL)
                process.wait.assert_called_once_with(timeout=2)

    def test_exited_leader_read_and_selector_constructor_cleanup(self):
        for origin in ('read', 'constructor'):
            with self.subTest(origin=origin):
                process = MagicMock(pid=812346, returncode=0)
                process.poll.return_value = 0
                selection = MagicMock()
                selection.get_map.return_value = {1: object()}
                key = MagicMock(fileobj=process.stdout, data='stdout')
                selection.select.return_value = [(key, None)]
                with patch.object(runner.subprocess, 'Popen', return_value=process), \
                        patch.object(runner.selectors, 'DefaultSelector', return_value=selection,
                                     side_effect=OSError('constructor') if origin == 'constructor' else None), \
                        patch.object(runner.os, 'set_blocking'), \
                        patch.object(runner.os, 'read', side_effect=OSError('read')), \
                        patch.object(runner.os, 'killpg') as kill:
                    with self.assertRaises(OSError):
                        runner.execute('/synthetic/native', [], {'HOME':'/synthetic'})
                kill.assert_called_once_with(process.pid, runner.signal.SIGKILL)
                process.wait.assert_called_once_with(timeout=2)

    def test_sigterm_context_restores_prior_handler_and_cleanup_not_reinterrupted(self):
        previous = object()
        with patch.object(runner.signal, 'getsignal', return_value=previous), \
                patch.object(runner.signal, 'signal') as install:
            with runner.interrupt_signals():
                handler = install.call_args.args[1]
                with self.assertRaises(KeyboardInterrupt):
                    handler(runner.signal.SIGTERM, None)
                handler(runner.signal.SIGTERM, None)
            self.assertEqual(install.call_count, 2)
            install.assert_called_with(runner.signal.SIGTERM, previous)

    def test_sigterm_imported_run_returns_fixed_failure_and_restores_handler(self):
        previous = object()
        with patch.object(runner.signal, 'getsignal', return_value=previous), \
                patch.object(runner.signal, 'signal') as install:
            def interrupt(*_args, **_kwargs):
                install.call_args.args[1](runner.signal.SIGTERM, None)
            with patch.object(runner, 'execute', side_effect=interrupt):
                report = runner.run(self.manifest)
            install.assert_called_with(runner.signal.SIGTERM, previous)
        self.assertEqual(report['status'], 'failed')
        self.assertEqual(report['failure_code'], 'interrupted')
        self.assertTrue(report['temporary_state_removed'])

    def test_sigterm_context_restores_handler_on_exception(self):
        previous = object()
        with patch.object(runner.signal, 'getsignal', return_value=previous), \
                patch.object(runner.signal, 'signal') as install:
            with self.assertRaises(OSError):
                with runner.interrupt_signals():
                    raise OSError('synthetic')
            install.assert_called_with(runner.signal.SIGTERM, previous)

    def test_signal_context_rejects_non_main_thread_before_process(self):
        with patch.object(runner.threading, 'current_thread', return_value=object()), \
                patch.object(runner, 'execute') as execute:
            with self.assertRaisesRegex(check.CheckFailure, 'signal_context_requires_main_thread'):
                runner.run(self.manifest)
        execute.assert_not_called()


if __name__ == '__main__':
    unittest.main()
