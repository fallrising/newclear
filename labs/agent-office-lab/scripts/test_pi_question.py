import copy
import hashlib
import json
import os
from pathlib import Path
import runpy
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_pi_work
from remote_cli import LAB

NONCE = '0123456789abcdef0123456789abcdef'
SESSION = 'session-1'


def write_private(path, data):
    path.write_bytes(data)
    path.chmod(0o600)


def valid_tree(tmp_path):
    out = tmp_path / 'out'
    out.mkdir(mode=0o700, parents=True)
    (out / 'workspace').mkdir(mode=0o700)
    q = out / 'question'
    q.mkdir(mode=0o700)
    marker = json.dumps({'schema': 'lab.pi.question.v1', 'session': SESSION, 'index': 1, 'nonce': NONCE}, separators=(',', ':')).encode()
    write_private(q / 'allow-marker.json', marker)
    events = [
        {'type': 'detector_installed', 'session': SESSION, 'provider': 'deepseek', 'model': 'deepseek-flash'},
        {'type': 'confirm_start', 'session': SESSION, 'provider': 'deepseek', 'model': 'deepseek-flash', 'index': 0},
        {'type': 'confirm_result', 'session': SESSION, 'provider': 'deepseek', 'model': 'deepseek-flash', 'index': 0, 'ui': False},
        {'type': 'confirm_start', 'session': SESSION, 'provider': 'deepseek', 'model': 'deepseek-flash', 'index': 1},
        {'type': 'confirm_result', 'session': SESSION, 'provider': 'deepseek', 'model': 'deepseek-flash', 'index': 1, 'ui': True},
        {'type': 'marker_written', 'session': SESSION, 'provider': 'deepseek', 'model': 'deepseek-flash', 'index': 1},
        {'type': 'confirm_start', 'session': SESSION, 'provider': 'deepseek', 'model': 'deepseek-flash', 'index': 2},
        {'type': 'confirm_result', 'session': SESSION, 'provider': 'deepseek', 'model': 'deepseek-flash', 'index': 2, 'ui': False},
        {'type': 'command_complete', 'session': SESSION, 'provider': 'deepseek', 'model': 'deepseek-flash'},
        {'type': 'command_rejected', 'session': SESSION, 'provider': 'deepseek', 'model': 'deepseek-flash'},
    ]
    write_private(out / 'question-events.jsonl', ''.join(json.dumps(e, separators=(',', ':')) + '\n' for e in events).encode())
    office = {
        'provider': 'pi', 'model': 'deepseek/deepseek-flash', 'status': 'question_verified',
        'model_inference_verified': False, 'session_id': SESSION, 'input_path': 'office_ws_terminal_input',
        'question_responses': copy.deepcopy(run_pi_work.QUESTION_RESPONSES), 'question_prompt_starts': 3,
        'question_prompt_ends': 3, 'marker_written_after_allow': True,
        'marker_sha256': __import__('hashlib').sha256(marker).hexdigest(), 'native_question_verified': True,
        'provider_request_detector_installed': True, 'same_session_verified': True,
        'denial_preserved_workspace': True, 'replay_rejected': True, 'cleanup_completed': True,
    }
    office['authenticated_hooks'] = [dict(type=t,status=s,session=SESSION) for t,s in
        [('session','starting')] + [('question','needs_input'),('session','done')] * 3]
    office['states'] = ['starting','idle','needs_input','done','needs_input','done','needs_input','done']
    write_private(out/'pi-events.jsonl', (json.dumps({'type':'session_start','session':SESSION,'provider':'deepseek','model':'deepseek-flash'})+'\n').encode())
    relay = {'records': [], 'client_requests': 0, 'external_requests': 0}
    return out, office, relay


class QuestionVerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out, self.office, self.relay = valid_tree(Path(self.temp.name).resolve())

    def verify(self, nonce=NONCE):
        return run_pi_work.verify_question(self.office, self.relay, self.out, nonce)

    def test_valid_evidence(self):
        self.assertTrue(self.verify())

    def test_malformed_report_fields(self):
        original = copy.deepcopy(self.office)
        for key, value in [('native_question_verified','true'), ('marker_written_after_allow',1),
                           ('session_id','other'), ('model_inference_verified',True),
                           ('marker_sha256',1), ('question_prompt_starts',True),
                           ('question_responses',[None])]:
            with self.subTest(key=key):
                self.office = dict(original, **{key:value})
                self.assertFalse(self.verify())
        self.office = original
        self.office['question_responses'][1]['ui_result'] = 1
        self.assertFalse(self.verify())

    def test_relay_attempt_or_boolean_count_fails(self):
        for relay in ({'records':[{}],'client_requests':0,'external_requests':0},
                      {'records':[],'client_requests':1,'external_requests':0},
                      {'records':[],'client_requests':False,'external_requests':0},
                      {'records':[],'client_requests':0,'external_requests':False}):
            with self.subTest(relay=relay):
                self.relay = relay
                self.assertFalse(self.verify())

    def test_wrong_or_malformed_nonce(self):
        for nonce in ('f'*32, None, 1, [], {}):
            self.assertFalse(self.verify(nonce))

    def test_unexpected_artifact_and_dangling_artifact_link(self):
        result = self.out/'workspace/result.json'
        result.write_text('{}')
        self.assertFalse(self.verify())
        result.unlink()
        result.symlink_to(self.out/'absent')
        self.assertFalse(self.verify())

    def test_marker_shape_type_duplicate_and_size(self):
        marker = self.out/'question/allow-marker.json'
        for raw in ('[]', 'null', '{"index":1,"index":1}', ' '*513,
                    json.dumps({'schema':'lab.pi.question.v1','session':SESSION,'index':True,'nonce':NONCE})):
            with self.subTest(raw=raw[:40]):
                write_private(marker, raw.encode())
                self.office['marker_sha256'] = hashlib.sha256(raw.encode()).hexdigest()
                self.assertFalse(self.verify())

    def test_event_shape_duplicate_and_provider_attempt(self):
        events = self.out/'question-events.jsonl'
        original = events.read_text()
        for raw in ('[]\n', 'null\n', '{"type":"confirm_start","type":"confirm_start"}\n',
                    original.replace('false','true',1), original + '{"type":"provider_request_attempt"}\n',
                    ' '*65537):
            with self.subTest(raw=raw[:40]):
                write_private(events, raw.encode())
                self.assertFalse(self.verify())

    def test_marker_symlink_fifo_hardlink_and_permissions(self):
        marker = self.out/'question/allow-marker.json'
        original = marker.read_bytes()
        marker.chmod(0o644)
        self.assertFalse(self.verify())
        marker.unlink()
        marker.symlink_to(self.out/'absent')
        self.assertFalse(self.verify())
        marker.unlink()
        os.mkfifo(marker,0o600)
        self.assertFalse(self.verify())
        marker.unlink()
        write_private(marker, original)
        os.link(marker, self.out/'linked-marker')
        self.assertFalse(self.verify())

    def test_parent_directory_symlink_and_permissions(self):
        q = self.out/'question'
        q.chmod(0o755)
        self.assertFalse(self.verify())
        q.chmod(0o700)
        q.rename(self.out/'saved-question')
        q.symlink_to(self.out/'saved-question', target_is_directory=True)
        self.assertFalse(self.verify())

    def test_hook_session_order_and_actual_pi_events(self):
        original = copy.deepcopy(self.office['authenticated_hooks'])
        self.office['authenticated_hooks'][2]['session'] = 'other'
        self.assertFalse(self.verify())
        self.office['authenticated_hooks'] = original[::-1]
        self.assertFalse(self.verify())
        self.office['authenticated_hooks'] = original
        with (self.out/'pi-events.jsonl').open('a') as stream:
            stream.write(json.dumps({'type':'assistant_end','session':SESSION,'provider':'deepseek','model':'deepseek-flash'})+'\n')
        self.assertFalse(self.verify())

    def test_extra_marker_fails(self):
        write_private(self.out/'question/extra.json', b'{}')
        self.assertFalse(self.verify())


class QuestionLauncherTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (LAB/'runs').mkdir(mode=0o700, exist_ok=True)

    def launch(self, mode=None, nonce=NONCE):
        with tempfile.TemporaryDirectory(prefix='launcher-question-', dir=LAB/'runs') as temp:
            out = Path(temp).resolve()
            workspace = out/'workspace'
            workspace.mkdir(mode=0o700)
            (workspace/'.agent-office').mkdir(mode=0o700)
            env = {'LAB_PI_OUT':str(out), 'LAB_PI_WORKSPACE':str(workspace)}
            if mode is not None:
                env.update(LAB_PI_QUESTION_MODE=mode, LAB_PI_QUESTION_NONCE=nonce)
            argv = ['pi','--model','deepseek/deepseek-flash','--extension',str(workspace/'.agent-office/agent-office-pi-extension.mjs')]
            previous = Path.cwd()
            os.chdir(workspace)
            try:
                with patch.dict(os.environ,env,clear=True), patch.object(sys,'argv',argv), patch('remote_cli.installed_cli',return_value=Path('/bin/echo')), patch.object(os,'execve',side_effect=SystemExit(0)) as execute:
                    with self.assertRaises(SystemExit) as caught:
                        runpy.run_path(str(LAB/'scripts/bin/pi'),run_name='__main__')
                    return caught.exception.code, execute.call_args.args[1] if execute.called else None
            finally:
                os.chdir(previous)

    def test_question_extension_added_once(self):
        code, command = self.launch('1')
        self.assertEqual(code,0)
        self.assertEqual(command.count(str(LAB/'scripts/pi_question_check.mjs')),1)
        self.assertEqual(command.count('--extension'),3)

    def test_ordinary_launch_excludes_question_extension(self):
        code, command = self.launch()
        self.assertEqual(code,0)
        self.assertNotIn(str(LAB/'scripts/pi_question_check.mjs'),command)

    def test_malformed_environment_rejected(self):
        for mode, nonce in [('0',NONCE),('true',NONCE),('1','bad')]:
            self.assertEqual(self.launch(mode,nonce),(1,None))

    def test_question_flags_are_exclusive(self):
        for flag in ['--check-startup','--allow-remote','--check-cancel','--check-resume','--check-host-restart','--check-crash']:
            with patch.object(sys,'argv',['run_pi_work.py','--check-question',flag]):
                with self.assertRaises(SystemExit) as caught:
                    run_pi_work.main()
                self.assertEqual(caught.exception.code,2)
        with patch.object(sys,'argv',['run_pi_work.py','--check-question','--authorization-ref','0'*32]):
            with self.assertRaises(ValueError):
                run_pi_work.main()


if __name__ == '__main__':
    unittest.main()
