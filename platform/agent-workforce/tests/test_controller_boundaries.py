"""Independent checks of the final dispatch and cleanup boundaries."""
import threading
import unittest
from agent_workforce.controller import Controller
from agent_workforce.fake import FakeBackend
from agent_workforce.store import Store
from support import NOW, records, grant, request

class ControllerBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.now=NOW
        self.store=Store(':memory:')
        self.addCleanup(self.store.close)
        self.backend=FakeBackend()
        self.controller=Controller(self.store,self.backend,clock=lambda:self.now,trusted_issuers=('operator-example',))
        for kind,rows in records().items():
            for key,row in rows.items():self.controller.register(kind,key,row)
        self.controller.put_grant(grant(),authenticated_operator='operator-example')

    def start(self):
        cmd=self.controller.accept(request(),authenticated_caller='operator-example')
        return self.controller.dispatch(cmd['command_id'])

    def test_registry_installer_cannot_bypass_grant_installer(self):
        with self.assertRaises(ValueError):
            self.controller.register('grants','grant-example',grant(revision=2,max_turns=100))
        self.assertEqual(self.store.get_record('grants','grant-example')['revision'],1)

    def test_grant_change_is_serialized_with_recheck_and_send(self):
        entered=threading.Event()
        finished=threading.Event()
        observations=[]
        threads=[]
        original=self.controller._recheck
        def recheck(*args):
            now=original(*args)
            def mutate():
                entered.set()
                self.controller.put_grant(grant(revision=2,revoked=True),authenticated_operator='operator-example')
                finished.set()
            thread=threading.Thread(target=mutate)
            threads.append(thread)
            thread.start()
            self.assertTrue(entered.wait(2))
            observations.append(finished.wait(.05))
            return now
        self.controller._recheck=recheck
        self.start()
        for thread in threads:
            thread.join(2)
            self.assertFalse(thread.is_alive())
        self.assertEqual(observations,[False])
        self.assertTrue(finished.is_set())
        self.assertEqual(len(self.backend.starts),1)

    def test_result_arriving_after_lease_expiry_waits_for_reconcile(self):
        self.backend.mode='complete'
        self.backend.before_start=lambda operation_id:setattr(self,'now',NOW+120)
        attempt=self.start()
        self.assertEqual(attempt['state'],'outcome_unknown')
        self.assertTrue([row for row in self.store.reservations() if not row['released']])
        found=self.controller.reconcile(attempt['attempt_id'])
        self.assertEqual(found['state'],'awaiting_review')
        self.assertEqual(found['operation_id'],attempt['operation_id'])
        self.assertEqual(len(self.backend.starts),1)

    def test_lost_stop_receipt_is_resolved_by_original_operation_inspection(self):
        attempt=self.start()
        original=self.backend.stop
        def lose_receipt(operation_id):
            original(operation_id)
            raise TimeoutError('synthetic lost stop receipt')
        self.backend.stop=lose_receipt
        unknown=self.controller.stop(attempt['attempt_id'])
        self.assertEqual(unknown['state'],'outcome_unknown')
        self.assertTrue([row for row in self.store.reservations() if not row['released']])
        resolved=self.controller.reconcile(attempt['attempt_id'])
        self.assertEqual(resolved['state'],'cancelled')
        self.assertTrue(resolved['stop_proven'])
        self.assertEqual([row for row in self.store.reservations() if not row['released']],[])
        self.assertEqual(self.backend.inspections,[attempt['operation_id']])
        self.assertEqual(len(self.backend.starts),1)

    def test_cleanup_does_not_require_a_new_valid_registry_snapshot(self):
        self.backend.mode='accept_then_raise'
        attempt=self.start()
        self.backend.finish(attempt['operation_id'],{'kept':True})
        session=records()['sessions']['session-a']
        session.update(revision=2,job_id='absent-job')
        self.controller.register('sessions','session-a',session)
        self.now=attempt['lease_until']+1
        resolved=self.controller.reconcile(attempt['attempt_id'])
        self.assertEqual(resolved['state'],'awaiting_review')
        self.assertEqual(self.backend.inspections,[attempt['operation_id']])
        self.assertEqual(len(self.backend.starts),1)

    def test_duplicate_input_keeps_canonical_json_type_identity(self):
        self.controller.accept(request(input={'value':1}),authenticated_caller='operator-example')
        for value in [True,1.0]:
            with self.subTest(value=value),self.assertRaises(ValueError):
                self.controller.accept(request(input={'value':value}),authenticated_caller='operator-example')
        self.assertEqual(len(self.store.commands()),1)

    def test_expiry_after_prepare_uses_control_lease_for_never_started_cleanup(self):
        cmd=self.controller.accept(request(),authenticated_caller='operator-example')
        self.controller.clock=lambda:1800 if self.store.attempts() else NOW
        with self.assertRaises(ValueError):self.controller.dispatch(cmd['command_id'])
        attempt=self.store.attempts()[0]
        self.assertEqual(attempt['state'],'cancelled')
        self.assertTrue(attempt['stop_proven'])
        self.assertEqual([row for row in self.store.reservations() if not row['released']],[])
        self.assertEqual(self.backend.starts,[])
