import json
import os
from pathlib import Path
import tempfile
import unittest

import remote_grant


class RemoteGrantTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.lab = Path(self.tmp.name)
        scripts = self.lab / 'scripts'
        scripts.mkdir()
        for name in remote_grant.SOURCE_NAMES:
            path = scripts / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('source for ' + name)

    def test_create_lists_and_consumes_one_private_grant(self):
        row = remote_grant.create(self.lab, 'pi', 60, now=1000.0)
        self.assertRegex(row['id'], r'^[0-9a-f]{32}$')
        self.assertEqual(row['fingerprint'], remote_grant.fingerprint(row['id']))
        path = self.lab / 'state/remote-grants/pending' / (row['id'] + '.json')
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.lab / 'state/remote-grants').stat().st_mode & 0o777, 0o700)
        self.assertEqual(remote_grant.pending(self.lab, 'pi', now=1001.0)['id'], row['id'])
        with self.assertRaisesRegex(remote_grant.GrantError, 'remote_grant_unavailable'):
            remote_grant.create(self.lab, 'pi', 60, now=1002.0)
        used = remote_grant.consume(self.lab, row['id'], 'pi', 'console', now=1003.0)
        self.assertEqual(used['id'], row['id'])
        self.assertTrue((self.lab / 'state/remote-grants/consumed' / (row['id'] + '.use.json')).is_file())
        self.assertIsNone(remote_grant.pending(self.lab, 'pi', now=1004.0))
        with self.assertRaisesRegex(remote_grant.GrantError, 'remote_grant_used'):
            remote_grant.consume(self.lab, row['id'], 'pi', 'console', now=1005.0)

    def test_rejects_bad_ttl_expiry_tamper_and_symlink(self):
        for ttl in (59, 1801):
            with self.assertRaises(remote_grant.GrantError):
                remote_grant.create(self.lab, 'pi', ttl)
        row = remote_grant.create(self.lab, 'pi', 60, now=2000.0)
        with self.assertRaisesRegex(remote_grant.GrantError, 'remote_grant_expired'):
            remote_grant.consume(self.lab, row['id'], 'pi', 'console', now=2061.0)
        path = self.lab / 'state/remote-grants/pending' / (row['id'] + '.json')
        data = json.loads(path.read_text()); data['limits']['provider_request_cap'] = 99; path.write_text(json.dumps(data)); path.chmod(0o600)
        with self.assertRaisesRegex(remote_grant.GrantError, 'remote_grant_source_changed'):
            remote_grant.consume(self.lab, row['id'], 'pi', 'console', now=2001.0)
        path.unlink(); path.symlink_to(self.lab / 'missing')
        with self.assertRaises(remote_grant.GrantError):
            remote_grant.consume(self.lab, row['id'], 'pi', 'console', now=2002.0)


if __name__ == '__main__':
    unittest.main()
