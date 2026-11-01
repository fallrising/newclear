"""Completed reservation history and strict physical admission contracts."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import fresh_generation as contract
import fresh_generation_ops as ops
from labops import ClusterLock
import pending_generation as pending
import test_fresh_generation_ops as fixtures


class OrdinaryAdmissionCompatibilityTests(unittest.TestCase):
    def test_no_generation_state_keeps_existing_private_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            private = project / 'private'
            private.mkdir(mode=0o755)
            private.chmod(0o755)
            with ClusterLock(project):
                self.assertEqual(os.stat(private).st_mode & 0o777, 0o755)
            self.assertEqual(set(os.listdir(private)), {'controller.lock'})

    def test_unknown_history_on_existing_private_mode_still_blocks(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            private = project / 'private'
            private.mkdir(mode=0o755)
            private.chmod(0o755)
            (private / 'generation-history').symlink_to(directory)
            with self.assertRaises(RuntimeError):
                with ClusterLock(project):
                    self.fail('unknown generation history admitted')


class PendingCompletionTests(unittest.TestCase):
    setUp = fixtures.GenerationStorageTests.setUp
    write = fixtures.GenerationStorageTests.write
    load_acceptance = fixtures.GenerationStorageTests.load_acceptance
    refresh_renewal = fixtures.GenerationStorageTests.refresh_renewal
    prepare = fixtures.GenerationStorageTests.prepare
    finalize = fixtures.GenerationStorageTests.finalize

    def test_completed_reservation_is_retained_and_next_generation_archives(self):
        self.prepare(); self.assertEqual(self.finalize()['status'],'completed')
        original = (self.project/'private/pending-generation/reservation.json').read_bytes()
        bindings = {**self.pending['reservation']['bindings'],'run_id':'next-run',
            'generation_before':2,'target_generation':3,
            'cluster_sha256':contract.sha((self.project/contract.PATHS[2]).read_bytes())}
        with ClusterLock(self.project): pass
        pending.reserve(self.project,bindings)
        self.assertEqual(pending.inspect(self.project)['reservation']['bindings']['run_id'],'next-run')
        retained = self.project/'private/generation-history'/self.pending['sha256']/'pending-generation'
        self.assertEqual((retained/'reservation.json').read_bytes(),original)
        self.assertTrue((retained/'completion.json').is_file())
        with self.assertRaises(RuntimeError):
            with ClusterLock(self.project): pass
        ref = {'path':ops.ACCEPTED+'/review.json',
               'sha256':contract.sha((self.project/ops.ACCEPTED/'review.json').read_bytes())}
        self.assertTrue(ops.verify_accepted_lineage(self.project,ref,now=self.now)['historical_integrity'])

    def test_unknown_completion_is_not_archived_or_admitted(self):
        self.prepare(); self.write('private/pending-generation/completion.json',{'status':'completed'})
        with self.assertRaises(RuntimeError):
            with ClusterLock(self.project): pass
        with self.assertRaises(RuntimeError): pending.reserve(self.project,self.pending['reservation']['bindings'])
        self.assertFalse((self.project/'private/generation-history').exists())

    def test_unknown_generation_record_poison_blocks_completion(self):
        self.prepare(); self.assertEqual(self.finalize()['status'],'completed')
        self.write(ops.AREA+'/'+self.run+'/foreign.json',{})
        self.assertEqual(pending.inspect(self.project),{'status':'invalid','blocked':True})
        with self.assertRaises(RuntimeError):
            with ClusterLock(self.project): pass

    def test_renewal_expiry_between_local_writes_stops_remaining_prefix(self):
        self.prepare()
        calls=[]
        def check():
            calls.append(True)
            if len(calls)==2: raise ValueError('synthetic expired current renewal')
        with patch.object(ops.authority,'check_current',side_effect=check):
            self.assertEqual(self.finalize()['status'],'blocked')
        self.assertEqual(ops.inspect_generation(self.project,self.run,self.generation_sha,now=self.now)['prefix_length'],1)
        self.assertEqual(json.loads((self.project/contract.PATHS[2]).read_text())['generation'],1)

    def retire(self):
        with ClusterLock(self.project) as lock:
            return pending.retire_completed(self.project,lock.private_fd,now=self.now)

    def test_retired_history_allows_later_ordinary_change_and_second_consumer(self):
        self.prepare(); self.assertEqual(self.finalize()['status'],'completed')
        self.retire()
        self.assertEqual(pending.inspect(self.project),{'status':'absent','blocked':False})
        with ClusterLock(self.project):
            self.write(contract.PATHS[2],{'cluster_id':'eru-vps-mvp','generation':3})
            self.write(contract.PATHS[0],{'new':'ordinary-authorized-inventory'})
        with ClusterLock(self.project): pass
        status = ops.verify_transition(self.project,self.run,self.generation_sha,None,now=self.now)
        self.assertEqual(status['status'],'completed')
        self.assertTrue(status['retired'])
        with ClusterLock(self.project) as lock:
            self.assertFalse(pending.retire_completed(self.project,lock.private_fd,now=self.now))
        ref = {'path':ops.ACCEPTED+'/review.json',
               'sha256':contract.sha((self.project/ops.ACCEPTED/'review.json').read_bytes())}
        self.assertTrue(ops.verify_accepted_lineage(self.project,ref,now=self.now)['historical_integrity'])
        next_binding={**self.pending['reservation']['bindings'],'run_id':'next-run','generation_before':3,'target_generation':4,
            'cluster_sha256':contract.sha((self.project/contract.PATHS[2]).read_bytes())}
        pending.reserve(self.project,next_binding)
        self.assertEqual(pending.inspect(self.project)['reservation']['bindings']['target_generation'],4)

    def test_retirement_crash_after_intent_only_explicit_finalize_can_finish(self):
        self.prepare(); self.assertEqual(self.finalize()['status'],'completed')
        with patch.object(pending.os,'rename',side_effect=OSError('synthetic lost local archive response')):
            with self.assertRaises(OSError): self.retire()
        self.assertEqual(pending.inspect(self.project),self.pending)
        with self.assertRaises((RuntimeError,ValueError)):
            with ClusterLock(self.project): pass
        self.assertEqual(self.finalize()['status'],'completed')
        self.assertEqual(pending.inspect(self.project),{'status':'absent','blocked':False})
        self.assertEqual(json.loads((self.project/contract.PATHS[2]).read_text())['generation'],2)

    def test_retirement_crash_after_archive_preserves_original_inode(self):
        self.prepare(); self.assertEqual(self.finalize()['status'],'completed')
        original=ops._publish_once
        def publish(files,path,value):
            if path.endswith('/receipt.json') and path.startswith(pending.HISTORY):
                raise OSError('synthetic crash before retirement receipt')
            return original(files,path,value)
        with patch.object(ops,'_publish_once',side_effect=publish):
            with self.assertRaises(OSError): self.retire()
        self.assertEqual(pending.inspect(self.project),self.pending)
        self.assertFalse((self.project/'private/pending-generation').exists())
        with self.assertRaises((RuntimeError,ValueError)):
            with ClusterLock(self.project): pass
        with patch.object(ops,'_replace',side_effect=AssertionError('retirement cannot rewrite generation')):
            self.assertEqual(self.finalize()['status'],'completed')
        with ClusterLock(self.project): pass

    def test_retired_history_tampering_and_unknown_claim_block_admission(self):
        self.prepare(); self.assertEqual(self.finalize()['status'],'completed'); self.retire()
        receipt=pending.HISTORY+'/'+self.pending['sha256']+'/receipt.json'
        self.write(receipt,{'complete':True})
        with self.assertRaises((RuntimeError,ValueError)):
            with ClusterLock(self.project): pass
        self.assertEqual(pending.inspect(self.project),{'status':'invalid','blocked':True})

    def test_retirement_failed_final_fsync_stays_blocked_until_explicit_finalize(self):
        self.prepare(); self.assertEqual(self.finalize()['status'],'completed')
        actual=ops.os.fsync
        failed=[]
        claim=self.project/pending.HISTORY/self.pending['sha256']
        def fsync(fd):
            route=os.readlink('/proc/self/fd/'+str(fd))
            if (route==str(claim) and (claim/'receipt.json').exists()
                    and not (claim/'.retirement-failed').exists() and not failed):
                failed.append(True)
                raise OSError('synthetic missing final directory durability')
            return actual(fd)
        with patch.object(pending.os,'fsync',side_effect=fsync):
            with self.assertRaises(OSError): self.retire()
        self.assertEqual(failed,[True])
        self.assertEqual(pending.inspect(self.project),self.pending)
        with self.assertRaises((RuntimeError,ValueError)):
            with ClusterLock(self.project): pass
        self.assertEqual(self.finalize()['status'],'completed')
        with ClusterLock(self.project): pass

    def test_unknown_retirement_claim_cannot_release_completed_barrier(self):
        self.prepare(); self.assertEqual(self.finalize()['status'],'completed')
        (self.project/pending.HISTORY/('f'*64)).mkdir(parents=True,mode=0o700)
        self.assertEqual(pending.inspect(self.project),{'status':'invalid','blocked':True})
        with self.assertRaises((RuntimeError,ValueError,OSError)):
            with ClusterLock(self.project): pass

    def test_exact_temporary_write_recovers_but_foreign_temporary_blocks(self):
        self.prepare()
        with patch.object(ops.os,'replace',side_effect=OSError('synthetic crash after file fsync')):
            self.assertEqual(self.finalize()['status'],'blocked')
        self.assertEqual(ops.inspect_generation(self.project,self.run,self.generation_sha,now=self.now)['status'],'before')
        target=self.project/'private/.deployment-plan.json.fresh-generation.tmp'
        exact_raw=target.read_bytes(); target.write_bytes(b'foreign')
        self.assertEqual(self.finalize()['status'],'blocked')
        target.write_bytes(exact_raw)
        self.assertEqual(self.finalize()['status'],'completed')
