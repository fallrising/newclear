"""Independent policy and local-journal review; no SSH or kernel operations."""
import copy
from datetime import timedelta
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fresh_network_firewall as policy
import fresh_network_firewall_ops as ops
import fresh_network_staging_ops as staging
import pending_generation
import test_fresh_network_staging as fixture


def rules_for(action):
    """Independent narrow nft JSON fixture, built from documented role policy."""
    index, net = action['host_index'], action['network']
    family = {'family': 'inet', 'table': 'eru_fresh_access', 'chain': 'input'}
    rows = [{'table': {'family': 'inet', 'name': 'eru_fresh_access'}},
            {'chain': {'family': 'inet', 'table': 'eru_fresh_access', 'name': 'input',
                       'type': 'filter', 'hook': 'input', 'prio': -20, 'policy': 'accept'}}]
    def match(left, right):
        return {'match': {'op': '==', 'left': left, 'right': right}}
    def rule(expressions):
        rows.append({'rule': {**family, 'expr': expressions}})
    rule([match({'meta': {'key': 'iifname'}}, 'lo'), {'accept': None}])
    pairs = [(22, net['controller_ip'])]
    if index:
        pairs += [(22, net['host_ips'][0]), (80, net['controller_ip']),
                  (80, net['host_ips'][0])]
    else:
        pairs += [(5001, ip) for ip in [net['controller_ip']] + net['host_ips']]
    for port, source in pairs:
        rule([match({'meta': {'key': 'iifname'}}, net['private_interface']),
              match({'payload': {'protocol': 'ip', 'field': 'saddr'}}, source),
              match({'payload': {'protocol': 'ip', 'field': 'daddr'}}, net['host_ips'][index]),
              match({'payload': {'protocol': 'tcp', 'field': 'dport'}}, port),
              {'accept': None}])
    rule([match({'payload': {'protocol': 'tcp', 'field': 'dport'}},
                {'set': [22, 80, 2375, 2376, 2379, 2380, 5001, 12345]}), {'drop': None}])
    return {'nftables': rows}


class PolicyReview(unittest.TestCase):
    def setUp(self):
        self.f = fixture.NetworkStagingTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.plan = self.f.f.record()['plan']
        self.pending = pending_generation.inspect(self.f.project)
        self.action = policy.action(self.plan, self.f.plan['sha256'], self.pending, 0,
                                    'a' * 64, 'b' * 64)

    def test_independent_rules_for_each_role(self):
        for index in range(4):
            action = policy.action(self.plan, self.f.plan['sha256'], self.pending, index,
                                   'a' * 64, 'b' * 64)
            expected = rules_for(action)
            self.assertEqual(policy.expected_ruleset(action), expected)
            policy.validate_ruleset(expected, action)
            self.assertEqual(len(expected['nftables']), 10 if index == 0 else 8)

    def test_dangerous_near_miss_rules_rejected(self):
        changes = [
            lambda r: r[3]['rule']['expr'][0]['match'].update(right='eth0'),
            lambda r: r[3]['rule']['expr'][1]['match'].update(right='0.0.0.0/0'),
            lambda r: r[3]['rule']['expr'][2]['match'].update(right='10.99.99.99'),
            lambda r: r[3]['rule']['expr'][3]['match'].update(right=2375),
            lambda r: r[3]['rule']['expr'][3]['match'].update(right=True),
            lambda r: r[3]['rule']['expr'][3]['match'].update(op='!='),
            lambda r: r[3]['rule']['expr'].insert(0, {'counter': None}),
            lambda r: r[3]['rule']['expr'].pop(1),
            lambda r: r[3]['rule']['expr'].__setitem__(-1, {'jump': {'target': 'other'}}),
            lambda r: r.__setitem__(slice(3, 5), list(reversed(r[3:5]))),
            lambda r: r[1]['chain'].update(hook='forward'),
            lambda r: r[1]['chain'].update(prio=0),
            lambda r: r[1]['chain'].update(policy='drop'),
            lambda r: r[1]['chain'].update(flags=[]),
            lambda r: r[0]['table'].update(flags=['dormant']),
            lambda r: r[0]['table'].update(family='ip'),
            lambda r: r[-1]['rule']['expr'][0]['match']['right']['set'].remove(2376),
            lambda r: r[-1]['rule']['expr'].__setitem__(-1, {'accept': None}),
            lambda r: r.append(copy.deepcopy(r[1])),
            lambda r: r[3]['rule']['expr'][0]['match'].update(handle=7),
        ]
        for i, change in enumerate(changes):
            with self.subTest(change=i):
                value = rules_for(self.action)
                change(value['nftables'])
                with self.assertRaises(ValueError):
                    policy.validate_ruleset(value, self.action)

    def test_output_handles_allowed_only_at_documented_positions(self):
        value = rules_for(self.action)
        for number, row in enumerate(value['nftables'], 1):
            next(iter(row.values()))['handle'] = number
        policy.validate_ruleset(value, self.action)
        for handle in (True, -1, '1', 1.5, None):
            bad = copy.deepcopy(value)
            bad['nftables'][3]['rule']['handle'] = handle
            with self.subTest(handle=handle), self.assertRaises(ValueError):
                policy.validate_ruleset(bad, self.action)

    def test_metainfo_is_bounded_leading_only_and_not_semantic_escape(self):
        meta = {'metainfo': {'version': '1.0.9', 'release_name': 'Old Doc Yak',
                             'json_schema_version': 1}}
        good = rules_for(self.action)
        good['nftables'].insert(0, meta)
        policy.validate_ruleset(good, self.action)
        cases = []
        duplicate = copy.deepcopy(good)
        duplicate['nftables'].insert(0, copy.deepcopy(meta))
        cases.append(duplicate)
        trailing = rules_for(self.action)
        trailing['nftables'].append(meta)
        cases.append(trailing)
        for field, value in (('json_schema_version', True), ('version', 'x' * 4096),
                             ('unknown', 1)):
            changed = copy.deepcopy(good)
            changed['nftables'][0]['metainfo'][field] = value
            cases.append(changed)
        for value in cases:
            with self.assertRaises(ValueError):
                policy.validate_ruleset(value, self.action)

    def test_raw_json_duplicate_nonfinite_depth_and_type_rejected(self):
        for raw in (b'{"nftables":[],"nftables":[]}', b'{"nftables":[NaN]}',
                    b'{"nftables":[Infinity]}', b'[]', b'null', b'\xff',
                    b'{"nftables":' + b'[' * 80 + b']' * 80 + b'}',
                    b' ' * (1024 * 1024), 'not bytes'):
            with self.subTest(raw=repr(raw)[:60]), self.assertRaises(ValueError):
                policy.decode_ruleset(raw)
        raw = json.dumps(rules_for(self.action)).encode()
        policy.validate_ruleset(policy.decode_ruleset(raw), self.action)

    def test_action_cannot_authorize_rehashed_alternate_payload(self):
        for change in (lambda p: p['render']['hosts'][0]['files'][0].update(content='flush ruleset\n'),
                       lambda p: p['render'].update(private_interface='eth0'),
                       lambda p: p['render'].update(controller_ip=p['render']['hosts'][0]['ip']),
                       lambda p: p['render']['hosts'][0]['files'][0].update(path='/etc/nftables.conf')):
            plan = copy.deepcopy(self.plan)
            change(plan)
            import hashlib
            f = plan['render']['hosts'][0]['files'][0]
            f['sha256'] = hashlib.sha256(f['content'].encode()).hexdigest()
            with self.assertRaises(ValueError):
                policy.action(plan, self.f.plan['sha256'], self.pending, 0, 'a' * 64, 'b' * 64)
        for index in (True, -1, 4, '0'):
            with self.assertRaises(ValueError):
                policy.action(self.plan, self.f.plan['sha256'], self.pending, index, 'a' * 64, 'b' * 64)


class FirewallAdapter:
    def __init__(self, f):
        self.f, self.calls, self.tables = f, [], {}
        self.lose = False

    def observe(self, action):
        self.calls.append(('observe', action['host_index']))
        result = self.f.adapter.observe(action)
        result['table'] = copy.deepcopy(self.tables.get(action['host_index'], {'kind': 'absent'}))
        return result

    def activate(self, action, digest):
        self.calls.append(('activate', action['host_index']))
        self.tables[action['host_index']] = {'kind': 'present', 'ruleset': rules_for(action),
                                             'intent_sha256': digest}
        if self.lose:
            raise OSError('secret-private-adapter-failure')


class CoordinatorReview(unittest.TestCase):
    def setUp(self):
        self.f = fixture.NetworkStagingTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.project, self.now, self.source = self.f.project, self.f.now, self.f.source
        self.staged = [self.f.stage(i) for i in range(4)]
        self.assertEqual([x['status'] for x in self.staged], ['staged'] * 4)
        self.authpath = 'private/firewall-review-auth.json'
        self.auth = {**self.f.auth, 'operation': 'fresh-network-firewall-activation-authorization',
                     'scope': 'activate-fresh-firewall-only'}
        self.save_auth()
        self.adapter = FirewallAdapter(self.f)

    def save_auth(self):
        self.authsha = self.f.f.f.f.r.write(self.authpath, self.auth)
        self.f.f.f.f.r.f.secure()

    def activate(self, index=0, **kw):
        options = {'now': self.now, 'source_state': self.source}
        options.update(kw)
        return ops.activate_network_firewall(self.project, self.f.plan['id'], self.f.plan['sha256'],
            self.authpath, self.authsha, index, self.adapter, **options)

    def inspect(self, result, index=0):
        return ops.inspect_network_firewall(self.project, self.f.run, index, result['intent_sha256'],
                                             now=self.now, source_state=self.source)

    def reconcile(self, result, index=0):
        return ops.reconcile_network_firewall(self.project, self.f.run, index, result['intent_sha256'],
            self.adapter, now=self.now, source_state=self.source)

    def slot(self, index=0):
        return self.project / ops.AREA / self.f.run / ('host-' + str(index))

    def test_valid_chain_requires_all_staging_and_durable_intent_before_dispatch(self):
        original = self.adapter.activate
        def dispatch(action, digest):
            saved = json.loads((self.slot(action['host_index']) / 'intent.json').read_text())
            self.assertEqual(saved['sha256'], digest)
            self.assertEqual(action['staging_intent_sha256'], self.staged[action['host_index']]['intent_sha256'])
            self.assertEqual(action['staging_receipt_sha256'], self.staged[action['host_index']]['receipt_sha256'])
            original(action, digest)
        with patch.object(self.adapter, 'activate', side_effect=dispatch):
            self.assertEqual(self.activate(1)['status'], 'blocked')
            self.assertEqual(self.adapter.calls, [])
            for index in range(4):
                result = self.activate(index)
                self.assertEqual(result['status'], 'firewall-active')
                for flag in ('stage_accepted', 'generation_changed', 'external_fence_verified'):
                    self.assertIs(result[flag], False)
        self.assertEqual([x for x in self.adapter.calls if x[0] == 'activate'],
                         [('activate', i) for i in range(4)])

    def test_missing_fourth_staging_receipt_blocks_before_observer(self):
        (self.f.slot(3) / 'receipt.json').unlink()
        self.assertEqual(self.activate()['status'], 'blocked')
        self.assertEqual(self.adapter.calls, [])
        self.assertFalse(self.slot().exists())

    def test_lost_response_recovery_only_observes_and_no_replay(self):
        self.adapter.lose = True
        result = self.activate()
        self.assertEqual(result['status'], 'uncertain')
        calls = list(self.adapter.calls)
        self.assertEqual(self.activate()['status'], 'uncertain')
        self.assertEqual(self.adapter.calls, calls)
        self.assertEqual(self.inspect(result)['status'], 'uncertain')
        self.assertEqual(self.adapter.calls, calls)
        self.assertEqual(self.reconcile(result)['status'], 'firewall-active')
        self.assertEqual(self.adapter.calls[len(calls):], [('observe', 0)])
        self.assertNotIn('secret-private', json.dumps(result))

    def test_recovery_of_absent_or_foreign_table_never_dispatches(self):
        self.adapter.lose = True
        result = self.activate()
        for value in ({'kind': 'absent'}, {**self.adapter.tables[0], 'intent_sha256': 'f' * 64}):
            self.adapter.tables[0] = value
            self.assertEqual(self.reconcile(result)['status'], 'uncertain')
        self.assertEqual([x for x in self.adapter.calls if x[0] == 'activate'], [('activate', 0)])
        self.assertFalse((self.slot() / 'receipt.json').exists())

    def test_stage_authorization_is_not_activation_authorization(self):
        self.auth = copy.deepcopy(self.f.auth)
        self.save_auth()
        self.assertEqual(self.activate()['status'], 'blocked')
        self.assertEqual(self.adapter.calls, [])

    def test_staging_raw_drift_during_before_observation_denies_dispatch(self):
        original = self.adapter.observe
        def drift(action):
            result = original(action)
            target = self.f.slot(3) / 'receipt.json'
            target.write_bytes(target.read_bytes() + b' ')
            return result
        with patch.object(self.adapter, 'observe', side_effect=drift):
            result = self.activate()
        self.assertEqual(result['status'], 'blocked')
        self.assertFalse(any(x[0] == 'activate' for x in self.adapter.calls))

    def test_staging_raw_drift_after_dispatch_denies_success(self):
        original = self.adapter.activate
        def drift(action, digest):
            original(action, digest)
            target = self.f.slot(3) / 'intent.json'
            target.write_bytes(target.read_bytes() + b' ')
        with patch.object(self.adapter, 'activate', side_effect=drift):
            result = self.activate()
        self.assertNotEqual(result['status'], 'firewall-active')
        self.assertFalse((self.slot() / 'receipt.json').exists())

    def test_false_staged_attributes_and_alternate_live_rules_never_accept(self):
        original = self.adapter.observe
        def altered(action):
            result = original(action)
            if result['table']['kind'] == 'present':
                result['table']['ruleset']['nftables'][-1]['rule']['expr'][-1] = {'accept': None}
            return result
        with patch.object(self.adapter, 'observe', side_effect=altered):
            result = self.activate()
            self.assertEqual(result['status'], 'uncertain')
            self.assertEqual(self.reconcile(result)['status'], 'uncertain')
        self.assertFalse((self.slot() / 'receipt.json').exists())

    def test_final_pending_drift_after_last_raw_read_blocks_dispatch(self):
        plans, changed = [], []
        original_plan, original_recheck = ops._Session.plan, ops.PrivateFiles.recheck
        def plan(session, *args):
            value = original_plan(session, *args)
            plans.append(True)
            return value
        def recheck(files):
            original_recheck(files)
            if len(plans) == 3 and not changed:
                changed.append(True)
                path = self.project / 'private' / pending_generation.PENDING_DIRECTORY / 'foreign-entry'
                path.write_text('foreign reservation entry')
                path.chmod(0o600)
        with patch.object(ops._Session, 'plan', plan), patch.object(ops.PrivateFiles, 'recheck', recheck):
            result = self.activate()
        self.assertEqual(changed, [True])
        self.assertEqual(result['status'], 'blocked')
        self.assertFalse(result['dispatch_attempted'])
        self.assertFalse(any(c[0] == 'activate' for c in self.adapter.calls))

    def test_final_clock_after_all_io_expires_before_observation(self):
        plans = []
        original = ops._Session.plan
        def plan(session, *args):
            value = original(session, *args)
            plans.append(True)
            return value
        observe = self.adapter.observe
        def old(action):
            result = observe(action)
            result['observed_at'] = (self.now - timedelta(minutes=14, seconds=59)).isoformat()
            return result
        with patch.object(ops._Session, 'plan', plan), patch.object(self.adapter, 'observe', side_effect=old), \
                patch.object(ops, '_time', side_effect=lambda _: self.now + timedelta(seconds=2)
                             if len(plans) >= 3 else self.now):
            result = self.activate()
        self.assertEqual(result['status'], 'blocked')
        self.assertFalse(result['dispatch_attempted'])
        self.assertFalse(any(c[0] == 'activate' for c in self.adapter.calls))

    def test_actual_source_recheck_after_before_observation_denies_dispatch(self):
        import fresh_execution_ops
        source = copy.deepcopy(self.source)
        original = self.adapter.observe
        def observed(action):
            result = original(action)
            source['sha'] = 'e' * 40
            return result
        with patch.object(fresh_execution_ops, '_git_source', side_effect=lambda _: source), \
                patch.object(self.adapter, 'observe', side_effect=observed):
            result = self.activate(source_state=None)
        self.assertEqual(result['status'], 'blocked')
        self.assertFalse(any(c[0] == 'activate' for c in self.adapter.calls))

    def test_late_recovery_loser_cannot_poison_successful_winner(self):
        self.adapter.lose = True
        result = self.activate()
        original, fired = os.open, []
        def late(path, flags, *args, **kwargs):
            if path == '.receipt-claim' and not fired:
                fired.append(True)
                self.assertEqual(self.reconcile(result)['status'], 'firewall-active')
            return original(path, flags, *args, **kwargs)
        with patch.object(os, 'open', side_effect=late):
            self.reconcile(result)
        self.assertEqual(fired, [True])
        self.assertEqual(self.inspect(result)['status'], 'firewall-active')
        self.assertFalse((self.slot() / '.firewall-failed').exists())
        self.assertEqual([c for c in self.adapter.calls if c[0] == 'activate'], [('activate', 0)])

    def test_cached_staging_authority_cannot_be_rebound_to_changed_authorization(self):
        # A semantically current change still violates the persisted raw binding.
        self.f.auth['expires_at'] = (self.now + timedelta(seconds=1)).isoformat()
        self.f.save_auth()
        # Rebuild fresh staging journals against that exact authorization.
        # Earlier receipts intentionally cannot be rebound to modified auth.
        self.assertEqual(self.activate()['status'], 'blocked')
        self.assertEqual(self.adapter.calls, [])

    def test_inspect_has_zero_writes_transport_and_private_output(self):
        result = self.activate()
        self.assertEqual(result['status'], 'firewall-active')
        original = os.open
        def readonly(path, flags, *args, **kwargs):
            self.assertFalse(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC))
            return original(path, flags, *args, **kwargs)
        with patch.object(os, 'open', side_effect=readonly), \
                patch.object(os, 'mkdir', side_effect=AssertionError('write')), \
                patch.object(self.adapter, 'observe', side_effect=AssertionError('transport')):
            self.assertEqual(self.inspect(result)['status'], 'firewall-active')
        for secret in ('private/', '100.100.', 'replacement-machine', 'ssh-ed25519'):
            self.assertNotIn(secret, json.dumps(result))


if __name__ == '__main__':
    unittest.main()
