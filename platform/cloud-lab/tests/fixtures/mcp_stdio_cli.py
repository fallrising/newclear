"""Synthetic stdio/HTTP fixture; only mask enclosing Git and optionally delay ACK."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import time
from unittest.mock import patch

child_mode = sys.argv[1] == 'child'
root = Path(sys.argv[2] if child_mode else sys.argv[1])
name = 'bot_bridge' if child_mode else 'mcp_stdio'
spec = importlib.util.spec_from_file_location('mt_fixture', Path(__file__).resolve().parents[2]/f'tools/{name}.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
if child_mode:
    exists = Path.exists
    original = module.probe.HTTPSClient.__call__
    def transport(self, method, path, body, headers):
        answer = original(self, method, path, body, headers)
        if method == 'POST' and os.environ.get('MT_TEST_DELAY_ACK') == '1':
            time.sleep(30)
        return answer
    with patch.object(Path, 'exists', lambda p: False if p.name == '.git' and not p.parent.is_relative_to(root) else exists(p)), patch.object(module.probe.HTTPSClient, '__call__', transport):
        sys.exit(module.main(sys.argv[3:]))
else:
    original = subprocess.Popen
    def launch(argv, **kwargs):
        return original([sys.executable, __file__, 'child', str(root), *argv[2:]], **kwargs)
    if os.environ.get('MT_TEST_DELAY_ACK') == '1':
        module.CALL_TIMEOUT = 1
    with patch.object(module.subprocess, 'Popen', launch):
        sys.exit(module.main(sys.argv[2:]))
