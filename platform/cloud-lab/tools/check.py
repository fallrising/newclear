#!/usr/bin/env python3
"""Run local implementation checks; preserve logs when launched in shared workspace."""
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
COMPONENT = Path(__file__).resolve().parents[1]
commands = [
    ['node', '--test', '--test-isolation=none', *map(str, sorted((COMPONENT / 'tests').glob('*.test.mjs')))],
    [sys.executable, '-m', 'unittest', 'discover', '-s', str(COMPONENT / 'tests'), '-p', 'test_*.py', '-v'],
]
failed = False
for index, command in enumerate(commands):
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=120)
    output = result.stdout + result.stderr
    print(output, end='')
    if os.environ.get('AGENT_EVIDENCE_DIR'):
        Path(os.environ['AGENT_EVIDENCE_DIR'], f'check-{index}.log').write_text(output)
    failed |= result.returncode != 0
sys.exit(int(failed))
