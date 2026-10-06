"""Fixed current network probes retain raw bootstrap service phase evidence."""
import copy
import unittest
from unittest.mock import patch

from test_fresh_network_probe import NOW, fixture, sample_evidence
from test_fresh_network_probe_ssh import SyntheticProbe
import fresh_network_probe as probe


def expected_services():
    return [{s: 'active' if (i == 0 and s != 'eru-agent.service') or (i > 0 and s == 'eru-agent.service')
             else 'stopped' for s in probe.SERVICES} for i in range(4)]


class BootstrapProbeTests(unittest.TestCase):
    def test_active_services_require_explicit_exact_phase_and_preserve_raw_evidence(self):
        render, setup, _ = fixture()
        evidence = sample_evidence(render, setup)
        expected = expected_services()
        for row, states in zip(evidence['hosts'], expected):
            row['services'] = {k: 'active' if v == 'active' else 'inactive' for k, v in states.items()}
        with self.assertRaises(ValueError):
            probe.validate_network_evidence(evidence, render, NOW, setup=setup)
        original = copy.deepcopy(evidence)
        actual = probe.validate_network_evidence(evidence, render, NOW, setup=setup, expected_services=expected)
        self.assertEqual(actual, original)
        self.assertEqual(evidence, original)
        wrong = copy.deepcopy(expected)
        wrong[2]['eru-agent.service'] = 'stopped'
        with self.assertRaises(ValueError):
            probe.validate_network_evidence(evidence, render, NOW, setup=setup, expected_services=wrong)

    def test_unknown_role_service_bool_and_missing_phase_are_rejected(self):
        render, setup, _ = fixture()
        evidence = sample_evidence(render, setup)
        for change in (lambda s: s.pop(), lambda s: s[0].update({'eru-agent.service': 'active'}),
                       lambda s: s[1].update({'etcd.service': 'active'}),
                       lambda s: s[1].update({'eru-agent.service': True}),
                       lambda s: s[0].update({'foreign.service': 'stopped'})):
            states = [{key: 'stopped' for key in probe.SERVICES} for _ in range(4)]
            change(states)
            with self.subTest(change=change), self.assertRaises(ValueError):
                probe.validate_network_evidence(evidence, render, NOW, setup=setup, expected_services=states)

    def test_actual_fixed_bundle_checks_started_services_and_rogue_processes(self):
        env = SyntheticProbe()
        self.addCleanup(env.close)
        expected = expected_services()
        original = env.run
        rogue = [False]
        def phase_run(index, argv, limit, timeout, **kw):
            if argv[0] == '/usr/bin/systemctl':
                state = expected[index][argv[-1]]
                return (b'LoadState=loaded\nActiveState=active\nSubState=running\n' if state == 'active'
                        else b'LoadState=loaded\nActiveState=inactive\nSubState=dead\n')
            if argv[0] == '/usr/bin/ps':
                tasks = [unit.removesuffix('.service') for unit, state in expected[index].items() if state == 'active']
                if rogue[0] and index == 1:
                    tasks.append('etcd')
                return ('init\n'+'\n'.join(tasks)+'\n').encode()
            return original(index, argv, limit, timeout, **kw)
        env.run = phase_run
        result = probe.collect_network_evidence(env.render, env.keys, setup=env.setup,
            transport=env.transport, runner=env.runner, now=NOW, expected_services=expected)
        self.assertEqual(result['hosts'][0]['services']['etcd.service'], 'active')
        self.assertEqual(result['hosts'][3]['services']['eru-agent.service'], 'active')
        self.assertEqual(len(env.transports), 4)
        rogue[0] = True
        with self.assertRaises(ValueError):
            probe.collect_network_evidence(env.render, env.keys, setup=env.setup,
                transport=env.transport, runner=env.runner, now=NOW, expected_services=expected)
