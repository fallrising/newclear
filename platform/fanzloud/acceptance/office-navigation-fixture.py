"""Isolated real Office HTTP fixture; synthetic saved runs and zero providers."""
import json
from pathlib import Path
import sys
import tempfile
import threading
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'labs/agent-office-lab/scripts'))
import office_console as console
from test_result_redaction_http import revision_run, file_evidence, SECRET_A, SECRET_B

with tempfile.TemporaryDirectory(prefix='office-nav-') as directory:
    lab = Path(directory)
    before = '安全 café 😀\n' + SECRET_A + '\n'
    after = '安全 café 😀\n' + SECRET_B + '\n'
    run = revision_run(lab / 'runs', 'local-work-nav', before, after)
    revision_run(lab / 'runs', 'local-work-failed', before, after, 'failed')
    (lab / 'runs/pi-work-incomplete').mkdir()
    app = console.Console(lab)
    # Test-only credential, never a real user's token or persisted in public evidence.
    app.token = 'SYNTHETIC-NAV-TOKEN'
    server = console.serve(app)
    requests = []
    original_handler = server.RequestHandlerClass
    class ObservedHandler(original_handler):
        def do_GET(self):
            requests.append({'method': 'GET', 'path': self.path,
                             'has_referrer': self.headers.get('Referer') is not None})
            super().do_GET()
        def do_POST(self):
            requests.append({'method': 'POST', 'path': self.path})
            super().do_POST()
    server.RequestHandlerClass = ObservedHandler
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    baseline = file_evidence(lab)
    def stable_state():
        value = app.snapshot()
        # catalog() generates this response timestamp on every read; not stored state.
        assert isinstance(value['results'].pop('generated_at'), str)
        return value
    original_state = stable_state()
    stopped = False
    with patch('office_console.subprocess.Popen', side_effect=AssertionError('provider forbidden')) as spawn:
        print(json.dumps({'port': server.server_port}), flush=True)
        try:
            for line in sys.stdin:
                command = line.strip()
                if command == 'deny':
                    app.token = 'SYNTHETIC-EXPIRED'
                elif command == 'restore':
                    app.token = 'SYNTHETIC-NAV-TOKEN'
                elif command == 'check':
                    assert baseline == file_evidence(lab)
                    assert original_state == stable_state()
                    spawn.assert_not_called()
                    assert not any(r['method'] != 'GET' for r in requests)
                elif command == 'tamper':
                    assert baseline == file_evidence(lab)
                    (run / 'workspace/output.md').write_text('deliberate test tamper')
                    baseline = file_evidence(lab)
                    original_state = stable_state()
                elif command == 'offline':
                    server.shutdown(); server.server_close(); thread.join(5); stopped = True
                elif command == 'finish':
                    assert baseline == file_evidence(lab)
                    assert original_state == stable_state()
                    spawn.assert_not_called()
                    print(json.dumps({'done': True, 'requests': requests, 'source_unchanged': True,
                                      'spawn_count': spawn.call_count}), flush=True)
                    break
                else:
                    raise AssertionError('unknown fixture command')
                print(json.dumps({'command': command, 'ok': True}), flush=True)
        finally:
            if not stopped:
                server.shutdown(); server.server_close(); thread.join(5)
            app.close()
