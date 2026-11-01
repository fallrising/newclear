import unittest
from unittest.mock import patch
from process_ownership import parse_processes, collect_owned, alive_owned, process_table, crash_owned
import signal


class OwnershipTests(unittest.TestCase):
    def test_parse_and_follow_only_root_descendants(self):
        rows = parse_processes('10 1 Sun Nov 1 15:00:00 2026\n11 10 Sun Nov 1 15:00:01 2026\n12 11 Sun Nov 1 15:00:02 2026\n20 1 Sun Nov 1 15:00:00 2026\ninvalid\n')
        owned = collect_owned(rows, {}, 10)
        self.assertEqual(set(owned), {10, 11, 12})
        del rows[10]; rows[11]['parent'] = 1
        self.assertEqual(set(alive_owned(rows, owned)), {11, 12})

    def test_reused_pid_does_not_claim_its_new_children(self):
        rows = {10: {'parent':1,'started':'old'}, 11:{'parent':10,'started':'child'}}
        owned = collect_owned(rows, {}, 10)
        rows = {10:{'parent':1,'started':'new'}, 13:{'parent':10,'started':'unrelated'}}
        self.assertEqual(collect_owned(rows, owned, 10), owned)
        self.assertEqual(alive_owned(rows, owned), [])

    def test_unreadable_snapshot_does_not_claim_everything_exited(self):
        with patch('process_ownership.subprocess.check_output', return_value='invalid format'):
            with self.assertRaisesRegex(RuntimeError, 'process_snapshot_invalid'):
                process_table()

    def test_crash_only_signals_a_matching_owned_identity(self):
        with patch('process_ownership.process_table', return_value={123: {'parent': 1, 'started': 'same'}}), \
                patch('process_ownership.os.kill') as kill:
            for pid, known in [(999, {123:'same'}), (123, {123:'old'}), (True, {123:'same'}), (1, {1:'same'})]:
                with self.assertRaisesRegex(ValueError, 'crash_target_not_owned'):
                    crash_owned(pid, known)
            kill.assert_not_called()
            crash_owned(123, {123:'same'})
            kill.assert_called_once_with(123, signal.SIGKILL)


if __name__ == '__main__':
    unittest.main()
