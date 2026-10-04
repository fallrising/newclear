"""Complete synthetic directory/staging/firewall/manual/probe acceptance flow."""
import copy
from datetime import timedelta
import json
import os
import unittest
from unittest.mock import patch

import test_fresh_network_firewall_integration as fixture
from test_fresh_network_ready import setup
import fresh_network_ready_ops as ops
import fresh_network_ready as contract
from fresh_rebuild import plan_digest
import pending_generation


class NetworkReadyTests(unittest.TestCase):
    def setUp(self):
        self.fw = fixture.FirewallIntegration()
        self.fw.setUp()
        self.addCleanup(self.fw.doCleanups)
        self.f = self.fw.f
        self.project, self.now, self.source = self.f.project, self.f.now, self.f.source
        self.fw.lost = False
        self.render = self.f.f.record()['plan']['render']
        self.setup = setup(self.render)
        self.inputpath = 'private/manual-setup.json'
        self.inputsha = self.write(self.inputpath, self.setup)
        self.auth = {**self.f.auth, 'operation': contract.OPERATION + '-authorization',
                     'scope': 'manual-console-network-and-access-only', 'setup_sha256': self.inputsha}
        self.authpath = 'private/manual-authorization.json'
        self.authsha = self.write(self.authpath, self.auth)
        self.collect_calls = 0

    def write(self, path, value):
        result = self.f.f.f.f.r.write(path, value)
        self.f.f.f.f.r.f.secure()
        return result

    def prerequisites(self):
        for i in range(4):
            self.assertEqual(self.fw.d.prepare(i)['status'], 'prepared')
            self.assertEqual(self.f.stage(i)['status'], 'staged')
        for i in range(4):
            self.assertEqual(self.fw.run_activation(i)['status'], 'firewall-active')

    def prepare(self):
        return ops.prepare_network_manual_setup(self.project, self.f.plan['id'],
            self.f.plan['sha256'], self.authpath, self.authsha, self.inputpath,
            self.inputsha, now=self.now, source_state=self.source)

    def manual(self):
        self.prepared = self.prepare()
        self.assertEqual(self.prepared['status'], 'manual-setup-prepared')
        intent = json.loads((self.project / ops.MANUAL_AREA / self.f.run / 'intent.json').read_text())['intent']
        self.owner_receipt = {'schema_version': 1, 'operation': contract.OPERATION + '-receipt',
            'intent_sha256': self.prepared['intent_sha256'], 'owner_confirmed': True,
            'hosts': [{'action': a, 'started_at': self.now.isoformat(),
                       'completed_at': self.now.isoformat(), 'owner_confirmed': True} for a in intent['actions']]}
        self.receiptpath = 'private/manual-owner-receipt.json'
        self.receiptsha = self.write(self.receiptpath, self.owner_receipt)
        self.recorded = self.record()
        self.assertEqual(self.recorded['status'], 'manual-setup-recorded')

    def record(self):
        return ops.record_network_manual_setup(self.project, self.f.run,
            self.prepared['intent_sha256'], self.receiptpath, self.receiptsha,
            now=self.now, source_state=self.source)

    def collector(self, render, keys, *, setup, now):
        from test_fresh_network_probe import sample_evidence
        self.collect_calls += 1
        return sample_evidence(render, setup, now)

    def accept(self, collector=None):
        return ops.accept_network_ready(self.project, self.f.run, self.recorded['manual_receipt_sha256'],
            collector or self.collector, now=self.now, source_state=self.source)

    def inspect(self, result, **kw):
        return ops.inspect_network_ready(self.project, self.f.run, result['receipt_sha256'],
            now=kw.get('now', self.now), source_state=self.source)

    def test_complete_flow_current_readonly_and_never_recollects(self):
        before = pending_generation.inspect(self.project)
        self.manual()
        self.assertEqual(self.accept()['status'], 'blocked')
        self.assertEqual(self.collect_calls, 0)
        self.prerequisites()
        self.assertEqual(self.prepare()['intent_sha256'], self.prepared['intent_sha256'])
        self.assertEqual(self.record()['manual_receipt_sha256'], self.recorded['manual_receipt_sha256'])
        result = self.accept()
        self.assertEqual(result['status'], 'network-ready')
        self.assertTrue(result['stage_accepted'])
        self.assertEqual(result['next_stage'], 'empty-control-plane')
        self.assertEqual(pending_generation.inspect(self.project), before)
        self.assertEqual(self.accept()['receipt_sha256'], result['receipt_sha256'])
        self.assertEqual(self.collect_calls, 1)
        real_open = os.open
        def readonly(path, flags, *a, **kw):
            self.assertEqual(flags & (os.O_WRONLY|os.O_RDWR|os.O_CREAT|os.O_TRUNC), 0)
            return real_open(path, flags, *a, **kw)
        with patch.object(os, 'open', side_effect=readonly):
            self.assertEqual(self.inspect(result)['status'], 'network-ready')
        for secret in ('public_ipv4', '10.', 'machine_id', 'private', 'setup', 'host_key'):
            self.assertNotIn(secret, json.dumps(result))
        self.assertEqual(self.inspect(result, now=self.now + timedelta(minutes=16))['status'], 'blocked')

    def test_current_authority_invalid_probes_and_late_publication_fail_closed(self):
        self.manual()
        self.prerequisites()
        self.owner_receipt['hosts'][0]['started_at'] = (self.now-timedelta(seconds=1)).isoformat()
        self.receiptsha = self.write(self.receiptpath, self.owner_receipt)
        self.assertEqual(self.record()['status'], 'blocked')
        self.assertEqual(self.accept()['status'], 'blocked')
        self.owner_receipt['hosts'][0]['started_at'] = self.now.isoformat()
        self.receiptsha = self.write(self.receiptpath, self.owner_receipt)
        self.auth['setup_sha256'] = 'f' * 64
        self.write(self.authpath, self.auth)
        self.assertEqual(self.accept()['status'], 'blocked')
        self.auth['setup_sha256'] = self.inputsha
        self.write(self.authpath, self.auth)
        def collector(*a, **kw):
            value = self.collector(*a, **kw)
            self.auth['owner_confirmed'] = False
            self.write(self.authpath, self.auth)
            return value
        self.assertEqual(self.accept(collector)['status'], 'blocked')
        self.assertFalse((self.project/ops.AREA/self.f.run/'receipt.json').exists())
        self.auth['owner_confirmed'] = True
        self.write(self.authpath, self.auth)
        def collector(*a, **kw):
            value = self.collector(*a, **kw)
            value['core_worker_ssh'][0]['authentication'] = 'password'
            return value
        self.assertEqual(self.accept(collector)['status'], 'blocked')
        publish = ops._publish
        def fail(files, directory, name, value):
            publish(files, directory, name, value)
            raise OSError('late synthetic fsync failure')
        with patch.object(ops, '_publish', side_effect=fail):
            self.assertEqual(self.accept()['status'], 'blocked')
        self.assertEqual(self.accept()['status'], 'blocked')
