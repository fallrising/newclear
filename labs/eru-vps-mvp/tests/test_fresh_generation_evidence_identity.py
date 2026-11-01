"""Acceptance evidence identity across physical and proved before-view reads.

The journal/session derivation is a declared synthetic boundary. Real private
file reads, helper observations, acceptance projection and raw hashes run here;
this counter does not establish the full generation/public CLI proof chain.
"""
import hashlib
import os
import unittest
from unittest.mock import patch

from app_desired import canonical_bytes
from fresh_execution_ops import PrivateFiles
from fresh_replay_ops import _raw_ref
import fresh_generation as generation
from fresh_rebuild import plan_digest
import fresh_replay as contract
import fresh_replay_ops as replay
from test_fresh_replay_host import Harness


class AcceptanceEvidenceIdentityTests(unittest.TestCase):
    def setUp(self):
        self.h = Harness()
        self.addCleanup(self.h.close)
        self.project = self.h.root
        (self.project / 'private').mkdir(mode=0o700)
        self.before = {}
        dependencies = []
        for path, value in zip(generation.PATHS, ([{'original': True}], {}, {'generation': 1})):
            raw = canonical_bytes(value)
            self.write(path, raw)
            self.before[path] = raw
            dependencies.append({'path': path, 'sha256': generation.sha(raw)})
        self.h.plan['dependencies'] = dependencies
        self.h.plan['context_refs'] = {key: 'private/context-' + key + '.json'
                                      for key in ('review', 'execution', 'bootstrap', 'network')}
        for path in self.h.plan['context_refs'].values():
            self.write(path, b'{}')
        self.h.digest = plan_digest(self.h.plan)
        self.receipts = []
        for index, step in enumerate(self.h.plan['steps']):
            action = self.h.action(index)
            if step['step'] not in contract.READONLY:
                self.h.dispatch(action, 'b' * 64)
            self.receipts.append({'receipt': {'observation': self.h.observe(action)},
                                  'sha256': hashlib.sha256(str(index).encode()).hexdigest()})
            self.write(replay._path(self.h.plan['run_id'], index) + '/receipt.json',
                       canonical_bytes(self.receipts[-1]))
        self.write(replay._path(self.h.plan['run_id']) + '/plan.json',
                   canonical_bytes({'plan': self.h.plan, 'sha256': self.h.digest}))
        self.write('private/operations/fresh-rebuild/bootstrap/' + self.h.plan['run_id'] +
                   '/steps/step-21/receipt.json', canonical_bytes({'receipt': {'timing': {}}}))

    def write(self, path, raw):
        destination = self.project / path
        parent = self.project
        for part in destination.relative_to(self.project).parts[:-1]:
            parent = parent / part
            parent.mkdir(exist_ok=True, mode=0o700)
        destination.write_bytes(raw)
        destination.chmod(0o600)

    def load(self):
        case = self
        class Session:
            def __init__(self, project, now, source_state):
                self.files = PrivateFiles(project)
                self.publications = self
            def load_plan(self, run, digest):
                for ref in case.h.plan['dependencies']:
                    _raw_ref(self.files, ref)
                return case.h.plan
            def slots(self, **kwargs):
                return list(range(len(case.receipts)))
            def slot(self, index):
                return None, case.receipts[index]
            def final(self):
                self.files.recheck()
            def check(self):
                pass
            def close(self):
                self.files.close()
        with patch.object(replay, '_Session', Session):
            return replay.load_acceptance(self.project, self.h.plan['run_id'], self.h.digest)

    def test_original_dependency_bytes_keep_same_acceptance_digest_in_before_view(self):
        original = self.load()
        identity = list((os.stat(self.project / 'private').st_dev,
                         os.stat(self.project / 'private').st_ino))
        # Only the historical-view seam is synthetic. Its before bytes are the
        # exact originals, and no current file changes in this pre-write case.
        with generation._historical(self.project, self.before, {}, identity, lambda: None):
            historical = self.load()
        self.assertEqual(original['evidence_refs'], historical['evidence_refs'])
        self.assertEqual(plan_digest(original), plan_digest(historical))
        for path, raw in self.before.items():
            self.assertEqual((self.project / path).read_bytes(), raw)

    def test_changed_dependency_without_proved_view_still_rejects(self):
        self.write(generation.PATHS[0], b'[]')
        with self.assertRaises(ValueError):
            self.load()
