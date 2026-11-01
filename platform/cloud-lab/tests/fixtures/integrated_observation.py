"""Local-only integration: real HTTP/self and kernel socket, synthetic CF envelopes."""
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys
import threading
import time
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('integration', ROOT / 'tools/integrate_authorization.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
directory = Path(sys.argv[1])
fixture = json.loads((directory / 'integration.json').read_text())
calls = []


def request(options):
    calls.append(options)
    if options['path'].endswith('/settings'):
        result = {'bindings': fixture['bindings']}
    elif options['path'].endswith('/query'):
        assert options['body'] == {'sql': m.source.SQL}
        connection = sqlite3.connect((directory / 'local.sqlite').as_uri() + '?mode=ro', uri=True)
        connection.row_factory = sqlite3.Row
        try:
            result = [{'success': True, 'results': [dict(row) for row in connection.execute(sql)]}
                      for sql in m.source.SQL.split(';') if sql.strip()]
        finally:
            connection.close()
    else:
        assert options['path'].endswith('/access/service_tokens/' + fixture['token']['id'])
        result = fixture['token']
    return {'success': True, 'status': 200, 'result': result}


config = m.runner.read_inspection_config(directory / 'runner.json', True)
socket_path = directory / 'resident.sock'
# The launcher fixture lives below a Git ancestor. Only that boundary is patched;
# mode/owner/no-follow, HMAC HTTP and all kernel/config/FLOCK checks stay real.
with patch.object(m.auth.files, 'require_outside_checkout'):
    with m.runner.InstanceLock(config.journal_path) as lock:
        with m.runner.ResidentObservation(socket_path, config, lock, time.time() + 60,
                                         time.monotonic() + 60, threading.Event()):
            m.write_collection(directory / 'profile.json', directory / 'collection', request,
                               config_paths={role: directory / (role + '.json') for role in ('bot', 'runner')},
                               resident_socket=socket_path, allow_loopback_http=True)
            report = m.status(directory / 'collection')
assert not socket_path.exists()
assert not (directory / 'runner.sqlite').exists()
print(json.dumps({'report': report, 'management_requests': len(calls)}))
