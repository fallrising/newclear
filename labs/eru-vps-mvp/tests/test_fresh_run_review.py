"""Independent adversarial checks for the public fresh-run pre-access boundary.

All inputs live in temporary synthetic roots; collection uses the fixture reader.
"""
import copy
from datetime import timedelta
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))

import fresh_network_access_ops as access_ops
import fresh_replacement_ops as replacement_ops
import fresh_run_ops as run_ops
from fresh_rebuild import plan_digest
import test_fresh_network_access_review as fixture


class FreshRunIndependentReview(unittest.TestCase):
    def setUp(self):
        self.f = fixture.NetworkAccessIndependentReview()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.project = self.f.project
        self.run = self.f.f.f.r.run
        self.execution_sha = self.f.f.execution['sha256']
        self.pending_sha = self.f.f.pending_sha
        self.source = self.f.source
        self.now = self.f.now + timedelta(hours=1)
        self.f.now = self.f.f.now = self.f.f.f.now = self.now
        self.serial = 0

    def write(self, label, value):
        self.serial += 1
        path = 'private/review-' + label + '-' + str(self.serial) + '.json'
        digest = self.f.f.f.r.write(path, value)
        self.f.f.f.r.f.secure()
        return {'path': path, 'sha256': digest}

    def step(self, operation, target, *, authority_target=None, adapters=None):
        binding = {'run_id': self.run, 'execution_sha256': self.execution_sha,
                   'pending_sha256': self.pending_sha, 'plan_id': None,
                   'plan_sha256': None, 'operation': operation,
                   'target_sha256': plan_digest(authority_target or target)}
        isolation = {'schema_version': 1, 'kind': 'fresh-run-step-isolation',
            'binding': binding, 'observed_at': self.now.isoformat(),
            'other_controllers_stopped': True, 'ci_writers_stopped': True,
            'app_writers_stopped': True,
            'old_hosts': copy.deepcopy(self.f.f.isolation['old_hosts'])}
        fence = {'schema_version': 1, 'kind': 'fresh-run-step-fence',
            'binding': binding, 'observed_at': self.now.isoformat(),
            'active': True, 'controller_count': 1, 'in_flight_writers': 0,
            'prior_fence': self.f.f.execution['execution']['evidence']['writer_fence'],
            'isolation': self.write('isolation', isolation)}
        renewal = {'schema_version': 1, 'kind': 'fresh-run-step-renewal',
            'authority': 'owner', 'approved': True, 'owner_confirmed': True,
            'binding': binding, 'target': authority_target or target,
            'admission_request': None, 'writer_fence': self.write('fence', fence),
            'issued_at': self.now.isoformat(),
            'expires_at': (self.now + timedelta(minutes=15)).isoformat(),
            'manual_authorizations': []}
        request = {'schema_version': 1, 'operation': 'fresh-run-step',
            'run_id': self.run, 'execution_sha256': self.execution_sha,
            'pending_sha256': self.pending_sha, 'step': operation,
            'parameters': target, 'renewal': self.write('renewal', renewal)}
        ref = self.write('step', request)
        return run_ops.next_step(self.project, self.run, self.execution_sha,
            ref['path'], ref['sha256'], now=lambda: self.now,
            source_state=self.source, adapters=adapters)

    def test_old_replacement_cannot_create_new_plan_until_driver_collects_fresh_facts(self):
        plan = {'run_id': self.run, 'execution_sha': self.execution_sha,
            'input_file': self.f.path, 'input_sha': self.f.sha,
            'plan_id': 'review-late-plan'}
        old = self.step('prepare_network_access', plan)
        self.assertEqual(old['status'], 'blocked', old)
        self.assertFalse((self.project / access_ops.AREA / plan['plan_id']).exists())

        collection = {'run_id': self.run, 'execution_sha': self.execution_sha,
            'input_file': self.f.f.f.path, 'input_sha': self.f.f.f.input_sha,
            'observation_id': 'review-fresh-replacement'}
        calls = len(self.f.f.f.calls)
        observed = self.step('collect_replacement_facts', collection,
            adapters={'collect_replacement_facts': self.f.f.f.reader})
        self.assertEqual(observed['status'], 'observed', observed)
        self.assertEqual(len(self.f.f.f.calls), calls + 4)

        admission = self.f.f
        admission.observation = observed
        admission.binding['replacement_sha256'] = observed['sha256']
        admission.auth['binding'] = copy.deepcopy(admission.binding)
        admission.isolation['binding'] = copy.deepcopy(admission.binding)
        admission.fence['binding'] = copy.deepcopy(admission.binding)
        admission.document['binding'] = copy.deepcopy(admission.binding)
        admission.document['replacement_observation'] = admission.ref(
            replacement_ops.AREA + '/' + observed['id'] + '/observation.json')
        admission.auth['issued_at'] = admission.fence['observed_at'] = self.now.isoformat()
        admission.auth['expires_at'] = (self.now + timedelta(minutes=15)).isoformat()
        admission.isolation['observed_at'] = self.now.isoformat()
        admission.save()
        reviewed = admission.inspect(now=self.now)
        self.assertEqual(reviewed['status'], 'prerequisites-reviewed', reviewed)
        self.f.document['binding'] = copy.deepcopy(admission.binding)
        self.f.document['admission_request'] = admission.ref(admission.path)
        self.f.document['admission_sha256'] = reviewed['sha256']
        self.f.save()
        plan['input_sha'] = self.f.sha
        planned = self.step('prepare_network_access', plan)
        self.assertEqual(planned['status'], 'planned', planned)
        self.assertTrue((self.project / access_ops.AREA / plan['plan_id'] / 'plan.json').exists())

    def test_forged_renewal_target_cannot_reach_replacement_reader(self):
        target = {'run_id': self.run, 'execution_sha': self.execution_sha,
            'input_file': self.f.f.f.path, 'input_sha': self.f.f.f.input_sha,
            'observation_id': 'review-intended-observation'}
        forged = {**target, 'observation_id': 'review-foreign-observation'}
        calls = len(self.f.f.f.calls)
        result = self.step('collect_replacement_facts', target, authority_target=forged,
            adapters={'collect_replacement_facts': self.f.f.f.reader})
        self.assertEqual(result['status'], 'blocked', result)
        self.assertEqual(len(self.f.f.f.calls), calls)
        self.assertFalse((self.project / replacement_ops.AREA / target['observation_id']).exists())

    def test_status_does_not_call_filename_count_journal_integrity(self):
        directory = (self.project / 'private/operations/fresh-rebuild'
                     / 'network-directory' / self.run / 'host-0')
        directory.mkdir(parents=True, mode=0o700)
        for name in ('intent.json', 'receipt.json'):
            path = directory / name
            path.write_bytes(b'not a valid immutable journal')
            path.chmod(0o600)
        result = run_ops.status_run(self.project, self.run, self.execution_sha,
                                    now=self.now, source_state=self.source)
        self.assertEqual(result['status'], 'reserved', result)
        self.assertTrue(result['execution_integrity_verified'])
        self.assertFalse(result['journal_integrity_verified'])
        self.assertFalse(result['current_network_ready'])
        self.assertEqual(result['journal_receipt_count'], 1)


if __name__ == '__main__':
    unittest.main()
