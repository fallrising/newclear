"""The local command demonstrates durable fake work without provider calls."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from agent_workforce.demo import run_demo

class DemoTests(unittest.TestCase):
    def test_repeat_demo_reuses_command_and_never_marks_external_done(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'demo.sqlite'
            first=run_demo(path)
            again=run_demo(path)
        self.assertEqual(first['command_id'], again['command_id'])
        self.assertEqual(first['operation_id'], again['operation_id'])
        self.assertEqual(first['backend_starts'], 1)
        self.assertEqual(again['backend_starts'], 0)
        self.assertEqual(again['commands'], 1)
        self.assertEqual(again['state'], 'awaiting_review')
        self.assertFalse(again['external_done'])
        self.assertEqual(again['held_reservations'], 0)
        self.assertIsNone(again['usage']['provider_cost'])

    def test_cli_reports_parseable_observations_and_persists_database(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'demo.sqlite'
            run=subprocess.run([sys.executable,'-m','agent_workforce','demo','--db',str(path)],capture_output=True,text=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertTrue(path.is_file())
            output=json.loads(run.stdout)
            self.assertEqual(output['backend'], 'fake')
            self.assertEqual(output['state'], 'awaiting_review')
            self.assertEqual(output['backend_starts'], 1)

    def test_cli_requires_explicit_command_and_database_path(self):
        run=subprocess.run([sys.executable,'-m','agent_workforce','demo'],capture_output=True,text=True)
        self.assertEqual(run.returncode, 2)
        self.assertIn('--db', run.stderr)
