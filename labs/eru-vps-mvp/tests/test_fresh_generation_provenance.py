"""Adversarial owner-reviewed timing source and preparation renewal tests."""
import copy
from datetime import timedelta
import json
import types
import unittest
from unittest.mock import patch

import fresh_generation_ops as ops
from fresh_run_lock import FreshRunLock
import test_fresh_generation_ops as fixtures


class TimingProvenanceTests(unittest.TestCase):
    setUp=fixtures.GenerationStorageTests.setUp
    write=fixtures.GenerationStorageTests.write
    load_acceptance=fixtures.GenerationStorageTests.load_acceptance
    refresh_renewal=fixtures.GenerationStorageTests.refresh_renewal
    prepare=fixtures.GenerationStorageTests.prepare
    finalize=fixtures.GenerationStorageTests.finalize

    def rewrite(self):
        self.input_document['proofs']=[self.write('private/timing-observation.json',self.proof_document)]
        self.input_document['timing']=copy.deepcopy(self.proof_document['timing'])
        self.input=self.write('private/timing-input.json',self.input_document)
        self.refresh_renewal()

    def attempt(self):
        with FreshRunLock(self.project,self.pending) as lock:
            with patch.object(ops,'_assert_current',return_value=types.SimpleNamespace(
                    pending=self.pending,lock=lock,ref=self.renewal)):
                return ops.prepare_generation(self.project,self.run,self.replay_sha,
                    self.input['path'],self.input['sha256'],now=self.now)

    def clock_change(self,kind,changes):
        ref=self.proof_document['clock_intervals'][kind]
        value=json.loads((self.project/ref['path']).read_text()); value.update(changes)
        self.proof_document['clock_intervals'][kind]=self.write(ref['path'],value)
        self.rewrite()

    def test_matching_json_without_raw_sources_cannot_prepare(self):
        for key in ('source','owner_confirmed','reviewed_at','console_queues','clock_intervals'):
            del self.proof_document[key]
        self.rewrite()
        self.assertEqual(self.attempt()['status'],'blocked')

    def test_forged_matching_no_queue_totals_cannot_override_console_sources(self):
        self.proof_document['timing'].update(provider_queue_intervals=[],no_queue_observed=True)
        self.rewrite()
        self.assertEqual(self.attempt()['status'],'blocked')

    def test_duration_summary_must_equal_raw_ticks(self):
        self.clock_change('total',{'completed_monotonic_ns':361000000000})
        self.assertEqual(self.attempt()['status'],'blocked')

    def test_same_clock_identity_cannot_mask_shifted_tick_origin(self):
        self.clock_change('installation',{'started_monotonic_ns':62000000000,
                                          'completed_monotonic_ns':302000000000})
        self.assertEqual(self.attempt()['status'],'blocked')

    def test_clock_identity_drift_is_rejected(self):
        self.clock_change('installation',{'clock_id':'another-clock'})
        self.assertEqual(self.attempt()['status'],'blocked')

    def test_console_source_ref_must_be_in_semantically_verified_chain(self):
        ref=self.proof_document['console_queues'][0]
        row=json.loads((self.project/ref['path']).read_text())
        action=json.loads((self.project/row['action']['path']).read_text())
        row['action']=self.write('private/copy-action.json',action)
        self.proof_document['console_queues'][0]=self.write(ref['path'],row)
        self.rewrite()
        self.assertEqual(self.attempt()['status'],'blocked')

    def test_four_explicit_zero_queue_sources_can_derive_zero(self):
        for i,ref in enumerate(self.proof_document['console_queues']):
            row=json.loads((self.project/ref['path']).read_text())
            row['started_at']=row['requested_at']
            self.proof_document['console_queues'][i]=self.write(ref['path'],row)
        self.proof_document['timing'].update(provider_queue_intervals=[],no_queue_observed=True)
        self.rewrite()
        self.assertEqual(self.attempt()['status'],'generation-prepared')

    def test_expired_original_prepare_renewal_rejects_publication(self):
        self.renewal_document['expires_at']=self.now.isoformat()
        self.renewal=self.write(self.renewal['path'],self.renewal_document)
        self.assertEqual(self.attempt()['status'],'blocked')

    def test_original_review_window_is_historical_not_current_authority(self):
        self.prepare()
        result=ops.inspect_generation(self.project,self.run,self.generation_sha,now=self.now+timedelta(days=1))
        self.assertEqual(result['status'],'before')
        self.assertFalse(result['generation_changed'])

    def test_changed_original_renewal_or_raw_clock_stops_finalization(self):
        self.prepare()
        self.renewal_document['approved']=False
        self.write(self.renewal['path'],self.renewal_document)
        self.assertEqual(self.finalize()['status'],'blocked')
