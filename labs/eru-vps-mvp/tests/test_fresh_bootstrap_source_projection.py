"""Pinned CLI protobuf omission behavior through real bootstrap evidence."""
import base64
import copy
import json
import unittest

import fresh_bootstrap_host as host
from fresh_bootstrap_render import canonical
import test_fresh_bootstrap_host as bootstrap_hosts


class BootstrapSourceProjectionTests(unittest.TestCase):
    def test_omitted_false_bypass_and_invalid_explicit_values(self):
        fixture = bootstrap_hosts.HostTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.through_core()
        fixture.runner.nodes = [
            {'name': row['node'], **{key: copy.deepcopy(row[key]) for key in
                ('podname', 'endpoint', 'resource_capacity', 'labels')},
                'available': True, 'bypass': False}
            for row in fixture.render['workers']]
        observation = fixture.call(21, observe=True)
        command = next(row for row in observation['evidence']['commands']
            if row['argv'][-3:] == ['pod', 'nodes', 'eru'])
        nodes = json.loads(base64.b64decode(command['stdout_base64']))
        for node in nodes:
            node.pop('bypass', None)
            if type(node['resource_capacity']) is dict:
                node['resource_capacity'] = canonical(node['resource_capacity']).decode()
        command['stdout_base64'] = base64.b64encode(canonical(nodes)).decode()
        facts = host.validate_evidence(fixture.action(21), observation)
        self.assertEqual([row['bypass'] for row in facts['workers']], [False] * 3)
        for value in (None, 0, 'false'):
            with self.subTest(value=value):
                forged = copy.deepcopy(observation)
                row = next(row for row in forged['evidence']['commands']
                    if row['argv'][-3:] == ['pod', 'nodes', 'eru'])
                invalid = copy.deepcopy(nodes)
                invalid[0]['bypass'] = value
                row['stdout_base64'] = base64.b64encode(canonical(invalid)).decode()
                with self.assertRaises(ValueError):
                    host.validate_evidence(fixture.action(21), forged)

    def test_registered_node_omits_false_available_before_agent_start(self):
        fixture = bootstrap_hosts.HostTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.through_core()
        index = host.STEPS.index('worker-register')
        observation = fixture.call(index)
        self.assertEqual(observation['state'], 'complete')
        self.assertFalse(fixture.runner.nodes[0]['available'])
        command = next(row for row in observation['evidence']['commands']
            if row['argv'][-3:] == ['pod', 'nodes', 'eru'])
        nodes = json.loads(base64.b64decode(command['stdout_base64']))
        self.assertEqual(len(nodes), 1)
        nodes[0].pop('available', None)
        if type(nodes[0]['resource_capacity']) is dict:
            nodes[0]['resource_capacity'] = canonical(nodes[0]['resource_capacity']).decode()
        command['stdout_base64'] = base64.b64encode(canonical(nodes)).decode()
        facts = host.validate_evidence(fixture.action(index), observation)
        self.assertEqual(facts['workers'][0]['available'], False)
        self.assertEqual(facts['workers'][0]['bypass'], True)
        for value in (None, 0, 'false'):
            with self.subTest(value=value):
                forged = copy.deepcopy(observation)
                row = next(row for row in forged['evidence']['commands']
                    if row['argv'][-3:] == ['pod', 'nodes', 'eru'])
                invalid = copy.deepcopy(nodes)
                invalid[0]['available'] = value
                row['stdout_base64'] = base64.b64encode(canonical(invalid)).decode()
                with self.assertRaises(ValueError):
                    host.validate_evidence(fixture.action(index), forged)
