"""Safety regression tests for the disposable ClickHouse fixture runner."""

import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest import mock


RUNNER = Path(__file__).with_name("run-integration.py")
SPEC = importlib.util.spec_from_file_location("prism_clickhouse_runner", RUNNER)
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)

NAME = "prism-ch-integration-0123456789abcdef"
IDENTIFIER = "a" * 64
OTHER_IDENTIFIER = "b" * 64


def inspect_error(*, message, code=1, output=""):
    return subprocess.CalledProcessError(code, ["docker", "inspect", NAME],
                                         output=output, stderr=message)


class RunnerCleanupTest(unittest.TestCase):
    def test_known_absence_uses_exact_name_and_empty_stdout(self):
        for message in (
            f"error: no such object: {NAME}",
            f"Error: No such object: {NAME}",
            f"error: no such container: {NAME}",
            f"ERROR: NO SUCH CONTAINER: {NAME}",
        ):
            with self.subTest(message=message):
                with mock.patch.object(runner, "run", side_effect=inspect_error(message=message + "\n")):
                    self.assertIsNone(runner.inspect_owned(NAME, {}))

    def test_unknown_inspect_errors_are_not_absence(self):
        for error in (
            inspect_error(message="permission denied"),
            inspect_error(message=f"error: no such object: {NAME}\npermission denied"),
            inspect_error(message="error: no such object: another-container"),
            inspect_error(message=f"error: no such object: {NAME}", code=2),
            inspect_error(message=f"error: no such object: {NAME}", output="unexpected"),
        ):
            with self.subTest(error=error.stderr, code=error.returncode, output=error.stdout):
                with mock.patch.object(runner, "run", side_effect=error):
                    with self.assertRaises(subprocess.CalledProcessError):
                        runner.inspect_owned(NAME, {})
        with mock.patch.object(runner, "run", side_effect=subprocess.TimeoutExpired(["docker", "inspect"], 10)):
            with self.assertRaises(subprocess.TimeoutExpired):
                runner.inspect_owned(NAME, {})

    def test_changed_label_or_captured_identity_cannot_be_removed(self):
        for observed in ((IDENTIFIER, "false"), (OTHER_IDENTIFIER, "true")):
            with self.subTest(observed=observed):
                with mock.patch.object(runner, "inspect_owned", return_value=observed), \
                     mock.patch.object(runner, "run") as run:
                    with self.assertRaises(RuntimeError):
                        runner.remove_owned(NAME, {}, IDENTIFIER)
                    run.assert_not_called()

    def test_removal_checks_name_and_id_absence(self):
        with mock.patch.object(runner, "inspect_owned", side_effect=[(IDENTIFIER, "true"), None, None]) as inspect, \
             mock.patch.object(runner, "run") as run:
            self.assertEqual(runner.remove_owned(NAME, {}, IDENTIFIER), IDENTIFIER)
            self.assertEqual([call.args[0] for call in inspect.call_args_list],
                             [NAME, NAME, IDENTIFIER])
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[0][-3:], ["rm", "-f", IDENTIFIER])

    def test_remaining_name_or_id_after_removal_fails_closed(self):
        for observations in (
            [(IDENTIFIER, "true"), (IDENTIFIER, "true")],
            [(IDENTIFIER, "true"), None, (IDENTIFIER, "true")],
        ):
            with self.subTest(observations=observations):
                with mock.patch.object(runner, "inspect_owned", side_effect=observations), \
                     mock.patch.object(runner, "run"):
                    with self.assertRaises(RuntimeError):
                        runner.remove_owned(NAME, {}, IDENTIFIER)

    def test_initial_name_absent_still_checks_captured_id(self):
        with mock.patch.object(runner, "inspect_owned", side_effect=[None, None]) as inspect, \
             mock.patch.object(runner, "run") as run:
            self.assertEqual(runner.remove_owned(NAME, {}, IDENTIFIER), IDENTIFIER)
            self.assertEqual([call.args[0] for call in inspect.call_args_list], [NAME, IDENTIFIER])
            run.assert_not_called()
        with mock.patch.object(runner, "inspect_owned", side_effect=[None, (IDENTIFIER, "true")]), \
             mock.patch.object(runner, "run") as run:
            with self.assertRaises(RuntimeError):
                runner.remove_owned(NAME, {}, IDENTIFIER)
            run.assert_not_called()
        with mock.patch.object(runner, "inspect_owned", side_effect=[None, inspect_error(message="network unavailable")]), \
             mock.patch.object(runner, "run") as run:
            with self.assertRaises(subprocess.CalledProcessError):
                runner.remove_owned(NAME, {}, IDENTIFIER)
            run.assert_not_called()

    def test_known_absence_matches_the_inspected_id(self):
        with mock.patch.object(runner, "run", side_effect=inspect_error(message=f"error: no such object: {IDENTIFIER}")):
            self.assertIsNone(runner.inspect_owned(IDENTIFIER, {}))
        with mock.patch.object(runner, "run", side_effect=inspect_error(message=f"error: no such object: {OTHER_IDENTIFIER}")):
            with self.assertRaises(subprocess.CalledProcessError):
                runner.inspect_owned(IDENTIFIER, {})


if __name__ == "__main__":
    unittest.main()
