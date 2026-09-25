"""Offline checks for the bounded ERU-006 network acceptance operator."""
import hashlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import network_acceptance as network


class NetworkInputTests(unittest.TestCase):
    def test_run_id_and_table_are_strictly_bound(self):
        run_id = '20260924T042000Z-ab12cd34'
        self.assertEqual(network.table_name(run_id), 'eru006_ab12cd34')
        for value in ('../etc/passwd', '20260924T042000Z-AB12CD34', '20260924-12345678'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                network.table_name(value)

    def test_sources_are_family_checked_canonicalized_and_deduplicated(self):
        self.assertEqual(network.canonical_addresses(
            ['100.64.0.3', '100.64.0.2', '100.64.0.3'], 4),
            ['100.64.0.2', '100.64.0.3'])
        self.assertEqual(network.canonical_addresses(
            ['fd7a:115c:a1e0::2', 'fd7a:115c:a1e0::1'], 6),
            ['fd7a:115c:a1e0::1', 'fd7a:115c:a1e0::2'])
        for raw, family in [('2001:db8::1', 4), ('0.0.0.0', 4), ('224.0.0.1', 4), ('ff02::1', 6)]:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                network.canonical_addresses([raw], family)

    def test_guard_is_limited_to_management_sources_and_drops_other_tcp80(self):
        run_id = '20260924T042000Z-ab12cd34'
        sources = {'ipv4': ['100.64.0.2'], 'ipv6': ['fd7a:115c:a1e0::1']}
        rendered = network.guard_lines(run_id, sources)
        self.assertIn('ip saddr 100.64.0.2 tcp dport 80 accept', rendered)
        self.assertIn('ip6 saddr fd7a:115c:a1e0::1 tcp dport 80 accept', rendered)
        self.assertIn('tcp dport 80 drop', rendered)
        expected = network.expected_guard(run_id, sources)
        self.assertTrue(network.verify_guard_text(expected, run_id, sources))
        self.assertTrue(network.verify_guard_text(
            expected.replace('priority -10', 'priority filter - 10'), run_id, sources))
        self.assertFalse(network.verify_guard_text(
            expected.replace('priority -10', 'priority 0'), run_id, sources))

    def test_guard_requires_at_least_one_management_ipv4(self):
        with self.assertRaisesRegex(ValueError, 'IPv4'):
            network.guard_lines('20260924T042000Z-ab12cd34', {'ipv4': [], 'ipv6': []})

    def test_ufw_rule_check_accepts_aligned_columns_but_requires_v4_and_v6_anywhere(self):
        rules = ['80/tcp                 ALLOW IN    Anywhere',
                 '80/tcp (v6)            ALLOW IN    Anywhere (v6)']
        self.assertEqual(network._reviewed_ufw_tcp80_rules(rules), (True, True))
        self.assertEqual(network._reviewed_ufw_tcp80_rules(rules[:1]), (True, False))
        self.assertEqual(network._reviewed_ufw_tcp80_rules(
            ['80/tcp ALLOW IN 100.64.0.0/10']), (False, False))

    def test_existing_input_chains_must_run_strictly_after_guard(self):
        rows = [{'hook': 'input', 'prio': 'filter - 1'},
                {'hook': 'input', 'prio': 0}, {'hook': 'forward', 'prio': -300}]
        self.assertEqual(network._input_chain_safe(rows), (True, [-1, 0]))
        for priority in (-10, -11, 'filter - 20', 'unrecognized'):
            rows = [{'hook': 'input', 'prio': priority}]
            with self.subTest(priority=priority):
                self.assertFalse(network._input_chain_safe(rows)[0])
        self.assertFalse(network._input_chain_safe([])[0])

    def test_public_control_route_requires_worker_v4_v6_and_core_v4(self):
        paths = {'worker4_v4': [{'route': {'available': True, 'device': 'eth0'}, 'tcp22': True}],
                 'worker4_v6': [{'route': {'available': True, 'device': 'eth0'}, 'tcp22': True}],
                 'core_v4': [{'route': {'available': True, 'device': 'eth0'}, 'tcp22': True}],
                 'core_v6': []}
        self.assertEqual(network._route_path_blockers(
            paths, required=('worker4_v4', 'worker4_v6', 'core_v4')), [])
        self.assertIn('worker4_v6: no public endpoint to probe', network._route_path_blockers(
            {**paths, 'worker4_v6': []}, required=('worker4_v6',)))
        self.assertTrue(network._route_path_blockers(
            {**paths, 'core_v4': [{'route': {'available': False, 'device': None}, 'tcp22': False}]},
            required=('core_v4',)))

    def test_nft_policy_hash_ignores_only_the_fail2ban_sshd_set_members(self):
        baseline = {'nftables': [
            {'table': {'family': 'inet', 'name': 'f2b-table'}},
            {'set': {'family': 'inet', 'table': 'f2b-table', 'name': 'addr-set-sshd',
                     'type': 'ipv4_addr', 'elem': ['203.0.113.1', '198.51.100.2']}},
            {'rule': {'family': 'inet', 'table': 'f2b-table', 'chain': 'input',
                      'expr': [{'accept': None}], 'handle': 7, 'counter': {'packets': 1}}},
        ]}
        changed_members = json.loads(json.dumps(baseline))
        changed_members['nftables'][1]['set']['elem'] = ['203.0.113.9', '198.51.100.8']
        stable, volatile = network._normalize_nft_ruleset(baseline)
        changed_stable, changed_volatile = network._normalize_nft_ruleset(changed_members)
        self.assertEqual(stable, changed_stable)
        self.assertEqual(volatile, [{'family': 'inet', 'table': 'f2b-table', 'name': 'addr-set-sshd'}])
        self.assertEqual(volatile, changed_volatile)

        changed_policy = json.loads(json.dumps(changed_members))
        changed_policy['nftables'][2]['rule']['expr'] = [{'drop': None}]
        changed_policy_stable, _ = network._normalize_nft_ruleset(changed_policy)
        self.assertNotEqual(stable, changed_policy_stable)

        changed_other_set = json.loads(json.dumps(baseline))
        changed_other_set['nftables'][1]['set']['name'] = 'unreviewed-set'
        other_stable, _ = network._normalize_nft_ruleset(changed_other_set)
        self.assertNotEqual(stable, other_stable)

    def test_bridge_egress_rules_are_scoped_to_one_cni_ip_and_udp_dns(self):
        run_id = '20260924T042000Z-ab12cd34'
        network_plan = {'endpoint': 'https://ipv4.icanhazip.com/',
                        'resolver_ipv4': ['1.1.1.1'],
                        'endpoint_ipv4': ['93.184.216.34', '93.184.216.35'],
                        'endpoint_ipv6': []}
        rules = network._egress_forward_rule_specs(run_id, '10.42.0.17', network_plan)
        self.assertEqual(len(rules), 1)
        rule, = rules
        self.assertEqual(rule['chain'], 'DOCKER-USER')
        self.assertEqual(rule['source'], '10.42.0.17/32')
        self.assertEqual(rule['destination'], '1.1.1.1/32')
        self.assertEqual((rule['protocol'], rule['port'], rule['target']), ('udp', 53, 'ACCEPT'))
        self.assertTrue(rule['comment'].startswith('eru006-' + run_id + '-egress-'))
        command = network._forward_rule_command(rule, 'insert')
        self.assertEqual(command[:8], ['sudo', '-n', '/usr/sbin/iptables', '--wait', '5',
                                       '-I', 'DOCKER-USER', '1'])
        self.assertEqual(command[-1], 'ACCEPT')
        self.assertTrue(network._forward_rule_matches(network._forward_rule_tokens(rule), rule))
        self.assertFalse(network._forward_rule_matches(
            network._forward_rule_tokens({**rule, 'target': 'RETURN'}), rule))
        self.assertIn('--comment', command)
        self.assertIn(rule['comment'], command)
        self.assertEqual(network._forward_rule_command(rule, 'delete')[5:7],
                         ['-D', 'DOCKER-USER'])
        with self.assertRaisesRegex(ValueError, 'private bridge'):
            network._egress_forward_rule_specs(run_id, '8.8.8.8', network_plan)
        with self.assertRaisesRegex(ValueError, 'no IPv4'):
            network._egress_forward_rule_specs(
                run_id, '10.42.0.17', {'endpoint': 'https://ipv4.icanhazip.com/',
                                       'resolver_ipv4': [], 'endpoint_ipv4': [], 'endpoint_ipv6': []})
        with self.assertRaisesRegex(ValueError, 'IPv6 DNS answers'):
            network._egress_forward_rule_specs(
                run_id, '10.42.0.17', {'endpoint': 'https://ipv4.icanhazip.com/',
                                       'resolver_ipv4': ['1.1.1.1'],
                                       'endpoint_ipv4': ['93.184.216.34'],
                                       'endpoint_ipv6': ['2001:db8::1']})

    def test_dns_probe_extracts_only_global_a_answers_after_name_section(self):
        output = ('Server: 10.42.0.1\nAddress 1: 10.42.0.1\n'
                  'Name: ipv4.icanhazip.com\nAddress 1: 104.16.184.241\n'
                  'Address 2: 104.16.185.241\n')
        self.assertEqual(network._global_dns_ipv4_answers(output),
                         ['104.16.184.241', '104.16.185.241'])
        self.assertEqual(network._global_dns_ipv4_answers(
            'Server: 10.42.0.1\nAddress 1: 10.42.0.1\n'), [])

    def test_busybox_wget_probe_uses_supported_options_and_ipv4_only_endpoint(self):
        help_output = ('Usage: wget [-cqS] [--spider] [-O FILE] [-o LOGFILE] '
                       '[--header STR] [-P DIR] [-U AGENT] [-T SEC] [-Y on/off] URL...')
        self.assertTrue(network._wget_probe_supported(help_output))
        self.assertFalse(network._wget_probe_supported('wget: unrecognized option: 4\n' + help_output))
        self.assertFalse(network._wget_probe_supported('Usage: wget -O FILE URL'))
        self.assertEqual(network.EGRESS_HOST, 'ipv4.icanhazip.com')
        command = network._wget_https_command()
        self.assertEqual(command, 'wget -Y off -S -T 20 -O /dev/null https://ipv4.icanhazip.com/')
        self.assertNotIn('wget -4', command)
        nslookup_help = 'Usage: nslookup [-type=QUERY_TYPE] [-debug] HOST [DNS_SERVER]'
        self.assertTrue(network._nslookup_a_query_supported(nslookup_help))
        self.assertFalse(network._nslookup_a_query_supported('Usage: nslookup HOST [DNS_SERVER]'))
        self.assertFalse(network._nslookup_a_query_supported(
            'nslookup: unrecognized option: type\n' + nslookup_help))
        self.assertEqual(network._nslookup_a_command('1.1.1.1'),
                         'nslookup -type=a ipv4.icanhazip.com 1.1.1.1')
        with self.assertRaises(ValueError):
            network._nslookup_a_command('2001:db8::1')

    def test_forward_cleanup_recognizes_only_exact_run_tagged_rule_tokens(self):
        run_id = '20260924T042000Z-ab12cd34'
        bridge = {'endpoint': 'https://ipv4.icanhazip.com/', 'resolver_ipv4': ['1.1.1.1'],
                  'endpoint_ipv4': ['93.184.216.34'], 'endpoint_ipv6': []}
        rules = network._egress_forward_rule_specs(run_id, '10.42.0.17', bridge)
        report = {'egress_forward_rules': rules}
        rows = [{'chain': rule['chain'], 'comment': rule['comment'],
                 'tokens': network._forward_rule_tokens(rule)} for rule in rules]
        self.assertEqual(network._forward_run_targets_from_rows(rows, report, run_id),
                         sorted(rules, key=lambda item: item['comment']))
        equivalent = list(rows[0]['tokens'])
        equivalent[equivalent.index('-s') + 1] = '10.42.0.17'
        self.assertTrue(network._forward_rule_matches(equivalent, rules[0]))
        with self.assertRaisesRegex(ValueError, 'exact source/destination/port'):
            network._forward_run_targets_from_rows(
                [{**rows[0], 'chain': 'FORWARD'}, *rows[1:]], report, run_id)
        changed = {**rows[0], 'tokens': rows[0]['tokens'][:-1] + ['DROP']}
        with self.assertRaisesRegex(ValueError, 'exact source/destination/port'):
            network._forward_run_targets_from_rows([changed, *rows[1:]], report, run_id)
        unknown = {**rows[0], 'comment': 'eru006-' + run_id + '-egress-unplanned'}
        with self.assertRaisesRegex(ValueError, 'no unique plan-bound owner'):
            network._forward_run_targets_from_rows([unknown], report, run_id)

    def test_run_owned_workloads_require_generated_app_and_exact_labels(self):
        run_id = '20260924T042000Z-ab12cd34'
        app = network.SOURCE_APP_PREFIX + hashlib.sha256((run_id + ':host').encode()).hexdigest()[:12]
        op = Mock()
        op.cli.return_value = [
            {'id': app + '_a1', 'nodename': 'worker-4',
             'labels': {'owner': network.OWNER, 'run': run_id}},
            {'id': 'unrelated_1', 'nodename': 'worker-2', 'labels': {'owner': 'other'}},
        ]
        report = {'apps': {'host': {'app': app}}}
        self.assertEqual(network._owned_workloads(op, run_id, report),
                         [{'id': app + '_a1', 'node': 'worker-4', 'app': app, 'run': run_id}])
        op.cli.return_value[0]['labels']['run'] = 'different-run'
        with self.assertRaisesRegex(ValueError, 'unexpected owner'):
            network._owned_workloads(op, run_id, report)

    def test_cni_nat_cleanup_requires_run_comment_chain_source_and_exact_nat_shape(self):
        run_id = '20260924T042000Z-ab12cd34'
        app = network.SOURCE_APP_PREFIX + hashlib.sha256((run_id + ':eru').encode()).hexdigest()[:12]
        workload_id = app + '_web_Test1'
        cni_ip = '10.42.0.17'
        rule = {'family': 'inet', 'table': 'cni_plugins_masquerade', 'chain': 'masq_checks',
                'handle': 41, 'comment': 'opaque-sandbox, net: eru, if: eth0, id: ' + workload_id,
                'expr': [
                    {'match': {'left': {'payload': {'field': 'saddr', 'protocol': 'ip'}},
                               'op': '==', 'right': cni_ip}},
                    {'match': {'left': {'payload': {'field': 'daddr', 'protocol': 'ip'}},
                               'op': '!=', 'right': {'prefix': {'addr': '10.42.0.0', 'len': 24}}}},
                    {'masquerade': None}]}
        report = {'apps': {'eru': {'app': app, 'workload_ids': [workload_id]}},
                  'cni_container': {'id': workload_id, 'eru_network_ip': cni_ip}}
        target, = network._cni_run_targets_from_rules([rule], report, run_id)
        self.assertEqual(target['handle'], 41)
        self.assertEqual(target['cni_ip'], cni_ip)
        self.assertEqual(target['workload_id'], workload_id)
        self.assertEqual(network._cni_run_targets_from_rules([], report, run_id), [])
        wrong = {**rule, 'chain': 'other_chain'}
        with self.assertRaisesRegex(ValueError, 'outside the reviewed'):
            network._cni_run_targets_from_rules([wrong], report, run_id)
        wrong_ip = {**rule, 'expr': [dict(rule['expr'][0], match={**rule['expr'][0]['match'], 'right':'10.42.0.18'}),
                                     *rule['expr'][1:]]}
        with self.assertRaisesRegex(ValueError, 'recorded CNI workload IP'):
            network._cni_run_targets_from_rules([wrong_ip], report, run_id)

    def test_remote_scripts_are_valid_python_and_have_no_patch_residue(self):
        facts = (network.REMOTE_FACTS.replace('IMAGE_VALUE', repr('docker.io/library/nginx@sha256:' + 'a' * 64))
                 .replace('TABLE_VALUE', repr('eru006_ab12cd34')).replace('ROLE', repr('worker')))
        facts = facts.replace('ENDPOINT_VALUE', repr(network.EGRESS_HOST))
        for script in (facts, network.LISTENER_OWNERSHIP, network.CONTAINER_NETWORK, network.CNI_RULES, network.FORWARD_RULES, network.FORWARD_RULE_TEST):
            with self.subTest(script=script[:35]):
                compile(script, '<remote ERU-006 probe>', 'exec')
                self.assertFalse(any(line.startswith('+') for line in script.splitlines()))


if __name__ == '__main__':
    unittest.main()
