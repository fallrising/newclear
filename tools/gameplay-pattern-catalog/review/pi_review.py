"""CATALOG_REVIEW_COMMAND adapter for the pi coding agent.

Reads one auto_check payload on stdin, asks pi (headless, no tools, no
session, no context files) for a verdict, and prints the verdict JSON on
stdout. The payload is untrusted data; pi runs with every tool disabled so
text inside it cannot cause actions. Exits non-zero when no JSON object can
be extracted, which auto_check records as checker-error.

Usage:
  CATALOG_REVIEW_COMMAND="python3 review/pi_review.py" python3 review/auto_check.py

PI_BIN overrides the pi path. PI_REVIEW_TIMEOUT (seconds, default 100)
bounds one pi call. PI_REVIEW_THINKING (default low) sets pi's thinking
level; pi's default level often runs past auto_check's 120 s limit. Model
and provider come from pi's own settings unless PI_REVIEW_MODEL is set. No credentials live in this file.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from auto_check import SYSTEM  # noqa: E402


def extract_object(text: str):
    """Return the last top-level JSON object in text that has a verdict."""
    decoder = json.JSONDecoder()
    found = None
    index = text.find('{')
    while index != -1:
        try:
            value, end = decoder.raw_decode(text, index)
        except json.JSONDecodeError:
            index = text.find('{', index + 1)
            continue
        if isinstance(value, dict) and 'verdict' in value:
            found = value
        index = text.find('{', end)
    return found


def ask(payload: str, timeout: int) -> str:
    pi = os.environ.get('PI_BIN') or shutil.which('pi') or str(Path.home() / '.local/bin/pi')
    argv = [pi, '-p', '--no-session', '--no-tools', '--no-context-files', '--no-skills',
            '--no-extensions', '--no-mcp', '--no-prompt-templates', '--no-approve',
            '--system-prompt', SYSTEM, '--thinking', os.environ.get('PI_REVIEW_THINKING', 'low')]
    model = os.environ.get('PI_REVIEW_MODEL')
    if model:
        argv += ['--model', model]
    argv.append('Review this JSON object and answer with the verdict JSON only.\n\n' + payload)
    completed = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, timeout=timeout, check=False)
    if completed.returncode != 0:
        raise RuntimeError('pi exit ' + str(completed.returncode))
    return completed.stdout.decode('utf-8', 'replace')


def main() -> int:
    payload = sys.stdin.read()
    json.loads(payload)
    timeout = int(os.environ.get('PI_REVIEW_TIMEOUT', '100'))
    try:
        verdict = extract_object(ask(payload, timeout))
    except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
        print('pi_review: ' + str(exc), file=sys.stderr)
        return 1
    if verdict is None:
        print('pi_review: no verdict JSON in pi output', file=sys.stderr)
        return 1
    json.dump(verdict, sys.stdout, ensure_ascii=False)
    sys.stdout.write('\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
