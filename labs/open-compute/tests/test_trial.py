"""Offline regressions for retained foreground ownership; no original runtime."""
import copy
import io
import os
import socket
import subprocess
import tempfile
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import Mock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import trial


def manifest():
    return dict(clean=False, workflow=None, identity=dict(account_id='account', database_id='db',
        instance_id='instance', deployment=dict(deployment_id='deploy',version_id='version')),
        port=8787)


def row(count=0, completed=0):
    return dict(job=dict(id='job-1',payload='test',callback_count=count,
        step_nonce='nonce' if count else None,completed=completed),row_count=1)


class OwnerTests(unittest.TestCase):
    def owner(self):
        state, scope = Mock(), Mock()
        owner = trial.TrialOwner(state, manifest(), scope)
        owner.process = Mock()
        owner.process.process.poll.return_value = None
        owner.process.observation_error = None
        owner.process.identity = dict(pid=123, start_ticks=456)
        owner.process.stop.return_value = dict(was_running=True, signal='SIGTERM',forced=False,
            exit_code=0, all_owned_exited=True,observation_error=None)
        owner.api, owner.worker, owner.host = Mock(), Mock(), 'worker.localhost:8787'
        owner.worker.request.return_value = row()
        return owner

    def test_workflow_reservation_saved_before_post_and_uncertain_post_poisoned(self):
        owner = self.owner()
        events=[]
        owner.state.save.side_effect=lambda value: events.append(('save',copy.deepcopy(value)))
        def post(*args,**kwargs):
            events.append(('post',None))
            raise OSError('private response lost')
        owner.api.v4.side_effect=post
        with patch.object(trial,'boot_id',return_value='11111111-1111-1111-1111-111111111111'):
            with self.assertRaises(Exception):owner.workflow('flow-1','job-1')
        self.assertEqual(events[0][0],'save')
        self.assertEqual(events[0][1]['workflow']['phase'],'reserved')
        self.assertEqual(events[1][0],'post')
        self.assertTrue(owner.poisoned)
        with self.assertRaises(trial.TrialError):owner.shutdown()
        self.assertFalse(owner.manifest['clean'])

    def test_reserved_save_failure_never_posts(self):
        owner=self.owner();owner.state.save.side_effect=OSError('full')
        with patch.object(trial,'boot_id',return_value='11111111-1111-1111-1111-111111111111'):
            with self.assertRaises(Exception):owner.workflow('flow-1','job-1')
        owner.api.v4.assert_not_called()
        self.assertTrue(owner.poisoned)

    def test_forced_stop_never_marks_clean(self):
        owner=self.owner();owner.process.stop.return_value['forced']=True
        with self.assertRaises(trial.TrialError):owner.shutdown()
        owner.state.save.assert_not_called()
        self.assertFalse(owner.manifest['clean'])

    def test_unexpected_dead_daemon_never_marks_clean(self):
        owner=self.owner();owner.process.process.poll.return_value=0
        with self.assertRaises(trial.TrialError):owner.shutdown()
        self.assertFalse(owner.manifest['clean'])

    def test_success_stop_saves_clean_only_after_scope_validation(self):
        owner=self.owner();events=[]
        owner.scope.check_owner.side_effect=lambda:events.append('scope')
        owner.state.save.side_effect=lambda m:events.append(('save',m['clean']))
        result=owner.shutdown()
        self.assertEqual(events,['scope',('save',True)])
        self.assertTrue(result['all_owned_exited'])

    def test_conflicting_payload_does_not_write(self):
        owner=self.owner()
        with self.assertRaises(trial.TrialError) as caught:owner.submit('job-1','different')
        self.assertEqual(caught.exception.reason,'conflict')
        owner.worker.request.assert_called_once_with('GET','/jobs/job-1',host=owner.host,expected_status=404)

    def test_supervised_shutdown_defers_clean_to_parent_after_exit(self):
        owner = self.owner()
        owner.supervision = Mock()
        receipt = owner.shutdown()
        self.assertTrue(receipt['all_owned_exited'])
        self.assertFalse(owner.manifest['clean'])
        owner.state.save.assert_called_once()
        owner.supervision.prepare_clean.assert_called_once_with(owner.state)

    def test_projected_row_hashes_nonce_and_rejects_bool_count(self):
        result=trial.project_row(row(1))
        self.assertNotIn('step_nonce',result['job'])
        self.assertEqual(len(result['job']['nonce_sha256']),64)
        bad=row();bad['job']['callback_count']=True
        with self.assertRaises(trial.TrialError):trial.project_row(bad)

    def test_pending_clock_rejects_reboot_reversal_and_skew(self):
        owner=self.owner();w=dict(boot_id='old',created_at=100.,created_monotonic=10.,phase='waiting')
        with patch.object(trial,'boot_id',return_value='new'):
            with self.assertRaises(trial.TrialError):trial.pending_deadline(w)
        with patch.object(trial,'boot_id',return_value='old'),patch.object(trial.time,'time',return_value=99.),patch.object(trial.time,'monotonic',return_value=11.):
            with self.assertRaises(trial.TrialError):trial.pending_deadline(w)
        with patch.object(trial,'boot_id',return_value='old'),patch.object(trial.time,'time',return_value=110.),patch.object(trial.time,'monotonic',return_value=11.):
            with self.assertRaises(trial.TrialError):trial.pending_deadline(w)

    def test_approval_uncertainty_poisoned(self):
        owner=self.owner();owner.manifest['workflow']=dict(id='flow',job_id='job-1',phase='waiting',nonce_sha256='a'*64,completed=False)
        owner.api.v4.side_effect=OSError('secret')
        with patch.object(trial,'pending_deadline',return_value=time.monotonic()+60):
            with self.assertRaises(Exception):owner.approve()
        self.assertTrue(owner.poisoned)
        self.assertFalse(owner.manifest['clean'])

    def test_client_never_retries_lost_write_ack(self):
        with patch.object(trial,'validate_client_path',return_value=Path('/private/control.sock')),patch.object(trial,'client_snapshot',return_value=(1,2,3,4)),patch.object(trial.socket,'socket') as factory:
            sock=factory.return_value.__enter__.return_value
            sock.recv.return_value=b''
            with patch.object(trial,'check_peer'):
                with self.assertRaises(Exception):trial.run_client(type('Args',(),dict(state='/private',command='stop'))())
            self.assertEqual(sock.connect.call_count,1)

    def verify_database(self,detail):
        owner=self.owner();owner.api.v4.side_effect=[[dict(id='account')],detail]
        owner.worker.request.return_value=dict(fixture='open-compute-m1',ok=True)
        records=dict(instances=[dict(name='lab',state='running',instance_id='instance')])
        with patch.object(owner,'live'),patch.object(trial.lab,'command',return_value=trial.json.dumps(records)),patch.object(trial.lab,'deployment_observation',return_value=owner.manifest['identity']['deployment']):
            owner.verify_identity(Path('/fake/binary'))
        return owner

    def test_resume_rejects_foreign_missing_and_wrongtype_database_uuid(self):
        for detail in ({'uuid':'foreign-database'},{},{'uuid':True},{'uuid':None},['db'],{'uuid':'db','extra':'x'*16385}):
            with self.subTest(detail_type=type(detail).__name__):
                with self.assertRaises(trial.TrialError):self.verify_database(detail)

    def test_resume_accepts_exact_bounded_database_uuid(self):
        self.verify_database(dict(uuid='db',name='lab-db'))

    def test_resume_waits_for_instance_before_endpoint_discovery(self):
        owner=self.owner();order=[]
        owner.start=lambda binary:order.append('start')
        owner.wait_instance=lambda binary:order.append('wait_instance')
        owner.connect=lambda:order.append('connect')
        owner.verify_identity=lambda binary:order.append('verify_identity')
        owner.resume(Path('/fake/binary'))
        self.assertEqual(order,['start','wait_instance','connect','verify_identity'])

    def test_instance_gate_waits_through_starting_with_live_owner(self):
        owner=self.owner();owner.live=Mock()
        def data(state,identity='instance'):
            return trial.json.dumps(dict(instances=[dict(name='lab',state=state,instance_id=identity)]))
        def poll(probe,predicate,*args):
            self.assertFalse(predicate(probe()))
            self.assertTrue(predicate(probe()))
        with patch.object(trial.lab,'command',side_effect=[data('starting'),data('running')]) as command,patch.object(trial.lab,'poll',side_effect=poll):
            owner.wait_instance(Path('/fake/binary'))
        self.assertEqual(command.call_count,2)
        self.assertGreaterEqual(owner.live.call_count,4)

    def test_instance_gate_refuses_foreign_running_or_starting_instance(self):
        for state in ('starting','running'):
            owner=self.owner();owner.live=Mock()
            records=trial.json.dumps(dict(instances=[dict(name='lab',state=state,instance_id='foreign')]))
            with self.subTest(state=state),patch.object(trial.lab,'command',return_value=records):
                with self.assertRaises(trial.TrialError) as caught:owner.wait_instance(Path('/fake/binary'))
                self.assertEqual(caught.exception.reason,'deployment')

    def test_get_ceiling_fails_before_transport(self):
        owner=self.owner();owner.gets=64;transport=Mock()
        bounded=trial.BudgetHTTP(owner,transport)
        with self.assertRaises(trial.TrialError) as caught:bounded.request('GET','/health')
        self.assertEqual(caught.exception.reason,'deadline');transport.request.assert_not_called()

    def test_missing_probe_requires_actual_validated_404(self):
        owner=self.owner();transport=Mock()
        transport.request.side_effect=[trial.lab.LabError('HTTP 404 for GET /jobs/job-1: invalid'),trial.lab.LabError('invalid expected missing-job response')]
        bounded=trial.BudgetHTTP(owner,transport)
        with self.assertRaises(trial.lab.LabError):bounded.request('GET','/jobs/job-1',host='x',expected_status=404)
        self.assertEqual(owner.gets,2)

    def test_private_secret_rejects_symlink_hardlink_and_oversize(self):
        with tempfile.TemporaryDirectory() as directory,patch.object(trial,'nofollow_parents'):
            # Leaf metadata is real; inherited workspace ancestors are not a
            # production-admissible trial path and are tested separately.
            path=Path(directory)/'key';path.write_bytes(b'private');path.chmod(0o600)
            self.assertEqual(trial.read_private(path),b'private')
            alias=Path(directory)/'alias';alias.symlink_to(path)
            with self.assertRaises(OSError):trial.read_private(alias)
            alias.unlink();os.link(path,alias)
            with self.assertRaises(trial.TrialError):trial.read_private(path)
            alias.unlink()
            with self.assertRaises(trial.TrialError):trial.read_private(path,limit=2)

    def test_protocol_rejects_extra_frame_and_partial_eof(self):
        request=dict(schema_version=1,command='status',args={})
        for data in (trial.encode_message(request)+trial.encode_message(request),b'{"schema_version":1'):
            left,right=socket.socketpair()
            try:
                right.sendall(data);right.shutdown(socket.SHUT_WR)
                with self.assertRaises(Exception):trial.receive(left,time.monotonic()+1)
            finally:left.close();right.close()

    def test_stalled_protocol_is_bounded(self):
        left,right=socket.socketpair()
        try:
            right.sendall(b'{')
            before=time.monotonic()
            with self.assertRaises((socket.timeout,trial.TrialError)):trial.receive(left,before+.03)
            self.assertLess(time.monotonic()-before,.5)
        finally:left.close();right.close()

    def test_cross_process_protocol_and_same_uid_peer(self):
        left,right=socket.socketpair()
        code="import socket,sys,time,trial; s=socket.socket(fileno=int(sys.argv[1])); trial.check_peer(s); r=trial.receive(s,time.monotonic()+2); trial.send(s,trial.success('stop',dict(was_running=True,signal='SIGTERM',forced=False,exit_code=0,all_owned_exited=True)),time.monotonic()+2); s.close()"
        child=subprocess.Popen([sys.executable,'-c',code,str(right.fileno())],pass_fds=(right.fileno(),),stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        right.close()
        try:
            trial.check_peer(left)
            trial.send(left,dict(schema_version=1,command='stop',args={}),time.monotonic()+2)
            response=trial.receive(left,time.monotonic()+2)
            self.assertTrue(response['data']['all_owned_exited'])
            stdout,stderr=child.communicate(timeout=3)
            self.assertEqual((child.returncode,stdout,stderr),(0,b'',b''))
        finally:
            left.close()
            if child.poll() is None:child.kill();child.wait(timeout=2)

    def test_utf16_payload_bound_rejects_before_any_http(self):
        owner=self.owner()
        with self.assertRaises(trial.TrialError):owner.submit('job-1','😀'*65)
        owner.worker.request.assert_not_called()

    def test_client_detects_socket_replacement_before_sending(self):
        with patch.object(trial,'validate_client_path',return_value=Path('/private/control.sock')),patch.object(trial,'client_snapshot',side_effect=[(1,2,3,4),(1,2,3,5)]),patch.object(trial.socket,'socket') as factory,patch.object(trial,'check_peer'):
            sock=factory.return_value.__enter__.return_value
            with self.assertRaises(trial.TrialError):trial.run_client(type('Args',(),dict(state='/private',command='stop'))())
            sock.sendall.assert_not_called()

    def test_shutdown_save_failure_is_sticky_and_retains_dirty(self):
        owner=self.owner();owner.state.save.side_effect=OSError('full')
        with self.assertRaises(OSError):owner.shutdown()
        self.assertTrue(owner.poisoned)
        self.assertFalse(owner.manifest['clean'])

    def test_readiness_transient_error_does_not_shadow_http_module(self):
        owner=self.owner();owner.scope.path=MagicMock()
        http=Mock();http.request.side_effect=[OSError('not ready'),{}]
        def poll(probe,predicate,*args):
            self.assertFalse(probe());self.assertTrue(probe())
        with patch.object(trial.lab,'Process',return_value=owner.process),patch.object(trial,'BudgetHTTP',return_value=http),patch.object(trial.lab,'poll',side_effect=poll),patch.object(owner,'live'):
            owner.start(Path('/fake/binary'))

    def test_frame_in_later_chunk_is_rejected(self):
        frame=trial.encode_message(dict(schema_version=1,command='status',args={}))
        connection=Mock();connection.recv.side_effect=[frame,frame,b'']
        with self.assertRaises(Exception):trial.receive(connection,time.monotonic()+1)

    def test_owner_start_records_dirty_before_spawning(self):
        owner=self.owner();events=[]
        owner.manifest['clean']=True
        owner.save=lambda:events.append(('save',owner.manifest['clean']))
        def fail(*args,**kwargs):events.append(('spawn',None));raise OSError('spawn failed')
        with patch.object(trial.lab,'Process',side_effect=fail):
            with self.assertRaises(OSError):owner.start(Path('/fake/binary'))
        self.assertEqual(events,[('save',False),('spawn',None)])

    def test_dirty_manifest_rejected_without_binary_execution(self):
        owner=self.owner();value=dict(owner.manifest,uid=os.geteuid())
        owner.state.load.return_value=value
        with patch.object(trial.os,'geteuid',return_value=1000),patch.object(trial.os,'getuid',return_value=1000):
            value['uid']=1000
            with self.assertRaises(trial.TrialError) as caught:trial.clean_manifest(owner.state)
        self.assertEqual(caught.exception.reason,'dirty')

    def test_unsafe_ancestor_is_rejected_before_client_connect(self):
        unsafe=type('Info',(),dict(st_mode=0o40775,st_uid=os.geteuid()))()
        with patch.object(Path,'lstat',return_value=unsafe):
            with self.assertRaises(trial.TrialError):trial.validate_client_path('/owned/state')

    def test_error_response_has_no_exception_details(self):
        result=trial.failure('serve',OSError('/secret/key token private'))
        self.assertEqual(result,dict(schema_version=1,command='serve',result='failed',error='io',data={}))


if __name__=='__main__':unittest.main()
