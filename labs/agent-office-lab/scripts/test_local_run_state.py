import signal
import unittest
from local_run_state import RunInterrupted, cleanup_confirmed, exit_code, failure_status, interrupt


class LocalRunStateTest(unittest.TestCase):
    def test_ctrl_c_is_cancelled_and_nonzero(self):
        with self.assertRaises(RunInterrupted) as raised:
            interrupt(signal.SIGINT, None)
        self.assertEqual(failure_status(raised.exception), 'cancelled')
        self.assertEqual(exit_code('cancelled'), 130)

    def test_termination_and_runtime_errors_remain_failures(self):
        for error in (RunInterrupted(signal.SIGTERM), RuntimeError('resource guard stopped'), ValueError('invalid artifact')):
            self.assertEqual(failure_status(error), 'failed')
        self.assertEqual(exit_code('failed'), 1)

    def test_stopping_completed_preview_does_not_claim_new_cancellation(self):
        self.assertEqual(failure_status(RunInterrupted(signal.SIGINT), preview_completed=True), 'stopped')
        self.assertEqual(failure_status(RuntimeError('crash'), preview_completed=True), 'failed')
        self.assertEqual(exit_code('stopped'), 0)

    def test_cleanup_requires_native_proof_only_if_office_started(self):
        self.assertTrue(cleanup_confirmed([], False, {}))
        self.assertTrue(cleanup_confirmed([], True, {'cleanup_completed': True}))
        for errors, office in [([], {}), ([], {'cleanup_completed': False}), (['owned process survived'], {'cleanup_completed': True})]:
            self.assertFalse(cleanup_confirmed(errors, True, office))


if __name__ == '__main__':
    unittest.main()
