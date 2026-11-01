"""Observed lease expiry must stay invalid across subsequent clock changes."""
import unittest
from agent_workforce.store import Store, StaleFenceError

class RuntimeExtensionTests(unittest.TestCase):
    def prepare(self, store, step):
        cmd=store.accept_command('job',step,{},worker_id='worker',route_policy={},grant_id='grant')
        resources=[{'kind':kind,'key':step if kind in ['session','workspace'] else kind,'capacity':1 if kind in ['session','workspace'] else 8} for kind in ['job','account','quota_pool','session','workspace']]
        return store.prepare_attempt(cmd['command_id'],route={},grant={},resources=resources,now=100,lease_until=200)

    def test_observed_expiry_invalidates_prepared_and_unknown_owners_permanently(self):
        for initial in ['dispatch_prepared','outcome_unknown']:
            with self.subTest(initial=initial), Store(':memory:') as store:
                attempt=self.prepare(store,'first')
                if initial=='outcome_unknown': store.publish_attempt(attempt['attempt_id'],attempt['fence'],initial,now=101)
                store.expire_leases(200)
                with self.assertRaises(StaleFenceError):
                    store.publish_attempt(attempt['attempt_id'],attempt['fence'],'running',now=110)
                self.assertTrue(store.reservations())
                claimed=store.claim_lease(attempt['attempt_id'],now=110,lease_until=210)
                self.assertGreater(claimed,attempt['fence'])
                store.publish_attempt(attempt['attempt_id'],claimed,'running',now=111)
                self.assertEqual(len(store.attempts()),1)

    def test_lease_claim_uses_persisted_global_fence_allocator(self):
        with Store(':memory:') as store:
            first=self.prepare(store,'first')
            second=self.prepare(store,'second')
            claimed=store.claim_lease(first['attempt_id'],now=200,lease_until=300)
            self.assertGreater(claimed,second['fence'])
            self.assertEqual(store.attempt(first['attempt_id'])['operation_id'],first['operation_id'])
