"""Synthetic strict policy contract; no nft process or kernel compatibility claim."""
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fresh_network_access as access
import fresh_network_firewall as policy


def fixture(index=0):
    hosts = [{'alias': 'ckc-disposable-%02d' % (i + 1), 'node': 'worker-' + str(i + 1),
              'ip': '100.100.1.' + str(i + 1), 'machine_id': 'machine-' + str(i),
              'boot_id': '00000000-0000-0000-0000-%012d' % i,
              'host_key_sha256': str(i + 1) * 64} for i in range(4)]
    for i, host in enumerate(hosts):
        host['files'] = [access._file('/etc/eru/fresh-access.nft',
            access._firewall(hosts, i, '100.100.1.10', 'tailscale0')),
            access._file('/etc/eru/' + ('known_hosts' if i == 0 else 'fresh-core-authorized-key'), 'fixture\n')]
    plan = {'id': 'plan-1', 'run_id': 'run-1', 'execution_sha256': 'a' * 64,
            'render': {'profile': 'A', 'private_interface': 'tailscale0',
                       'controller_ip': '100.100.1.10', 'controller_known_hosts': 'fixture\n', 'hosts': hosts}}
    return plan, 'b' * 64, {'sha256': 'c' * 64}, index, 'd' * 64, 'e' * 64


class FirewallContractTests(unittest.TestCase):
    def setUp(self):
        self.args = fixture()
        self.action = policy.action(*self.args)
        self.now = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)

    def test_core_policy_matches_independent_allowed_tuples(self):
        document = policy.expected_ruleset(self.action)
        rules = document['nftables']
        self.assertEqual(rules[:2], [
            {'table': {'family': 'inet', 'name': 'eru_fresh_access'}},
            {'chain': {'family': 'inet', 'table': 'eru_fresh_access', 'name': 'input',
                       'type': 'filter', 'hook': 'input', 'prio': -20, 'policy': 'accept'}}])
        self.assertEqual(rules[2]['rule']['expr'], [
            {'match': {'op': '==', 'left': {'meta': {'key': 'iifname'}}, 'right': 'lo'}}, {'accept': None}])
        tuples = []
        for row in rules[3:-1]:
            expressions = row['rule']['expr']
            self.assertEqual(row['rule']['family'], 'inet')
            self.assertEqual(row['rule']['table'], 'eru_fresh_access')
            self.assertEqual(row['rule']['chain'], 'input')
            self.assertEqual([e['match']['left'] for e in expressions[:-1]], [
                {'meta': {'key': 'iifname'}}, {'payload': {'protocol': 'ip', 'field': 'saddr'}},
                {'payload': {'protocol': 'ip', 'field': 'daddr'}},
                {'payload': {'protocol': 'tcp', 'field': 'dport'}}])
            self.assertEqual([e['match']['op'] for e in expressions[:-1]], ['=='] * 4)
            self.assertEqual(expressions[-1], {'accept': None})
            tuples.append(tuple(e['match']['right'] for e in expressions[:-1]))
        self.assertEqual(tuples, [
            ('tailscale0', '100.100.1.10', '100.100.1.1', 22),
            ('tailscale0', '100.100.1.10', '100.100.1.1', 5001),
            ('tailscale0', '100.100.1.1', '100.100.1.1', 5001),
            ('tailscale0', '100.100.1.2', '100.100.1.1', 5001),
            ('tailscale0', '100.100.1.3', '100.100.1.1', 5001),
            ('tailscale0', '100.100.1.4', '100.100.1.1', 5001)])
        self.assertEqual(rules[-1]['rule']['expr'], [
            {'match': {'op': '==', 'left': {'payload': {'protocol': 'tcp', 'field': 'dport'}},
                       'right': {'set': [22, 80, 2375, 2376, 2379, 2380, 5001, 12345]}}}, {'drop': None}])
        policy.validate_ruleset(document, self.action)

    def test_each_worker_and_wireguard_bind_only_controller_and_core(self):
        for index in (1, 2, 3):
            args = fixture(index)
            expected = policy.action(*args)
            rows = policy.expected_ruleset(expected)['nftables']
            tuples = [tuple(e['match']['right'] for e in row['rule']['expr'][:-1])
                      for row in rows[3:-1]]
            self.assertEqual(tuples, [
                ('tailscale0', '100.100.1.10', '100.100.1.' + str(index + 1), 22),
                ('tailscale0', '100.100.1.1', '100.100.1.' + str(index + 1), 22),
                ('tailscale0', '100.100.1.10', '100.100.1.' + str(index + 1), 80),
                ('tailscale0', '100.100.1.1', '100.100.1.' + str(index + 1), 80)])
            plan = args[0]
            plan['render']['private_interface'] = 'wg0'
            for number, host in enumerate(plan['render']['hosts']):
                host['files'][0] = access._file('/etc/eru/fresh-access.nft',
                    access._firewall(plan['render']['hosts'], number, '100.100.1.10', 'wg0'))
            expected = policy.action(*args)
            rows = policy.expected_ruleset(expected)['nftables']
            self.assertTrue(all(row['rule']['expr'][0]['match']['right'] == 'wg0' for row in rows[3:-1]))

    def test_action_validates_every_host_payload_not_only_selected_host(self):
        mutations = [lambda p: p['render']['hosts'][3].update(alias='wrong'),
            lambda p: p['render']['hosts'][2].update(boot_id='invalid'),
            lambda p: p['render']['hosts'][2]['files'][0].update(content='flush ruleset\n'),
            lambda p: p['render']['hosts'][1]['files'][1].update(mode='0644'),
            lambda p: p['render']['hosts'][1]['files'][1].update(path='/root/.ssh/authorized_keys'),
            lambda p: p['render']['hosts'][2].update(machine_id=p['render']['hosts'][0]['machine_id']),
            lambda p: p['render']['hosts'][3].update(host_key_sha256=p['render']['hosts'][0]['host_key_sha256']),
            lambda p: p['render'].update(profile='B'),
            lambda p: p['render'].update(private_interface='eth0'),
            lambda p: p['render'].update(controller_ip='100.100.1.1'),
            lambda p: p['render']['hosts'][1].update(ip='8.8.8.8'),
            lambda p: p['render']['hosts'][3].update(ip=p['render']['hosts'][1]['ip'])]
        for change in mutations:
            args = list(fixture())
            change(args[0])
            with self.subTest(change=change), self.assertRaises(ValueError):
                policy.action(*args)

    def test_action_rejects_arbitrary_firewall_even_with_valid_hash(self):
        args = list(fixture())
        args[0]['render']['hosts'][0]['files'][0] = access._file('/etc/eru/fresh-access.nft', 'flush ruleset\n')
        with self.assertRaises(ValueError):
            policy.action(*args)

    def test_action_has_strict_hash_index_and_defensive_copy(self):
        for position, bad in ((1, True), (3, True), (3, -1), (3, 4), (4, 'bad'), (5, 'BAD' * 20)):
            args = list(fixture())
            args[position] = bad
            with self.subTest(position=position, bad=bad), self.assertRaises(ValueError):
                policy.action(*args)
        before = copy.deepcopy(self.action)
        self.args[0]['render']['hosts'][0]['files'][0]['content'] = 'changed'
        self.assertEqual(self.action, before)
        rows = policy.expected_ruleset(self.action)
        rows['nftables'][3]['rule']['expr'][0]['match']['left']['meta']['key'] = 'wrong'
        self.assertEqual(rows['nftables'][4]['rule']['expr'][0]['match']['left'], {'meta': {'key': 'iifname'}})

    def test_accepts_only_finite_top_level_metadata_without_modifying_input(self):
        document = policy.expected_ruleset(self.action)
        for number, row in enumerate(document['nftables']):
            next(iter(row.values()))['handle'] = number
        document['nftables'].insert(0, {'metainfo': {
            'version': '1.0.9', 'release_name': 'fixture', 'json_schema_version': 1}})
        original = copy.deepcopy(document)
        policy.validate_ruleset(document, self.action)
        self.assertEqual(document, original)
        self.assertEqual(policy.decode_ruleset(json.dumps(document).encode()), document)

    def test_handle_bool_float_negative_and_overflow_rejected(self):
        for handle in (True, False, -1, 1.0, '1', None, 2**64):
            for offset in (0, 1, 2):
                document = policy.expected_ruleset(self.action)
                next(iter(document['nftables'][offset].values()))['handle'] = handle
                with self.subTest(handle=handle, offset=offset), self.assertRaises(ValueError):
                    policy.validate_ruleset(document, self.action)

    def test_metainfo_position_schema_and_bounds_rejected(self):
        valid = {'version': '1.0.9', 'release_name': 'fixture', 'json_schema_version': 1}
        variants = [{**valid, 'json_schema_version': True}, {**valid, 'json_schema_version': 2},
                    {**valid, 'version': ''}, {**valid, 'version': 'x' * 129},
                    {**valid, 'release_name': 'line\nbreak'}, {**valid, 'extra': 1}]
        for meta in variants:
            document = policy.expected_ruleset(self.action)
            document['nftables'].insert(0, {'metainfo': meta})
            with self.subTest(meta=meta), self.assertRaises(ValueError):
                policy.validate_ruleset(document, self.action)
        for offset in (1, 3):
            document = policy.expected_ruleset(self.action)
            document['nftables'].insert(offset, {'metainfo': valid})
            with self.assertRaises(ValueError):
                policy.validate_ruleset(document, self.action)

    def test_rejects_semantic_near_misses_extra_objects_and_order(self):
        mutations = [lambda r: r[0]['table'].update(family='ip'),
            lambda r: r[0]['table'].update(flags=['dormant']),
            lambda r: r[1]['chain'].update(prio=-10),
            lambda r: r[1]['chain'].update(policy='drop'),
            lambda r: r[1]['chain'].update(hook='output'),
            lambda r: r[1]['chain'].update(type='nat'),
            lambda r: r[1]['chain'].update(dev='tailscale0'),
            lambda r: r[3]['rule'].update(comment='hidden metadata'),
            lambda r: r[3]['rule'].update(index=0),
            lambda r: r[3]['rule']['expr'].pop(0),
            lambda r: r[3]['rule']['expr'].pop(1),
            lambda r: r[3]['rule']['expr'].pop(2),
            lambda r: r[3]['rule']['expr'][0]['match'].update(right='eth0'),
            lambda r: r[3]['rule']['expr'][1]['match'].update(right='0.0.0.0/0'),
            lambda r: r[3]['rule']['expr'][1]['match'].update(op='!='),
            lambda r: r[3]['rule']['expr'][2]['match'].update(right='100.100.1.2'),
            lambda r: r[3]['rule']['expr'][3]['match']['left']['payload'].update(protocol='udp'),
            lambda r: r[3]['rule']['expr'][3]['match'].update(right=23),
            lambda r: r[3]['rule']['expr'].append({'counter': {'packets': 0, 'bytes': 0}}),
            lambda r: r[3]['rule']['expr'][-1].update(accept=True),
            lambda r: r[3]['rule']['expr'].__setitem__(-1, {'jump': {'target': 'elsewhere'}}),
            lambda r: r[3]['rule']['expr'][0]['match'].update(handle=1),
            lambda r: r[-1]['rule']['expr'][0]['match']['right']['set'].remove(2379),
            lambda r: r[-1]['rule']['expr'][0]['match']['right']['set'].append(443),
            lambda r: r[-1]['rule']['expr'].__setitem__(-1, {'accept': None}),
            lambda r: r.append(copy.deepcopy(r[3])),
            lambda r: r.append({'set': {'name': 'unknown'}}),
            lambda r: r.append({'table': {'family': 'inet', 'name': 'foreign'}}),
            lambda r: r.__setitem__(slice(3, 5), list(reversed(r[3:5]))),
            lambda r: r.pop()]
        for change in mutations:
            document = policy.expected_ruleset(self.action)
            change(document['nftables'])
            with self.subTest(change=change), self.assertRaises(ValueError):
                policy.validate_ruleset(document, self.action)

    def test_raw_json_strictness_and_decoded_bounds(self):
        for raw in (b'{"nftables":[],"nftables":[]}', b'{"nftables":[NaN]}',
                    b'{"nftables":[Infinity]}', b'{"nftables":[1e999]}', b'{"nftables":[]',
                    b'[]', b'{"nftables":{}}', b'\xff', 'not bytes',
                    b' ' * (policy.LIMIT + 1), b'[' * 2000 + b']' * 2000,
                    b'{"nftables":[' + b'[' * 20 + b']' * 20 + b']}'):
            with self.subTest(raw=str(raw)[:50]), self.assertRaises(ValueError):
                policy.decode_ruleset(raw)
        for value in ({'nftables': [None] * 5000}, {'nftables': [{'x': 'y' * 65537}]},
                      {'nftables': [], 'extra': 0}, {'nftables': [float('nan')]},
                      {'nftables': [1.0]}, {'nftables': [{1: 'key'}]}):
            with self.subTest(value=str(value)[:50]), self.assertRaises(ValueError):
                policy.validate_ruleset(value, self.action)
        nested = []
        nested.append(nested)
        with self.assertRaises(ValueError):
            policy.validate_ruleset({'nftables': nested}, self.action)

    def before(self):
        return {'observed_at': self.now.isoformat(),
                'host': {k: v for k, v in self.action['host'].items() if k != 'files'},
                'directory': {'path': '/etc/eru', 'kind': 'directory', 'uid': 0, 'gid': 0, 'mode': '0700'},
                'files': [{'path': f['path'], 'kind': 'regular', 'uid': 0, 'gid': 0,
                           'mode': '0600', 'nlink': 1, 'sha256': f['sha256'],
                           'intent_sha256': 'd' * 64} for f in self.action['host']['files']],
                'table': {'kind': 'absent'}}

    def after(self):
        result = self.before()
        result['table'] = {'kind': 'present', 'ruleset': policy.expected_ruleset(self.action),
                           'intent_sha256': 'f' * 64}
        return result

    def test_before_and_after_require_same_staged_bytes_and_incarnation(self):
        self.assertEqual(policy.observation(self.before(), self.action, self.now), self.now)
        self.assertEqual(policy.observation(self.after(), self.action, self.now, intent_sha='f' * 64), self.now)
        mutations = [lambda o: o['files'][0].update(intent_sha256='f' * 64),
                     lambda o: o['files'][1].update(sha256='f' * 64),
                     lambda o: o['files'][0].update(uid=True),
                     lambda o: o['files'][0].update(nlink=2),
                     lambda o: o['directory'].update(mode='0755'),
                     lambda o: o['host'].update(boot_id='foreign'),
                     lambda o: o.update(observed_at=(self.now - timedelta(minutes=16)).isoformat()),
                     lambda o: o.update(observed_at=(self.now + timedelta(seconds=1)).isoformat())]
        for make, digest in ((self.before, None), (self.after, 'f' * 64)):
            for change in mutations:
                value = make()
                change(value)
                with self.subTest(change=change, digest=digest), self.assertRaises(ValueError):
                    policy.observation(value, self.action, self.now, intent_sha=digest)

    def test_no_existing_table_adoption_or_missing_provenance(self):
        with self.assertRaises(ValueError):
            policy.observation(self.after(), self.action, self.now)
        for change in (lambda o: o['table'].update(intent_sha256='d' * 64),
                       lambda o: o['table'].pop('intent_sha256'),
                       lambda o: o.update(table={'kind': 'absent'}),
                       lambda o: o['table']['ruleset']['nftables'].pop()):
            value = self.after()
            change(value)
            with self.assertRaises(ValueError):
                policy.observation(value, self.action, self.now, intent_sha='f' * 64)
        with self.assertRaises(ValueError):
            policy.observation(self.after(), self.action, self.now,
                               intent_sha='f' * 64, since=(self.now + timedelta(seconds=1)).isoformat())

    def auth(self):
        return {'schema_version': 1, 'operation': policy.OPERATION + '-authorization',
                **{k: self.action[k] for k in ('plan_id', 'plan_sha256', 'execution_sha256', 'pending_sha256')},
                'scope': 'activate-fresh-firewall-only', 'owner_confirmed': True,
                'authorized_at': self.now.isoformat(),
                'expires_at': (self.now + timedelta(minutes=15)).isoformat()}

    def test_authorization_is_exclusive_bounded_and_exact(self):
        policy.authorization(self.auth(), self.action, self.now)
        for change in ({'operation': 'fresh-network-file-staging-authorization'},
                       {'operation': 'fresh-network-directory-preparation-authorization'},
                       {'scope': 'stage-network-files-only'}, {'owner_confirmed': 1},
                       {'schema_version': True}, {'pending_sha256': 'f' * 64},
                       {'extra': 'field'}, {'expires_at': (self.now + timedelta(minutes=16)).isoformat()},
                       {'authorized_at': (self.now + timedelta(seconds=1)).isoformat()},
                       {'expires_at': (self.now - timedelta(seconds=1)).isoformat()}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                policy.authorization({**self.auth(), **change}, self.action, self.now)

    def test_intent_current_derivation_and_receipt_chronology(self):
        ref, identity = {'path': 'private/fixture.json', 'sha256': 'a' * 64}, {'device': 1, 'inode': 2}
        intent = policy.intent_record(self.action, ref, self.before(), 'a' * 64, self.now.isoformat(), identity)
        policy.validate_intent(intent, self.action, ref, 'a' * 64, identity, self.now)
        for change in (lambda i: i.update(schema_version=True), lambda i: i.update(operation='wrong'),
                       lambda i: i['action'].update(staging_receipt_sha256='f' * 64),
                       lambda i: i.update(created_at=(self.now - timedelta(seconds=1)).isoformat()),
                       lambda i: i.update(predecessor_sha256='f' * 64)):
            value = copy.deepcopy(intent)
            change(value)
            with self.assertRaises(ValueError):
                policy.validate_intent(value, self.action, ref, 'a' * 64, identity, self.now)
        receipt = {'schema_version': 1, 'operation': policy.OPERATION + '-receipt',
                   'intent_sha256': 'f' * 64, 'observation': self.after(),
                   'created_at': self.now.isoformat(), 'recovered': False}
        policy.validate_receipt(receipt, intent, 'f' * 64, self.now)
        for change in ({'schema_version': True}, {'recovered': 0}, {'intent_sha256': 'd' * 64},
                       {'operation': 'fresh-network-file-staging-receipt'},
                       {'created_at': (self.now - timedelta(seconds=1)).isoformat()}):
            with self.assertRaises(ValueError):
                policy.validate_receipt({**receipt, **change}, intent, 'f' * 64, self.now)
