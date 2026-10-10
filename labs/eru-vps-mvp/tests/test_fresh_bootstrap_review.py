"""Independent adversarial checks for the combined local bootstrap boundary."""
import base64
import copy
import gzip
import io
import json
import tarfile
import unittest

import fresh_bootstrap as contract
import fresh_bootstrap_host as host
import fresh_bootstrap_ops as ops
import fresh_bootstrap_render as render
import test_fresh_bootstrap_host as host_fixture
import test_fresh_bootstrap_ops as journal_fixture


class BootstrapReviewTests(unittest.TestCase):
    def test_etcd_member_header_identity_must_match_status_and_keyspace(self):
        fixture = host_fixture.HostTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.call(0)
        fixture.call(1)
        action = fixture.action(2)
        observed = fixture.call(2, observe=True)
        row = next(row for row in observed['evidence']['commands']
                   if tuple(row['argv']) == host.ETCD + ('member', 'list'))
        members = json.loads(base64.b64decode(row['stdout_base64']))
        members['header']['member_id'] = 999
        row['stdout_base64'] = base64.b64encode(render.canonical(members)).decode()
        with self.assertRaises(ValueError):
            host.validate_evidence(action, observed)

    def replace_etcd_archive(self, fixture, raw):
        fixture.archives['etcd-io/etcd'] = raw
        inputs = copy.deepcopy(fixture.render['inputs'])
        next(row for row in inputs['artifact_lock']['artifacts']
             if row['repository'] == 'etcd-io/etcd')['sha256'] = render.digest(raw)
        fixture.render = render.build_render(
            inputs['access_render'], inputs['artifact_lock'],
            render.decode_binary(inputs['token_base64']),
            run_id=fixture.render['run_id'],
            target_token_sha256=fixture.render['target_token_sha256'],
            prior_token_sha256=inputs['prior_token_sha256'],
            safe_core=inputs['safe_core'], capacities=inputs['capacities'])

    def test_readonly_empty_accept_is_valid_before_durable_intent(self):
        fixture = host_fixture.HostTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.call(0)
        fixture.call(1)
        action = fixture.action(2)
        observed = fixture.call(2, observe=True)
        self.assertEqual(observed['state'], 'complete')
        facts = contract.observation(observed, action, fixture.now, before=True)
        self.assertEqual(facts['etcd']['keys'], [])

    def test_mutating_preflight_still_requires_absence(self):
        fixture = host_fixture.HostTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        observed = fixture.call(0)
        self.assertEqual(observed['state'], 'complete')
        with self.assertRaises(ValueError):
            contract.observation(observed, fixture.action(0), fixture.now, before=True)

    def test_duplicate_archive_basename_cannot_select_unreviewed_binary(self):
        fixture = host_fixture.HostTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode='w') as output:
            for name in ('bin/etcd', 'nested/etcd', 'bin/etcdctl', 'bin/etcdutl'):
                raw = name.encode()
                member = tarfile.TarInfo(name)
                member.size = len(raw)
                output.addfile(member, io.BytesIO(raw))
        raw = gzip.compress(archive.getvalue(), mtime=0)
        self.replace_etcd_archive(fixture, raw)
        with self.assertRaises(ValueError):
            fixture.call(0)
        self.assertFalse((fixture.root / 'usr/local/bin/etcd').exists())
        self.assertEqual(fixture.runner.writes, [])

    def test_archive_member_limit_blocks_before_target_write(self):
        fixture = host_fixture.HostTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode='w') as output:
            for name in ('etcd', 'etcdctl', 'etcdutl'):
                raw = name.encode()
                member = tarfile.TarInfo('bin/' + name)
                member.size = len(raw)
                output.addfile(member, io.BytesIO(raw))
            for index in range(4094):
                output.addfile(tarfile.TarInfo('ignored/%04d' % index))
        self.replace_etcd_archive(fixture, gzip.compress(archive.getvalue(), mtime=0))
        with self.assertRaises(ValueError):
            fixture.call(0)
        self.assertFalse((fixture.root / 'usr/local/bin/etcd').exists())
        self.assertEqual(fixture.runner.writes, [])

    def test_authorization_raw_byte_drift_poison_history_and_successor(self):
        fixture = journal_fixture.BootstrapJournalTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.assertEqual(fixture.execute(0)['status'], 'bootstrap-step-complete')
        auth_path = fixture.project / fixture.auths[0][0]
        auth_path.write_bytes(auth_path.read_bytes() + b' ')
        self.assertEqual(fixture.inspect()['status'], 'blocked')
        calls = list(fixture.adapter.calls)
        self.assertEqual(fixture.execute(1)['status'], 'blocked')
        self.assertEqual(fixture.adapter.calls, calls)

    def test_foreign_completed_slot_entry_blocks_without_dispatch(self):
        fixture = journal_fixture.BootstrapJournalTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.assertEqual(fixture.execute(0)['status'], 'bootstrap-step-complete')
        unknown = fixture.project / ops._path('run', 0) / 'foreign.json'
        unknown.write_text('preserve')
        calls = list(fixture.adapter.calls)
        self.assertEqual(fixture.inspect()['status'], 'blocked')
        self.assertEqual(fixture.execute(1)['status'], 'blocked')
        self.assertEqual(fixture.adapter.calls, calls)
        self.assertEqual(unknown.read_text(), 'preserve')


if __name__ == '__main__':
    unittest.main()
