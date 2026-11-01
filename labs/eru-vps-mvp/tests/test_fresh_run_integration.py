"""Moving-clock public CLI/driver mainline; temp roots and fake firewall only."""
from contextlib import redirect_stdout
from datetime import timedelta
import io
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import labctl
import fresh_run_ops as ops
import fresh_network_ready_ops as ready
import pending_generation
from labops import ClusterLock
import test_fresh_network_ready_ops as fixture
from test_fresh_run_authority_integration import renewal


class FreshRunIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.f = fixture.NetworkReadyTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        f = self.f
        self.project, self.source, self.original = f.project, f.source, f.now
        self.run, self.plan = f.f.run, f.f.plan
        self.execution = self.plan['execution_sha256']
        self.helper = SimpleNamespace(project=f.project, now=f.now, f=f.f.f,
            plan=self.plan, run=self.run, auth=f.f.auth)
        self.sequence = 0
        self.pending = pending_generation.inspect(self.project)
        self.cluster = (self.project/'private/operations/cluster.json').read_bytes()
        self.adapters = {'prepare_network_directory': f.fw.d.adapter,
            'stage_network_files': f.f.adapter, 'activate_network_firewall': f.fw,
            'accept_network_ready': f.collector,
            'reconcile_network_directory': ops.ObservationOnly(f.fw.d.adapter.observe)}

    def advance(self, hours):
        self.f.now = self.original + timedelta(hours=hours)
        self.f.f.now = self.f.now
        self.helper.now = self.f.now

    def authorization(self, operation):
        f = self.f
        paths = {'prepare_network_directory': f.fw.d.authpath,
                 'stage_network_files': f.f.authpath,
                 'activate_network_firewall': f.fw.authpath,
                 'prepare_network_manual_setup': f.authpath}
        doc = json.loads((self.project/paths[operation]).read_text())
        doc.update(authorized_at=f.now.isoformat(), expires_at=(f.now+timedelta(minutes=15)).isoformat())
        self.sequence += 1
        path = 'private/current-operation-'+str(self.sequence)+'.json'
        return path, f.write(path, doc)

    def parameters(self, operation, index=None):
        path, digest = self.authorization(operation)
        if operation == 'prepare_network_manual_setup':
            return {'plan_id': self.plan['id'], 'plan_sha': self.plan['sha256'],
                'authorization_file': path, 'authorization_sha': digest,
                'input_file': self.f.inputpath, 'input_sha': self.f.inputsha}
        return {'plan_id': self.plan['id'], 'expected_sha': self.plan['sha256'],
            'authorization_file': path, 'authorization_sha': digest, 'host_index': index}

    def request(self, operation, target):
        ref = renewal(self.helper, operation, target, at=self.f.now, ref_only=True)
        document = {'schema_version': 1, 'operation': 'fresh-run-step', 'run_id': self.run,
            'execution_sha256': self.execution, 'pending_sha256': self.pending['sha256'],
            'step': operation, 'parameters': target, 'renewal': ref}
        self.sequence += 1
        path = 'private/run-step-'+str(self.sequence)+'.json'
        return path, self.f.write(path, document)

    def invoke(self, operation, target, *, recover=False):
        path, digest = self.request(operation, target)
        command = 'recover' if recover else 'next'
        api_name = 'recover_run' if recover else 'next_step'
        original_api = getattr(ops, api_name)
        def actual(*args):
            return original_api(*args, now=lambda: self.f.now, source_state=self.source, adapters=self.adapters)
        output = io.StringIO()
        with patch.object(labctl, 'PROJECT', self.project), \
                patch.object(ops, api_name, side_effect=actual), \
                patch.object(labctl, 'Operator', side_effect=AssertionError('legacy dispatch')), \
                patch('sys.argv', ['labctl', 'fresh-run', command, '--run', self.run,
                    '--sha256', self.execution, '--input', path, '--input-sha256', digest]), redirect_stdout(output):
            labctl.main()
        result = json.loads(output.getvalue())
        self.assertNotIn('PRIVATE-SENTINEL', output.getvalue())
        return result

    def test_hours_long_mainline_then_next_day_history(self):
        self.advance(1)
        prepared = self.invoke('prepare_network_manual_setup', self.parameters('prepare_network_manual_setup'))
        self.assertEqual(prepared['status'], 'manual-setup-prepared', prepared)
        for index in range(4):
            self.advance(2+index)
            for operation, expected in [('prepare_network_directory', 'prepared'), ('stage_network_files', 'staged')]:
                result = self.invoke(operation, self.parameters(operation, index))
                self.assertEqual(result['status'], expected, result)
        for index in range(4):
            self.advance(6+index)
            result = self.invoke('activate_network_firewall', self.parameters('activate_network_firewall', index))
            self.assertEqual(result['status'], 'firewall-active', result)
        intent = json.loads((self.project/ready.MANUAL_AREA/self.run/'intent.json').read_text())['intent']
        # Console work happened inside its original short authorization; idle
        # waiting before recording is not misreported as an authorized action.
        completed = self.original+timedelta(hours=1)
        owner = {'schema_version': 1, 'operation': 'fresh-network-manual-setup-receipt',
            'intent_sha256': prepared['intent_sha256'], 'owner_confirmed': True,
            'hosts': [{'action': action, 'started_at': completed.isoformat(),
                'completed_at': completed.isoformat(), 'owner_confirmed': True} for action in intent['actions']]}
        owner_path = 'private/owner-completed.json'
        owner_sha = self.f.write(owner_path, owner)
        self.advance(10)
        recorded = self.invoke('record_network_manual_setup', {'run_id': self.run,
            'expected_intent_sha': prepared['intent_sha256'], 'receipt_file': owner_path, 'receipt_sha': owner_sha})
        self.assertEqual(recorded['status'], 'manual-setup-recorded', recorded)
        self.advance(11)
        result = self.invoke('accept_network_ready', {'run_id': self.run,
            'expected_manual_receipt_sha': recorded['manual_receipt_sha256']})
        self.assertEqual(result['status'], 'network-ready', result)
        self.assertEqual(self.f.collect_calls, 1)
        receipt_path = self.project/ready.AREA/self.run/'receipt.json'
        before = receipt_path.read_bytes()
        self.advance(35)
        history = ops.status_run(self.project, self.run, self.execution, now=lambda:self.f.now, source_state=self.source)
        self.assertEqual(history['status'], 'network-history-verified', history)
        self.assertTrue(history['historical_integrity'])
        self.assertFalse(history['current_network_ready'])
        self.assertFalse(history['stage_accepted'])
        self.assertEqual(self.f.collect_calls, 1)
        self.assertEqual(before, receipt_path.read_bytes())
        self.assertEqual(self.pending, pending_generation.inspect(self.project))
        self.assertEqual(self.cluster, (self.project/'private/operations/cluster.json').read_bytes())
        with self.assertRaises(RuntimeError):
            with ClusterLock(self.project):
                self.fail('ordinary mutation admitted pending generation')

    def test_lost_reply_recovery_has_observation_only_capability(self):
        self.advance(1)
        self.f.fw.d.lose = True
        target = self.parameters('prepare_network_directory', 0)
        result = self.invoke('prepare_network_directory', target)
        self.assertEqual(result['status'], 'uncertain', result)
        self.assertTrue(result['dispatch_attempted'])
        calls = list(self.f.fw.d.calls)
        repeated = self.invoke('prepare_network_directory', target)
        self.assertEqual(repeated['status'], 'uncertain', repeated)
        self.assertEqual(self.f.fw.d.calls, calls)
        self.advance(2)
        recovered = self.invoke('reconcile_network_directory', {'run_id': self.run,
            'host_index': 0, 'expected_intent_sha': result['intent_sha256']}, recover=True)
        self.assertEqual(recovered['status'], 'prepared', recovered)
        self.assertFalse(recovered['remote_mutation_performed'])
        self.assertEqual(self.f.fw.d.calls[len(calls):], [('directory', 'observe', 0)])
        self.assertEqual(self.f.fw.d.calls.count(('directory', 'prepare', 0)), 1)
        self.assertFalse(hasattr(self.adapters['reconcile_network_directory'], 'prepare'))
        receipt = self.project/'private/operations/fresh-rebuild/network-directory'/self.run/'host-0/receipt.json'
        before = receipt.read_bytes()
        self.f.fw.d.lose = False
        successor = self.invoke('prepare_network_directory', self.parameters('prepare_network_directory', 1))
        self.assertEqual(successor['status'], 'prepared', successor)
        self.assertEqual(receipt.read_bytes(), before)
        self.assertEqual(self.f.fw.d.calls.count(('directory', 'prepare', 0)), 1)
