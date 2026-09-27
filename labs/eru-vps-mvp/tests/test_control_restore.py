"""Offline safety regressions for ERU-016 control-metadata restore review plans."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stderr, redirect_stdout
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

import control_restore
import control_restore_ops
from control_restore_ops import save_review_plan
import labctl


class ControlRestorePlanTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.project = Path(temporary.name) / 'eru-vps-mvp'
        self.project.mkdir()
        self.private = self.project / 'private'
        self.private.mkdir()
        self.now = datetime(2026, 9, 27, 12, 0, tzinfo=timezone.utc)
        self.sentinel = 'RESTORE-PRIVATE-SENTINEL'
        self.source_state = {'commit': 'a' * 40, 'project_clean': True}

        (self.project / 'scripts').mkdir()
        (self.project / 'scripts/fixture.py').write_text('# fixture\n')
        (self.project / 'patches').mkdir()
        self.write_json('artifacts.amd64.lock.json', {
            'architecture': 'linux/amd64',
            'artifacts': [{
                'repository': 'etcd-io/etcd', 'tag': 'v3.6.14',
                'sha256': '1' * 64,
            }],
        })
        self.write_json('upstream.lock.json', {'source': 'pinned'})
        self.write_json(
            'patches/core-v0.1.5-lock-context.validation.json', {'release': 'pinned'})
        self.write_json('private/verified-host-public-keys.json', {})
        (self.private / 'preflight').mkdir()

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

        self.report_path = 'private/controller-preflight/controller.json'
        self.report = {
            'schema': 1, 'checked_at': self.now.isoformat(),
            'source': self.source_state,
            'locks': {
                'artifact_sha256': self.file_sha('artifacts.amd64.lock.json'),
                'upstream_sha256': self.file_sha('upstream.lock.json'),
                'core_validation_sha256': self.file_sha(
                    'patches/core-v0.1.5-lock-context.validation.json'),
            },
            'private_inputs': {'deployment-plan.json': True},
            'blockers': [], 'ready_for_review': True,
        }
        self.write_json(self.report_path, self.report)

        self.source_path = 'private/control-restore-sources/source.json'
        source_nodes = [
            {
                'name': f'worker-{index}', 'podname': 'eru',
                'endpoint_sha256': hashlib.sha256(
                    f'endpoint-{self.sentinel}-{index}'.encode()).hexdigest(),
                'available': True, 'bypass': False,
                'labels_sha256': hashlib.sha256(f'labels-{index}'.encode()).hexdigest(),
                'resource_capacity_sha256': hashlib.sha256(
                    f'capacity-{index}'.encode()).hexdigest(),
                'resource_usage_sha256': hashlib.sha256(
                    f'usage-{index}'.encode()).hexdigest(),
            }
            for index in range(2, 5)
        ]
        source_workloads = [
            {
                'id': f'workload-{self.sentinel}-{index}',
                'nodename': f'worker-{index + 2}', 'podname': 'eru',
                'image_sha256': hashlib.sha256(f'image-{index}'.encode()).hexdigest(),
                'labels_sha256': hashlib.sha256(
                    f'workload-labels-{index}'.encode()).hexdigest(),
            }
            for index in range(2)
        ]
        runtime_workers = [
            {
                'node': f'worker-{index}',
                'containers_sha256': hashlib.sha256(
                    f'containers-{index}'.encode()).hexdigest(),
                'tasks_sha256': hashlib.sha256(f'tasks-{index}'.encode()).hexdigest(),
            }
            for index in range(2, 5)
        ]
        plugin_accounts = [
            {
                'plugin': 'resource-storage', 'node': f'worker-{index}',
                'capacity_sha256': hashlib.sha256(
                    f'plugin-capacity-{index}'.encode()).hexdigest(),
                'usage_sha256': hashlib.sha256(
                    f'plugin-usage-{index}'.encode()).hexdigest(),
            }
            for index in range(2, 5)
        ]
        membership = {'nodes': source_nodes, 'workloads': source_workloads}
        source_etcd_members = [{
            'host_alias': 'ckc-disposable-01', 'node': 'worker-1',
            'member_id_sha256': '1' * 64, 'name_sha256': '2' * 64,
            'peer_url_sha256': '3' * 64, 'client_url_sha256': '4' * 64,
            'data_dir_sha256': '5' * 64,
        }]
        self.source = {
            'schema_version': 1, 'operation': 'control-source-snapshot',
            'cluster_id': 'eru-vps-mvp', 'generation': 7,
            'topology_profile': 'profile-a-four-host-basic',
            'captured_at': (self.now - timedelta(minutes=12)).isoformat(),
            'member_set_sha256': control_restore.sha256_bytes(
                control_restore.canonical_bytes(source_etcd_members)),
            'cluster_id_sha256': '3' * 64,
            'token_sha256': '4' * 64,
            'data_dirs_sha256': control_restore.sha256_bytes(
                control_restore.canonical_bytes(['5' * 64])),
            'runtime_snapshot_sha256': control_restore.sha256_bytes(
                control_restore.canonical_bytes(runtime_workers)),
            'node_workload_snapshot_sha256': control_restore.sha256_bytes(
                control_restore.canonical_bytes(membership)),
            'plugin_accounting_sha256': control_restore.sha256_bytes(
                control_restore.canonical_bytes(plugin_accounts)),
            'worker_count': 3, 'workload_count': 2,
            'etcd_members': source_etcd_members,
            'eru_membership': membership, 'runtime_workers': runtime_workers,
            'plugin_accounts': plugin_accounts,
        }
        self.write_json(self.source_path, self.source)

        self.snapshot_path = 'private/control-metadata-snapshots/snapshot.db'
        snapshot = self.project / self.snapshot_path
        snapshot.parent.mkdir(parents=True)
        snapshot.write_bytes(('full-etcd-snapshot-' + self.sentinel).encode())
        self.snapshot_sha = self.file_sha(self.snapshot_path)
        self.snapshot_size = snapshot.stat().st_size

        self.status_path = 'private/control-restore-status/status.json'
        self.status = {
            'schema_version': 1, 'operation': 'etcdutl-snapshot-status',
            'snapshot_sha256': self.snapshot_sha, 'snapshot_hash': 'deadbeef',
            'revision': 4321, 'total_keys': 37,
            'total_size_bytes': self.snapshot_size,
            'checked_at': (self.now - timedelta(minutes=7)).isoformat(),
            'etcdutl_sha256': 'c' * 64,
        }
        self.write_json(self.status_path, self.status)

        self.catalog_path = 'private/backup-catalog/receipt.json'
        self.catalog = {
            'schema_version': 1,
            'operation': 'external-snapshot-catalog-receipt',
            'snapshot_sha256': self.snapshot_sha,
            'object_sha256': self.snapshot_sha,
            'object_id_sha256': 'd' * 64,
            'encrypted': True,
            'retained_until': (self.now + timedelta(days=90)).isoformat(),
            'restore_read_test_evidence_sha256': 'e' * 64,
            'recorded_at': (self.now - timedelta(minutes=6)).isoformat(),
        }
        self.write_json(self.catalog_path, self.catalog)

        self.trust_index = {
            'schema_version': 1, 'operation': 'control-restore-trust-index',
            'status_receipts': [{
                'receipt_sha256': self.file_sha(self.status_path),
                'snapshot_sha256': self.snapshot_sha,
                'source_cluster_snapshot_sha256': self.file_sha(self.source_path),
                'source_endpoint_evidence_sha256': '0' * 64,
                'capture_method': 'etcdctl-snapshot-save',
                'full_keyspace': True,
                'etcdutl_sha256': 'c' * 64,
            }],
            'catalog_receipts': [{
                'receipt_sha256': self.file_sha(self.catalog_path),
                'snapshot_sha256': self.snapshot_sha,
                'object_sha256': self.snapshot_sha,
                'object_id_sha256': 'd' * 64,
            }],
            'toolchains': [{
                'etcd_version': 'v3.6.14',
                'artifact_release_sha256': '1' * 64,
                'etcd_sha256': 'a' * 64, 'etcdctl_sha256': 'b' * 64,
                'etcdutl_sha256': 'c' * 64,
            }],
            'core_key_records': [{
                'recovery_mode': 'restore-verified-external-key',
                'evidence_sha256': 'b' * 64,
                'revoke_set_sha256': 'c' * 64,
            }],
        }
        self.write_json('control-restore-trust.json', self.trust_index)
        self.report['locks']['restore_trust_sha256'] = self.file_sha(
            'control-restore-trust.json')
        self.write_json(self.report_path, self.report)

        members = [{
            'host_alias': 'ckc-disposable-01', 'node': 'worker-1',
            'name_sha256': 'f' * 64, 'peer_url_sha256': '9' * 64,
            'client_url_sha256': 'a' * 64, 'data_dir_sha256': 'b' * 64,
        }]
        initial_cluster = control_restore.sha256_bytes(
            control_restore.canonical_bytes(members))
        watch_consumers = [
            {'name': 'eru-agent', 'restart_required': True,
             'evidence_sha256': '0' * 64},
            {'name': 'eru-core', 'restart_required': True,
             'evidence_sha256': '1' * 64},
            {'name': 'resource-storage', 'restart_required': True,
             'evidence_sha256': '2' * 64},
        ]
        self.input_path = 'private/restore-control-intents/restore.json'
        self.document = {
            'schema_version': 1, 'mode': 'restore-control',
            'topology_profile': 'profile-a-four-host-basic',
            'expected_cluster': {'cluster_id': 'eru-vps-mvp', 'generation': 7},
            'controller_report': self.binding(self.report_path),
            'inventory': self.binding('private/deployment-plan.json'),
            'cluster_record': self.binding('private/operations/cluster.json'),
            'source_cluster_snapshot': self.binding(self.source_path),
            'snapshot': {
                'path': self.snapshot_path, 'sha256': self.snapshot_sha,
                'size_bytes': self.snapshot_size,
                'capture_method': 'etcdctl-snapshot-save', 'full_keyspace': True,
                'capture_started_at': (self.now - timedelta(minutes=10)).isoformat(),
                'capture_completed_at': (self.now - timedelta(minutes=8)).isoformat(),
                'source_endpoint_evidence_sha256': '0' * 64,
                'status_evidence': self.binding(self.status_path),
                'toolchain': {
                    'etcd_version': 'v3.6.14',
                    'artifact_release_sha256': '1' * 64,
                    'etcd_sha256': 'a' * 64, 'etcdctl_sha256': 'b' * 64,
                    'etcdutl_sha256': 'c' * 64, 'verified': True,
                },
                'external_copy': {
                    'catalog_receipt': self.binding(self.catalog_path),
                    'object_id_sha256': 'd' * 64,
                    'object_sha256': self.snapshot_sha, 'encrypted': True,
                    'retained_until': (self.now + timedelta(days=90)).isoformat(),
                    'restore_read_test_evidence_sha256': 'e' * 64,
                },
            },
            'writer_quiescence': {
                'confirmed': True,
                'quiesced_at': (self.now - timedelta(minutes=11)).isoformat(),
                'in_flight_zero': True, 'writer_set_sha256': '1' * 64,
                'evidence_sha256': '2' * 64,
            },
            'old_control_plane': {
                'source_member_set_sha256': self.source['member_set_sha256'],
                'source_cluster_id_sha256': self.source['cluster_id_sha256'],
                'source_token_sha256': self.source['token_sha256'],
                'source_data_dirs_sha256': self.source['data_dirs_sha256'],
                'isolation_confirmed': True,
                'isolated_at': (self.now - timedelta(minutes=5)).isoformat(),
                'evidence_sha256': '3' * 64,
            },
            'target_etcd': {
                'members': members, 'initial_cluster_sha256': initial_cluster,
                'target_token_sha256': '6' * 64,
                'target_data_dirs_sha256': control_restore.sha256_bytes(
                    control_restore.canonical_bytes(['b' * 64])),
            },
            'revision_policy': {
                'mode': 'bump-and-mark-compacted', 'bump_revision': 1000000,
                'mark_compacted': True,
                'basis': {
                    'snapshot_revision': 4321,
                    'estimated_write_rate_per_second': 25,
                    'maximum_restore_window_seconds': 1800,
                    'calculated_minimum_bump': 45001,
                    'evidence_sha256': '8' * 64,
                },
                'watch_consumers': watch_consumers,
                'client_restart_set_sha256': control_restore.sha256_bytes(
                    control_restore.canonical_bytes(watch_consumers)),
            },
            'retained_workers': {
                'worker_count': 3,
                'inventory_sha256': self.file_sha('private/deployment-plan.json'),
                'runtime_snapshot_sha256': self.source['runtime_snapshot_sha256'],
                'node_workload_snapshot_sha256': self.source['node_workload_snapshot_sha256'],
                'plugin_accounting_sha256': self.source['plugin_accounting_sha256'],
            },
            'reconciliation': {
                'expected_etcd_membership_sha256': initial_cluster,
                'expected_eru_membership_sha256': self.source[
                    'node_workload_snapshot_sha256'],
                'expected_runtime_sha256': self.source['runtime_snapshot_sha256'],
                'expected_plugin_accounting_sha256': self.source['plugin_accounting_sha256'],
                'expected_http_sha256': 'a' * 64,
                'core_key_recovery_mode': 'restore-verified-external-key',
                'core_key_available': True,
                'core_key_evidence_sha256': 'b' * 64,
                'core_key_revoke_set_sha256': 'c' * 64,
            },
            'objectives': {
                'rpo_candidate_seconds': 900,
                'outage_cutoff_at': (self.now - timedelta(minutes=2)).isoformat(),
                'protected_through_at': (self.now - timedelta(minutes=8)).isoformat(),
                'rto_candidate_seconds': 1800,
                'rto_start_definition_sha256': 'c' * 64,
                'rto_end_definition_sha256': 'd' * 64,
            },
            'evidence_store': {
                'available': True, 'encrypted': True,
                'retention_policy_sha256': 'e' * 64,
                'evidence_sha256': 'f' * 64,
            },
            'application_volume_restore': False,
        }
        self.write_input()

    def write_json(self, relative, value):
        path = self.project / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')

    def file_sha(self, relative):
        return hashlib.sha256((self.project / relative).read_bytes()).hexdigest()

    def binding(self, relative):
        return {'path': relative, 'sha256': self.file_sha(relative)}

    def write_input(self):
        self.write_json(self.input_path, self.document)

    def save(self, plan_id='restore-review-1'):
        return save_review_plan(
            self.project, self.input_path, plan_id, now=self.now,
            source_state=self.source_state,
            committed_trust_sha256=self.file_sha('control-restore-trust.json'))

    def output_path(self, plan_id):
        return self.private / 'operations/restore-control/review-plans' / (plan_id + '.json')

    def rewrite_status(self):
        self.write_json(self.status_path, self.status)
        self.document['snapshot']['status_evidence'] = self.binding(self.status_path)
        self.write_input()

    def rewrite_catalog(self):
        self.write_json(self.catalog_path, self.catalog)
        self.document['snapshot']['external_copy']['catalog_receipt'] = self.binding(
            self.catalog_path)
        self.write_input()

    def rewrite_source(self):
        self.write_json(self.source_path, self.source)
        self.document['source_cluster_snapshot'] = self.binding(self.source_path)
        self.write_input()

    def test_valid_full_snapshot_creates_non_executable_review_plan(self):
        cluster_before = (self.project / 'private/operations/cluster.json').read_bytes()
        input_before = (self.project / self.input_path).read_bytes()
        snapshot_before = (self.project / self.snapshot_path).read_bytes()
        with patch.object(labctl, 'Operator', side_effect=AssertionError('remote operator used')):
            envelope, path = self.save()
        plan = envelope['plan']
        self.assertEqual(
            path.as_posix(),
            'private/operations/restore-control/review-plans/restore-review-1.json')
        self.assertEqual(plan['operation'], 'control-metadata-restore-review-plan')
        self.assertEqual(plan['mode'], 'restore-control')
        self.assertEqual((plan['generation_before'], plan['generation_after']), (7, 8))
        self.assertEqual(plan['decision'], 'reviewable')
        self.assertFalse(plan['executable'])
        self.assertFalse(plan['execution_implemented'])
        self.assertFalse(plan['remote_mutation_performed'])
        self.assertFalse(plan['application_volume_restore'])
        self.assertEqual(plan['snapshot']['status']['revision'], 4321)
        self.assertEqual(plan['snapshot']['status']['total_keys'], 37)
        self.assertEqual(plan['snapshot']['source']['sha256'], self.snapshot_sha)
        self.assertEqual(len(plan['target_etcd']['members']), 1)
        self.assertTrue(all(
            not stage['implemented'] and not stage['executable']
            and stage['evidence_status'] == 'checks_not_performed'
            for stage in plan['stages']))
        self.assertEqual(envelope['sha256'], control_restore.plan_digest(plan))
        self.assertEqual((self.project / 'private/operations/cluster.json').read_bytes(), cluster_before)
        self.assertEqual((self.project / self.input_path).read_bytes(), input_before)
        self.assertEqual((self.project / self.snapshot_path).read_bytes(), snapshot_before)

    def test_rejects_partial_copied_or_fresh_capture_semantics(self):
        original = copy.deepcopy(self.document)
        cases = [
            ('partial', lambda d: d['snapshot'].update(full_keyspace=False)),
            ('copied-db', lambda d: d['snapshot'].update(capture_method='copied-member-db')),
            ('fresh', lambda d: d.update(mode='fresh')),
            ('volume', lambda d: d.update(application_volume_restore=True)),
        ]
        for label, change in cases:
            with self.subTest(label=label):
                self.document = copy.deepcopy(original)
                change(self.document)
                self.write_input()
                with self.assertRaisesRegex(ValueError, 'full-keyspace|snapshot save|restore-control|volume'):
                    self.save('unsafe-' + label)

    def test_snapshot_status_and_external_catalog_must_bind_exact_bytes(self):
        self.status['snapshot_sha256'] = '0' * 64
        self.rewrite_status()
        with self.assertRaisesRegex(ValueError, 'reviewed bytes'):
            self.save('status-drift')

        self.status['snapshot_sha256'] = self.snapshot_sha
        self.rewrite_status()
        self.catalog['object_sha256'] = '0' * 64
        self.rewrite_catalog()
        with self.assertRaisesRegex(ValueError, 'independently bind'):
            self.save('catalog-drift')

        self.catalog['object_sha256'] = self.snapshot_sha
        self.rewrite_catalog()
        (self.project / self.snapshot_path).write_bytes(b'changed-snapshot')
        with self.assertRaisesRegex(ValueError, 'bytes or size'):
            self.save('snapshot-drift')

    def test_pinned_toolchain_and_revision_policy_fail_closed_on_drift(self):
        self.document['snapshot']['toolchain']['etcd_version'] = 'v3.5.0'
        self.write_input()
        with self.assertRaisesRegex(ValueError, 'v3.6'):
            self.save('wrong-version')

        self.document['snapshot']['toolchain']['etcd_version'] = 'v3.6.14'
        self.document['revision_policy']['mark_compacted'] = False
        self.write_input()
        with self.assertRaisesRegex(ValueError, 'mark-compacted'):
            self.save('unsafe-revision')

    def test_revision_requires_adequate_basis_and_every_known_consumer(self):
        self.document['revision_policy']['bump_revision'] = 45000
        self.write_input()
        with self.assertRaisesRegex(ValueError, 'not adequate'):
            self.save('short-bump')

        self.document['revision_policy']['bump_revision'] = 1000000
        consumers = self.document['revision_policy']['watch_consumers'][1:]
        self.document['revision_policy']['watch_consumers'] = consumers
        self.document['revision_policy']['client_restart_set_sha256'] = (
            control_restore.sha256_bytes(control_restore.canonical_bytes(consumers)))
        self.write_input()
        with self.assertRaisesRegex(ValueError, 'every known'):
            self.save('missing-consumer')

    def test_generation_topology_and_retained_runtime_drift_are_rejected(self):
        self.document['expected_cluster']['generation'] = 8
        self.write_input()
        with self.assertRaisesRegex(ValueError, 'current cluster'):
            self.save('generation-drift')

        self.document['expected_cluster']['generation'] = 7
        self.document['retained_workers']['runtime_snapshot_sha256'] = '0' * 64
        self.write_input()
        with self.assertRaisesRegex(ValueError, 'retained worker baseline'):
            self.save('runtime-drift')

    def test_old_control_isolation_and_other_external_gates_save_blocked_plan(self):
        self.document['old_control_plane']['isolation_confirmed'] = False
        self.document['old_control_plane']['isolated_at'] = None
        self.document['writer_quiescence']['confirmed'] = False
        self.document['evidence_store']['available'] = False
        self.document['snapshot']['toolchain']['verified'] = False
        self.document['reconciliation']['core_key_available'] = False
        self.write_input()
        plan = self.save('blocked-review')[0]['plan']
        self.assertEqual(plan['decision'], 'blocked')
        self.assertEqual(plan['blocker_codes'], [
            'core-key-unavailable', 'evidence-store-unavailable', 'old-control-not-isolated',
            'toolchain-not-verified', 'writers-not-quiesced'])
        self.assertFalse(plan['executable'])

    def test_new_logical_cluster_rejects_reused_token_data_dir_and_bad_membership(self):
        self.document['target_etcd']['target_token_sha256'] = self.source['token_sha256']
        self.write_input()
        with self.assertRaisesRegex(ValueError, 'new cluster token'):
            self.save('reused-token')

        self.document['target_etcd']['target_token_sha256'] = '6' * 64
        self.document['target_etcd']['members'].append(copy.deepcopy(
            self.document['target_etcd']['members'][0]))
        self.write_input()
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            self.save('invented-ha')

    def test_target_host_and_data_dir_aggregate_are_derived_from_members(self):
        self.document['target_etcd']['members'][0]['host_alias'] = 'ckc-disposable-02'
        self.write_input()
        with self.assertRaisesRegex(ValueError, 'Profile A core host'):
            self.save('wrong-etcd-host')

        self.document['target_etcd']['members'][0]['host_alias'] = 'ckc-disposable-01'
        self.document['target_etcd']['initial_cluster_sha256'] = control_restore.sha256_bytes(
            control_restore.canonical_bytes(self.document['target_etcd']['members']))
        self.document['reconciliation']['expected_etcd_membership_sha256'] = (
            self.document['target_etcd']['initial_cluster_sha256'])
        self.document['target_etcd']['target_data_dirs_sha256'] = '0' * 64
        self.write_input()
        with self.assertRaisesRegex(ValueError, 'data-dir digest'):
            self.save('contradictory-data-dirs')

    def test_exact_retained_records_and_eru_reconciliation_are_hash_bound(self):
        self.source['runtime_workers'][0]['containers_sha256'] = '0' * 64
        self.rewrite_source()
        with self.assertRaisesRegex(ValueError, 'not derived from exact records'):
            self.save('runtime-detail-drift')

        self.source['runtime_workers'][0]['containers_sha256'] = hashlib.sha256(
            b'containers-2').hexdigest()
        self.rewrite_source()
        self.document['reconciliation']['expected_eru_membership_sha256'] = (
            self.document['target_etcd']['initial_cluster_sha256'])
        self.write_input()
        with self.assertRaisesRegex(ValueError, 'Eru membership'):
            self.save('eru-membership-conflation')

    def test_status_catalog_and_toolchain_require_source_controlled_trust_anchors(self):
        self.status['snapshot_hash'] = 'cafebabe'
        self.rewrite_status()
        with self.assertRaisesRegex(ValueError, 'trusted restore index'):
            self.save('unanchored-status')

        self.status['snapshot_hash'] = 'deadbeef'
        self.rewrite_status()
        self.document['snapshot']['toolchain']['etcd_sha256'] = '0' * 64
        self.write_input()
        with self.assertRaisesRegex(ValueError, 'toolchain.*trusted restore index'):
            self.save('unanchored-toolchain')

        self.document['snapshot']['toolchain']['etcd_sha256'] = 'a' * 64
        self.document['reconciliation']['core_key_evidence_sha256'] = 'd' * 64
        self.write_input()
        with self.assertRaisesRegex(ValueError, 'core key.*trusted restore index'):
            self.save('unanchored-core-key')

    def test_trust_index_must_match_committed_head_binding(self):
        with self.assertRaisesRegex(ValueError, 'committed HEAD'):
            save_review_plan(
                self.project, self.input_path, 'uncommitted-trust', now=self.now,
                source_state=self.source_state,
                committed_trust_sha256='0' * 64)

    def test_invalid_rpo_candidate_and_timestamp_order_fail_or_block(self):
        self.document['objectives']['protected_through_at'] = (
            self.now - timedelta(minutes=20)).isoformat()
        self.write_input()
        plan = self.save('rpo-missed')[0]['plan']
        self.assertEqual(plan['decision'], 'blocked')
        self.assertIn('rpo-candidate-missed', plan['blocker_codes'])

        self.document['objectives']['protected_through_at'] = (
            self.now - timedelta(minutes=8)).isoformat()
        self.document['writer_quiescence']['quiesced_at'] = (
            self.now - timedelta(minutes=9)).isoformat()
        self.write_input()
        with self.assertRaisesRegex(ValueError, 'quiesced before'):
            self.save('bad-chronology')

    def test_private_paths_duplicate_json_and_nested_symlinks_are_rejected(self):
        outside = self.project / 'outside.json'
        outside.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'project private'):
            save_review_plan(
                self.project, outside, 'outside', now=self.now,
                source_state=self.source_state)

        duplicate = self.private / 'restore-control-intents/duplicate.json'
        duplicate.write_text('{"schema_version":1,"schema_version":1}')
        with self.assertRaisesRegex(ValueError, 'duplicate field'):
            save_review_plan(
                self.project, duplicate, 'duplicate', now=self.now,
                source_state=self.source_state)

        linked = self.private / 'control-restore-status/linked.json'
        linked.symlink_to(self.project / self.status_path)
        self.document['snapshot']['status_evidence'] = {
            'path': 'private/control-restore-status/linked.json',
            'sha256': self.file_sha(self.status_path),
        }
        self.write_input()
        with self.assertRaisesRegex(ValueError, 'symlinks'):
            self.save('linked-status')

    def test_ancestor_and_record_directory_symlinks_are_rejected_by_dirfd_walk(self):
        status_directory = self.private / 'control-restore-status'
        real_status = self.private / 'control-restore-status-real'
        status_directory.rename(real_status)
        status_directory.symlink_to(real_status, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'symlinks'):
            self.save('linked-status-parent')

        status_directory.unlink()
        real_status.rename(status_directory)
        outside = self.private / 'record-outside'
        outside.mkdir()
        record_root = self.private / 'operations/restore-control'
        record_root.symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'record directories'):
            self.save('linked-record-parent')

    def test_trusted_private_root_symlink_and_immutable_concurrent_record(self):
        backing = self.project / 'private-backing'
        self.private.rename(backing)
        self.private.symlink_to(backing, target_is_directory=True)

        def attempt():
            try:
                return self.save('concurrent-plan')[0]
            except FileExistsError:
                return None

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _index: attempt(), range(2)))
        self.assertEqual(sum(result is not None for result in results), 1)
        saved = json.loads(self.output_path('concurrent-plan').read_text())
        self.assertEqual(saved, next(item for item in results if item is not None))
        with self.assertRaisesRegex(FileExistsError, 'fresh plan ID'):
            self.save('concurrent-plan')

    def test_private_root_identity_is_pinned_for_the_whole_transaction(self):
        backing = self.project / 'private-backing'
        alternate = self.project / 'private-alternate'
        self.private.rename(backing)
        alternate.mkdir()
        self.private.symlink_to(backing, target_is_directory=True)
        original = control_restore_ops._restore_trust

        def swap_root(project):
            result = original(project)
            self.private.unlink()
            self.private.symlink_to(alternate, target_is_directory=True)
            return result

        with patch.object(control_restore_ops, '_restore_trust', side_effect=swap_root), \
                self.assertRaisesRegex(ValueError, 'private root changed'):
            self.save('root-swap')
        self.assertFalse(
            (backing / 'operations/restore-control/review-plans/root-swap.json').exists())

    def test_plan_hash_is_deterministic_and_binds_revision_policy(self):
        first = self.save('stable-plan')[0]
        self.output_path('stable-plan').unlink()
        second = self.save('stable-plan')[0]
        self.assertEqual(first, second)

        self.output_path('stable-plan').unlink()
        self.document['revision_policy']['bump_revision'] += 1
        self.write_input()
        changed = self.save('stable-plan')[0]
        self.assertNotEqual(first['sha256'], changed['sha256'])

    def test_cli_output_is_redacted_and_no_executor_is_registered(self):
        stdout, stderr = StringIO(), StringIO()
        argv = ['labctl.py', 'plan-control-restore', '--input', self.input_path,
                '--plan-id', 'cli-redaction']
        with patch.object(labctl, 'PROJECT', self.project), patch.object(sys, 'argv', argv), \
                patch.object(control_restore_ops, '_git_source', return_value=self.source_state), \
                patch.object(
                    control_restore_ops, '_git_committed_trust_sha256',
                    return_value=self.file_sha('control-restore-trust.json')), \
                redirect_stdout(stdout), redirect_stderr(stderr):
            labctl.main()
        output = stdout.getvalue() + stderr.getvalue()
        for private in [
                self.sentinel, 'ckc-disposable-01', '192.0.2.1', str(self.project),
                self.source['cluster_id_sha256'],
                self.document['target_etcd']['target_token_sha256']]:
            self.assertNotIn(private, output)
        summary = json.loads(stdout.getvalue())
        self.assertEqual(summary['snapshot_revision'], 4321)
        self.assertEqual(summary['member_count'], 1)
        self.assertEqual(summary['worker_count'], 3)
        self.assertFalse(summary['executable'])
        self.assertFalse(summary['execution_implemented'])
        self.assertEqual(stderr.getvalue(), '')

        labctl_source = (SCRIPTS / 'labctl.py').read_text()
        self.assertNotIn("sub.add_parser('execute-control-restore'", labctl_source)
        control_source = (SCRIPTS / 'control_restore_ops.py').read_text()
        self.assertNotIn('Operator(', control_source)
        self.assertNotIn("['etcdutl'", control_source)


if __name__ == '__main__':
    unittest.main()
