"""Trusted session and workflow assignments are domain records."""
import copy
import unittest

from agent_workforce.domain import Registry, RegistryError
from support import records

class BindingTests(unittest.TestCase):
    def test_trusted_session_snapshot_is_detached(self):
        source = records()
        registry = Registry(source)
        source['sessions']['session-a']['binding_key'] = 'changed'
        row = registry.get('sessions', 'session-a')
        self.assertEqual(row['binding_key'], 'session-physical-a')
        row['binding_key'] = 'caller-mutation'
        self.assertEqual(registry.get('sessions','session-a')['binding_key'], 'session-physical-a')

    def test_session_references_and_owners_match_trusted_route(self):
        for field, value in [('worker_id','worker-b'),('job_id','absent'),
                             ('account_ref','account-b'),('workspace_ref','absent'),
                             ('owner','other-owner'),('route_id','route-b')]:
            source = records()
            source['sessions']['session-a'][field] = value
            with self.subTest(field=field), self.assertRaises(RegistryError):
                Registry(source)

    def test_binding_key_requires_nonempty_text_when_present(self):
        for kind, key in [('sessions','session-a'),('resources','workspace-a')]:
            for value in [None, '', [], True]:
                source = records()
                source[kind][key]['binding_key'] = value
                with self.subTest(kind=kind, value=value), self.assertRaises(RegistryError):
                    Registry(source)

    def test_workflow_hops_are_nonnegative_real_integers(self):
        for value in [-1, True, 1.5, '1']:
            source=records()
            source['jobs']['job-example']['step_hops']['review-0']=value
            with self.subTest(value=value), self.assertRaises(RegistryError): Registry(source)
        source=records();source['jobs']['job-example']['step_hops']=[]
        with self.assertRaises(RegistryError): Registry(source)

    def test_session_requires_all_binding_fields(self):
        for field in ['binding_key','worker_id','job_id','route_id','account_ref','workspace_ref']:
            source=records();del source['sessions']['session-a'][field]
            with self.subTest(field=field), self.assertRaises(RegistryError): Registry(source)
