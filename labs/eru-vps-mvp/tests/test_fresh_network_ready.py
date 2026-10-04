"""Manual console contracts, synthetic data only."""
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fresh_network_ready as ready
from fresh_observation import public_key


def setup(render):
    key = render['hosts'][1]['files'][1]['content'].split('ssh-ed25519 ', 1)[1].strip()
    return {'schema_version': 1,
        'hosts': [{'host_index': i, 'public_ipv4': '8.8.8.' + str(i + 1),
                   'public_ipv6': None, 'console_action_ref': 'console-' + str(i),
                   'authorized_keys_sha256': None if i == 0 else render['hosts'][i]['files'][1]['sha256']} for i in range(4)],
        'core_key': {'path': '/root/.ssh/eru-fresh-core',
                     'public_key_sha256': public_key('ssh-ed25519 ' + key)},
        'worker_authorized_keys_path': '/home/ckc/.ssh/authorized_keys',
        'core_known_hosts_path': '/etc/eru/known_hosts',
        'worker_helper_path': '/usr/local/libexec/eru-ssh-command',
        'worker_helper_sha256': hashlib.sha256(b'reviewed-helper').hexdigest(),
        'controller_egress': {'interface': 'eth0', 'source_ipv4': '192.168.1.20', 'source_ipv6': None}}


class ManualContractTests(unittest.TestCase):
    def setUp(self):
        from test_fresh_network_probe import fixture
        self.render, self.setup, _ = fixture()

    def test_setup_binds_effective_paths_and_key(self):
        ready.validate_setup(self.setup, self.render)
        for change in (lambda v: v['hosts'][1].update(console_action_ref='console-0'),
                       lambda v: v['hosts'][0].update(public_ipv4='10.0.0.1'),
                       lambda v: v['core_key'].update(public_key_sha256='f'*64),
                       lambda v: v.update(worker_authorized_keys_path='/tmp/key')):
            v = copy.deepcopy(self.setup)
            change(v)
            with self.assertRaises(ValueError):
                ready.validate_setup(v, self.render)

    def test_four_actions_bind_identity_endpoints_and_content(self):
        actions = ready.manual_actions(self.setup, self.render)
        self.assertEqual(len(actions), 4)
        self.assertEqual(actions[0]['effective_access']['known_hosts_sha256'],
                         self.render['hosts'][0]['files'][1]['sha256'])
        self.assertEqual(actions[1]['effective_access']['authorized_keys_sha256'],
                         self.setup['hosts'][1]['authorized_keys_sha256'])
        self.assertEqual(actions[1]['host']['ip'], self.render['hosts'][1]['ip'])

    def test_manual_authority_and_receipts_reject_cross_scope_and_preintent_actions(self):
        now = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)
        intent = {'plan_id': 'plan', 'plan_sha256': 'a'*64, 'execution_sha256': 'b'*64,
                  'pending_sha256': 'c'*64, 'input': {'path': 'private/setup.json', 'sha256': 'd'*64},
                  'created_at': now.isoformat(), 'actions': ready.manual_actions(self.setup, self.render)}
        auth = {'schema_version': 1, 'operation': ready.OPERATION+'-authorization',
                **{k:intent[k] for k in ('plan_id','plan_sha256','execution_sha256','pending_sha256')},
                'setup_sha256': 'd'*64, 'scope':'manual-console-network-and-access-only',
                'owner_confirmed':True, 'authorized_at':now.isoformat(),
                'expires_at':(now+timedelta(minutes=15)).isoformat()}
        ready.authorization(auth,intent,now)
        for key,value in [('setup_sha256','f'*64),('scope','stage-network-files-only'),
                          ('schema_version',True),('owner_confirmed',1)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                ready.authorization({**auth,key:value},intent,now)
        receipt = {'schema_version':1,'operation':ready.OPERATION+'-receipt',
                   'intent_sha256':'e'*64,'owner_confirmed':True,'hosts':[
                    {'action':a,'started_at':now.isoformat(),'completed_at':now.isoformat(),
                     'owner_confirmed':True} for a in intent['actions']]}
        ready.validate_manual_receipt(receipt,intent,'e'*64,now)
        for change in (lambda v:v['hosts'].pop(), lambda v:v['hosts'].__setitem__(1,v['hosts'][0]),
                       lambda v:v['hosts'][0].update(started_at=(now-timedelta(seconds=1)).isoformat()),
                       lambda v:v.update(owner_confirmed=1),lambda v:v.update(schema_version=True)):
            value=copy.deepcopy(receipt)
            change(value)
            with self.assertRaises(ValueError):
                ready.validate_manual_receipt(value,intent,'e'*64,now)
