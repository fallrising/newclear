"""Offline proposal must expose uncertainty and never become an authorization."""
import copy
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import test_authorization as fixtures

SPEC=importlib.util.spec_from_file_location('plan_service',fixtures.ROOT/'tools/plan_service.py')
m=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(m)
NOW=fixtures.NOW


def config():
    return dict(base_url='https://lab.example',audience='test',credential_id='key-runner',generation=1,
        secret_hex='ab'*32,cloudflare_access_client_id='synthetic-client',cloudflare_access_client_secret='synthetic-secret',
        journal_path='journal.sqlite',workspace_id='workspace',resource_ref={'resource_id':'node','generation':1},
        recipe_ref={'recipe_id':'node-health','version':'1.0.0','digest':'sha256:'+'a'*64})


class PlanTests(unittest.TestCase):
    def setUp(self):self.snapshot=fixtures.snapshot();self.config=config()
    def plan(self,**kw):return m.make_plan(self.snapshot,self.config,days=kw.get('days',7),poll_seconds=kw.get('poll_seconds',60),now=kw.get('now',NOW))

    def test_fixed_windows_estimates_and_no_authority(self):
        before=copy.deepcopy(self.snapshot),copy.deepcopy(self.config)
        p=self.plan()
        self.assertEqual(p['offsets_seconds'],{'service_until':604800,'runner_grant_until':605400,'runner_hmac_until':605400,'access_until':606000})
        self.assertEqual(p['estimate']['idle_claims_per_24h'],1440)
        self.assertEqual(p['estimate']['single_start_idle_requests'],10081)
        self.assertEqual(p['estimate']['single_start_all_cycles_report_requests'],20161)
        self.assertIsNone(p['estimate']['d1_rows_read']);self.assertIsNone(p['estimate']['bill'])
        self.assertTrue(p['approval_required']);self.assertFalse(p['applied']);self.assertFalse(p['activation_ready'])
        self.assertNotIn('query',p);self.assertNotIn('service_until',p)
        self.assertEqual((self.snapshot,self.config),before)
        raw=json.dumps(p)
        for secret in (self.config['secret_hex'],self.config['cloudflare_access_client_secret'],self.config['cloudflare_access_client_id']):self.assertNotIn(secret,raw)

    def test_poll_rounds_up_and_only_bounded_integer_options(self):
        self.assertEqual(self.plan(days=1,poll_seconds=59)['estimate']['idle_claims_per_24h'],1465)
        for key,values in [('days',[0,8,True,1.5,'7']),('poll_seconds',[0,4,61,False,5.5,'60'])]:
            for value in values:
                with self.subTest(key=key,value=value),self.assertRaises(m.PlanError):self.plan(**{key:value})

    def test_unknown_and_stale_sources_not_refreshed(self):
        row=self.snapshot['subjects'][0];row['credential']=None;row['access_service']=None;row['runner_stop_at']=None
        p=self.plan(now=NOW+301)
        self.assertFalse(p['snapshot_fresh']);self.assertEqual(p['observed_at'],self.snapshot['observed_at'])
        self.assertIn('credential',p['unknown_layers']);self.assertIn('access_service',p['unknown_layers'])
        self.assertTrue(p['requires_recollection_before_activation'])
        self.assertFalse(p['activation_ready'])

    def test_known_revocation_and_busy_refused(self):
        variants=[]
        for section in ('grant','credential','access_service'):
            s=fixtures.snapshot();s['subjects'][0][section]['revoked']=1 if section=='grant' else True;variants.append(s)
        s=fixtures.snapshot();s['active_commands']=1;variants.append(s)
        s=fixtures.snapshot();s['schedules_enabled']=True;variants.append(s)
        for value in variants:
            self.snapshot=value
            with self.assertRaises(m.PlanError):self.plan()

    def test_config_scope_known_identity_and_access_refused(self):
        for key,value in [('workspace_id','wrong'),('credential_id','wrong'),('generation',2),('resource_ref',{'resource_id':'other','generation':1})]:
            self.config=config();self.config[key]=value
            with self.subTest(key=key),self.assertRaises(m.PlanError):self.plan()
        self.config=config();del self.config['cloudflare_access_client_id'];del self.config['cloudflare_access_client_secret']
        with self.assertRaises(m.PlanError):self.plan()

    def test_exact_runner_capabilities_required(self):
        row=self.snapshot['subjects'][0];policy=json.loads(row['grant']['policy']);policy['capabilities']=['runs:reconcile'];row['grant']['policy']=json.dumps(policy)
        with self.assertRaises(m.PlanError):self.plan()

    def test_config_digest_matches_runtime_canonical_json(self):
        import hashlib
        self.assertEqual(self.plan()['config_sha256'],hashlib.sha256(m.runner.encode(self.config)).hexdigest())
        self.config['secret_hex']='cd'*32
        self.assertNotEqual(self.plan()['config_sha256'],m.runner.hashlib.sha256(m.runner.encode(config())).hexdigest())

    def test_shared_access_roles_explicit_without_renewing_other_grants(self):
        row=copy.deepcopy(self.snapshot['subjects'][0]);row['role']='bot';row['runner_stop_at']=None;row['credential']=None;row['grant']['id']='bot-grant'
        policy=json.loads(row['grant']['policy']);policy['principal_id']='bot';policy['capabilities']=['commands:read'];row['grant']['policy']=json.dumps(policy)
        self.snapshot['subjects'].append(row)
        p=self.plan();self.assertEqual(p['shared_access_roles'],['bot','runner'])
        self.assertEqual(p['renew_roles'],['runner'])

    def test_future_snapshot_and_missing_runner_grant_refused(self):
        with self.assertRaises(m.PlanError):self.plan(now=NOW-1)
        self.snapshot['subjects'][0]['grant']=None
        with self.assertRaises(m.PlanError):self.plan()


class FileTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.source=self.root/'snapshot.json';self.config=self.root/'config.json';self.output=self.root/'plan.json'
        self.source.write_text(json.dumps(fixtures.snapshot()));self.config.write_text(json.dumps(config()))
        for p in (self.source,self.config):p.chmod(0o600)

    def run_plan(self):return m.run(self.source,self.config,self.output,days=7,poll_seconds=60,now=NOW)

    def test_private_exclusive_output_redacted_and_runtime_rejects_proposal(self):
        # Launcher temp root is below a Git ancestor. Patch only that guard here;
        # a separate test below checks the unpatched rejection, and real CLI is external.
        with patch.object(m.auth.files,'require_outside_checkout'):
            result=self.run_plan()
            self.assertEqual(set(result),{'saved','applied','sha256'})
            self.assertEqual(self.output.stat().st_mode&0o777,0o600)
            before=self.output.read_bytes()
            with self.assertRaises(m.PlanError):self.run_plan()
            self.assertEqual(self.output.read_bytes(),before)
        cfg=m.runner.Config.from_dict(config());cfg._loaded_sha256=json.loads(before)['config_sha256']
        with self.assertRaises(m.runner.ProtocolError):m.runner.read_service_policy(self.output,cfg)

    def test_unsafe_files_and_parent_never_publish(self):
        with patch.object(m.auth.files,'require_outside_checkout'):
            self.config.chmod(0o644)
            with self.assertRaises(m.PlanError):self.run_plan()
            self.config.chmod(0o600);alias=self.root/'alias';alias.symlink_to(self.source)
            with self.assertRaises(m.PlanError):m.run(alias,self.config,self.output,days=7,poll_seconds=60,now=NOW)
            hard=self.root/'hard';os.link(self.source,hard)
            with self.assertRaises(m.PlanError):self.run_plan()
            hard.unlink();self.root.chmod(0o777)
            try:
                with self.assertRaises(m.PlanError):self.run_plan()
            finally:self.root.chmod(0o700)
        self.assertFalse(self.output.exists())

    def test_git_checkout_guard_is_not_bypassed(self):
        (self.root/'.git').mkdir()
        with self.assertRaises(m.PlanError):self.run_plan()
        self.assertFalse(self.output.exists())

    def test_cli_errors_never_echo_private_inputs(self):
        self.config.chmod(0o644)
        with contextlib.redirect_stderr(io.StringIO()) as err,contextlib.redirect_stdout(io.StringIO()) as out:
            code=m.main(['--snapshot',str(self.source),'--config',str(self.config),'--output',str(self.output),'--days','7','--poll-seconds','60'])
        self.assertEqual(code,1)
        self.assertEqual(out.getvalue(),'')
        self.assertNotIn(str(self.root),err.getvalue());self.assertNotIn('synthetic-secret',err.getvalue())


if __name__=='__main__':unittest.main()
