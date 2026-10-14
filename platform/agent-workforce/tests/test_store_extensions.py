"""Independent storage integration regressions, beyond worker focus tests."""
import unittest
from agent_workforce.store import Store, StoreError

class StoreExtensionTests(unittest.TestCase):
    def test_put_record_returns_original_detached_snapshot(self):
        with Store(':memory:') as store:
            row={'revision':1,'nested':{'value':2}}
            first=store.put_record('records','key',row)
            self.assertEqual(first,row)
            self.assertEqual(store.put_record('records','key',row),first)
            first['nested']['value']=3
            self.assertEqual(store.get_record('records','key')['nested']['value'],2)

    def test_command_outbox_uses_unambiguous_composite_identity(self):
        with Store(':memory:') as store:
            common=dict(worker_id='worker',route_policy={'route_id':'route'},grant_id='grant')
            first=store.accept_command('job:extra','step',{},**common)
            second=store.accept_command('job','extra:step',{},**common)
            self.assertNotEqual(first['command_id'],second['command_id'])
            self.assertEqual(len(store.commands()),2)
            ids=[row['message_id'] for row in store.outbox_rows()]
            self.assertEqual(len(set(ids)),2)
            self.assertEqual(store.accept_command('job','extra:step',{},**common),second)
            self.assertEqual(len(store.outbox_rows()),2)

    def test_large_inbox_time_is_rejected_without_write(self):
        with Store(':memory:') as store:
            message={'sender':'a','message_id':'m','recipients':['b'],'body':{},'expires_at':10**1000}
            with self.assertRaises(StoreError):store.receive_message('a',message,'b')
            self.assertEqual(store.inbox_rows(),[])
            self.assertEqual(store.audit_rows(),[])

    def test_sqlite_integer_fields_reject_oversized_json_integers(self):
        with Store(':memory:') as store:
            with self.assertRaises(StoreError):
                store.put_record('workers','worker',{'revision':10**1000})
            self.assertEqual(store.records('workers'),{})
            cmd=store.accept_command('job','step',{},worker_id='worker',route_policy={},grant_id='grant')
            resources=[{'kind':kind,'key':kind,'capacity':1} for kind in ['job','account','quota_pool','session','workspace']]
            resources[0]['capacity']=10**1000
            with self.assertRaises(StoreError):
                store.prepare_attempt(cmd['command_id'],route={},grant={},resources=resources,now=100,lease_until=200)
            self.assertEqual(store.attempts(),[])
