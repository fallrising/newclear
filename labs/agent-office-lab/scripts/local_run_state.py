"""Local runner outcomes: distinguish user cancellation from failures and cleanup."""
import signal


class RunInterrupted(RuntimeError):
    def __init__(self, signum):
        self.signum = signum
        super().__init__(f'Interrupted by signal {signum}')


def interrupt(signum, _frame):
    raise RunInterrupted(signum)


def failure_status(error, preview_completed=False):
    if isinstance(error, RunInterrupted):
        if preview_completed:
            return 'stopped'
        if error.signum == signal.SIGINT:
            return 'cancelled'
    # SIGTERM may come from the resource guard; never label it a user cancellation.
    return 'failed'


def cleanup_confirmed(errors, office_started, office_report):
    return errors == [] and (not office_started or office_report.get('cleanup_completed') is True)


def exit_code(status):
    if status == 'cancelled':
        return 130
    return 0 if status in ('completed', 'stopped') else 1
