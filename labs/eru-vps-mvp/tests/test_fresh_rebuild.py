"""Offline safety regressions for the ERU-015 fresh-cluster review plan."""
from contextlib import redirect_stderr, redirect_stdout
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import copy
import hashlib
from io import StringIO
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))

import fresh_rebuild
import fresh_rebuild_ops
from fresh_rebuild_ops import save_review_plan
import labctl


class FreshRebuildPlanTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.project = Path(temporary.name) / 'eru-vps-mvp'
        self.project.mkdir()
        self.private = self.project / 'private'
        self.private.mkdir()
        self.now = datetime(2026, 9, 27, 12, 0, tzinfo=timezone.utc)
        self.sentinel = 'PRIVATE-TOPOLOGY-SENTINEL'

        (self.project / 'scripts').mkdir()
        (self.project / 'scripts/fixture.py').write_text('# fixture\n')
        (self.project / 'patches').mkdir()
        self.write_json('artifacts.amd64.lock.json', {'architecture': 'linux/amd64'})
        self.write_json('upstream.lock.json', {'source': 'pinned'})
        self.write_json('patches/core-v0.1.5-lock-context.validation.json', {'release': 'pinned'})
        self.write_json('private/verified-host-public-keys.json', {})

        self.inventory = [
            {
                'alias': f'ckc-disposable-{index:02d}',
                'node': f'worker-{index}',
                'role': 'core' if index == 1 else 'worker',
                'ip': f'192.0.2.{index}',
            }
            for index in range(1, 5)
        ]
        self.write_json('private/deployment-plan.json', self.inventory)
        self.write_json('private/operations/cluster.json', {
            'cluster_id': 'eru-vps-mvp', 'generation': 7,
        })
        self.write_json('private/preflight/host-fixture.json', {'reviewed': True})

        self.report_path = 'private/controller-preflight/controller.json'
        self.report = {
            'schema': 1,
            'checked_at': self.now.isoformat(),
            'source': {'commit': 'a' * 40, 'project_clean': True},
            'locks': {
                'artifact_sha256': self.file_sha('artifacts.amd64.lock.json'),
                'upstream_sha256': self.file_sha('upstream.lock.json'),
                'core_validation_sha256': self.file_sha(
                    'patches/core-v0.1.5-lock-context.validation.json'),
            },
            'private_inputs': {'deployment-plan.json': True},
            'blockers': [],
            'ready_for_review': True,
        }
        self.write_json(self.report_path, self.report)

        self.host_refs = []
        for index, row in enumerate(self.inventory, 1):
            relative = f'private/reimage-intents/host-{index}.json'
            intent = {
                'schema_version': 1,
                'provider_api_used': False,
                'provider_resource_ref': f'provider-{self.sentinel}-{index}',
                'os_image_ref': 'debian-12-pinned-image',
                'target': {
                    'alias': row['alias'], 'node': row['node'],
                    'machine_id': f'machine-{self.sentinel}-{index}',
                },
                'erase_scope': {
                    'boot_volume_ref': f'boot-volume-{self.sentinel}-{index}',
                    'additional_volume_refs': [f'data-volume-{self.sentinel}-{index}'],
                },
                'reviewed_at': self.now.isoformat(),
            }
            self.write_json(relative, intent)
            self.host_refs.append({
                'alias': row['alias'], 'node': row['node'], 'path': relative,
                'sha256': self.file_sha(relative),
            })

        self.input_path = 'private/fresh-rebuild-intents/rebuild.json'
        self.document = {
            'schema_version': 1,
            'mode': 'fresh',
            'topology_profile': 'profile-a-four-host-basic',
            'series': {
                'id': 'v08-campaign', 'required_successes': 3, 'iteration': 1,
                'previous_accepted_run': None,
            },
            'expected_cluster': {'cluster_id': 'eru-vps-mvp', 'generation': 7},
            'controller_report': {
                'path': self.report_path, 'sha256': self.file_sha(self.report_path),
            },
            'inventory': {
                'path': 'private/deployment-plan.json',
                'sha256': self.file_sha('private/deployment-plan.json'),
            },
            'host_intents': self.host_refs,
            'fresh_etcd': {
                'mode': 'new-empty', 'restore_source': None,
                'prior_token_sha256': '1' * 64,
                'target_token_sha256': '2' * 64,
            },
            'external_materials': {
                name: {'available': True, 'evidence_sha256': hashlib.sha256(name.encode()).hexdigest()}
                for name in fresh_rebuild.MATERIALS
            },
            'desired_apps': [self.app('cache-a', 'worker-2'), self.app('cache-b', 'worker-3')],
            'writer_quiescence_review': {
                'confirmed': True, 'reviewed_at': self.now.isoformat(),
                'evidence_sha256': '3' * 64,
            },
            'data_disposition_review': {
                'confirmed_discardable': True, 'reviewed_at': self.now.isoformat(),
                'evidence_sha256': '4' * 64,
            },
        }
        self.write_input()

    def app(self, name, node):
        return {
            'schema_version': 1,
            'name': name,
            'image': 'registry.example.invalid/cache@sha256:' + 'b' * 64,
            'node': node,
            'replicas': 1,
            'entrypoint': 'web',
            'command': ['serve', '--marker', 'APP-COMMAND-' + self.sentinel],
            'restart': 'always',
            'resources': {'cpu': 1, 'memory': '64MiB', 'storage': '128MiB'},
            'network': 'eru',
            'service': {
                'port': 8080, 'path': '/health', 'expected_status': 200,
                'body_contains': 'BODY-' + self.sentinel,
            },
            'stateless': True,
        }

    def write_json(self, relative, value):
        path = self.project / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')

    def file_sha(self, relative):
        return hashlib.sha256((self.project / relative).read_bytes()).hexdigest()

    def write_input(self):
        self.write_json(self.input_path, self.document)

    def rewrite_report(self):
        self.write_json(self.report_path, self.report)
        self.document['controller_report']['sha256'] = self.file_sha(self.report_path)
        self.write_input()

    def rewrite_host(self, index, intent):
        relative = self.host_refs[index]['path']
        self.write_json(relative, intent)
        self.document['host_intents'][index]['sha256'] = self.file_sha(relative)
        self.write_input()

    def load_host(self, index):
        return json.loads((self.project / self.host_refs[index]['path']).read_text())

    def save(self, plan_id='fresh-review-1', source_state=None):
        return save_review_plan(
            self.project, self.input_path, plan_id, now=self.now,
            source_state=source_state or self.report['source'])

    def output_path(self, plan_id):
        return self.private / 'operations/fresh-rebuild/review-plans' / (plan_id + '.json')

    def test_valid_fresh_intent_creates_non_executable_next_generation_review_plan(self):
        cluster_before = (self.project / 'private/operations/cluster.json').read_bytes()
        input_before = (self.project / self.input_path).read_bytes()
        with patch.object(labctl, 'Operator', side_effect=AssertionError('remote operator used')):
            envelope, path = self.save()
        plan = envelope['plan']
        self.assertEqual(path.as_posix(),
                         'private/operations/fresh-rebuild/review-plans/fresh-review-1.json')
        self.assertEqual(plan['generation_before'], 7)
        self.assertEqual(plan['generation_after'], 8)
        self.assertEqual(plan['mode'], 'fresh')
        self.assertEqual(plan['fresh_policy']['etcd_mode'], 'new-empty')
        self.assertFalse(plan['fresh_policy']['restore_allowed'])
        self.assertEqual(plan['scope']['host_count'], 4)
        self.assertEqual(len(plan['desired_apps']), 2)
        self.assertEqual(plan['decision'], 'reviewable')
        self.assertFalse(plan['executable'])
        self.assertFalse(plan['execution_implemented'])
        self.assertFalse(plan['remote_mutation_performed'])
        self.assertEqual(plan['checks_not_performed'], ['V01', 'V02', 'V03', 'V04', 'V08'])
        self.assertEqual(
            [stage['stage'] for stage in plan['stages']],
            ['controller-ready', 'scope-reviewed', 'writers-quiesced',
             'generation-started', 'hosts-reimaged', 'network-and-access-ready',
             'empty-control-plane', 'cluster-bootstrapped', 'apps-replayed',
             'resources-accepted', 'residue-audited', 'generation-accepted'])
        self.assertTrue(all(stage['evidence_status'] == 'checks_not_performed'
                            and stage['required_evidence']
                            and not stage['implemented'] and not stage['executable']
                            for stage in plan['stages']))
        self.assertEqual(envelope['sha256'], fresh_rebuild.plan_digest(plan))
        self.assertEqual((self.project / 'private/operations/cluster.json').read_bytes(), cluster_before)
        self.assertEqual((self.project / self.input_path).read_bytes(), input_before)

    def test_restore_semantics_and_reused_etcd_token_are_rejected(self):
        original = copy.deepcopy(self.document)
        cases = [
            ('mode', lambda d: d.update(mode='restore')),
            ('restore-source', lambda d: d['fresh_etcd'].update(restore_source='snapshot.db')),
            ('existing-metadata', lambda d: d['fresh_etcd'].update(mode='restore-existing')),
            ('reused-token', lambda d: d['fresh_etcd'].update(target_token_sha256='1' * 64)),
        ]
        for label, change in cases:
            with self.subTest(label=label):
                self.document = copy.deepcopy(original)
                change(self.document)
                self.write_input()
                with self.assertRaisesRegex(ValueError, 'fresh|restore|token'):
                    self.save('fresh-' + label)

    def test_inventory_generation_and_host_order_drift_fail_closed(self):
        self.document['expected_cluster']['generation'] = 8
        self.write_input()
        with self.assertRaisesRegex(ValueError, 'current cluster'):
            self.save('generation-drift')
        self.assertFalse(self.output_path('generation-drift').exists())

        self.document['expected_cluster']['generation'] = 7
        self.document['host_intents'][0], self.document['host_intents'][1] = (
            self.document['host_intents'][1], self.document['host_intents'][0])
        self.write_input()
        with self.assertRaisesRegex(ValueError, 'four-host topology'):
            self.save('host-order-drift')

    def test_raw_inventory_extensions_are_hash_bound_but_not_public_scope(self):
        inventory = json.loads((self.project / 'private/deployment-plan.json').read_text())
        for row in inventory:
            row['private_region'] = 'REGION-' + self.sentinel
        self.write_json('private/deployment-plan.json', inventory)
        self.document['inventory']['sha256'] = self.file_sha('private/deployment-plan.json')
        self.write_input()
        plan = self.save('inventory-extension')[0]['plan']
        self.assertEqual(
            plan['bindings']['inventory']['sha256'],
            self.file_sha('private/deployment-plan.json'))
        self.assertNotIn('private_region', json.dumps(plan['scope']))

    def test_duplicate_provider_and_volume_scopes_are_rejected(self):
        first = self.load_host(0)
        second = self.load_host(1)
        second['provider_resource_ref'] = first['provider_resource_ref']
        self.rewrite_host(1, second)
        with self.assertRaisesRegex(ValueError, 'provider resource references'):
            self.save('duplicate-provider')

        second['provider_resource_ref'] = 'provider-second-restored'
        second['erase_scope']['boot_volume_ref'] = first['erase_scope']['boot_volume_ref']
        self.rewrite_host(1, second)
        with self.assertRaisesRegex(ValueError, 'volume references'):
            self.save('duplicate-volume')

    def test_wildcard_scope_stale_intent_and_mixed_os_are_rejected(self):
        intent = self.load_host(0)
        intent['provider_resource_ref'] = '*'
        self.rewrite_host(0, intent)
        with self.assertRaisesRegex(ValueError, 'exact'):
            self.save('wildcard-provider')

        intent['provider_resource_ref'] = 'provider-core-restored'
        intent['reviewed_at'] = (self.now - timedelta(days=31)).isoformat()
        self.rewrite_host(0, intent)
        with self.assertRaisesRegex(ValueError, '30 days'):
            self.save('stale-host-intent')

        intent['reviewed_at'] = self.now.isoformat()
        intent['os_image_ref'] = 'different-os-image'
        self.rewrite_host(0, intent)
        with self.assertRaisesRegex(ValueError, 'same reviewed OS image'):
            self.save('mixed-os')

    def test_invalid_or_duplicate_desired_apps_are_rejected(self):
        self.document['desired_apps'][0]['image'] = 'unpinned:latest'
        self.write_input()
        with self.assertRaisesRegex(ValueError, 'pinned'):
            self.save('unpinned-app')

        self.document['desired_apps'][0] = self.app('cache-a', 'worker-2')
        self.document['desired_apps'][1] = self.app('cache-a', 'worker-3')
        self.write_input()
        with self.assertRaisesRegex(ValueError, 'logical names'):
            self.save('duplicate-app')

    def test_unavailable_review_prerequisites_save_a_blocked_non_executable_plan(self):
        self.document['external_materials']['bootstrap_secrets']['available'] = False
        self.document['writer_quiescence_review']['confirmed'] = False
        self.write_input()
        envelope, _ = self.save('blocked-review')
        plan = envelope['plan']
        self.assertEqual(plan['decision'], 'blocked')
        self.assertFalse(plan['executable'])
        self.assertTrue(any('external material' in item for item in plan['blockers']))
        self.assertTrue(any('quiescence' in item for item in plan['blockers']))

    def test_stale_controller_report_and_current_lock_drift_fail_closed(self):
        self.report['checked_at'] = (self.now - timedelta(days=2)).isoformat()
        self.rewrite_report()
        with self.assertRaisesRegex(ValueError, 'review window'):
            self.save('stale-controller')

        self.report['checked_at'] = self.now.isoformat()
        self.rewrite_report()
        self.write_json('artifacts.amd64.lock.json', {'architecture': 'changed'})
        with self.assertRaisesRegex(ValueError, 'lock bindings'):
            self.save('lock-drift')

    @patch('fresh_generation_ops.verify_accepted_lineage')
    def test_series_metadata_requires_immediate_accepted_predecessor(self, verify_lineage):
        # This test isolates campaign metadata checks. Full sealed lineage is
        # required by production and covered by completion guard/integration.
        first = self.save('previous-run')[0]
        acceptance_path = 'private/operations/fresh-rebuild/accepted-runs/previous-run.json'
        acceptance = {
            'schema_version': 1,
            'operation': 'full-cluster-fresh-rebuild-acceptance',
            'status': 'accepted',
            'plan_id': 'previous-run',
            'plan_sha256': first['sha256'],
            'cluster_id': 'eru-vps-mvp',
            'generation': 8,
            'series_id': 'v08-campaign',
            'iteration': 1,
            'checks': {name: 'passed' for name in fresh_rebuild.ACCEPTANCE_CHECKS},
            'rto': {
                'total_seconds': 1810, 'provider_queue_seconds': 400,
                'installation_seconds': 1410, 'candidate_seconds': 1800,
            },
            'evidence_index_sha256': '6' * 64,
        }
        self.write_json(acceptance_path, acceptance)
        self.write_json('private/operations/cluster.json', {
            'cluster_id': 'eru-vps-mvp', 'generation': 8,
        })
        self.document['expected_cluster']['generation'] = 8
        self.document['fresh_etcd'].update(
            prior_token_sha256='2' * 64, target_token_sha256='7' * 64)
        self.document['series'].update(
            iteration=2,
            previous_accepted_run={
                'id': 'previous-run', 'plan_sha256': first['sha256'], 'generation': 8,
                'acceptance': {
                    'path': acceptance_path, 'sha256': self.file_sha(acceptance_path),
                },
            })
        self.write_input()
        plan = self.save('series-second')[0]['plan']
        self.assertEqual(plan['series']['iteration'], 2)
        self.assertEqual(plan['acceptance']['required_consecutive_successes'], 3)
        self.assertIn('V08', plan['checks_not_performed'])

        self.document['series']['previous_accepted_run']['plan_sha256'] = '5' * 64
        self.write_input()
        with self.assertRaisesRegex(ValueError, 'immediate campaign predecessor'):
            self.save('series-fabricated')

        self.document['series']['previous_accepted_run']['plan_sha256'] = first['sha256']
        acceptance['checks']['V04'] = 'failed'
        self.write_json(acceptance_path, acceptance)
        self.document['series']['previous_accepted_run']['acceptance']['sha256'] = self.file_sha(
            acceptance_path)
        self.write_input()
        with self.assertRaisesRegex(ValueError, 'required fresh-rebuild gates'):
            self.save('series-unaccepted')

        acceptance['checks']['V04'] = 'passed'
        self.write_json(acceptance_path, acceptance)
        self.document['series']['previous_accepted_run']['acceptance']['sha256'] = self.file_sha(
            acceptance_path)
        self.document['desired_apps'][0]['command'].append('--campaign-drift')
        self.write_input()
        with self.assertRaisesRegex(ValueError, 'campaign version, scope or desired manifests'):
            self.save('series-manifest-drift')

        self.document['desired_apps'][0]['command'].pop()
        previous_path = self.output_path('previous-run')
        previous_envelope = json.loads(previous_path.read_text())
        previous_envelope['plan']['decision'] = 'blocked'
        previous_envelope['plan']['blockers'] = ['synthetic prior blocker']
        previous_envelope['sha256'] = fresh_rebuild.plan_digest(previous_envelope['plan'])
        previous_path.write_text(json.dumps(previous_envelope))
        acceptance['plan_sha256'] = previous_envelope['sha256']
        self.write_json(acceptance_path, acceptance)
        self.document['series']['previous_accepted_run']['plan_sha256'] = previous_envelope['sha256']
        self.document['series']['previous_accepted_run']['acceptance']['sha256'] = self.file_sha(
            acceptance_path)
        self.write_input()
        with self.assertRaisesRegex(ValueError, 'was not reviewable'):
            self.save('series-blocked-predecessor')

    def test_current_git_source_must_still_match_clean_controller_preflight(self):
        with self.assertRaisesRegex(ValueError, 'changed after preflight'):
            self.save('dirty-source', source_state={
                'commit': self.report['source']['commit'], 'project_clean': False,
            })
        with self.assertRaisesRegex(ValueError, 'changed after preflight'):
            self.save('changed-commit', source_state={
                'commit': 'b' * 40, 'project_clean': True,
            })

    def test_private_input_rejects_outside_nested_symlink_and_duplicate_json(self):
        outside = self.project / 'outside.json'
        outside.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'project private'):
            save_review_plan(
                self.project, outside, 'outside', now=self.now,
                source_state=self.report['source'])

        nested = self.private / 'fresh-rebuild-intents/nested/rebuild.json'
        nested.parent.mkdir()
        nested.write_bytes((self.project / self.input_path).read_bytes())
        with self.assertRaisesRegex(ValueError, 'exact private directory'):
            save_review_plan(
                self.project, nested, 'nested', now=self.now,
                source_state=self.report['source'])

        linked = self.private / 'fresh-rebuild-intents/linked.json'
        linked.symlink_to(self.project / self.input_path)
        with self.assertRaisesRegex(ValueError, 'symlinks'):
            save_review_plan(
                self.project, linked, 'linked', now=self.now,
                source_state=self.report['source'])

        duplicate = self.private / 'fresh-rebuild-intents/duplicate.json'
        duplicate.write_text('{"schema_version":1,"schema_version":1}')
        with self.assertRaisesRegex(ValueError, 'duplicate field'):
            save_review_plan(
                self.project, duplicate, 'duplicate-json', now=self.now,
                source_state=self.report['source'])

        nonstandard = self.private / 'fresh-rebuild-intents/nonstandard.json'
        nonstandard.write_text('{"schema_version": 1, "elapsed": NaN}')
        with self.assertRaisesRegex(ValueError, 'non-standard number'):
            save_review_plan(
                self.project, nonstandard, 'nonstandard-json', now=self.now,
                source_state=self.report['source'])

    def test_trusted_private_root_symlink_is_supported_but_record_overwrite_is_not(self):
        backing = self.project / 'private-backing'
        self.private.rename(backing)
        self.private.symlink_to(backing, target_is_directory=True)
        envelope, _ = self.save('symlink-root')
        self.assertEqual(envelope['plan']['decision'], 'reviewable')

        with self.assertRaisesRegex(FileExistsError, 'fresh plan ID'):
            self.save('symlink-root')
        target = self.output_path('record-symlink-target')
        target.parent.mkdir(parents=True, exist_ok=True)
        harmless = backing / 'harmless.json'
        harmless.write_text('{}')
        target.symlink_to(harmless)
        with self.assertRaisesRegex(ValueError, 'may not be a symlink'):
            self.save('record-symlink-target')

    def test_concurrent_same_plan_id_has_one_immutable_winner(self):
        def attempt():
            try:
                return self.save('concurrent-plan')[0]
            except FileExistsError:
                return None

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _index: attempt(), range(2)))
        self.assertEqual(sum(result is not None for result in results), 1)
        saved = json.loads(self.output_path('concurrent-plan').read_text())
        self.assertEqual(saved, next(result for result in results if result is not None))

    def test_hash_is_stable_for_same_plan_and_changes_on_material_spec_drift(self):
        first, _ = self.save('stable-plan')
        self.output_path('stable-plan').unlink()
        second, _ = self.save('stable-plan')
        self.assertEqual(first, second)

        self.output_path('stable-plan').unlink()
        self.document['desired_apps'][0]['command'].append('--changed')
        self.write_input()
        changed, _ = self.save('stable-plan')
        self.assertNotEqual(first['sha256'], changed['sha256'])
        self.assertNotEqual(
            first['plan']['desired_apps_sha256'], changed['plan']['desired_apps_sha256'])

    def test_cli_output_is_count_digest_only_and_does_not_register_an_executor(self):
        # The CLI takes the wall clock; pin it to the fixture time so the 1-day review window holds.
        clock_patch = patch.object(fresh_rebuild_ops, 'datetime')
        clock = clock_patch.start()
        self.addCleanup(clock_patch.stop)
        clock.now.return_value = self.now
        stdout = StringIO()
        stderr = StringIO()
        argv = ['labctl.py', 'plan-fresh-rebuild', '--input', self.input_path,
                '--plan-id', 'cli-redaction']
        with patch.object(labctl, 'PROJECT', self.project), patch.object(sys, 'argv', argv), \
                patch.object(fresh_rebuild_ops, '_git_source', return_value=self.report['source']), \
                redirect_stdout(stdout), redirect_stderr(stderr):
            labctl.main()
        output = stdout.getvalue() + stderr.getvalue()
        for private in [
                self.sentinel, 'ckc-disposable-01', '192.0.2.1',
                str(self.project), 'debian-12-pinned-image', 'cache-a']:
            self.assertNotIn(private, output)
        summary = json.loads(stdout.getvalue())
        self.assertEqual(summary['host_count'], 4)
        self.assertEqual(summary['desired_app_count'], 2)
        self.assertFalse(summary['executable'])
        self.assertFalse(summary['execution_implemented'])
        self.assertEqual(stderr.getvalue(), '')
        self.assertNotIn('execute-fresh-rebuild', output)

        self.document['external_materials']['provider_console_access']['available'] = False
        self.write_input()
        blocked_out, blocked_err = StringIO(), StringIO()
        blocked_argv = ['labctl.py', 'plan-fresh-rebuild', '--input', self.input_path,
                        '--plan-id', 'cli-blocked-redaction']
        with patch.object(labctl, 'PROJECT', self.project), \
                patch.object(sys, 'argv', blocked_argv), \
                patch.object(fresh_rebuild_ops, '_git_source', return_value=self.report['source']), \
                redirect_stdout(blocked_out), redirect_stderr(blocked_err):
            labctl.main()
        blocked = blocked_out.getvalue() + blocked_err.getvalue()
        self.assertNotIn(self.sentinel, blocked)
        self.assertEqual(json.loads(blocked_out.getvalue())['decision'], 'blocked')
        self.assertEqual(blocked_err.getvalue(), '')

        with patch.object(labctl, 'PROJECT', self.project), \
                patch.object(sys, 'argv', blocked_argv), \
                patch.object(fresh_rebuild_ops, '_git_source', return_value=self.report['source']), \
                self.assertRaisesRegex(FileExistsError, 'use a fresh plan ID') as raised:
            labctl.main()
        self.assertNotIn(self.sentinel, str(raised.exception))


if __name__ == '__main__':
    unittest.main()
