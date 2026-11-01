"""Public fresh-run routing, observation defaults and output privacy."""
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import labctl
import fresh_run_ops as ops


class FreshRunCLITests(unittest.TestCase):
    def invoke(self, command, result=None, error=None):
        name = {'start': 'start_run', 'next': 'next_step', 'status': 'status_run', 'recover': 'recover_run'}[command[0]]
        output = io.StringIO()
        with patch.object(ops, name, return_value=result, side_effect=error) as api, \
                patch.object(labctl, 'Operator', side_effect=AssertionError('legacy remote operator')), \
                patch.object(labctl, 'ClusterLock', side_effect=AssertionError('ordinary pending lock')), \
                patch('sys.argv', ['labctl', 'fresh-run', *command]), redirect_stdout(output):
            labctl.main()
        return json.loads(output.getvalue()), api.call_args

    def test_all_entry_routes_and_private_output(self):
        common = ['--run', 'run-one', '--sha256', 'a'*64]
        for name, args in [('status', common), ('recover', common),
                ('next', common+['--input', 'private/request.json', '--input-sha256', 'b'*64]),
                ('start', ['--plan', 'plan-one', '--sha256', 'a'*64, '--input', 'private/input.json', '--run-id', 'run-one'])]:
            with self.subTest(name=name):
                result, call = self.invoke([name, *args], {'status': 'reserved',
                    'private': 'PRIVATE-SENTINEL', 'nested': {'token': 'PRIVATE-SENTINEL'}})
                self.assertEqual(result, {'status': 'reserved'})
                self.assertEqual(call.args[0], labctl.PROJECT)
        _, call = self.invoke(['recover', *common], {'status': 'reserved'})
        self.assertEqual(call.args[-2:], (None, None))

    def test_error_is_redacted_and_cannot_fall_through_to_operator(self):
        result, _ = self.invoke(['status', '--run', 'run-one', '--sha256', 'a'*64],
            error=ValueError('PRIVATE-SENTINEL'))
        self.assertEqual(result['status'], 'blocked')
        self.assertNotIn('PRIVATE-SENTINEL', json.dumps(result))
