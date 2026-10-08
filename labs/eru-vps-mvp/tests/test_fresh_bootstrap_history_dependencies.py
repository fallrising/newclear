"""Actual bootstrap loader/derive/PrivateFiles with a checked before-view seam.

NetworkBootstrapFixture provides the existing synthetic artifact, source, clock,
transport and observation boundaries. The historical context is entered with
three real raw snapshots, original pending/private identity and a live checker;
this does not establish the full generation verified_history/CLI proof chain.
"""
import copy
from contextlib import contextmanager
import unittest

from app_desired import canonical_bytes
from fresh_execution_ops import PrivateFiles
import fresh_bootstrap_ops as bootstrap
import fresh_generation as generation
from fresh_rebuild import plan_digest
import pending_generation
from test_fresh_bootstrap_ops import NetworkBootstrapFixture


class BootstrapHistoryDependencyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.f = NetworkBootstrapFixture()
        cls.addClassCleanup(cls.f.doCleanups)
        cls.f.setUp()
        cls.pending = pending_generation.inspect(cls.f.project)
        cls.before = {p: (cls.f.project / p).read_bytes() for p in generation.PATHS}
        cls.identity = cls.pending['reservation']['private_identity']
        session = bootstrap._Session(cls.f.project, cls.f.now, cls.f.source)
        try:
            cls.record = session.derive(cls.f.plan['id'], cls.f.plan['sha256'],
                cls.f.accepted['receipt_sha256'], {'path': cls.f.inputpath, 'sha256': cls.f.inputsha},
                cls.f.now.isoformat())
        finally:
            session.close()
        cls.digest = plan_digest(cls.record)
        path = cls.f.project / bootstrap._path(cls.f.run) / 'plan.json'
        path.parent.mkdir(parents=True, mode=0o700)
        for directory in (cls.f.project / 'private').rglob('*'):
            if directory.is_dir(): directory.chmod(0o700)
        path.write_bytes(canonical_bytes({'plan': cls.record, 'sha256': cls.digest}))
        path.chmod(0o600)
        cls.snapshots = {}
        for i, (original, raw) in enumerate(cls.before.items()):
            path = 'private/history-original-' + str(i) + '.bin'
            cls.f.raw(path, raw)
            cls.snapshots[original] = {'path': path, 'sha256': generation.sha(raw)}

    @contextmanager
    def history(self, *, identity=None):
        proof = PrivateFiles(self.f.project)
        self.addCleanup(proof.close)
        def check():
            with generation._physical():
                self.assertEqual(pending_generation.inspect(self.f.project), self.pending)
                for original, ref in self.snapshots.items():
                    raw, path, digest = proof.read(ref['path'])
                    if path != ref['path'] or digest != ref['sha256'] or raw != self.before[original]:
                        raise ValueError('historical snapshot differs')
                proof.recheck()
        check()
        with generation._historical(self.f.project, self.before, self.pending,
                                    identity if identity is not None else self.identity, check):
            yield

    def load(self):
        session = bootstrap._Session(self.f.project, self.f.now, self.f.source)
        self.addCleanup(session.close)
        record = session.load_plan(self.f.run, self.digest)
        session.files.recheck()
        return record, session.files

    def test_actual_loader_retains_identical_dependencies_in_checked_before_view(self):
        physical, physical_files = self.load()
        self.assertTrue(set(generation.PATHS) <= set(physical_files.seen))
        with self.history():
            historical, historical_files = self.load()
            self.assertFalse(set(generation.PATHS) & set(historical_files.seen))
            self.assertEqual(physical, historical)
            self.assertEqual(plan_digest(historical), self.digest)
        for path, raw in self.before.items():
            self.assertEqual((self.f.project / path).read_bytes(), raw)

    def test_derive_has_no_semantic_or_raw_dependency_difference(self):
        with self.history():
            session = bootstrap._Session(self.f.project, self.f.now, self.f.source)
            self.addCleanup(session.close)
            # load_plan reads recorded refs before deriving; keep that footprint.
            for ref in self.record['dependencies']:
                bootstrap._raw_ref(session.files, ref)
            rebuilt = session.derive(self.record['plan_id'], self.record['plan_sha256'],
                self.record['network_receipt_sha256'], self.record['input'], self.record['created_at'])
            differences = [key for key in self.record if self.record[key] != rebuilt[key]]
            omitted = sorted({ref['path'] for ref in self.record['dependencies']} -
                             {ref['path'] for ref in rebuilt['dependencies']})
            self.assertEqual(differences, [], {'different_fields': differences, 'omitted_refs': omitted})

    def test_changed_raw_dependency_rejects_even_in_checked_view(self):
        target = self.f.project / 'private/bootstrap-token.bin'
        original = target.read_bytes()
        try:
            target.write_bytes(original + b'changed')
            with self.history(), self.assertRaises(ValueError):
                self.load()
        finally:
            target.write_bytes(original)

    def test_changed_canonical_raw_without_view_rejects(self):
        path = self.f.project / generation.PATHS[0]
        original = path.read_bytes()
        try:
            path.write_bytes(original + b' ')
            with self.assertRaises(ValueError):
                self.load()
        finally:
            path.write_bytes(original)

    def test_rehashed_plan_cannot_drop_a_canonical_dependency(self):
        path = self.f.project / bootstrap._path(self.f.run) / 'plan.json'
        original = path.read_bytes()
        changed = copy.deepcopy(self.record)
        changed['dependencies'] = [ref for ref in changed['dependencies']
                                   if ref['path'] != generation.PATHS[0]]
        digest = plan_digest(changed)
        try:
            path.write_bytes(canonical_bytes({'plan': changed, 'sha256': digest}))
            with self.history():
                session = bootstrap._Session(self.f.project, self.f.now, self.f.source)
                self.addCleanup(session.close)
                with self.assertRaisesRegex(ValueError, 'not current derivation'):
                    session.load_plan(self.f.run, digest)
        finally:
            path.write_bytes(original)

    def test_wrong_private_identity_context_rejects(self):
        wrong = [self.identity[0], self.identity[1] + 1]
        with self.history(identity=wrong), self.assertRaisesRegex(ValueError, 'private root changed'):
            self.load()

    def test_changed_snapshot_ref_rejects(self):
        path = self.f.project / next(iter(self.snapshots.values()))['path']
        original = path.read_bytes()
        try:
            path.write_bytes(original + b' ')
            with self.assertRaisesRegex(ValueError, 'snapshot differs'):
                with self.history():
                    self.load()
        finally:
            path.write_bytes(original)

    def test_rehashed_plan_context_change_is_not_a_dependency_override(self):
        path = self.f.project / bootstrap._path(self.f.run) / 'plan.json'
        original = path.read_bytes()
        changed = copy.deepcopy(self.record)
        changed['prior']['cluster_id'] = 'forged'
        digest = plan_digest(changed)
        try:
            path.write_bytes(canonical_bytes({'plan': changed, 'sha256': digest}))
            with self.history():
                session = bootstrap._Session(self.f.project, self.f.now, self.f.source)
                self.addCleanup(session.close)
                with self.assertRaisesRegex(ValueError, 'not current derivation'):
                    session.load_plan(self.f.run, digest)
        finally:
            path.write_bytes(original)


if __name__ == '__main__':
    unittest.main()
