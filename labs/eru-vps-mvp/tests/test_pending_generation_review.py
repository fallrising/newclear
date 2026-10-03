"""Independent controller-route checks, using synthetic roots and no real adapters."""
from contextlib import ExitStack, redirect_stdout
import io
import os
from pathlib import Path
import runpy
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import labops
import labctl
import core_patch
import recovery
import network_acceptance
import control_health
import soak
import pending_generation as pending
from app_executor import AppExecutor


class PendingGenerationReviewTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.project = Path(temporary.name)
        self.private = self.project / 'private'
        self.private.mkdir(mode=0o700)
        self.environment = mock.patch.dict(os.environ, {}, clear=False)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        os.environ.pop(labops.LOCK_ENV, None)
        self.pending = self.private / pending.PENDING_DIRECTORY
        self.pending.mkdir(mode=0o700)

    def test_controller_clis_reject_before_operator_or_subprocess(self):
        routes = [
            (labctl, ['execute', '--plan', 'synthetic', '--sha256', 'a' * 64], 'Operator'),
            (labctl, ['reconcile', '--run', 'synthetic'], 'Operator'),
            (labctl, ['execute-worker-loss-cleanup', '--plan', 'synthetic', '--sha256', 'a' * 64], 'Operator'),
            (labctl, ['execute-worker-drain', '--plan', 'synthetic', '--sha256', 'a' * 64, '--apps', 'missing.json'], 'Operator'),
            (core_patch, ['execute', '--plan', 'synthetic', '--sha256', 'a' * 64], 'PatchOperator'),
            (recovery, ['execute', '--plan', 'synthetic', '--sha256', 'a' * 64], 'RecoveryOperator'),
            (network_acceptance, ['execute', '--plan', 'synthetic', '--sha256', 'a' * 64], 'Operator'),
            (network_acceptance, ['cleanup-execute', '--plan', 'synthetic', '--sha256', 'a' * 64], 'Operator'),
            (soak, ['start', '--canary-run', 'synthetic'], 'PatchOperator'),
            (soak, ['stop', '--run', 'synthetic'], 'PatchOperator'),
            (control_health, ['--disk-probe'], 'Operator'),
        ]
        original_umask = os.umask(0o077)
        self.addCleanup(os.umask, original_umask)
        for module, arguments, operator_name in routes:
            with self.subTest(module=module.__name__, arguments=arguments), ExitStack() as stack:
                stack.enter_context(mock.patch.object(module, 'PROJECT', self.project))
                stack.enter_context(mock.patch.object(sys, 'argv', [module.__name__, *arguments]))
                operator = stack.enter_context(mock.patch.object(module, operator_name))
                dispatch = stack.enter_context(mock.patch('subprocess.run'))
                with self.assertRaisesRegex(RuntimeError, 'pending generation'):
                    module.main()
                operator.assert_not_called()
                dispatch.assert_not_called()
                self.assertNotIn(labops.LOCK_ENV, os.environ)

    def test_direct_deploy_and_smoke_entrypoints_reject_before_main(self):
        real_lock = labops.ClusterLock
        for script in ('deploy-lab.py', 'smoke-lab.py'):
            with self.subTest(script=script), mock.patch.object(
                    labops, 'ClusterLock', side_effect=lambda _project: real_lock(self.project)), \
                    mock.patch('subprocess.run') as dispatch:
                with self.assertRaisesRegex(RuntimeError, 'pending generation'):
                    runpy.run_path(str(Path(labctl.__file__).parent / script), run_name='__main__')
                dispatch.assert_not_called()

    def test_app_executor_public_api_blocks_before_plan_or_adapter(self):
        executor = object.__new__(AppExecutor)
        executor.root = self.private / 'operations' / 'apps'
        with mock.patch.object(executor, '_execute_locked') as dispatch:
            with self.assertRaisesRegex(RuntimeError, 'pending generation'):
                executor.execute({}, 'a' * 64)
            dispatch.assert_not_called()

    def test_labctl_status_remains_available_without_operator_or_generation(self):
        with mock.patch.object(labctl, 'PROJECT', self.project), \
                mock.patch.object(sys, 'argv', ['labctl.py', 'status']), \
                mock.patch.object(labctl, 'Operator') as operator, redirect_stdout(io.StringIO()) as out:
            labctl.main()
        self.assertEqual(out.getvalue().strip(), '[]')
        operator.assert_not_called()
        self.assertFalse((self.private / 'operations').exists())

    def test_untrusted_completion_claim_does_not_release_cli_barrier(self):
        (self.pending / pending.RECORD_NAME).write_text(
            '{"status":"complete","blocked":false,"expires_at":"1970-01-01"}')
        with mock.patch.object(labctl, 'PROJECT', self.project), \
                mock.patch.object(sys, 'argv', ['labctl.py', 'execute', '--plan', 'synthetic', '--sha256', 'a' * 64]), \
                mock.patch.object(labctl, 'Operator') as operator:
            with self.assertRaisesRegex(RuntimeError, 'pending generation'):
                labctl.main()
            operator.assert_not_called()
        self.assertEqual(pending.inspect(self.project), {'status': 'invalid', 'blocked': True})

    def test_repointed_root_is_outside_same_backing_root_contract(self):
        # Characterize the explicit trust boundary, not a safe takeover procedure.
        # Replacing the trusted root discards access to its reservation/lock.
        self.private.rename(self.project / 'old-private')
        self.private.mkdir(mode=0o700)
        with labops.ClusterLock(self.project):
            self.assertEqual(pending.inspect(self.project), {'status': 'absent', 'blocked': False})
        self.assertTrue((self.project / 'old-private' / pending.PENDING_DIRECTORY).is_dir())


if __name__ == '__main__':
    unittest.main()
