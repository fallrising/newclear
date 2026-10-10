"""Independent adversarial contracts for local execution preparation."""
from datetime import timedelta
from contextlib import redirect_stdout, redirect_stderr
from io import StringIO
import sys
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import test_fresh_execution as fixtures
import fresh_execution_ops as ops
import fresh_rebuild
import pending_generation
from reimage_review import load_intent


class FreshExecutionReviewTests(unittest.TestCase):
    def fixture(self):
        fixture = fixtures.FreshExecutionTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        return fixture

    def reservation(self, fixture, envelope):
        binding = envelope['execution']['binding']
        return {**{key: binding[key] for key in (
            'cluster_id', 'run_id', 'generation_before', 'target_generation',
            'review_sha256', 'scope_sha256')},
            'execution_sha256': envelope['sha256'],
            'cluster_sha256': envelope['execution']['cluster_sha256'],
            'fence_sha256': envelope['execution']['evidence']['writer_fence']['sha256']}

    def rewrite_review(self, fixture, plan):
        fixture.review = {'plan': plan, 'sha256': fresh_rebuild.plan_digest(plan)}
        fixture.fixture.write_json(
            'private/operations/fresh-rebuild/review-plans/' + plan['id'] + '.json',
            fixture.review)
        fixture.binding.update(review_sha256=fixture.review['sha256'],
            scope_sha256=plan['scope']['scope_sha256'],
            generation_before=plan['generation_before'],
            target_generation=plan['generation_after'])
        fixture.write_evidence()

    def test_rehashed_alternate_cluster_cannot_replace_current_generation(self):
        case = self.fixture()
        f = case.fixture
        f.document['expected_cluster']['generation'] = 8
        f.write_input()
        alternate = 'private/operations/shadow-cluster.json'
        cluster = {'cluster_id': 'eru-vps-mvp', 'generation': 8}
        f.write_json(alternate, cluster)
        bindings = copy.deepcopy(case.review['plan']['bindings'])
        bindings['fresh_input']['sha256'] = f.file_sha(f.input_path)
        bindings['cluster_record'] = {'path': alternate, 'sha256': f.file_sha(alternate)}
        hosts = [load_intent(case.project, ref['path'], node=ref['node'],
            alias=ref['alias'], machine_id=f.load_host(index)['target']['machine_id'],
            now=case.now) for index, ref in enumerate(f.host_refs)]
        plan = fresh_rebuild.build_plan(f.document, inventory=f.inventory,
            cluster=cluster, host_intents=hosts, controller_report=f.report,
            bindings=bindings, plan_id=case.review['plan']['id'], now=case.now)
        self.rewrite_review(case, plan)
        with self.assertRaises((ValueError, RuntimeError)):
            case.prepare()
        self.assertEqual(json.loads((case.project / 'private/operations/cluster.json').read_text())['generation'], 7)
        self.assertFalse((case.project / ops.AREA / case.run).exists())

    def test_forged_rehashed_review_scope_is_not_authority(self):
        case = self.fixture()
        plan = copy.deepcopy(case.review['plan'])
        plan['scope']['hosts'][0]['provider_resource_ref'] = 'forged-resource'
        plan['scope']['scope_sha256'] = fresh_rebuild.plan_digest(plan['scope']['hosts'])
        self.rewrite_review(case, plan)
        with self.assertRaises((ValueError, RuntimeError)):
            case.prepare()
        self.assertFalse((case.project / ops.AREA / case.run).exists())

    def test_expired_pending_record_is_blocked_without_repair_or_release(self):
        case = self.fixture()
        envelope, path = case.prepare()
        pending_generation.reserve(case.project, self.reservation(case, envelope))
        before = {str(p.relative_to(case.project)): p.read_bytes()
            for p in (case.project / 'private').rglob('*') if p.is_file()}
        with patch.object(ops, 'ClusterLock', side_effect=AssertionError('inspect acquired admission')):
            result = case.inspect(envelope['sha256'], now=case.now + timedelta(minutes=16))
        self.assertEqual(result['status'], 'blocked')
        self.assertFalse(result['executable'])
        after = {str(p.relative_to(case.project)): p.read_bytes()
            for p in (case.project / 'private').rglob('*') if p.is_file()}
        self.assertEqual(before, after)
        self.assertEqual(pending_generation.inspect(case.project)['status'], 'pending')

    def test_every_reservation_binding_mismatch_blocks_observation(self):
        changes = {'run_id': 'other-run', 'fence_sha256': 'e' * 64,
            'execution_sha256': 'd' * 64, 'scope_sha256': 'c' * 64,
            'review_sha256': 'b' * 64, 'cluster_sha256': 'a' * 64}
        for field, value in changes.items():
            with self.subTest(field=field):
                case = self.fixture()
                envelope, _ = case.prepare()
                binding = self.reservation(case, envelope)
                binding[field] = value
                pending_generation.reserve(case.project, binding)
                self.assertEqual(case.inspect(envelope['sha256'])['status'], 'blocked')
        case = self.fixture()
        envelope, _ = case.prepare()
        binding = self.reservation(case, envelope)
        binding.update(generation_before=8, target_generation=9)
        pending_generation.reserve(case.project, binding)
        self.assertEqual(case.inspect(envelope['sha256'])['status'], 'blocked')

    def test_future_attestations_never_publish_preparation(self):
        for kind in ('writer_fence', 'host_baseline', 'external_materials', 'owner_authorization'):
            with self.subTest(kind=kind):
                case = self.fixture()
                field = 'issued_at' if kind == 'owner_authorization' else 'observed_at'
                case.evidence[kind][field] = (case.now + timedelta(seconds=1)).isoformat()
                case.write_evidence()
                with self.assertRaises((ValueError, RuntimeError)):
                    case.prepare()
                self.assertFalse((case.project / ops.AREA / case.run).exists())

    def test_unknown_crash_entry_blocks_without_deleting_bytes(self):
        case = self.fixture()
        envelope, relative = case.prepare()
        extra = (case.project / relative).parent / '.execution.tmp'
        extra.write_bytes(b'incomplete-private-publication')
        extra.chmod(0o600)
        with patch.object(ops, 'ClusterLock', side_effect=AssertionError('inspect acquired admission')):
            self.assertEqual(case.inspect(envelope['sha256'])['status'], 'blocked')
        self.assertEqual(extra.read_bytes(), b'incomplete-private-publication')
        with self.assertRaises((ValueError, FileExistsError, RuntimeError)):
            case.prepare()

    def test_material_bytes_and_source_drift_block_saved_preparation(self):
        for label in ('material', 'source'):
            with self.subTest(label=label):
                case = self.fixture()
                envelope, relative = case.prepare()
                sealed = (case.project / relative).read_bytes()
                if label == 'material':
                    material = next(iter(case.evidence['external_materials']['materials'].values()))
                    target = case.project / material['path']
                else:
                    target = case.project / 'scripts/fixture.py'
                target.write_bytes(target.read_bytes() + b'drift')
                self.assertEqual(case.inspect(envelope['sha256'])['status'], 'blocked')
                self.assertEqual((case.project / relative).read_bytes(), sealed)

    def test_real_cli_observes_pending_without_remote_or_private_output(self):
        import labctl
        case = self.fixture()
        envelope, _ = case.prepare()
        pending_generation.reserve(case.project, self.reservation(case, envelope))
        before = {str(p): p.read_bytes() for p in (case.project / 'private').rglob('*') if p.is_file()}
        output, errors = StringIO(), StringIO()
        with patch.object(labctl, 'PROJECT', case.project), \
                patch.object(labctl, 'Operator', side_effect=AssertionError('remote operator')), \
                patch.object(ops, '_git_source', return_value=case.fixture.report['source']), \
                patch.object(ops, 'datetime') as clock, \
                patch.object(sys, 'argv', ['labctl.py', 'inspect-fresh-execution',
                    '--run', case.run, '--sha256', envelope['sha256']]), \
                redirect_stdout(output), redirect_stderr(errors):
            clock.now.return_value = case.now
            labctl.main()
        self.assertEqual(json.loads(output.getvalue())['status'], 'reserved')
        self.assertEqual(errors.getvalue(), '')
        for private in (case.fixture.sentinel, str(case.project), '192.0.2.1',
                        'provider-', 'boot-volume-', 'machine-', 'cache-a'):
            self.assertNotIn(private, output.getvalue())
        after = {str(p): p.read_bytes() for p in (case.project / 'private').rglob('*') if p.is_file()}
        self.assertEqual(before, after)

    def test_host_duplicate_boot_identity_is_rejected_before_publication(self):
        case = self.fixture()
        hosts = case.evidence['host_baseline']['hosts']
        hosts[1]['boot_id_sha256'] = hosts[0]['boot_id_sha256']
        case.write_evidence()
        with self.assertRaises(ValueError):
            case.prepare()
        self.assertFalse((case.project / ops.AREA / case.run).exists())


if __name__ == '__main__':
    unittest.main()
