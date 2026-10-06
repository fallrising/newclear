"""Local immutable journal tests plus an unmodified-network fixture for integration.

Journal cases replace only derivation/network/helper collection with deterministic
synthetic contracts; they do not claim actual host or network acceptance.
"""
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

import fresh_bootstrap as contract
import fresh_bootstrap_ops as ops
from fresh_execution import timestamp
from fresh_rebuild import plan_digest


class NetworkBootstrapFixture:
    """Real review/execution/network chain with synthetic pinned public binary.

    Call setUp()/doCleanups(); prepare_inputs() returns the strict request ref.
    All provenance changes happen before the first review/execution is prepared.
    """
    def setUp(self, *, artifact_lock=None):
        import test_fresh_rebuild as rebuild
        import test_fresh_network_ready_ops as ready
        self.token = b'synthetic-fresh-bootstrap-token-20261006'
        self.binary = b'synthetic-safe-node-add-binary'
        source = Path(ops.__file__).resolve().parents[1]
        original = rebuild.FreshRebuildPlanTests.setUp
        def setup(f):
            original(f)
            lock = artifact_lock or json.loads((source / 'artifacts.amd64.lock.json').read_text())
            f.write_json('artifacts.amd64.lock.json', lock)
            name = 'core-v0.1.5-safe-node-add'
            (f.project / 'patches' / (name + '.patch')).write_bytes((source / 'patches' / (name + '.patch')).read_bytes())
            validation = json.loads((source / 'patches' / (name + '.validation.json')).read_text())
            digest = hashlib.sha256(self.binary).hexdigest()
            validation['artifact_sha256'] = digest
            validation['independent_runner_verification']['artifact_sha256'] = digest
            f.write_json('patches/' + name + '.validation.json', validation)
            f.document['fresh_etcd']['target_token_sha256'] = hashlib.sha256(self.token).hexdigest()
            f.report['locks']['artifact_sha256'] = f.file_sha('artifacts.amd64.lock.json')
            f.rewrite_report()
        self.network = ready.NetworkReadyTests()
        with patch.object(rebuild.FreshRebuildPlanTests, 'setUp', setup):
            self.network.setUp()
        self.project = self.network.project
        self.now, self.source = self.network.now, self.network.source
        self.run = self.network.f.run
        self.network.manual()
        self.network.prerequisites()
        self.accepted = self.network.accept()
        if self.accepted['status'] != 'network-ready':
            raise AssertionError(self.accepted)
        self.plan = self.network.f.plan
        self.execution = json.loads((self.project / 'private/operations/fresh-rebuild/executions' /
                                     self.run / 'execution.json').read_text())
        self.prepare_inputs()

    def doCleanups(self):
        self.network.doCleanups()

    def write(self, path, value):
        return self.network.write(path, value)

    def raw(self, path, value):
        target = self.project / path
        target.write_bytes(value)
        target.chmod(0o600)
        return {'path': path, 'sha256': hashlib.sha256(value).hexdigest()}

    def prepare_inputs(self):
        baseline_ref = self.execution['execution']['evidence']['host_baseline']
        baseline = json.loads((self.project / baseline_ref['path']).read_text())
        network_plan = json.loads((self.project / ops.NETWORK_PLANS / self.plan['id'] / 'plan.json').read_text())['plan']
        self.document = {'schema_version': 1, 'operation': 'fresh-bootstrap-request',
            'run_id': self.run, 'execution_sha256': self.execution['sha256'],
            'pending_sha256': ops.pending_generation.inspect(self.project)['sha256'],
            'plan_id': self.plan['id'], 'plan_sha256': self.plan['sha256'],
            'network_receipt_sha256': self.accepted['receipt_sha256'],
            'token_file': self.raw('private/bootstrap-token.bin', self.token),
            'safe_core_binary': self.raw('private/bootstrap-core.bin', self.binary),
            'artifact_lock_sha256': hashlib.sha256((self.project / 'artifacts.amd64.lock.json').read_bytes()).hexdigest(),
            'capacities': [{'node': h['node'], 'resource_capacity': {'storage': {'storage': 10737418240}},
                            'labels': {'owner': 'eru-vps-mvp', 'role': 'worker'}} for h in network_plan['render']['hosts'][1:]],
            'prior_baseline': baseline['observation']}
        self.inputpath = 'private/bootstrap-input.json'
        self.inputsha = self.write(self.inputpath, self.document)
        return {'path': self.inputpath, 'sha256': self.inputsha}


class Adapter:
    def __init__(self, test):
        self.test, self.states, self.calls, self.lose = test, {}, [], False

    def observe(self, action):
        index = action['step_index']
        self.calls.append(('observe', index))
        readonly = index in contract.ACCEPTANCE
        complete = readonly or index in self.states
        provenance = self.states.get(index)
        return {'schema_version': 1, 'action_sha256': plan_digest(action),
            'observed_at': self.test.clock.isoformat(),
            'host': {k: action['host'][k] for k in contract.HOST_FIELDS},
            'state': 'complete' if complete else 'absent', 'provenance': copy.deepcopy(provenance),
            'evidence': {'files': [], 'commands': [], 'services': []}}

    def dispatch(self, action, digest):
        index = action['step_index']
        self.calls.append(('dispatch', index))
        intent = json.loads((self.test.project / ops._path('run', index) / 'intent.json').read_text())
        self.test.assertEqual(intent['sha256'], digest)
        self.states[index] = {'intent_sha256': digest, 'action_sha256': plan_digest(action),
            'started_at': self.test.clock.isoformat(), 'completed_at': self.test.clock.isoformat()}
        if self.lose:
            raise OSError('PRIVATE-LOST-REPLY')


class BootstrapJournalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.project = Path(self.tmp.name)
        (self.project / 'private').mkdir(mode=0o700)
        self.clock = datetime(2026, 10, 6, tzinfo=timezone.utc)
        self.pending = {'status': 'pending', 'sha256': '3'*64}
        self.dependency = self.project / 'private/input.json'
        self.dependency.write_text('{}')
        self.dependency.chmod(0o600)
        hosts = [{'alias': 'host-'+str(i), 'node': 'node-'+str(i), 'ip': '100.64.0.'+str(i+1),
                  'machine_id': 'new-machine-'+str(i), 'boot_id': 'new-boot-'+str(i),
                  'host_key_sha256': str(i+1)*64, 'files': []} for i in range(4)]
        workers = [{**h, 'podname': 'eru', 'endpoint': 'ssh://'+h['ip'],
                    'resource_capacity': {'storage': {'storage': 10}}, 'labels': {'role': 'worker'}} for h in hosts[1:]]
        self.plan = {'schema_version': 1, 'operation': 'fresh-bootstrap-plan', 'run_id': 'run',
            'plan_id': 'network', 'plan_sha256': '1'*64, 'execution_sha256': '2'*64,
            'pending_sha256': '3'*64, 'network_receipt_sha256': '4'*64,
            'input': {'path': 'private/input.json', 'sha256': hashlib.sha256(b'{}').hexdigest()},
            'created_at': self.clock.isoformat(), 'private_identity': list((os.stat(self.project/'private').st_dev, os.stat(self.project/'private').st_ino)),
            'network_render': {'hosts': hosts, 'controller_known_hosts': '\n'.join(h['ip']+' key'+str(i) for i,h in enumerate(hosts))},
            'network_setup': {}, 'render': {'target_token_sha256': '5'*64, 'data_root':'/var/lib/eru-fresh/run',
                'safe_core_sha256':'6'*64, 'workers':workers}, 'prior': {'cluster_id':'100','member_ids':['200']},
            'dependencies': [{'path':'private/input.json','sha256':hashlib.sha256(b'{}').hexdigest()}]}
        network_path = self.project / ops.NETWORK_RECEIPTS / 'run'
        network_path.mkdir(parents=True, mode=0o700)
        for directory in (self.project / 'private').rglob('*'):
            if directory.is_dir():
                directory.chmod(0o700)
        (network_path / 'receipt.json').write_text('{}')
        (network_path / 'receipt.json').chmod(0o600)
        self.digest = plan_digest(self.plan)
        self.adapter = Adapter(self)
        self.addCleanup(patch.stopall)
        patch.object(ops.pending_generation, 'inspect', side_effect=lambda _: copy.deepcopy(self.pending)).start()
        patch.object(ops.authority, 'active', return_value=types.SimpleNamespace(historical=False)).start()
        patch.object(ops.authority, 'check_current', return_value=None).start()
        patch.object(ops._Session, 'derive', side_effect=lambda *a: copy.deepcopy(self.plan)).start()
        patch.object(ops._Session, 'network_valid', autospec=True, side_effect=self.network_valid).start()
        helper = types.ModuleType('fresh_bootstrap_host')
        helper.validate_evidence = self.evidence
        patch.dict('sys.modules', {'fresh_bootstrap_host': helper}).start()
        result = ops.prepare_bootstrap.__wrapped__(self.project, 'network', '1'*64, '4'*64,
            'private/input.json', hashlib.sha256(b'{}').hexdigest(), now=lambda:self.clock)
        self.assertEqual(result['status'], 'bootstrap-planned')
        self.auths = {}

    def network_valid(self, session, evidence, index, now, *, after=False):
        contract.fresh(evidence['observed_at'], now)
        if evidence['services'] != contract.expected_services(index, after=after):
            raise ValueError('synthetic network phase drift')

    def collector(self, render, keys, *, setup, now, expected_services):
        return {'observed_at': now.isoformat(), 'services': expected_services}

    def evidence(self, action, observed, *, before=False):
        return {'etcd': {'cluster_id':'101','member_id':'201','member_ids':['201'],'healthy':True,
                         'keys': [], 'token_sha256':'5'*64,'data_root':'/var/lib/eru-fresh/run'},
                'core':{'readable':True,'runtime_sha256':'6'*64,'invocation_id':'core-new'},
                'agent':{'runtime_sha256':'7'*64,'invocation_id':'agent-'+str(action['host_index'])},
                'workers': [{k:h[k] for k in ('node','podname','endpoint','resource_capacity','labels')} |
                            {'available':True,'bypass':False} for h in self.plan['render']['workers']]}

    def auth(self, index):
        if index not in self.auths:
            action = contract.action(self.plan, self.digest, index)
            value = {'schema_version':1,'operation':'fresh-bootstrap-authorization',
                **{k:action[k] for k in contract.BINDING},'scope':'fresh-bootstrap-one-step-only',
                'owner_confirmed':True,'authorized_at':self.clock.isoformat(),
                'expires_at':(self.clock+timedelta(minutes=15)).isoformat()}
            path = 'private/auth-'+str(index)+'.json'
            raw = json.dumps(value).encode()
            (self.project/path).write_bytes(raw)
            (self.project/path).chmod(0o600)
            self.auths[index] = path, hashlib.sha256(raw).hexdigest()
        return self.auths[index]

    def execute(self, index=0):
        path, digest = self.auth(index)
        return ops.execute_bootstrap.__wrapped__(self.project,'run',self.digest,index,path,digest,
            self.adapter,self.collector,now=lambda:self.clock)

    def recover(self, result, index=0):
        return ops.reconcile_bootstrap.__wrapped__(self.project,'run',index,result['intent_sha256'],
            self.adapter,self.collector,now=lambda:self.clock)

    def inspect(self):
        return ops.inspect_bootstrap(self.project,'run',self.digest,now=lambda:self.clock)

    def test_lost_reply_never_replayed_and_recovery_preserves_original_interval(self):
        self.adapter.lose = True
        result = self.execute()
        self.assertEqual(result['status'],'uncertain')
        calls = list(self.adapter.calls)
        self.assertEqual(self.execute()['status'],'uncertain')
        self.assertEqual(self.adapter.calls,calls)
        self.clock += timedelta(hours=2)
        self.assertEqual(self.inspect()['status'],'uncertain')
        recovered = self.recover(result)
        self.assertEqual(recovered['status'],'bootstrap-step-complete')
        self.assertEqual([x for x in self.adapter.calls if x[0]=='dispatch'],[('dispatch',0)])
        self.assertFalse(recovered['generation_changed'])
        self.assertNotIn('PRIVATE',json.dumps(recovered))

    def test_failed_preflight_has_zero_dispatch_and_keeps_unknown_data(self):
        with patch.object(self.adapter,'observe', side_effect=OSError('unknown data')):
            self.assertEqual(self.execute()['status'],'blocked')
        self.assertEqual(self.adapter.calls,[])
        self.assertFalse((self.project/ops._path('run',0)).exists())
        poison=self.project/ops._path('run')/'unknown'
        poison.write_text('preserve')
        self.assertEqual(self.execute()['status'],'blocked')
        self.assertEqual(poison.read_text(),'preserve')

    def test_order_raw_drift_and_pending_change_before_dispatch(self):
        self.assertEqual(self.execute(1)['status'],'blocked')
        self.assertEqual(self.adapter.calls,[])
        observe=self.adapter.observe
        def drift(action):
            value=observe(action)
            self.dependency.write_bytes(b'{} ')
            return value
        with patch.object(self.adapter,'observe',side_effect=drift):
            self.assertEqual(self.execute()['status'],'blocked')
        self.assertFalse(any(x[0]=='dispatch' for x in self.adapter.calls))

    def test_all_fixed_steps_exact_acceptance_and_local_status(self):
        for index in range(22):
            with self.subTest(index=index):
                result=self.execute(index)
                expected=contract.stage(index) if index in contract.ACCEPTANCE else 'bootstrap-step-complete'
                self.assertEqual(result['status'],expected)
            self.clock += timedelta(seconds=2)
        self.assertEqual(result['next_stage'],'apps-replayed')
        self.assertEqual(len([x for x in self.adapter.calls if x[0]=='dispatch']),20)
        calls=list(self.adapter.calls)
        result=self.inspect()
        self.assertEqual(result['journal_receipt_count'],22)
        self.assertEqual(self.adapter.calls,calls)
        self.assertFalse(result['current_network_ready'])
        real_open=os.open
        def readonly(path, flags, *a, **kw):
            self.assertEqual(flags & (os.O_CREAT|os.O_RDWR|os.O_WRONLY|os.O_TRUNC),0)
            return real_open(path,flags,*a,**kw)
        with patch.object(os,'open',side_effect=readonly):
            self.assertEqual(self.inspect()['status'],'historically-valid')

    def test_uncertain_action_cannot_continue_or_reconcile_absence(self):
        self.adapter.lose=True
        result=self.execute()
        self.assertEqual(self.execute(1)['status'],'blocked')
        self.adapter.states.clear()
        self.assertEqual(self.recover(result)['status'],'uncertain')
        self.assertEqual([x for x in self.adapter.calls if x[0]=='dispatch'],[('dispatch',0)])

    def test_recovery_rejects_writer_completion_outside_original_authority(self):
        self.adapter.lose=True
        result=self.execute()
        self.clock+=timedelta(minutes=20)
        self.adapter.states[0]['completed_at']=self.clock.isoformat()
        self.assertEqual(self.recover(result)['status'],'blocked')
        self.assertFalse((self.project/ops._path('run',0)/'receipt.json').exists())
        self.adapter.states[0]['completed_at'] = self.adapter.states[0]['started_at']
        self.assertEqual(self.recover(result)['status'], 'bootstrap-step-complete')

    def test_stale_network_and_pending_drift_have_zero_writer_calls(self):
        observe = self.adapter.observe
        def stale(action):
            value = observe(action)
            self.clock += timedelta(minutes=16)
            return value
        with patch.object(self.adapter, 'observe', side_effect=stale):
            self.assertEqual(self.execute()['status'], 'blocked')
        self.assertFalse(any(kind == 'dispatch' for kind, _ in self.adapter.calls))
        self.clock -= timedelta(minutes=16)
        def changed(action):
            value = observe(action)
            self.pending['sha256'] = '8'*64
            return value
        with patch.object(self.adapter, 'observe', side_effect=changed):
            self.assertEqual(self.execute()['status'], 'blocked')
        self.assertFalse(any(kind == 'dispatch' for kind, _ in self.adapter.calls))

    def test_original_auth_raw_drift_after_observation_blocks_dispatch(self):
        self.auth(0)
        observe = self.adapter.observe
        def changed(action):
            value = observe(action)
            path = self.project / self.auths[0][0]
            path.write_bytes(path.read_bytes()+b' ')
            return value
        with patch.object(self.adapter, 'observe', side_effect=changed):
            self.assertEqual(self.execute()['status'], 'blocked')
        self.assertFalse(any(kind == 'dispatch' for kind, _ in self.adapter.calls))

    def test_late_intent_expiry_never_dispatches_and_poison_stays(self):
        publish = ops._publish
        def late(files, directory, name, value):
            digest = publish(files, directory, name, value)
            if name == 'intent.json':
                self.clock += timedelta(minutes=16)
            return digest
        with patch.object(ops, '_publish', side_effect=late):
            self.assertEqual(self.execute()['status'], 'blocked')
        self.assertFalse(any(kind == 'dispatch' for kind, _ in self.adapter.calls))
        self.assertTrue((self.project/ops._path('run',0)/'.publication-failed').exists())

    def test_receipt_publication_failure_cannot_replay_or_overwrite(self):
        publish = ops._publish
        def late(files, directory, name, value):
            digest = publish(files, directory, name, value)
            if name == 'receipt.json':
                raise OSError('synthetic late fsync failure')
            return digest
        with patch.object(ops, '_publish', side_effect=late):
            self.assertEqual(self.execute()['status'], 'blocked')
        self.assertEqual(self.execute()['status'], 'blocked')
        self.assertEqual([x for x in self.adapter.calls if x[0]=='dispatch'], [('dispatch',0)])
        self.assertTrue((self.project/ops._path('run',0)/'receipt.json').exists())

    def test_receipt_pins_raw_intent_and_successor_pins_raw_predecessor(self):
        self.assertEqual(self.execute()['status'], 'bootstrap-step-complete')
        intent = self.project/ops._path('run',0)/'intent.json'
        original = intent.read_bytes()
        intent.write_bytes(original+b' ')
        self.assertEqual(self.inspect()['status'], 'blocked')
        intent.write_bytes(original)
        self.assertEqual(self.execute(1)['status'], 'bootstrap-step-complete')
        receipt = self.project/ops._path('run',0)/'receipt.json'
        receipt.write_bytes(receipt.read_bytes()+b' ')
        self.assertEqual(self.inspect()['status'], 'blocked')
        self.assertEqual(self.execute(2)['status'], 'blocked')

    def test_empty_accept_rejects_old_identity_and_nonempty_global_keyspace(self):
        self.execute(0)
        self.execute(1)
        helper = __import__('fresh_bootstrap_host')
        for field, value in [('cluster_id','100'),('member_ids',['200']),('keys',['foreign-key'])]:
            def wrong(action, observed, *, before=False):
                result = self.evidence(action, observed, before=before)
                result['etcd'][field] = value
                return result
            with self.subTest(field=field), patch.object(helper,'validate_evidence',side_effect=wrong):
                self.assertEqual(self.execute(2)['status'], 'blocked')
        self.assertFalse((self.project/ops._path('run',2)).exists())
        self.assertEqual(self.execute(2)['status'], 'empty-control-plane')

    def test_final_acceptance_rejects_worker_and_agent_continuity_drift(self):
        for index in range(21):
            self.assertNotEqual(self.execute(index)['status'], 'blocked')
        helper = __import__('fresh_bootstrap_host')
        def wrong(action, observed, *, before=False):
            result = self.evidence(action, observed, before=before)
            if action['step_index'] == 21:
                result['workers'][2]['available'] = False
            return result
        with patch.object(helper,'validate_evidence',side_effect=wrong):
            self.assertEqual(self.execute(21)['status'], 'blocked')
        self.assertFalse((self.project/ops._path('run',21)).exists())
        # A newly observed agent incarnation is not the accepted start action.
        observe = self.adapter.observe
        def restarted(action):
            value = observe(action)
            if action['step_index'] == 19:
                value['provenance']['action_sha256'] = '9'*64
            return value
        with patch.object(self.adapter,'observe',side_effect=restarted):
            self.assertEqual(self.execute(21)['status'], 'blocked')
        # Readonly uncertain acceptance remains observable after corrected facts.
        intent = json.loads((self.project/ops._path('run',21)/'intent.json').read_text())
        self.assertEqual(self.recover({'intent_sha256':intent['sha256']},21)['status'],'cluster-bootstrapped')

    def test_historical_network_sample_within_ttl_is_not_current_collection(self):
        original = self.collector
        def stale(*args, **kwargs):
            evidence = original(*args, **kwargs)
            evidence['observed_at'] = (self.clock-timedelta(seconds=1)).isoformat()
            return evidence
        self.collector = stale
        self.assertEqual(self.execute()['status'], 'blocked')
        self.assertEqual(self.adapter.calls, [])
