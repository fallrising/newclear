"""Malformed JSON inputs reject through the documented error boundary."""
import unittest
from agent_workforce.admission import admit, AdmissionError
from agent_workforce.domain import Registry, RegistryError
from agent_workforce.storage_base import finite_time, StoreError
from support import NOW, records, grant, request

class InputRejectionTests(unittest.TestCase):
    def test_unhashable_enums_reject_without_typeerror(self):
        source=records();source['workers']['worker-a']['role']=[]
        with self.assertRaises(RegistryError): Registry(source)
        registry=Registry(records(),trusted_issuers=('operator-example',))
        for field in ['origin','operation']:
            for bad in [[], {}, None]:
                with self.subTest(field=field,bad=bad), self.assertRaises(AdmissionError):
                    admit(registry,grant(),request(**{field:bad}),authenticated_caller='operator-example',now=NOW)

    def test_large_json_integer_is_rejected_as_timestamp(self):
        large=10**1000
        source=records();source['profiles']['profile-a']['timeout_seconds']=large
        with self.assertRaises(RegistryError): Registry(source)
        registry=Registry(records(),trusted_issuers=('operator-example',))
        for now in [large, -large]:
            with self.subTest(now_sign=now>0), self.assertRaises(AdmissionError):
                admit(registry,grant(),request(),authenticated_caller='operator-example',now=now)
            with self.assertRaises(StoreError): finite_time(now)

    def test_session_workspace_requires_physical_identity_and_workspace_kind(self):
        source=records();del source['resources']['workspace-a']['binding_key']
        with self.assertRaises(RegistryError): Registry(source)
        source=records();source['resources']['workspace-a']['kind']='other-resource'
        with self.assertRaises(RegistryError): Registry(source)
