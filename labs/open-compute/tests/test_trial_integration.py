import copy
import unittest
import tempfile
import time
from pathlib import Path
from unittest.mock import patch, Mock

import trial_integration as trial


class ReportTests(unittest.TestCase):
    def test_success_requires_every_retention_and_shutdown_proof(self):
        report = trial.initial_report()
        report.update(result='passed', phase='complete', error=None,
                      scope_removed=True, evidence_file_written=True)
        report['acceptance'] = {name: 'passed' for name in trial.ACCEPTANCE}
        report['retained'] = {name: True for name in trial.RETAINED}
        report['commands'] = copy.deepcopy(trial.SEQUENCE)
        report['daemon_generations'] = [{'pid': n, 'start_ticks': n} for n in (11, 12, 13)]
        stop = dict(was_running=True, signal='SIGTERM', forced=False,
                    exit_code=0, all_owned_exited=True)
        report['shutdowns'] = [stop.copy() for _ in range(3)]
        report['environment']['euid'] = 1001
        self.assertEqual(trial.project_report(report), report)
        for key in trial.RETAINED:
            bad = copy.deepcopy(report)
            bad['retained'][key] = False
            with self.assertRaises(trial.TrialFailure):
                trial.project_report(bad)
        for mutation in ('forced', 'dead', 'unknown', 'missing', 'reused'):
            bad = copy.deepcopy(report)
            if mutation == 'forced': bad['shutdowns'][1]['forced'] = True
            if mutation == 'dead': bad['shutdowns'][1]['was_running'] = False
            if mutation == 'unknown': bad['shutdowns'][1]['all_owned_exited'] = False
            if mutation == 'missing': bad['commands'].pop(12)
            if mutation == 'reused': bad['daemon_generations'][1] = bad['daemon_generations'][0]
            with self.assertRaises(trial.TrialFailure):
                trial.project_report(bad)

    def test_failed_evidence_cannot_claim_final_acceptance(self):
        report = trial.initial_report()
        self.assertEqual(trial.project_report(report), report)
        report['acceptance']['M7-05'] = 'passed'
        with self.assertRaises(trial.TrialFailure): trial.project_report(report)

    def test_reports_reject_secret_injection_and_bool_identifiers(self):
        report = trial.initial_report()
        for mutation in ('extra', 'path', 'bool', 'nan'):
            bad = copy.deepcopy(report)
            if mutation == 'extra': bad['token'] = 'private'
            if mutation == 'path': bad['error'] = '/home/private/token'
            if mutation == 'bool': bad['daemon_generations'] = [{'pid': True, 'start_ticks': 2}]
            if mutation == 'nan': bad['environment']['euid'] = float('nan')
            with self.assertRaises(trial.TrialFailure): trial.project_report(bad)

    def test_partial_command_failure_remains_visible(self):
        report = trial.initial_report()
        report['commands'] = [dict(command='init', result='failed')]
        report['phase'] = 'init'
        self.assertEqual(trial.project_report(report), report)
        report['commands'][0]['command'] = 'shell'
        with self.assertRaises(trial.TrialFailure): trial.project_report(report)


class LifecycleOracleTests(unittest.TestCase):
    def test_full_identity_rejects_same_ids_changed_runtime_or_script(self):
        original={'instance_id':'i','account_id':'a','database_id':'d',
                  'deployment':{'deployment_id':'dep','version_id':'v',
                    'script_etag':'a'*64,'runtime':{'compatibility_date':'2026-09-08'},
                    'bindings':[{'name':'DB','database_id':'d'}]}}
        trial.require_same_identity(original,copy.deepcopy(original))
        for field,new in [('runtime',{'compatibility_date':'2020-01-01'}),
                          ('script_etag','b'*64),('bindings',[])]:
            changed=copy.deepcopy(original);changed['deployment'][field]=new
            with self.assertRaises(trial.TrialFailure): trial.require_same_identity(original,changed)

    def test_cleanup_force_or_unknown_cannot_pass_and_all_children_attempted(self):
        for mode in ('forced','unknown'):
            bad=Mock();bad.process.poll.return_value=None
            bad.live.return_value=False
            bad.observation_error='unknown' if mode=='unknown' else None
            bad.stop.return_value=dict(was_running=True,signal='SIGTERM',forced=mode=='forced',
                exit_code=0,all_owned_exited=True,observation_error=bad.observation_error)
            other=Mock();other.process.poll.return_value=0;other.live.return_value=False
            other.observation_error=None
            with self.assertRaises(trial.TrialFailure): trial.finalize_children([other,bad])
            other.finish_threads.assert_called_once()

    def test_exited_owner_failure_keeps_sanitized_reason_and_receipt(self):
        child=Mock();child.process.poll.return_value=1
        child.observation_error=None
        child.text.return_value='{"schema_version":1,"command":"serve","result":"failed","error":"ownership","data":{}}\n'
        commands=[]
        with self.assertRaises(trial.TrialFailure) as failure:
            trial.observe_ready(child,commands)
        self.assertEqual(str(failure.exception),'ownership')
        self.assertEqual(commands,[dict(command='serve',result='failed')])
        child.finish_threads.assert_called_once()

    def test_cleanup_expired_alarm_does_not_continue_to_next_child(self):
        bad=Mock();bad.process.poll.return_value=None
        bad.stop.side_effect=lambda **kwargs: time.sleep(.2)
        other=Mock()
        started=time.monotonic()
        with self.assertRaises(trial.TrialFailure):
            with trial.lab.m3_deadline(.02,'M7 cleanup') as deadline:
                trial.finalize_children([other,bad],deadline)
        self.assertLess(time.monotonic()-started,.15)
        other.process.poll.assert_not_called()


class PublicationTests(unittest.TestCase):
    def test_write_failure_revokes_success_without_overwriting_existing_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            (root/'report.json').write_bytes(b'existing')
            report=trial.initial_report()
            with self.assertRaises(trial.TrialFailure): trial.write_report(root,report)
            self.assertFalse(report['evidence_file_written'])
            self.assertEqual(report['result'],'failed')
            self.assertEqual(report['acceptance']['M7-05'],'failed')
            self.assertEqual((root/'report.json').read_bytes(),b'existing')

    def test_failed_run_can_publish_only_valid_failed_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            report=trial.initial_report()
            trial.write_report(Path(tmp),report)
            self.assertEqual(report['result'],'failed')
            self.assertTrue(report['evidence_file_written'])
            self.assertTrue((Path(tmp)/'report.json').is_file())


if __name__ == '__main__': unittest.main()
