"""Public follow-up wire admission and predecessor evidence regressions."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import fresh_rebuild
import fresh_rebuild_ops
import fresh_run_ops as driver
from fresh_execution_ops import PrivateFiles
import test_fresh_rebuild as rebuild_fixtures


class CompletionGuardTests(unittest.TestCase):
    def test_reviewed_replay_step_is_admitted_by_the_exact_wire_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            private = project / 'private'
            private.mkdir(mode=0o700)
            renewal = b'{}'
            (private / 'renewal.json').write_bytes(renewal)
            (private / 'renewal.json').chmod(0o600)
            document = {'schema_version': 1, 'operation': 'fresh-run-step',
                'run_id': 'run-one', 'execution_sha256': 'a' * 64,
                'pending_sha256': 'b' * 64, 'step': 'prepare_replay',
                'parameters': {'run_id': 'run-one', 'bootstrap_sha': 'c' * 64,
                    'bootstrap_receipt_sha': 'd' * 64},
                'renewal': {'path': 'private/renewal.json',
                    'sha256': hashlib.sha256(renewal).hexdigest()}}
            raw = json.dumps(document).encode()
            (private / 'step.json').write_bytes(raw)
            (private / 'step.json').chmod(0o600)
            files = PrivateFiles(project)
            try:
                result = driver._request(files, 'private/step.json',
                    hashlib.sha256(raw).hexdigest(), 'run-one', 'a' * 64,
                    {'sha256': 'b' * 64}, recovery=False)
                self.assertEqual(result, document)
                # The same writer is never admitted through observation recovery.
                with self.assertRaises(ValueError):
                    driver._request(files, 'private/step.json',
                        hashlib.sha256(raw).hexdigest(), 'run-one', 'a' * 64,
                        {'sha256': 'b' * 64}, recovery=True)
            finally:
                files.close()

    def test_series_cannot_accept_claimed_passes_without_the_sealed_index_and_commit(self):
        fixture = rebuild_fixtures.FreshRebuildPlanTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        first = fixture.save('claimed-predecessor')[0]
        path = 'private/operations/fresh-rebuild/accepted-runs/claimed-predecessor.json'
        acceptance = {'schema_version': 1,
            'operation': 'full-cluster-fresh-rebuild-acceptance', 'status': 'accepted',
            'plan_id': first['plan']['id'], 'plan_sha256': first['sha256'],
            'cluster_id': 'eru-vps-mvp', 'generation': 8,
            'series_id': first['plan']['series']['id'], 'iteration': 1,
            'checks': {name: 'passed' for name in fresh_rebuild.ACCEPTANCE_CHECKS},
            'rto': {'total_seconds': 10, 'provider_queue_seconds': 0,
                'installation_seconds': 5, 'candidate_seconds': 1800},
            'evidence_index_sha256': 'e' * 64}
        fixture.write_json(path, acceptance)
        series = copy.deepcopy(fixture.document['series'])
        series.update(iteration=2, previous_accepted_run={
            'id': first['plan']['id'], 'plan_sha256': first['sha256'], 'generation': 8,
            'acceptance': {'path': path, 'sha256': fixture.file_sha(path)}})
        with self.assertRaises((ValueError, RuntimeError, OSError)):
            fresh_rebuild_ops._previous_accepted(fixture.project, series)
