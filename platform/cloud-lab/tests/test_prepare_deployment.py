"""Synthetic, offline deployment preparation failure boundaries."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('prepare_deployment', ROOT / 'tools/prepare_deployment.py')


def profile():
    return dict(schema_version='cloudlab.deployment.v1', account_id='a' * 32,
                zone_id='b' * 32, database_id='12345678-1234-4234-8234-123456789abc',
                domain='lab.example.invalid', worker_name='cloud-lab-qualification',
                access_issuer='https://synthetic.cloudflareaccess.com', access_audience='synthetic-aud',
                human_subject='synthetic-subject', workspace_id='synthetic-workspace', resource_id='synthetic-node',
                resource_generation=1, not_before='2026-10-27T00:00:00Z', expires_at='2026-10-28T00:00:00Z')


class PrepareTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(cls.mod)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        # The shared launcher may itself live below a real checkout. Model the
        # synthetic fixture as an isolated filesystem root: hide only external
        # ancestor Git markers, never markers inside this test's own directory.
        real_stat = os.stat
        external_ancestors = {(real_stat(p).st_dev, real_stat(p).st_ino) for p in self.base.parents}
        def fixture_stat(path, *args, **kwargs):
            if path == '.git' and 'dir_fd' in kwargs:
                info = os.fstat(kwargs['dir_fd'])
                if (info.st_dev, info.st_ino) in external_ancestors:
                    raise FileNotFoundError('outside synthetic fixture root')
            return real_stat(path, *args, **kwargs)
        patcher = mock.patch.object(self.mod.os, 'stat', side_effect=fixture_stat)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.input = self.base / 'profile.json'
        self.output = self.base / 'bundle'
        self.write(profile())

    def write(self, value):
        self.input.write_bytes(json.dumps(value).encode())
        self.input.chmod(0o600)

    def prepare(self):
        return self.mod.prepare_deployment(self.input, self.output)

    def read(self, name):
        return json.loads((self.output / name).read_text())

    def test_exact_sources_digest_manifest_and_disabled_ingress(self):
        manifest = self.prepare()
        for relative in self.mod.SOURCE_FILES:
            self.assertEqual((ROOT / relative).read_bytes(), (self.output / relative).read_bytes())
        self.assertEqual(manifest['recipe_ref']['digest'], 'sha256:' + hashlib.sha256((ROOT / 'recipes/node-health.json').read_bytes()).hexdigest())
        self.assertTrue(manifest['source_version'])
        for name, digest in manifest['files'].items():
            self.assertEqual(digest, hashlib.sha256((self.output / name).read_bytes()).hexdigest())
        self.assertEqual(set(manifest['files']), {str(p.relative_to(self.output)) for p in self.output.rglob('*') if p.is_file()} - {'manifest.json'})
        wrangler = self.read('wrangler.json')
        self.assertFalse(wrangler['workers_dev'])
        self.assertFalse(wrangler['preview_urls'])
        self.assertTrue(wrangler['assets']['run_worker_first'])
        self.assertNotIn('routes', wrangler)
        self.assertNotIn('triggers', wrangler)
        for p in self.output.rglob('*'):
            self.assertEqual(stat.S_IMODE(p.stat().st_mode), 0o700 if p.is_dir() else 0o600)
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o700)

    def test_secret_isolation_and_runner_configuration(self):
        p = profile()
        p.update(cloudflare_access_client_id='synthetic-id', cloudflare_access_client_secret='synthetic-private-secret')
        self.write(p)
        self.prepare()
        runner, bot = self.read('runner.json'), self.read('bot.json')
        self.assertNotEqual(runner['secret_hex'], bot['secret_hex'])
        self.assertEqual(len(bytes.fromhex(runner['secret_hex'])), 32)
        secrets = self.read('worker-secrets.json')
        keys = json.loads(secrets['MACHINE_KEYS'])
        access = json.loads(secrets['ACCESS_CONFIG'])
        self.assertEqual(set(keys), {runner['credential_id'], bot['credential_id']})
        self.assertEqual(keys[runner['credential_id']]['secret_hex'], runner['secret_hex'])
        self.assertEqual(set(access['subjects']), {p['human_subject']})
        spec = importlib.util.spec_from_file_location('bundle_runner', ROOT / 'adapters/node-health/runner.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.Config.from_dict(runner)
        module.Config.from_dict(bot)
        for name in ('wrangler.json', 'grant-seed.sql', 'plan.md', 'manifest.json'):
            raw = (self.output / name).read_text()
            for forbidden in (runner['secret_hex'], bot['secret_hex'], p['human_subject'], p['cloudflare_access_client_secret']):
                self.assertNotIn(forbidden, raw)

    def test_grants_execute_and_separate_capabilities(self):
        self.prepare()
        db = sqlite3.connect(':memory:')
        self.addCleanup(db.close)
        db.execute('PRAGMA foreign_keys=ON')
        db.executescript((self.output / 'apps/control/migrations/0001.sql').read_text())
        seed = (self.output / 'grant-seed.sql').read_text()
        self.assertNotRegex(seed.upper(), r'\b(?:BEGIN|COMMIT|ROLLBACK)\b')
        statements = seed.splitlines()
        with db:
            db.execute('BEGIN')
            for statement in statements:
                db.execute(statement)
        grants = {json.loads(p)['principal_id']: json.loads(p) for p, in db.execute('SELECT policy FROM grants')}
        self.assertEqual(len(grants), 4)
        roles = {key.rsplit('-', 1)[-1]: value for key, value in grants.items()}
        self.assertEqual(set(roles['runner']['capabilities']), {'dispatch:claim', 'runs:report', 'runs:reconcile'})
        self.assertEqual(set(roles['scheduler']['capabilities']), {'commands:submit', 'node:health:read'})
        self.assertNotIn('dispatch:claim', roles['bot']['capabilities'])
        self.assertIn('artifact:read', roles['human']['capabilities'])
        for grant in grants.values():
            self.assertEqual(grant['workspace_id'], profile()['workspace_id'])
            self.assertEqual(grant['resource_ref'], {'resource_id': profile()['resource_id'], 'generation': 1})
            self.assertEqual(grant['max_timeout_seconds'], 10)
            self.assertEqual(grant['max_output_bytes'], 16384)
        self.assertEqual(db.execute('SELECT enabled FROM schedules').fetchone(), (0,))
        with self.assertRaises(sqlite3.IntegrityError):
            with db:
                db.execute('BEGIN')
                db.execute("INSERT INTO grants VALUES ('rollback-sentinel',1,0,'{}')")
                for statement in statements:
                    db.execute(statement)
        self.assertEqual(db.execute("SELECT count(*) FROM grants WHERE id='rollback-sentinel'").fetchone(), (0,))
        self.assertEqual(db.execute('SELECT count(*) FROM grants').fetchone(), (4,))

    def test_invalid_profiles_fail_before_output(self):
        cases = [dict(extra='secret'), dict(resource_generation=True), dict(resource_generation=0),
                 dict(domain='https://lab.example.invalid'), dict(domain='127.0.0.1'), dict(domain='LAB.example.invalid'),
                 dict(domain='lab.example.invalid/path'), dict(access_issuer='https://evil.invalid'),
                 dict(worker_name='other'), dict(account_id='A' * 32), dict(database_id='bad'),
                 dict(expires_at='2026-10-28T00:00:01Z'), dict(expires_at='2026-10-26T00:00:00Z'),
                 dict(not_before='2026-02-30T00:00:00Z'), dict(human_subject=''),
                 dict(cloudflare_access_client_id='unpaired'), dict(access_audience=['bad'])]
        for changes in cases:
            with self.subTest(changes=changes):
                p = profile(); p.update(changes); self.write(p)
                with self.assertRaises(self.mod.PreparationError): self.prepare()
                self.assertFalse(self.output.exists())
        for raw in (b'{"schema_version":1,"schema_version":2}', b'\xff', b'{"a":NaN}', b'{"a":1.2}', b'{"a":"\\ud800"}', b'[]'):
            self.input.write_bytes(raw)
            with self.assertRaises(self.mod.PreparationError): self.prepare()
            self.assertFalse(self.output.exists())

    def test_profile_permissions_and_path_protection(self):
        self.input.chmod(0o644)
        with self.assertRaises(self.mod.PreparationError): self.prepare()
        self.input.chmod(0o600)
        link = self.base / 'input-link'; link.symlink_to(self.input)
        with self.assertRaises(self.mod.PreparationError): self.mod.prepare_deployment(link, self.output)
        alias = self.base / 'alias'; alias.symlink_to(self.base, target_is_directory=True)
        with self.assertRaises(self.mod.PreparationError): self.mod.prepare_deployment(alias / 'profile.json', self.output)
        with self.assertRaises(self.mod.PreparationError): self.mod.prepare_deployment(self.input, alias / 'new')
        with self.assertRaises(self.mod.PreparationError): self.mod.prepare_deployment(self.input, self.base / 'missing' / 'new')
        with self.assertRaises(self.mod.PreparationError): self.mod.prepare_deployment(self.input, str(self.base) + '/x/../bundle')
        self.assertFalse(self.output.exists())

    def test_exclusive_output_preserves_existing_content(self):
        self.output.mkdir(); sentinel = self.output / 'sentinel'; sentinel.write_text('keep')
        with self.assertRaises(self.mod.PreparationError): self.prepare()
        self.assertEqual(sentinel.read_text(), 'keep')
        alternative = self.base / 'symlink'; alternative.symlink_to(self.output, target_is_directory=True)
        with self.assertRaises(self.mod.PreparationError): self.mod.prepare_deployment(self.input, alternative)
        self.assertEqual(sentinel.read_text(), 'keep')

    def test_private_profiles_hardlinks_and_output_parent_permissions(self):
        hardlink = self.base / 'hardlink'
        os.link(self.input, hardlink)
        with self.assertRaises(self.mod.PreparationError): self.prepare()
        self.assertFalse(self.output.exists())
        hardlink.unlink()
        self.base.chmod(0o777)
        self.addCleanup(self.base.chmod, 0o700)
        with self.assertRaises(self.mod.PreparationError): self.prepare()
        self.assertFalse(self.output.exists())

    def test_failure_keeps_existing_files_and_new_partial_directory(self):
        real_open = os.open
        def failing_open(path, flags, *args, **kwargs):
            if path == 'runner.json' and flags & os.O_CREAT:
                raise OSError('synthetic secret must not reach diagnostics')
            return real_open(path, flags, *args, **kwargs)
        with mock.patch.object(self.mod.os, 'open', side_effect=failing_open):
            with self.assertRaises(self.mod.PreparationError) as caught:
                self.prepare()
        self.assertNotIn('synthetic secret', str(caught.exception))
        self.assertTrue(self.output.is_dir())
        self.assertFalse((self.output / 'manifest.json').exists())
        exact = self.output / 'apps/control/worker/index.mjs'
        self.assertEqual(exact.read_bytes(), (ROOT / 'apps/control/worker/index.mjs').read_bytes())
        with self.assertRaises(self.mod.PreparationError): self.prepare()
        self.assertEqual(exact.read_bytes(), (ROOT / 'apps/control/worker/index.mjs').read_bytes())

    def test_profile_and_output_reject_any_git_checkout_ancestor(self):
        for marker_kind in ('file', 'directory', 'symlink'):
            with self.subTest(marker_kind=marker_kind):
                checkout = self.base / ('checkout-' + marker_kind)
                checkout.mkdir()
                marker = checkout / '.git'
                if marker_kind == 'directory':
                    marker.mkdir()
                elif marker_kind == 'symlink':
                    marker.symlink_to('synthetic-missing-git-directory')
                else:
                    marker.write_text('gitdir: synthetic-unused-location')
                nested = checkout / 'private'; nested.mkdir()
                sentinel = nested / 'sentinel'; sentinel.write_text('keep')
                private_profile = nested / 'profile.json'
                private_profile.write_bytes(self.input.read_bytes()); private_profile.chmod(0o600)
                with mock.patch.object(self.mod, 'build_files', side_effect=AssertionError('must reject before key generation')):
                    with self.assertRaises(self.mod.PreparationError):
                        self.mod.prepare_deployment(private_profile, self.output)
                    with self.assertRaises(self.mod.PreparationError):
                        self.mod.prepare_deployment(self.input, nested / 'new-bundle')
                self.assertEqual(sentinel.read_text(), 'keep')
                self.assertFalse(self.output.exists())
                self.assertFalse((nested / 'new-bundle').exists())

    def test_cli_diagnostics_do_not_disclose_profile(self):
        p = profile(); p['domain'] = 'TOP_SECRET_BAD_DOMAIN'; self.write(p)
        result = subprocess.run([sys.executable, str(ROOT / 'tools/prepare_deployment.py'), '--profile', str(self.input), '--output', str(self.output)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('TOP_SECRET', result.stdout + result.stderr)
        self.assertNotIn(str(self.input), result.stdout + result.stderr)
        self.assertNotIn('Traceback', result.stderr)


if __name__ == '__main__': unittest.main()
