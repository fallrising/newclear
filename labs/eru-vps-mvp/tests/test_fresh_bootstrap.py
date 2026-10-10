"""Strict local bootstrap contracts; no host commands are executed."""
import copy
from datetime import datetime, timezone, timedelta
import unittest

import fresh_bootstrap as contract
from fresh_rebuild import plan_digest


class BootstrapContractTests(unittest.TestCase):
    def test_fixed_steps_and_strict_index(self):
        self.assertEqual(len(contract.STEPS), 22)
        self.assertEqual(contract.STEPS[2], ('empty-accept', 0, None))
        self.assertEqual(contract.STEPS[5], ('pod-create', 0, None))
        self.assertEqual(contract.STEPS[-1], ('cluster-accept', 0, None))
        for value in (True, -1, 22, '0'):
            with self.assertRaises(ValueError):
                contract.step_index(value)

    def test_authority_exact_operation_and_interval(self):
        now = datetime(2026, 10, 6, tzinfo=timezone.utc)
        expected = {'plan_id':'network', 'plan_sha256':'1'*64,
                    'execution_sha256':'2'*64, 'pending_sha256':'3'*64,
                    'bootstrap_sha256':'4'*64, 'step_index':0}
        auth = {'schema_version':1, 'operation':'fresh-bootstrap-authorization',
                **expected, 'scope':'fresh-bootstrap-one-step-only', 'owner_confirmed':True,
                'authorized_at':now.isoformat(), 'expires_at':(now+timedelta(minutes=15)).isoformat()}
        contract.authorization(auth, expected, now)
        for key, value in [('schema_version',True), ('step_index',True), ('owner_confirmed',1),
                           ('bootstrap_sha256','5'*64), ('scope','all-steps')]:
            bad = {**auth,key:value}
            with self.assertRaises(ValueError):
                contract.authorization(bad, expected, now)
        with self.assertRaises(ValueError):
            contract.authorization(auth, expected, now+timedelta(minutes=15))

    def test_service_expectations_are_phase_specific(self):
        self.assertEqual(contract.expected_services(0)[0]['etcd.service'], 'stopped')
        self.assertEqual(contract.expected_services(2)[0]['etcd.service'], 'active')
        self.assertEqual(contract.expected_services(5)[0]['eru-core.service'], 'active')
        self.assertEqual(contract.expected_services(9)[1]['eru-agent.service'], 'stopped')
        self.assertEqual(contract.expected_services(10)[1]['eru-agent.service'], 'active')
        self.assertEqual(contract.expected_services(21)[3]['eru-agent.service'], 'active')
