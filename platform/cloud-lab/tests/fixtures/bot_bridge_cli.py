"""Launcher fixture: isolate enclosing Git metadata, never runtime authorization."""
import importlib.util
import os
from pathlib import Path
import sys
from unittest.mock import patch

root = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location('bot_cli_fixture', Path(__file__).resolve().parents[2]/'tools/bot_bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
exists = Path.exists
original = bridge.probe.HTTPSClient.__call__

def drop_ack(self, method, path, body, headers):
    result = original(self, method, path, body, headers)
    if method == 'POST' and path == '/api/commands':
        raise OSError('synthetic loss after server commit')
    return result

with patch.object(Path, 'exists', lambda p: False if p.name == '.git' and not p.parent.is_relative_to(root) else exists(p)):
    if os.environ.get('BOT_TEST_DROP_ACK') == '1':
        with patch.object(bridge.probe.HTTPSClient, '__call__', drop_ack):
            sys.exit(bridge.main(sys.argv[2:]))
    sys.exit(bridge.main(sys.argv[2:]))
